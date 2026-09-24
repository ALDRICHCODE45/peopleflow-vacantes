import type { ComponentType } from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "@/features/candidate/prototype-candidate";
import { enrichJob } from "@/features/jobs/enrich";
import type { JobItem } from "@/features/jobs/types";

// VAF-03 RED: the standalone application wizard does not exist yet, so every
// contract below fails until `vacancy-application-wizard.tsx` lands and the
// postular route swaps its `data-pf-application-form-pending` placeholder for it.
const APPLICATION_DIR = join(process.cwd(), "src", "features", "jobs", "application");
const WIZARD_FILE = join(APPLICATION_DIR, "vacancy-application-wizard.tsx");
const ROUTE_FILE = join(process.cwd(), "src", "app", "(public)", "vacantes", "[jobId]", "postular", "page.tsx");
const AVATAR_SRC = "/candidate/ximena-barrera.jpg";
const STEP_LABELS = ["Tus datos", "Tu postulación", "Revisar"] as const;
const EMPTY_LETTER = "Sin carta de presentación";
const RAW_COLOR_UTILITY =
  /(?:^|\s|[a-z-]+:)(?:text|bg|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)-\d{2,3}(?:\s|$)/;
/** Rendered implementation-status disclosure copy is prohibited in the UI. */
const IMPLEMENTATION_STATUS_COPY = /demostraci[óo]n|no se env[íi]a|no se guarda/iu;

const job: JobItem = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e",
  title: "Ingeniera Frontend",
  description: "Construye la experiencia de vacantes.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
  salary_currency: "MXN",
  company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f", name: "Acme" },
};

const wizardProps = {
  job: enrichJob(job),
  identity: CANDIDATE_IDENTITY,
  profile: CANDIDATE_PROFILE,
  avatarSrc: AVATAR_SRC,
};
type WizardProps = typeof wizardProps;
type WizardComponent = ComponentType<WizardProps>;
type WizardUser = ReturnType<typeof userEvent.setup>;

const absentWizard = (): Error => new Error("absent wizard: vacancy-application-wizard.tsx is not implemented");

function readWizardSource(): string {
  if (!existsSync(WIZARD_FILE)) throw absentWizard();
  return readFileSync(WIZARD_FILE, "utf8");
}

async function loadWizard(): Promise<WizardComponent> {
  if (!existsSync(WIZARD_FILE)) throw absentWizard();
  const wizardModule = (await import(/* @vite-ignore */ WIZARD_FILE)) as { VacancyApplicationWizard: WizardComponent };
  return wizardModule.VacancyApplicationWizard;
}

// jsdom lacks the pointer, media-query, and layout APIs the installed Base UI
// primitives read while they open a Select popup and lay out the progress rail.
class TestPointerEvent extends MouseEvent {
  readonly pointerType = "mouse";
  readonly pointerId = 1;
}

function stubBrowserApis() {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, media: "", onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(() => false),
  })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
}

beforeEach(stubBrowserApis);
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function renderWizard() {
  const Wizard = await loadWizard();
  const user = userEvent.setup();
  return { user, ...render(<Wizard {...wizardProps} />) };
}

async function clickContinue(user: WizardUser): Promise<void> {
  await user.click(screen.getByRole("button", { name: /continuar/i }));
}

async function advanceToReview(user: WizardUser): Promise<void> {
  await clickContinue(user);
  await clickContinue(user);
}

async function pasteLetter(user: WizardUser, value: string): Promise<void> {
  const textarea = screen.getByRole("textbox");
  await user.click(textarea);
  await user.paste(value);
}

function currentStepLabel(container: HTMLElement): string {
  const current = container.querySelector('[aria-current="step"]');
  if (current === null) throw new Error("no step marked aria-current=step");
  return (current.textContent ?? "").replace(/\s+/g, " ").trim();
}

function progressText(): string {
  const progress = screen.getByRole("progressbar");
  return `${progress.getAttribute("aria-valuetext") ?? ""} ${progress.textContent ?? ""}`.replace(/\s+/g, " ").trim();
}

describe("VAF-03 wizard source contract", () => {
  it("is a client component composing the installed local shadcn primitives", () => {
    const source = readWizardSource();
    expect(source).toMatch(/["']use client["']/);
    for (const primitive of ["card", "field", "select", "textarea", "progress", "avatar", "badge", "separator", "button"]) {
      expect(source).toMatch(new RegExp(`components/ui/${primitive}["']`));
    }
    expect(source).toMatch(/buttonVariants/);
    // No local re-implementation may shadow the installed primitives.
    expect(source).not.toMatch(/\b(?:function|const)\s+(?:Card|Field|Select|Textarea|Progress|Avatar|Badge|Separator|Button)\b/);
  });

  it("reuses the shared draft vocabulary without transport, storage, router, timer, or remote image", () => {
    const source = readWizardSource();
    expect(source).toMatch(/from\s*["']\.\/application-draft["']/);
    expect(source).toMatch(/APPLICATION_DRAFT_SOURCES|APPLICATION_DRAFT_SOURCE_LABELS/);
    expect(source).toMatch(/next\/link/);
    expect(source).toMatch(/candidato\/login/);
    expect(source).not.toMatch(/\bfetch\(|requestJson|XMLHttpRequest|axios/);
    expect(source).not.toMatch(/next\/navigation|useRouter|useSearchParams|useParams|usePathname/);
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(source).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|Math\.random|Date\.now|new Date\(|randomUUID/);
    expect(source).not.toMatch(/src=\{?["']https?:\/\//);
    expect(source).not.toMatch(/https?:\/\/[^"'\s]+\.(?:png|jpe?g|webp|gif|svg)/i);
    expect(source).not.toMatch(/<form[^>]*(?:method|action)=|onSubmit=/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/);
    expect(source).not.toMatch(/(?:bg|text|border|ring|from|to|via)-primary-\d/);
    expect(source).not.toMatch(RAW_COLOR_UTILITY);
  });

  it("wires the postular route to the wizard with the frozen candidates and local portrait", () => {
    const route = readFileSync(ROUTE_FILE, "utf8");
    expect(route).not.toMatch(/data-pf-application-form-pending/);
    expect(route).toMatch(/vacancy-application-wizard["']/);
    expect(route).toMatch(/from\s*["']@\/features\/candidate\/prototype-candidate["']/);
    const wizardTag = route.match(/<VacancyApplicationWizard\b[\s\S]*?\/?>/)?.[0] ?? "";
    expect(wizardTag).not.toBe("");
    expect(wizardTag).toMatch(/job=\{enrichJob\(result\.job\)\}/);
    expect(wizardTag).toMatch(/identity=\{CANDIDATE_IDENTITY\}/);
    expect(wizardTag).toMatch(/profile=\{CANDIDATE_PROFILE\}/);
    expect(wizardTag).toMatch(/avatarSrc="\/candidate\/ximena-barrera\.jpg"/);
  });
});

describe("VAF-03 step rail and read-only profile", () => {
  it("renders the ordered three-step rail with only the first step current and reachable", async () => {
    const { container } = await renderWizard();
    const rail = [...container.querySelectorAll("ol")].find((list) =>
      STEP_LABELS.every((label) => (list.textContent ?? "").includes(label)),
    );
    expect(rail).toBeDefined();
    const items = within(rail as HTMLElement).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    STEP_LABELS.forEach((label, index) => expect(items[index]).toHaveTextContent(label));
    expect(currentStepLabel(container)).toContain("Tus datos");
    expect(progressText()).toContain("Paso 1 de 3");
    // One forward control only: no control can jump straight to the review step.
    expect(screen.getAllByRole("button", { name: /continuar/i })).toHaveLength(1);
    const jumps = [...container.querySelectorAll("a,button")].filter((node) =>
      /revisar/i.test(node.textContent ?? ""),
    );
    expect(jumps).toHaveLength(0);
  });

  it("shows the frozen Ximena profile read-only and excludes unsupported controls", async () => {
    const { container } = await renderWizard();
    const text = container.textContent ?? "";
    expect(text).toContain(CANDIDATE_IDENTITY.fullName);
    expect(text).toContain(CANDIDATE_PROFILE.professionalTitle);
    expect(text).toContain(CANDIDATE_IDENTITY.email);
    expect(text).toContain(CANDIDATE_PROFILE.phone);
    expect(text).toContain(CANDIDATE_PROFILE.city);
    expect(text).toContain(CANDIDATE_PROFILE.country);
    expect(text).toContain("Solo lectura");
    // The profile states its read-only nature and never discloses implementation status.
    expect(text).not.toMatch(IMPLEMENTATION_STATUS_COPY);
    const portrait = container.querySelector(`img[src="${AVATAR_SRC}"]`);
    expect(portrait).not.toBeNull();
    expect(portrait?.getAttribute("alt") ?? "").toContain(CANDIDATE_IDENTITY.fullName);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(text).not.toMatch(/años de experiencia/i);
    expect(text).not.toMatch(/disponibilidad/i);
    expect(text).not.toMatch(/sube tu cv|curr[íi]culum/i);
  });
});

describe("VAF-03 application step", () => {
  it("defaults to the job board source and maps the shared vocabulary into installed Select items", async () => {
    const { user, container } = await renderWizard();
    await clickContinue(user);
    expect(currentStepLabel(container)).toContain("Tu postulación");
    expect(progressText()).toContain("Paso 2 de 3");
    const combobox = screen.getByRole("combobox");
    expect(combobox).toHaveTextContent("Portal de empleo");
    // The portaled Base UI popup cannot open under jsdom without starving the
    // shared timer queue, so the ordered mapping is pinned structurally. The
    // draft-model test (application-draft.test.ts) stays the exact vocabulary
    // and label authority, and browser E2E covers the real source switch.
    const source = readWizardSource();
    expect(source).toMatch(
      /import\s*\{[^}]*\bSelectContent\b[^}]*\bSelectGroup\b[^}]*\bSelectItem\b[^}]*\}\s*from\s*["']@\/components\/ui\/select["']/,
    );
    expect(source).toMatch(
      /<SelectContent>\s*<SelectGroup>[\s\S]*?SOURCE_ITEMS\.map\([\s\S]*?<SelectItem key=\{option\.value\} value=\{option\.value\}>[\s\S]*?\{option\.label\}[\s\S]*?<\/SelectItem>[\s\S]*?<\/SelectGroup>\s*<\/SelectContent>/,
    );
  });

  it("counts Unicode code points and lets exactly 2000 reach review", async () => {
    const { user, container } = await renderWizard();
    await clickContinue(user);
    await pasteLetter(user, "🙂".repeat(2000));
    expect(container).toHaveTextContent(/2000\s*(?:\/|de)\s*2000/);
    await clickContinue(user);
    expect(progressText()).toContain("Paso 3 de 3");
  });

  it("blocks 2001 code points with an alert and does not skip to review", async () => {
    const { user, container } = await renderWizard();
    await clickContinue(user);
    await pasteLetter(user, "🙂".repeat(2001));
    await clickContinue(user);
    expect(screen.getByRole("alert")).toHaveTextContent(/2000|caracteres|l[íi]mite/i);
    expect(currentStepLabel(container)).toContain("Tu postulación");
    expect(progressText()).toContain("Paso 2 de 3");
  });
});

describe("VAF-03 review step", () => {
  it("reviews the vacancy, profile, source and blank letter, then gates sending behind login", async () => {
    const { user, container } = await renderWizard();
    await advanceToReview(user);
    expect(progressText()).toContain("Paso 3 de 3");
    const text = container.textContent ?? "";
    expect(text).toContain(job.title);
    expect(text).toContain(job.company.name);
    expect(text).toContain(CANDIDATE_IDENTITY.fullName);
    expect(text).toContain(CANDIDATE_IDENTITY.email);
    expect(text).toContain("Portal de empleo");
    expect(text).toContain(EMPTY_LETTER);
    // The review never discloses implementation status or a no-send/no-save claim.
    expect(text).not.toMatch(IMPLEMENTATION_STATUS_COPY);
    const login = screen.getByRole("link", { name: /iniciar sesión para enviar/i });
    expect(login).toHaveAttribute("href", "/candidato/login");
    expect(login.className).toContain("inline-flex");
    expect(login.className).toContain("rounded-2xl");
    // No submit affordance and no success receipt: the prototype never claims a send.
    expect(screen.queryByRole("button", { name: /enviar/i })).toBeNull();
    expect(text).not.toMatch(/postulaci[óo]n (?:enviada|recibida)/i);
  });

  it("reviews the default source and a trimmed cover letter", async () => {
    const { user, container } = await renderWizard();
    await clickContinue(user);
    await pasteLetter(user, "  Hola equipo  ");
    await clickContinue(user);
    expect(progressText()).toContain("Paso 3 de 3");
    const text = container.textContent ?? "";
    expect(text).toContain("Portal de empleo");
    expect(text).toContain("Hola equipo");
    expect(text).not.toContain("  Hola equipo  ");
    expect(text).not.toContain(EMPTY_LETTER);
  });

  it("preserves the selected source and letter across back navigation", async () => {
    const { user, container } = await renderWizard();
    await clickContinue(user);
    await pasteLetter(user, "Hola");
    await clickContinue(user);
    expect(progressText()).toContain("Paso 3 de 3");
    await user.click(screen.getByRole("button", { name: /atrás/i }));
    expect(progressText()).toContain("Paso 2 de 3");
    expect(screen.getByRole("textbox")).toHaveValue("Hola");
    expect(screen.getByRole("combobox")).toHaveTextContent("Portal de empleo");
    await user.click(screen.getByRole("button", { name: /atrás/i }));
    expect(progressText()).toContain("Paso 1 de 3");
    expect(container).toHaveTextContent(CANDIDATE_IDENTITY.fullName);
  });

  it("performs no request or storage write while stepping through the flow", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("network disabled")));
    vi.stubGlobal("fetch", fetchSpy);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const { user } = await renderWizard();
    await advanceToReview(user);
    await user.click(screen.getByRole("button", { name: /atrás/i }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
