import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { CandidateProfile } from "./model";
import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "./prototype-candidate";
import { profileToDraft } from "./profile-draft";
import { ProfileWorkspace } from "./profile-workspace";

// Source as text, so the coupling, token and side-effect contracts stay asserted here.
const SOURCE = readFileSync(join(process.cwd(), "src/features/candidate", "profile-workspace.tsx"), "utf8");
/** Projected draft of the frozen fixture: every seeded value is a plain string. */
const SEEDED = profileToDraft(CANDIDATE_PROFILE);
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\(/u;
/** Strips technical comments so the rendered-copy ban inspects only product strings. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/[^\n]*/gu, " ");
/** Rendered copy may not expose implementation status; `\b` keeps `localStorage` and data ids intact. */
const IMPLEMENTATION_STATUS_COPY = /\b(?:demo|mock|prototip\w*|fictici\w*|prueba|test|local|no disponible|no implementado|no se guarda|no se env[ií]a|no se sube)\b/iu;
const modulesOf = (source: string) => [...new Set([...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))].sort();
const field = (container: HTMLElement, path: string) => container.querySelector(`[data-pf-profile-field="${path}"]`) as HTMLInputElement;
const dirtyLabel = (container: HTMLElement) => container.querySelector("[data-pf-profile-dirty]")?.textContent;
const announcement = (container: HTMLElement) => container.querySelector("[data-pf-profile-announcement]");
const review = () => screen.getByRole("button", { name: "Revisar datos" });
const reset = () => screen.getByRole("button", { name: "Restaurar copia original" });
const identityCard = (container: HTMLElement) => container.querySelector("[data-pf-profile-identity]") as HTMLElement;
const completenessCard = (container: HTMLElement) => container.querySelector("[data-pf-profile-completeness]") as HTMLElement;
const progressBar = (container: HTMLElement) => container.querySelector("[data-slot='progress']") as HTMLElement;
const completionValue = (container: HTMLElement) => container.querySelector("[data-pf-profile-completeness-value]")?.textContent;
/** Same local literal the route passes; keeps the workspace fixture-independent. */
const AVATAR_SRC = "/candidate/ximena-barrera.jpg";
/** The literal five-category tab rail, in reference order, and the exact fields each owns. */
const TAB_LABELS = ["Personal", "Experiencia", "Educación", "Compensación", "Idiomas"] as const;
const TAB_FIELDS: Readonly<Record<(typeof TAB_LABELS)[number], readonly string[]>> = {
  Personal: ["phone", "linkedinUrl", "portfolioUrl", "birthDate", "city", "country"],
  Experiencia: ["professionalTitle", "summary", "currentCompany", "yearsOfExperience"],
  Educación: ["educationLevel", "fieldOfStudy", "skills"],
  Compensación: ["currentSalaryGross", "currentSalaryNet", "expectedSalary", "salaryCurrency", "expectedSalaryPeriod"],
  Idiomas: ["languages"],
};
const ALL_FIELDS = Object.values(TAB_FIELDS).flat();
const tab = (label: (typeof TAB_LABELS)[number]) => screen.getByRole("tab", { name: label });
const show = (label: (typeof TAB_LABELS)[number]): void => { fireEvent.click(tab(label)); };
const activePanel = (container: HTMLElement) => container.querySelector("[data-slot='tabs-content']") as HTMLElement;
const panelFields = (container: HTMLElement) => Array.from(activePanel(container).querySelectorAll("[data-pf-profile-field]")).map((node) => node.getAttribute("data-pf-profile-field") as string);
const panelCards = (container: HTMLElement) => Array.from(activePanel(container).querySelectorAll("[data-pf-profile-section-card]")) as HTMLElement[];
const cardGrid = (container: HTMLElement) => panelCards(container)[0].parentElement as HTMLElement;
const renderWorkspace = (profile: CandidateProfile = CANDIDATE_PROFILE) => render(<ProfileWorkspace identity={CANDIDATE_IDENTITY} profile={profile} avatarSrc={AVATAR_SRC} />);
/** Forces Base UI's AvatarImage to mount so its real `<img>` is observable in jsdom. */
function stubLoadedImage() {
  class LoadedImage {
    complete = true;
    naturalWidth = 1;
    naturalHeight = 1;
    referrerPolicy = "";
    crossOrigin: string | null = null;
    sizes = "";
    srcset = "";
    src = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
  }
  vi.stubGlobal("Image", LoadedImage);
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("profile workspace initial state", () => {
  it("seeds the private draft from the profile with a clean pristine state", () => {
    const { container } = renderWorkspace();
    const seeded = profileToDraft(CANDIDATE_PROFILE);
    show("Experiencia");
    expect(field(container, "professionalTitle")).toHaveValue(seeded.professionalTitle);
    show("Compensación");
    expect(field(container, "salaryCurrency")).toHaveValue("MXN");
    show("Idiomas");
    expect(screen.getByLabelText("Nombre del idioma 1")).toHaveValue("español");
    expect(screen.getByLabelText("Nivel del idioma 2")).toHaveTextContent("Intermedio alto");
    expect(screen.queryByRole("note")).toBeNull();
    expect(dirtyLabel(container)).toBe("Sin cambios pendientes");
    expect(reset()).toBeDisabled();
  });

  it("renders exactly one noValidate form owning the fields, one live region and honest actions", () => {
    const { container } = renderWorkspace();
    const forms = container.querySelectorAll("form");
    expect(forms).toHaveLength(1);
    expect(forms[0]).toHaveAttribute("novalidate");
    expect(forms[0].contains(container.querySelector("[data-pf-profile-fields]"))).toBe(true);
    expect(review()).toHaveAttribute("type", "submit");
    expect(reset()).toHaveAttribute("type", "button");
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(container).not.toHaveTextContent(/\bGuardar\b|\bActualizar\b/u);
  });

  it("hosts the semantic field system inside the active category without icon chips or helper copy", () => {
    const { container } = renderWorkspace();
    expect(activePanel(container).querySelectorAll("[data-slot='field-set']")).toHaveLength(2);
    expect(activePanel(container).querySelectorAll("[data-pf-profile-section-icon]")).toHaveLength(0);
    expect(container.querySelectorAll('[data-slot="field-description"]')).toHaveLength(0);
    expect(container.querySelectorAll("[data-pf-profile-section-hint]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-slot='input-group']")).toHaveLength(5);
    expect(field(container, "city").closest("[data-slot='input-group']")).not.toBeNull();
    show("Experiencia");
    expect(field(container, "yearsOfExperience").closest("[data-slot='input-group']")).not.toBeNull();
    expect(container.querySelector("#profile-yearsOfExperience-hint")).toBeNull();
  });
});

describe("profile workspace local edits", () => {
  it("keeps edits in local state, marks dirty and never mutates the received profile", async () => {
    const user = userEvent.setup();
    const before = JSON.stringify(CANDIDATE_PROFILE);
    const { container } = renderWorkspace();
    await user.type(screen.getByLabelText("Ciudad de residencia"), "!");
    expect(field(container, "city")).toHaveValue(`${CANDIDATE_PROFILE.city}!`);
    expect(dirtyLabel(container)).toBe("Cambios pendientes");
    expect(reset()).toBeEnabled();
    show("Experiencia");
    await user.clear(screen.getByLabelText("Años de experiencia"));
    await user.type(screen.getByLabelText("Años de experiencia"), "11");
    expect(field(container, "yearsOfExperience")).toHaveValue(11);
    expect(JSON.stringify(CANDIDATE_PROFILE)).toBe(before);
  });

  it("clears stale issues and the review announcement on the next edit", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    show("Compensación");
    await user.clear(screen.getByLabelText("Moneda"));
    await user.click(review());
    expect(field(container, "salaryCurrency")).toHaveAttribute("aria-invalid", "true");
    expect(announcement(container)).not.toBeNull();
    show("Personal");
    await user.type(screen.getByLabelText("Ciudad de residencia"), "a");
    expect(container.querySelectorAll("[aria-invalid]")).toHaveLength(0);
    expect(container.querySelectorAll('[id$="-error"]')).toHaveLength(0);
    expect(announcement(container)).toBeNull();
    expect(dirtyLabel(container)).toBe("Cambios pendientes");
  });
});

describe("profile workspace invalid review", () => {
  it("renders scalar issues across tabs, a natural count summary and focuses the first failing control", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    fireEvent.change(screen.getByLabelText("Perfil de LinkedIn"), { target: { value: "no-es-una-url" } });
    show("Experiencia");
    fireEvent.change(screen.getByLabelText("Años de experiencia"), { target: { value: "12.5" } });
    show("Compensación");
    await user.clear(screen.getByLabelText("Moneda"));
    show("Personal");
    await user.click(review());
    expect(announcement(container)).toHaveTextContent("La revisión encontró 3 errores.");
    expect(field(container, "linkedinUrl")).toHaveAttribute("aria-invalid", "true");
    expect(field(container, "linkedinUrl")).toHaveFocus();
    expect(container.querySelector("#profile-linkedinUrl-error")).toHaveTextContent("La URL de LinkedIn no es una URL válida.");
    show("Experiencia");
    expect(field(container, "yearsOfExperience")).toHaveAttribute("aria-invalid", "true");
    show("Compensación");
    expect(field(container, "salaryCurrency")).toHaveAttribute("aria-invalid", "true");
  });

  it("refocuses the same control on every repeated invalid submit", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    show("Compensación");
    await user.clear(screen.getByLabelText("Moneda"));
    await user.click(review());
    expect(field(container, "salaryCurrency")).toHaveFocus();
    screen.getByLabelText("Salario bruto actual").focus();
    expect(field(container, "salaryCurrency")).not.toHaveFocus();
    await user.click(review());
    expect(field(container, "salaryCurrency")).toHaveFocus();
  });

  it("uses the singular count for exactly one issue", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    show("Compensación");
    await user.clear(screen.getByLabelText("Moneda"));
    await user.click(review());
    expect(announcement(container)).toHaveTextContent("La revisión encontró 1 error.");
    expect(announcement(container)).not.toHaveTextContent("errores");
  });
});

describe("profile workspace language focus", () => {
  it("focuses the indexed Select trigger for a missing language level", () => {
    const missingLevel = {
      ...CANDIDATE_PROFILE,
      languages: CANDIDATE_PROFILE.languages.map((language, index) => index === 0 ? { ...language, level: "" } : language),
    } as unknown as CandidateProfile;
    renderWorkspace(missingLevel);
    fireEvent.click(review());
    expect(screen.getByRole("tab", { name: "Idiomas" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Nivel del idioma 1")).toHaveFocus();
  });

  it("focuses the indexed name control for a duplicate language", () => {
    const { container } = renderWorkspace();
    show("Idiomas");
    fireEvent.change(screen.getByLabelText("Nombre del idioma 2"), { target: { value: "español" } });
    fireEvent.click(review());
    expect(screen.getByLabelText("Nombre del idioma 2")).toHaveFocus();
    expect(container.querySelector("#profile-language-1-name-error")).toHaveTextContent("ya está registrado");
  });

  it("focuses the add control for a root languages issue", async () => {
    const user = userEvent.setup();
    const crowded: CandidateProfile = { ...CANDIDATE_PROFILE, languages: Array.from({ length: 21 }, (_, index) => ({ name: `idioma ${index}`, level: "A1" })) };
    const { container } = renderWorkspace(crowded);
    await user.click(review());
    expect(screen.getByRole("button", { name: "Agregar idioma" })).toHaveFocus();
    expect(announcement(container)).toHaveTextContent("La revisión encontró 1 error.");
    expect(container.querySelector("#profile-languages-error")).toHaveTextContent("Puedes registrar hasta 20 idiomas.");
  });
});

describe("profile workspace valid review and reset", () => {
  it("reports a passing review without saving, sending or replacing the profile", async () => {
    const user = userEvent.setup();
    const before = JSON.stringify(CANDIDATE_PROFILE);
    const { container } = renderWorkspace();
    await user.type(screen.getByLabelText("Ciudad de residencia"), "!");
    await user.click(review());
    expect(container.querySelectorAll('[id$="-error"]')).toHaveLength(0);
    expect(announcement(container)).toHaveTextContent("La revisión pasó");
    expect(announcement(container)?.textContent ?? "").not.toMatch(/guard|env|persist/iu);
    expect(field(container, "city")).toHaveValue(`${CANDIDATE_PROFILE.city}!`);
    expect(dirtyLabel(container)).toBe("Cambios pendientes");
    expect(JSON.stringify(CANDIDATE_PROFILE)).toBe(before);
  });

  it("keeps the exact complete copy only while the draft still declares every signal", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.type(screen.getByLabelText("Ciudad de residencia"), "!");
    await user.click(review());
    expect(progressBar(container)).toHaveAttribute("aria-valuenow", "10");
    expect(announcement(container)).toHaveTextContent("tus datos están completos en esta vista");
  });

  it("does not claim completeness when a valid review leaves an optional signal empty", async () => {
    const user = userEvent.setup();
    const before = JSON.stringify(CANDIDATE_PROFILE);
    const { container } = renderWorkspace();
    show("Experiencia");
    await user.clear(screen.getByLabelText("Título profesional"));
    await user.click(review());
    expect(container.querySelectorAll('[id$="-error"]')).toHaveLength(0);
    expect(progressBar(container)).toHaveAttribute("aria-valuenow", "9");
    const text = announcement(container)?.textContent ?? "";
    expect(text).toContain("La revisión pasó");
    expect(text).toContain("90%");
    expect(text).not.toMatch(/guard|env|persist/iu);
    expect(text).not.toContain("completos");
    expect(JSON.stringify(CANDIDATE_PROFILE)).toBe(before);
  });

  it("restores a fresh cloned draft and announces the restore", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.type(screen.getByLabelText("Ciudad de residencia"), "!");
    show("Idiomas");
    await user.click(screen.getByRole("button", { name: "Agregar idioma" }));
    expect(dirtyLabel(container)).toBe("Cambios pendientes");
    await user.click(reset());
    expect(container.querySelectorAll("[data-pf-profile-language-row]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-pf-profile-field='languages'] input:not([aria-hidden='true'])")).toHaveLength(2);
    show("Personal");
    expect(field(container, "city")).toHaveValue(CANDIDATE_PROFILE.city);
    expect(announcement(container)).toHaveTextContent("Restauramos la copia original");
    expect(announcement(container)?.textContent ?? "").not.toMatch(/guard|env|persist/iu);
    expect(dirtyLabel(container)).toBe("Sin cambios pendientes");
    expect(reset()).toBeDisabled();
  });

  it("still restores after an invalid review left field errors on screen", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    show("Compensación");
    await user.clear(screen.getByLabelText("Moneda"));
    await user.click(review());
    expect(field(container, "salaryCurrency")).toHaveAttribute("aria-invalid", "true");
    await user.click(reset());
    expect(field(container, "salaryCurrency")).toHaveValue("MXN");
    expect(container.querySelectorAll('[id$="-error"]')).toHaveLength(0);
    expect(announcement(container)).toHaveTextContent("Restauramos la copia original");
    expect(reset()).toBeDisabled();
  });
});

describe("profile workspace identity summary", () => {
  it("presents the frozen identity and its initials fallback", () => {
    const { container } = renderWorkspace();
    const header = identityCard(container);
    expect(header).toHaveTextContent(CANDIDATE_IDENTITY.fullName);
    expect(header).toHaveTextContent(CANDIDATE_IDENTITY.email);
    expect(container.querySelector("[data-slot='avatar-fallback']")).toHaveTextContent("XB");
    expect(header.querySelectorAll("svg")).toHaveLength(0);
    expect(header.querySelector("[data-pf-profile-headline]")).toHaveTextContent(SEEDED.professionalTitle);
    expect(header.querySelector("[data-pf-profile-context]")).toHaveTextContent(SEEDED.city);
    expect(header.querySelector("[data-pf-profile-context]")).toHaveTextContent(SEEDED.currentCompany);
    expect(header).not.toHaveTextContent(CANDIDATE_IDENTITY.userId);
  });

  it("mirrors the live draft headline and context while the frozen profile stays untouched", async () => {
    const user = userEvent.setup();
    const before = JSON.stringify(CANDIDATE_PROFILE);
    const { container } = renderWorkspace();
    show("Experiencia");
    await user.clear(screen.getByLabelText("Título profesional"));
    await user.type(screen.getByLabelText("Título profesional"), "Líder de plataforma");
    show("Personal");
    await user.clear(screen.getByLabelText("Ciudad de residencia"));
    expect(identityCard(container).querySelector("[data-pf-profile-headline]")).toHaveTextContent("Líder de plataforma");
    expect(identityCard(container).querySelector("[data-pf-profile-context]")).not.toHaveTextContent(SEEDED.city);
    expect(JSON.stringify(CANDIDATE_PROFILE)).toBe(before);
  });

  it("derives the header from the received identity only, with a single-initial fallback", () => {
    const other = { ...CANDIDATE_IDENTITY, fullName: "Aurora", email: "aurora.demo@ejemplo.mx" };
    const { container } = render(<ProfileWorkspace identity={other} profile={CANDIDATE_PROFILE} avatarSrc={AVATAR_SRC} />);
    expect(container.querySelector("[data-slot='avatar-fallback']")).toHaveTextContent("A");
    expect(container).toHaveTextContent("aurora.demo@ejemplo.mx");
    expect(container).not.toHaveTextContent(CANDIDATE_IDENTITY.fullName);
    expect(container).not.toHaveTextContent(CANDIDATE_IDENTITY.email);
  });

  it("states an honest placeholder headline once the draft clears the professional title", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    show("Experiencia");
    await user.clear(screen.getByLabelText("Título profesional"));
    expect(identityCard(container).querySelector("[data-pf-profile-headline]")).toHaveTextContent("Título profesional sin definir");
  });
});

describe("profile workspace completion summary", () => {
  it("derives a shadcn Progress from the seeded draft", () => {
    const { container } = renderWorkspace();
    const bar = progressBar(container);
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute("role", "progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "10");
    expect(bar).toHaveAttribute("aria-valuemax", "10");
    expect(container.querySelector("progress")).toBeNull();
    expect(bar.querySelector("[data-slot='progress-track']")).not.toBeNull();
    expect(bar.querySelector("[data-slot='progress-indicator']")).not.toBeNull();
    expect(completionValue(container)).toBe("10 de 10 datos clave");
    expect(completenessCard(container)).toHaveTextContent("100%");
  });

  it("recomputes the meter as draft fields change and never claims persistence", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    await user.clear(screen.getByLabelText("Ciudad de residencia"));
    expect(progressBar(container)).toHaveAttribute("aria-valuenow", "9");
    expect(completenessCard(container)).toHaveTextContent("90%");
    show("Experiencia");
    await user.clear(screen.getByLabelText("Años de experiencia"));
    expect(progressBar(container)).toHaveAttribute("aria-valuenow", "8");
    expect(completionValue(container)).toBe("8 de 10 datos clave");
    // The separate completion footnote is gone; heading, percentage, bar and count remain.
    expect(completenessCard(container)).not.toHaveTextContent("No se guarda ni se envía");
    expect(completenessCard(container)).not.toHaveTextContent("Se calcula solo con los datos");
    expect(within(completenessCard(container)).getByRole("heading", { level: 3, name: "Avance del perfil" })).toBeInTheDocument();
    expect(completenessCard(container)).toHaveTextContent("80%");
  });

  it("keeps the meter outside the single polite live region", () => {
    const { container } = renderWorkspace();
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(progressBar(container).closest("[aria-live]")).toBeNull();
    expect(completenessCard(container)).not.toHaveAttribute("aria-live");
  });

  it("paints shadcn Progress track and indicator with semantic tokens", () => {
    const { container } = renderWorkspace();
    const bar = progressBar(container);
    const track = bar.querySelector("[data-slot='progress-track']") as HTMLElement;
    const indicator = bar.querySelector("[data-slot='progress-indicator']") as HTMLElement;
    expect(track.className).toContain("bg-muted");
    expect(indicator.className).toContain("bg-primary");
    expect(RAW_COLOR.test(`${bar.className} ${track.className} ${indicator.className}`)).toBe(false);
  });
});

describe("profile workspace card composition", () => {
  it("frames identity, tabs and the active panel inside one shadcn Card below the toolbar", () => {
    const { container } = renderWorkspace();
    const card = container.querySelector("[data-pf-profile-card]") as HTMLElement;
    const toolbar = container.querySelector("[data-pf-profile-toolbar]") as HTMLElement;
    const identity = identityCard(container);
    expect(card).toHaveAttribute("data-slot", "card");
    expect(identity).toHaveAttribute("data-slot", "card-header");
    expect(card.contains(identity)).toBe(true);
    expect(card.querySelector("[data-slot='tabs']")).not.toBeNull();
    expect(card.querySelector("[data-pf-profile-fields]")).not.toBeNull();
    expect(toolbar.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panelCards(container)).toHaveLength(2);
  });

  it("reserves PeopleFlow primary for actions and progress instead of surfaces or the tab rail", () => {
    const { container } = renderWorkspace();
    const card = container.querySelector("[data-pf-profile-card]") as HTMLElement;
    const hero = identityCard(container);
    const role = container.querySelector("[data-pf-profile-headline]") as HTMLElement;
    for (const surface of [card, hero, role]) {
      expect(surface.className).not.toContain("bg-primary");
      expect(surface.className).not.toContain("ring-primary");
      expect(surface.className).not.toContain("border-primary");
    }
    expect(role).toHaveAttribute("data-slot", "badge");
    expect(progressBar(container).querySelector("[data-slot='progress-indicator']")).toHaveClass("bg-primary");
    expect(review().getAttribute("class") ?? "").toContain("bg-primary");
    // The active tab keeps the installed default variant's native paint, so primary stays off the rail.
    expect(tab("Personal").getAttribute("class") ?? "").not.toContain("data-active:text-primary");
    expect(tab("Personal")).toHaveAttribute("aria-selected", "true");
  });

  it("keeps every surface token-painted with no custom inline style", () => {
    const { container } = renderWorkspace();
    const painted = Array.from(container.querySelectorAll("[class]")).map((node) => node.getAttribute("class") ?? "").join(" ");
    expect(RAW_COLOR.test(painted)).toBe(false);
    expect(container.querySelectorAll('[style]:not([aria-hidden="true"]):not([role="presentation"]):not([data-slot="progress-indicator"])')).toHaveLength(0);
  });
});

describe("profile workspace candidate portrait", () => {
  it("renders the local portrait through AvatarImage with a truthful alt and initials fallback", () => {
    stubLoadedImage();
    const { container } = renderWorkspace();
    const image = container.querySelector("[data-slot='avatar-image']") as HTMLImageElement | null;
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe(AVATAR_SRC);
    const alt = image?.getAttribute("alt") ?? "";
    expect(alt).toContain(CANDIDATE_IDENTITY.fullName);
    expect(alt).toMatch(/fotograf|retrato/iu);
  });

  it("still exposes the initials fallback while the image has not loaded", () => {
    const { container } = renderWorkspace();
    expect(container.querySelector("[data-slot='avatar-fallback']")).toHaveTextContent("XB");
  });

  it("renders whichever local portrait source the parent passes instead of a hardcoded path", () => {
    stubLoadedImage();
    const { container } = render(<ProfileWorkspace identity={CANDIDATE_IDENTITY} profile={CANDIDATE_PROFILE} avatarSrc="/candidate/otra-candidata.jpg" />);
    const image = container.querySelector("[data-slot='avatar-image']") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("/candidate/otra-candidata.jpg");
  });

  it("stores the downloaded Unsplash portrait locally with source provenance", () => {
    const jpg = readFileSync(join(process.cwd(), "public/candidate", "ximena-barrera.jpg"));
    expect(jpg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(existsSync(join(process.cwd(), "public/candidate", "ximena-barrera.svg"))).toBe(false);
    const provenance = readFileSync(join(process.cwd(), "public/candidate", "PROVENANCE.txt"), "utf8").toLowerCase();
    for (const claim of ["unsplash", "photo-1535713875002-d1d0cf377fde", "ximena barrera"]) expect(provenance).toContain(claim);
    expect(provenance).not.toContain("no external source");
  });
});

describe("profile workspace contract", () => {
  it("centers the profile content within a readable wide-screen measure", () => {
    const { container } = renderWorkspace();
    const workspace = container.querySelector("[data-pf-profile-workspace]") as HTMLElement;
    expect(workspace.className).toContain("mx-auto");
    expect(workspace.className).toContain("w-full");
    expect(workspace.className).toContain("max-w-screen-2xl");
  });

  it("keeps exactly one responsive padding owner on the workspace root", () => {
    const { container } = renderWorkspace();
    const root = container.querySelector("[data-pf-profile-workspace]") as HTMLElement;
    const tokens = root.className.split(/\s+/u);
    for (const token of ["px-4", "py-4", "lg:px-6"]) expect(tokens, token).toContain(token);
    const owners = Array.from(container.querySelectorAll("[class]")).filter((node) => {
      const value = (node.getAttribute("class") ?? "").split(/\s+/u);
      return value.includes("px-4") && value.includes("lg:px-6");
    });
    expect(owners).toHaveLength(1);
    expect(owners[0]).toBe(root);
  });

  it("keeps 40px targets, visible focus, token-only paint and a responsive toolbar", () => {
    const { container } = renderWorkspace();
    for (const node of [review(), reset()]) {
      const classes = node.getAttribute("class") ?? "";
      expect(classes.includes("min-h-10") && classes.includes("focus-visible:ring-3"), node.textContent ?? "").toBe(true);
    }
    const toolbar = container.querySelector("[data-pf-profile-toolbar]") as HTMLElement;
    expect(toolbar.className).toContain("flex");
    expect(RAW_COLOR.test(Array.from(container.querySelectorAll("[class]")).map((node) => node.getAttribute("class") ?? "").join(" "))).toBe(false);
    expect(container.querySelectorAll('[style]:not([aria-hidden="true"]):not([role="presentation"]):not([data-slot="progress-indicator"])')).toHaveLength(0);
    expect(SOURCE).not.toMatch(/w-\[\d+px\]|overflow-x|(?<!max-)w-screen/u);
  });

  it("orders the upper toolbar before the Card, then identity before tabs like the reference", () => {
    const { container } = renderWorkspace();
    const identity = identityCard(container);
    const toolbar = container.querySelector("[data-pf-profile-toolbar]") as HTMLElement;
    const card = container.querySelector("[data-pf-profile-card]") as HTMLElement;
    const tabs = card.querySelector("[data-slot='tabs']") as HTMLElement;
    expect(within(identity).getByRole("heading", { level: 2 })).toHaveTextContent(CANDIDATE_IDENTITY.fullName);
    expect(toolbar.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.contains(identity)).toBe(true);
    expect(identity.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll("[data-slot='avatar']")).toHaveLength(1);
    expect(review()).toHaveAttribute("data-slot", "button");
    expect(reset()).toHaveAttribute("data-slot", "button");
  });

  it("keeps the upper toolbar in normal flow so it never overlays the fields", () => {
    const { container } = renderWorkspace();
    const toolbar = container.querySelector("[data-pf-profile-toolbar]") as HTMLElement;
    for (const overlay of ["sticky", "fixed", "absolute", "bottom-0", "z-10", "backdrop-blur", "bg-background/"]) {
      expect(toolbar.className, `toolbar must stay in flow, not ${overlay}`).not.toContain(overlay);
    }
    const fields = container.querySelector("[data-pf-profile-fields]") as HTMLElement;
    expect(toolbar.compareDocumentPosition(fields) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("stays a local client orchestrator over the profile with no fixture, transport or persistence", () => {
    expect(SOURCE).toMatch(/^"use client";/u);
    expect(modulesOf(SOURCE)).toEqual(["./model", "./profile-draft", "./profile-form-fields", "@/components/ui/avatar", "@/components/ui/badge", "@/components/ui/button", "@/components/ui/card", "@/components/ui/progress", "@/components/ui/tabs", "lucide-react", "react"]);
    expect(SOURCE).toContain("<Progress");
    expect(SOURCE).not.toContain("<progress");
    for (const forbidden of ["prototype-candidate", "CANDIDATE_PROFILE", "candidateProfileSchema", "fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "indexedDB", "navigator.", "document.cookie", "useRouter", "next/navigation", "setTimeout", "setInterval", "Math.random", "Date.now", "window.", "Notification", "alert(", "console.", "onNavigate", "onSave", "crypto."]) {
      expect(SOURCE, `profile-workspace.tsx must not declare ${forbidden}`).not.toContain(forbidden);
    }
    // Rendered copy must stay product-facing: no implementation-status disclosure.
    expect(IMPLEMENTATION_STATUS_COPY.test(stripComments(SOURCE))).toBe(false);
    expect(SOURCE).not.toContain("data-pf-profile-disclosure");
  });
});

describe("profile workspace reference hierarchy", () => {
  it("separates the profile into five shadcn Tabs in the reference order", () => {
    const { container } = renderWorkspace();
    const root = container.querySelector("[data-slot='tabs']") as HTMLElement;
    expect(root).not.toBeNull();
    const list = root.querySelector("[data-slot='tabs-list']") as HTMLElement;
    expect(list).toHaveAttribute("tabindex", "0");
    expect(list).toHaveAccessibleName("Secciones del perfil");
    expect(list.className).toContain("focus-visible:ring-3");
    const triggers = Array.from(root.querySelectorAll("[data-slot='tabs-trigger']"));
    expect(triggers.map((node) => node.textContent?.trim())).toEqual([...TAB_LABELS]);
    expect(container.querySelectorAll("[data-slot='tabs-content']")).toHaveLength(1);
    expect(tab("Personal")).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the profile tab rail and its triggers on the user-selected installed line variant", () => {
    const { container } = renderWorkspace();
    const root = container.querySelector("[data-slot='tabs']") as HTMLElement;
    const list = root.querySelector("[data-slot='tabs-list']") as HTMLElement;
    // The user-selected installed line variant owns the rail, so the profile requests it explicitly.
    expect(list).toHaveAttribute("data-variant", "line");
    expect(SOURCE).toContain('variant="line"');
    // Transparent line list comes from the installed primitive, not a profile-authored imitation.
    expect(list.className).toContain("bg-transparent");
    expect(list.className).not.toContain("bg-muted");
    expect(SOURCE).not.toContain("data-active:text-primary");
    // Only the mobile-safe rail survives: a bounded width with its own scroll container.
    expect(list.className).toMatch(/max-w-|overflow-(?:x-)?auto/u);
    // Overflowing tabs must start at the leading edge so the first tab stays fully visible.
    expect(list.className).toContain("justify-start");
    // The accessible name and the focusable scroll accommodation stay on the list.
    expect(list).toHaveAccessibleName("Secciones del perfil");
    expect(list).toHaveAttribute("tabindex", "0");
    expect(list.className).toContain("focus-visible:ring-3");
    const triggers = Array.from(root.querySelectorAll("[data-slot='tabs-trigger']")) as HTMLElement[];
    expect(triggers).toHaveLength(TAB_LABELS.length);
    for (const trigger of triggers) {
      const cls = trigger.getAttribute("class") ?? "";
      const label = trigger.textContent ?? "";
      // Native primitive styling: the component's own padding, text color and active paint survive.
      expect(cls, label).toContain("px-1.5");
      expect(cls, label).toContain("py-0.5");
      expect(cls, label).toContain("text-foreground/70");
      expect(cls, label).toContain("data-active:text-foreground");
      // The line variant's active underline is the installed primitive's own class contract.
      expect(cls, label).toContain("group-data-[variant=line]/tabs-list:data-active:after:opacity-100");
      // No profile-authored active color, text color or padding override on the trigger.
      expect(cls, label).not.toContain("data-active:text-primary");
      expect(cls, label).not.toContain("text-foreground/80");
      expect(cls.split(/\s+/u).filter((token) => /px-/u.test(token) && !token.includes(":")), label).toEqual(["px-1.5"]);
    }
  });

  it("mounts only the active category and removes the previous fields on tab change", () => {
    const { container } = renderWorkspace();
    expect([...panelFields(container)].sort()).toEqual([...TAB_FIELDS.Personal].sort());
    expect(container.querySelector("[data-pf-profile-field='salaryCurrency']")).toBeNull();
    show("Compensación");
    expect([...panelFields(container)].sort()).toEqual([...TAB_FIELDS["Compensación"]].sort());
    expect(container.querySelector("[data-pf-profile-field='city']")).toBeNull();
    expect(container.querySelectorAll("[data-slot='tabs-content']")).toHaveLength(1);
  });

  it("keeps all 19 fields reachable across the five tabs without stacking them together", () => {
    const { container } = renderWorkspace();
    const seen = new Set<string>();
    for (const label of TAB_LABELS) {
      show(label);
      for (const path of panelFields(container)) seen.add(path);
    }
    expect(seen.size).toBe(19);
    expect([...seen].sort()).toEqual([...ALL_FIELDS].sort());
  });

  it("distributes two neutral section Cards per category and one wide Card for Idiomas", () => {
    const { container } = renderWorkspace();
    for (const label of ["Personal", "Experiencia", "Educación", "Compensación"] as const) {
      show(label);
      const cards = panelCards(container);
      expect(cards, label).toHaveLength(2);
      // No accent/neutral distinction: both cards share one neutral surface.
      expect(new Set(cards.map((card) => card.className)).size, label).toBe(1);
      for (const card of cards) {
        expect(card.className, label).toContain("ring-border/70");
        expect(card.className, label).not.toContain("ring-primary");
        expect(card.className, label).not.toContain("hover:ring");
      }
      expect(cardGrid(container).className, label).toContain("grid-cols-1");
      expect(cardGrid(container).className, label).toMatch(/:grid-cols-2\b/u);
    }
    show("Idiomas");
    const wide = panelCards(container);
    expect(wide).toHaveLength(1);
    expect(wide[0].className).toContain("md:col-span-2");
    expect(wide[0].className).not.toContain("ring-primary");
    expect(wide[0].className).not.toContain("hover:ring");
    expect(cardGrid(container).children).toHaveLength(1);
  });

  it("leads with a size-24 avatar, the identity block and an upper toolbar before the tabbed Card", () => {
    const { container } = renderWorkspace();
    const avatar = container.querySelector("[data-slot='avatar']") as HTMLElement;
    expect(avatar.className).toMatch(/(?:^|\s)(?:(?:sm|md|lg|xl):)?size-(?:2[4-9]|[3-9]\d)(?:\s|$)/u);
    const header = identityCard(container);
    expect(header).toHaveTextContent(CANDIDATE_IDENTITY.fullName);
    expect(header.querySelector("[data-pf-profile-headline]")).not.toBeNull();
    expect(within(header).getByText(CANDIDATE_IDENTITY.email)).toBeInTheDocument();
    const context = header.querySelector("[data-pf-profile-context]") as HTMLElement;
    expect(context).toHaveTextContent(SEEDED.city);
    expect(context).toHaveTextContent(SEEDED.currentCompany);
    const toolbar = container.querySelector("[data-pf-profile-toolbar]") as HTMLElement;
    expect(toolbar).not.toBeNull();
    expect(toolbar.contains(review())).toBe(true);
    expect(toolbar.contains(reset())).toBe(true);
    expect(within(toolbar).getByRole("status")).toHaveAttribute("aria-live", "polite");
    const card = container.querySelector("[data-pf-profile-card]") as HTMLElement;
    expect(toolbar.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("activates Compensación before focusing Moneda when the first issue is off the active tab", async () => {
    const user = userEvent.setup();
    const { container } = renderWorkspace();
    show("Compensación");
    await user.clear(screen.getByLabelText("Moneda"));
    show("Personal");
    expect(tab("Personal")).toHaveAttribute("aria-selected", "true");
    await user.click(review());
    expect(tab("Compensación")).toHaveAttribute("aria-selected", "true");
    expect(field(container, "salaryCurrency")).toHaveAttribute("aria-invalid", "true");
    expect(field(container, "salaryCurrency")).toHaveFocus();
  });
});
