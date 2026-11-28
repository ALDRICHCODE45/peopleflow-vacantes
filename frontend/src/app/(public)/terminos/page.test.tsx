import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TermsPage, { metadata } from "./page";

afterEach(cleanup);

describe("/terminos (provisional, L23)", () => {
  it("is public and never indexed", () => {
    expect(metadata.title).toBe("Términos y condiciones");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("states first that the text is provisional, then shows only a neutral heading structure", () => {
    const { container } = render(<TermsPage />);
    expect(container.querySelectorAll("main")).toHaveLength(1);
    const banner = screen.getByRole("note");
    expect(banner).toHaveTextContent("Texto provisional: el texto legal definitivo se publicará antes del lanzamiento.");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Términos y condiciones");
    expect(banner.compareDocumentPosition(screen.getByRole("heading", { level: 2, name: "Objeto" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Objeto", "Uso de la plataforma", "Cuentas", "Contenido publicado", "Responsabilidad", "Cambios a estos términos", "Contacto",
    ]);
    // Headings only: no clause text that could read as a legal obligation.
    expect(container.querySelectorAll("main section p")).toHaveLength(0);
  });

  it("links home and to the other provisional page with 44 px targets", () => {
    render(<TermsPage />);
    const privacy = screen.getByRole("link", { name: "Aviso de privacidad" });
    expect(privacy).toHaveAttribute("href", "/aviso-de-privacidad");
    expect(privacy.className).toContain("min-h-11");
    expect(screen.getByRole("link", { name: "Volver al inicio" })).toHaveAttribute("href", "/");
  });
});
