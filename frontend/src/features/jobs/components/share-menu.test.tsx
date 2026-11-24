import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
vi.mock("@/components/ui/dropdown-menu", async () => (await import("@/components/data-table/test-menu")).menuDouble);
import { ShareMenu } from "./share-menu";
import { shareLinks, shareUrl } from "./share-links";

// Stub individual members: replacing `navigator` wholesale breaks user-event.
function stubNavigator(members: { clipboard?: unknown; share?: unknown }) {
  Object.defineProperty(navigator, "clipboard", { value: members.clipboard, configurable: true });
  Object.defineProperty(navigator, "share", { value: members.share, configurable: true });
}
afterEach(() => { cleanup(); stubNavigator({}); });

it("appends origen=compartido, drops the hash and replaces another origen", () => {
  expect(shareUrl("https://x.test/vacantes/1?origen=sitio&q=2#beneficios")).toBe("https://x.test/vacantes/1?q=2&origen=compartido");
  expect(shareUrl("/vacantes/1", "https://x.test")).toBe("https://x.test/vacantes/1?origen=compartido");
});

it("builds the WhatsApp, mail and LinkedIn links from title, company and url", () => {
  const url = "https://x.test/vacantes/1?origen=compartido";
  const links = shareLinks({ title: "Analista", company: "Acme", url });
  expect(links.whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent(`Analista — Acme — ${url}`)}`);
  expect(links.email).toBe(`mailto:?subject=${encodeURIComponent("Analista — Acme")}&body=${encodeURIComponent(`Mira esta vacante: Analista — Acme\n\n${url}`)}`);
  expect(links.linkedin).toBe(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`);
  expect(shareLinks({ title: "Analista", url }).whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent(`Analista — ${url}`)}`);
});

it("opens a menu with copy, WhatsApp, mail and LinkedIn; external links open in a new tab", async () => {
  stubNavigator({ clipboard: { writeText: vi.fn() } });
  render(<ShareMenu title="Analista" company="Acme" url="/vacantes/1" />);
  await userEvent.click(screen.getByRole("button", { name: "Compartir vacante" }));
  expect(screen.getAllByRole("menuitem").map(item => item.textContent)).toEqual(["Copiar enlace", "WhatsApp", "Correo", "LinkedIn"]);
  for (const name of ["WhatsApp", "LinkedIn"]) {
    const link = screen.getByRole("menuitem", { name });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  }
  expect(screen.getByRole("menuitem", { name: "WhatsApp" })).toHaveAttribute("href", expect.stringContaining(encodeURIComponent("/vacantes/1?origen=compartido")));
  expect(screen.getByRole("menuitem", { name: "Correo" })).toHaveAttribute("href", expect.stringMatching(/^mailto:\?subject=/u));
});

it.each([true, false])("reports the actual clipboard outcome and copies the tagged url (success %s)", async success => {
  const writeText = success ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error("denied"));
  stubNavigator({ clipboard: { writeText } });
  render(<ShareMenu title="Analista" url="/vacantes/1" visibleStatus />);
  await userEvent.click(screen.getByRole("button", { name: "Compartir vacante" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Copiar enlace" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(success ? "Enlace copiado" : "Copia la dirección de esta página para compartirla."));
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/vacantes/1?origen=compartido`);
});

it("offers «Más opciones…» only where navigator.share exists and shares title, text and url", async () => {
  stubNavigator({ clipboard: { writeText: vi.fn() } });
  const first = render(<ShareMenu title="Analista" company="Acme" url="/vacantes/1" />);
  await userEvent.click(screen.getByRole("button", { name: "Compartir vacante" }));
  expect(screen.queryByRole("menuitem", { name: "Más opciones…" })).toBeNull();
  first.unmount();
  const share = vi.fn().mockResolvedValue(undefined);
  stubNavigator({ clipboard: { writeText: vi.fn() }, share });
  render(<ShareMenu title="Analista" company="Acme" url="/vacantes/1" />);
  await userEvent.click(screen.getByRole("button", { name: "Compartir vacante" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Más opciones…" }));
  expect(share).toHaveBeenCalledWith({ title: "Analista — Acme", url: `${window.location.origin}/vacantes/1?origen=compartido` });
});

it("supports an icon-only trigger with its own accessible name", () => {
  render(<ShareMenu title="Acme" url="/empresas/acme" label="Compartir empresa" iconOnly />);
  expect(screen.getByRole("button", { name: "Compartir empresa" })).toBeInTheDocument();
});
