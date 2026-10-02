import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CompanySiteEditor } from "./company-site-editor";

/** The three editable sections and the exact field each owns, in content order. */
const SECTIONS = ["Identidad", "Historia", "Capacidades"] as const;
const SECTION_FIELDS: Readonly<
  Record<(typeof SECTIONS)[number], readonly string[]>
> = {
  Identidad: ["name", "tagline"],
  Historia: ["about", "mission"],
  Capacidades: ["whatWeDo"],
};

const featureDir = join(process.cwd(), "src/features/company-site-editor");
const editorSource = readFileSync(join(featureDir, "company-site-editor.tsx"), "utf8");
const draftSource = readFileSync(join(featureDir, "employer-site-draft.ts"), "utf8");

/** Base UI tabs switch through a click in jsdom; the rail stays keyboard-operable. */
const show = (label: (typeof SECTIONS)[number]) =>
  fireEvent.click(screen.getByRole("tab", { name: label }));
const editor = (container: HTMLElement) =>
  container.querySelector("[data-pf-sitio-editor]") as HTMLElement;
const preview = (container: HTMLElement) =>
  container.querySelector("[data-pf-sitio-preview-surface]") as HTMLElement;
const field = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-pf-sitio-input="${name}"]`) as HTMLElement;
const type = (container: HTMLElement, name: string, value: string) =>
  fireEvent.change(field(container, name), { target: { value } });
const outboundLinks = (surface: HTMLElement) =>
  Array.from(surface.querySelectorAll("a")).filter(
    (anchor) => !(anchor.getAttribute("href") ?? "").startsWith("#"),
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("company site editor identity boundary", () => {
  it("starts from the employer identity and never borrows another company's facts or cover", () => {
    const { container } = render(<CompanySiteEditor />);
    const surface = preview(container);

    expect(
      within(surface).getByRole("heading", { level: 2, name: "Nexo Labs" }),
    ).toBeVisible();
    expect(surface.textContent ?? "").not.toMatch(/Acme|montacargas|acme-cover/iu);
    expect(surface.querySelector("img")).toBeNull();
    for (const label of ["Ubicación", "Tamaño del equipo", "Fundada", "Forma de trabajo"]) {
      expect(within(surface).queryByText(label)).toBeNull();
    }
    expect(surface.textContent ?? "").not.toContain("Sitio web de");
  });

  it("exposes only the identity, story and capability fields and keeps every other fact optional", () => {
    const { container } = render(<CompanySiteEditor />);
    const exposed = new Set<string>();

    for (const label of SECTIONS) {
      show(label);
      for (const control of container.querySelectorAll("[data-pf-sitio-input]")) {
        exposed.add(control.getAttribute("data-pf-sitio-input") ?? "");
      }
    }

    expect([...exposed].sort()).toEqual(["about", "mission", "name", "tagline", "whatWeDo"]);
    expect(
      container.querySelectorAll(
        "input[type='file'], input[type='url'], input[type='number']",
      ),
    ).toHaveLength(0);
  });
});

describe("company site editor section navigation", () => {
  it("mounts one editing section at a time", () => {
    const { container } = render(<CompanySiteEditor />);

    for (const label of SECTIONS) {
      show(label);
      const mounted = Array.from(
        container.querySelectorAll("[data-pf-sitio-input]"),
      ).map((control) => control.getAttribute("data-pf-sitio-input"));
      expect(mounted, `${label} mounted fields`).toEqual([...SECTION_FIELDS[label]]);
    }
  });

  it("keeps typed values across section tabs while the preview follows every change", () => {
    const { container } = render(<CompanySiteEditor />);

    type(container, "name", "Nexo Labs Talento");
    type(container, "tagline", "Talento para equipos que crecen.");
    expect(
      within(preview(container)).getByRole("heading", {
        level: 2,
        name: "Nexo Labs Talento",
      }),
    ).toBeVisible();
    expect(preview(container).textContent).toContain("Talento para equipos que crecen.");

    show("Historia");
    type(container, "about", "Somos un equipo de producto.");
    type(container, "mission", "Hacer simple el reclutamiento.");
    show("Capacidades");
    type(container, "whatWeDo", "Diseñamos software, acompañamos equipos");

    expect(preview(container).textContent).toContain("Somos un equipo de producto.");
    expect(preview(container).textContent).toContain("Hacer simple el reclutamiento.");
    expect(preview(container).textContent).toContain("Diseñamos software");

    // Section state lives only in React state and survives every tab change.
    show("Identidad");
    expect(field(container, "tagline")).toHaveValue("Talento para equipos que crecen.");
    show("Historia");
    expect(field(container, "about")).toHaveValue("Somos un equipo de producto.");
    show("Capacidades");
    expect(field(container, "whatWeDo")).toHaveValue("Diseñamos software, acompañamos equipos");
  });
});

describe("company site editor preview", () => {
  it("embeds the shared renderer as an H2/H3 preview with prefixed, unique anchors", () => {
    const { container } = render(<CompanySiteEditor />);
    const surface = preview(container);

    expect(container.querySelectorAll("h1")).toHaveLength(0);
    expect(surface.querySelector("#preview-empresa")).not.toBeNull();

    for (const anchor of Array.from(surface.querySelectorAll("a"))) {
      const href = anchor.getAttribute("href") ?? "";
      if (!href.startsWith("#")) continue;
      expect(href.startsWith("#preview-")).toBe(true);
      expect(surface.querySelector(href), `${href} target`).not.toBeNull();
    }

    const ids = Array.from(container.querySelectorAll("[id]")).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(screen.getByRole("tab", { name: "Identidad" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("keeps the empty vacancy preview honest and leaves only the labelled board link outbound", () => {
    const { container } = render(<CompanySiteEditor />);
    const surface = preview(container);

    expect(surface.textContent).toContain("Nexo Labs todavía no lista sus vacantes aquí");
    // No vacancy list, no invented row and no published-jobs claim.
    expect(within(surface).queryByRole("list", { name: /vacantes/iu })).toBeNull();
    expect(within(surface).queryAllByRole("listitem")).toHaveLength(0);
    expect(
      outboundLinks(surface).map((anchor) => [
        anchor.getAttribute("href"),
        anchor.textContent?.trim(),
      ]),
    ).toEqual([["/vacantes", "Ver vacantes publicadas"]]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("labels the preview as a local draft and offers no save, publish or status affordance", () => {
    const { container } = render(<CompanySiteEditor />);

    const region = screen.getByRole("region", { name: "Vista previa" });
    expect(
      within(region).getByText("Vista previa local; los cambios no se guardan ni publican."),
    ).toBeVisible();

    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(
      container.querySelectorAll(
        "button[type='submit'], [data-pf-sitio-save], [data-pf-sitio-publish]",
      ),
    ).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.textContent ?? "").not.toMatch(
      /guardar|publicar|guardado|publicado|se guardó|se publicó/iu,
    );
  });

  it("keeps the honest placeholders when a field only carries whitespace and falls back to the employer name when cleared", () => {
    const { container } = render(<CompanySiteEditor />);

    // Whitespace-only story text is not authorized content: the placeholder stays.
    show("Historia");
    type(container, "about", "   ");
    type(container, "mission", "\n");
    expect(preview(container).textContent).toContain(
      "Aún no hay una historia aprobada para Nexo Labs.",
    );
    expect(field(container, "about")).toHaveValue("   ");

    // Clearing the identity field never empties the preview heading.
    show("Identidad");
    type(container, "name", "");
    expect(
      within(preview(container)).getByRole("heading", { level: 2, name: "Nexo Labs" }),
    ).toBeVisible();
  });

  it("splits the form and the preview on wide viewports and keeps both columns shrinkable", () => {
    const { container } = render(<CompanySiteEditor />);
    const layout = container.querySelector("[data-pf-sitio-layout]") as HTMLElement;
    const form = container.querySelector("[data-pf-sitio-form]") as HTMLElement;
    const region = container.querySelector("[data-pf-sitio-preview]") as HTMLElement;

    expect(layout.className).toContain("grid");
    expect(layout.className).toContain("lg:grid-cols-2");
    expect(layout.contains(form)).toBe(true);
    expect(layout.contains(region)).toBe(true);
    for (const column of [form, region]) {
      expect(column.className).toContain("min-w-0");
    }
  });
});

describe("company site editor side-effect boundary", () => {
  it("writes no storage and mutates no navigation while the user edits", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const clear = vi.spyOn(Storage.prototype, "clear");
    const hrefBefore = window.location.href;
    const { container } = render(<CompanySiteEditor />);

    type(container, "name", "Nexo Labs Talento");
    show("Historia");
    type(container, "about", "Somos un equipo de producto.");
    show("Capacidades");
    type(container, "whatWeDo", "Diseñamos software");

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(window.location.href).toBe(hrefBefore);
    expect(editor(container)).not.toBeNull();
  });

  it("declares no request, storage, router, upload or raw-color concern", () => {
    for (const forbidden of [
      "fetch(",
      "localStorage",
      "sessionStorage",
      "document.cookie",
      "useRouter",
      "window.location",
      "<form",
      'type="file"',
      'type="url"',
    ]) {
      expect(editorSource, `company-site-editor.tsx must not declare ${forbidden}`).not.toContain(forbidden);
      expect(draftSource, `employer-site-draft.ts must not declare ${forbidden}`).not.toContain(forbidden);
    }

    for (const source of [editorSource, draftSource]) {
      expect(source).not.toMatch(/oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\s*\(/);
    }

    // The editor reuses the shared renderer and the profile-free empty draft.
    expect(editorSource).toContain(
      'from "@/features/company-profile/company-careers-view"',
    );
    expect(editorSource).toContain('const PREVIEW_ID_PREFIX = "preview-"');
    expect(draftSource).toContain("emptyCompanySiteContent");
    // No other company's fixture, cover or profile model is reachable here.
    for (const source of [editorSource, draftSource]) {
      expect(source).not.toMatch(/acme-cover|prototype-companies|montacargas/iu);
    }
  });
});
