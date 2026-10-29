import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { usePathname } from "next/navigation";
import { loadDraftForEditAction, type DraftEditResult } from "@/features/jobs/drafts/reopen/load";
import { draftEditSeedFromRead } from "@/features/jobs/drafts/reopen/seed";
import { filledDraftRead } from "@/features/jobs/drafts/reopen/test-fixture";
import { VACANCY_CONFIG_MODULES, VacancyConfigShell } from "./shell";
import { loadDraftPublicationAction } from "@/features/jobs/drafts/pipeline/publication-actions";
vi.mock("@/features/jobs/drafts/pipeline/publication-actions", () => ({ loadDraftPublicationAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/reopen/load", () => ({ loadDraftForEditAction: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: vi.fn(() => `/empresa/vacantes/${read.id}/configuracion/columnas`) }));
vi.mock("@/components/company-dashboard/site-header", () => ({ SiteHeader: ({ title, parent, status }: { title: React.ReactNode; parent: { label: string; href: string }; status: React.ReactNode }) => <header><h1>{title}</h1><a href={parent.href}>{parent.label}</a>{status}</header> }));
const read = filledDraftRead();
const success = { ok: true, seed: { ...draftEditSeedFromRead(read), lifecycle: { ...read.lifecycle, publication: null, process: null } }, identity: { draftId: read.id, etag: '"etag"' } } as const;
const shell = () => <VacancyConfigShell draftId={read.id}><p>Contenido del apartado</p></VacancyConfigShell>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(usePathname).mockReturnValue(`/empresa/vacantes/${read.id}/configuracion/columnas`);
  vi.mocked(loadDraftForEditAction).mockResolvedValue(success);
  vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "draft", publishedAt: null, missing: [] } });
});
afterEach(cleanup);
it.each([read.fields.title, null])("owns one header with the draft title %s, badge and Pipeline parent", async title => {
  vi.mocked(loadDraftForEditAction).mockResolvedValue({ ...success, seed: { ...success.seed, model: { ...success.seed.model, fields: { ...success.seed.model.fields, title } } } });
  const { container } = render(shell());
  expect(await screen.findByRole("heading", { level: 1, name: title || "Sin título" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Pipeline" })).toHaveAttribute("href", `/empresa/vacantes/${read.id}/pipeline`);
  expect(container.querySelectorAll("header")).toHaveLength(1);
  expect(screen.getByText("Borrador")).toHaveAttribute("data-variant", "info");
  expect(screen.getByText("Borrador")).toHaveAttribute("data-dot");
  expect(screen.getByRole("heading", { level: 2, name: "Configuración de la vacante" })).toBeVisible();
  expect(screen.getByText("Ajusta cómo funciona esta vacante. Los cambios de cada apartado se guardan por separado.")).toBeVisible();
  expect(screen.getByText("Contenido del apartado")).toBeVisible();
});
it.each([["paused", "Pausada", "review"], ["closed", "Cerrada · proceso en curso", "neutral"]] as const)("uses %s lifecycle in the header", async (publication, label, variant) => {
  vi.mocked(loadDraftForEditAction).mockResolvedValue({ ...success, seed: { ...success.seed, lifecycle: { ...success.seed.lifecycle, publication, process: "active" } } });
  render(shell());
  expect(await screen.findByText(label)).toHaveAttribute("data-variant", variant);
});
it("shows the confirmed published state instead of labelling an active vacancy as a draft", async () => {
  vi.mocked(loadDraftForEditAction).mockResolvedValue({ ...success, seed: { ...success.seed, lifecycle: { ...success.seed.lifecycle, publication: "published", process: "active" } } });
  vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "published", publishedAt: "2026-10-18T12:00:00Z", missing: [] } });
  render(shell());
  expect(await screen.findByText("Activa")).toHaveAttribute("data-variant", "accent");
  expect(screen.queryByText("Borrador")).not.toBeInTheDocument();
});
it("does not invent a publication state when its read fails", async () => {
  vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  render(shell());
  expect(await screen.findByText("Contenido del apartado")).toBeVisible();
  expect(screen.queryByText("Borrador")).not.toBeInTheDocument();
  expect(screen.queryByText("Activa")).not.toBeInTheDocument();
});
it("lists only implemented modules with active navigation and descriptions", async () => {
  render(shell());
  const nav = await screen.findByRole("navigation", { name: "Apartados de configuración de la vacante" });
  const links = within(nav).getAllByRole("link");
  expect(VACANCY_CONFIG_MODULES.map(module => module.slug)).toEqual(["columnas", "entrega", "solicitud", "checklist"]);
  expect(links).toHaveLength(VACANCY_CONFIG_MODULES.length);
  for (const [index, module] of VACANCY_CONFIG_MODULES.entries()) {
    expect(links[index]).toHaveTextContent(module.title);
    expect(links[index]).toHaveTextContent(module.description);
    expect(links[index]).toHaveAttribute("href", `/empresa/vacantes/${read.id}/configuracion/${module.slug}`);
    expect(links[index]).toHaveClass("min-h-10");
    if (module.slug === "columnas") {
      expect(links[index]).toHaveAttribute("aria-current", "page");
      expect(links[index]).toHaveClass("bg-card", "text-foreground", "ring-1", "ring-primary/40");
    } else expect(links[index]).not.toHaveAttribute("aria-current");
  }
});
it("does not expose a Subestados link on its obsolete route", async () => {
  vi.mocked(usePathname).mockReturnValue(`/empresa/vacantes/${read.id}/configuracion/subestados`);
  render(shell());
  const nav = await screen.findByRole("navigation", { name: "Apartados de configuración de la vacante" });
  const links = within(nav).getAllByRole("link");
  expect(links[0]).not.toHaveAttribute("aria-current");
  expect(links).toHaveLength(4);
  expect(within(nav).queryByRole("link", { name: /Subestados/ })).not.toBeInTheDocument();
});
it("marks Entrega current after the columns link", async () => {
  vi.mocked(usePathname).mockReturnValue(`/empresa/vacantes/${read.id}/configuracion/entrega`);
  render(shell());
  const nav = await screen.findByRole("navigation", { name: "Apartados de configuración de la vacante" });
  const links = within(nav).getAllByRole("link");
  expect(links[1]).toHaveTextContent("Entrega"); expect(links[1]).toHaveTextContent("Columna de corte, objetivo y fecha compromiso.");
  expect(links[1]).toHaveAttribute("aria-current", "page"); expect(links[0]).not.toHaveAttribute("aria-current");
});
it("marks Solicitud current after Entrega with the management description and icon", async () => {
  vi.mocked(usePathname).mockReturnValue(`/empresa/vacantes/${read.id}/configuracion/solicitud`);
  render(shell());
  const nav = await screen.findByRole("navigation", { name: "Apartados de configuración de la vacante" });
  const links = within(nav).getAllByRole("link");
  expect(links[2]).toHaveTextContent("Solicitud"); expect(links[2]).toHaveTextContent("Fecha de solicitud y plazas a cubrir.");
  expect(links[2]).toHaveAttribute("aria-current", "page"); expect(links[2].querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  expect(links[1]).not.toHaveAttribute("aria-current");
});
it("reserves loading content and withholds the module until the draft is authorized", async () => {
  let resolve!: (value: DraftEditResult) => void;
  vi.mocked(loadDraftForEditAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  const { container } = render(shell());
  expect(screen.getByRole("heading", { level: 1, name: "Configuración" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Cargando configuración");
  expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  expect(screen.queryByText("Contenido del apartado")).not.toBeInTheDocument();
  await act(async () => resolve(success));
  expect(screen.getByText("Contenido del apartado")).toBeVisible();
});
it("replaces the whole area with the draft error, then retries", async () => {
  vi.mocked(loadDraftForEditAction).mockResolvedValueOnce({ ok: false, reason: "not_found" });
  render(shell());
  expect(await screen.findByRole("heading", { name: "No encontramos este borrador" })).toBeVisible();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  expect(screen.queryByText("Contenido del apartado")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByText("Contenido del apartado")).toBeVisible();
  expect(loadDraftForEditAction).toHaveBeenCalledTimes(2);
});
it("does not mark an unrelated pathname as the current module", async () => {
  vi.mocked(usePathname).mockReturnValue(`/empresa/vacantes/${read.id}/configuracion/otro`);
  render(shell());
  const nav = await screen.findByRole("navigation", { name: "Apartados de configuración de la vacante" });
  for (const link of within(nav).getAllByRole("link")) {
    expect(link).not.toHaveAttribute("aria-current");
    expect(link).not.toHaveClass("bg-card");
  }
});
it("ignores the previous vacancy's late draft result", async () => {
  let resolve!: (value: DraftEditResult) => void;
  vi.mocked(loadDraftForEditAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockResolvedValueOnce({ ok: false, reason: "not_found" });
  const { rerender } = render(shell());
  rerender(<VacancyConfigShell draftId="223e4567-e89b-42d3-a456-426614174000"><p>Contenido del apartado</p></VacancyConfigShell>);
  await screen.findByRole("heading", { name: "No encontramos este borrador" });
  await act(async () => resolve(success));
  expect(screen.queryByText("Contenido del apartado")).not.toBeInTheDocument();
  expect(screen.queryByText("Borrador")).not.toBeInTheDocument();
});
it("handles rejected draft reads safely", async () => {
  vi.mocked(loadDraftForEditAction).mockRejectedValueOnce(new Error("network"));
  render(shell());
  expect(await screen.findByRole("heading", { name: "No hubo respuesta del servidor" })).toBeVisible();
});
