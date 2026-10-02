import type { ComponentType } from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
const CANDIDATE_CARD_FILE = join(APPLICATION_DIR, "application-candidate-card.tsx");
const ROUTE_FILE = join(process.cwd(), "src", "app", "(public)", "vacantes", "[jobId]", "postular", "page.tsx");
const AVATAR_SRC = "/candidate/ximena-barrera.jpg";
/** The frozen fixture strings this suite asserts; the prototype declares them all. */
const CANDIDATE_TITLE = CANDIDATE_PROFILE.professionalTitle ?? "";
const CANDIDATE_PHONE = CANDIDATE_PROFILE.phone ?? "";
const CANDIDATE_CITY = CANDIDATE_PROFILE.city ?? "";
const CANDIDATE_COUNTRY = CANDIDATE_PROFILE.country ?? "";
const STEP_LABELS = ["Tus datos", "Tu postulación", "Tu CV", "Revisar"] as const;
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
  vacancySummary: <p data-testid="vacancy-summary-slot">Resumen de la vacante</p>,
};
type WizardProps = typeof wizardProps;
type WizardComponent = ComponentType<WizardProps>;
type WizardUser = ReturnType<typeof userEvent.setup>;

const absentWizard = (): Error => new Error("absent wizard: vacancy-application-wizard.tsx is not implemented");

function readWizardSource(): string {
  if (!existsSync(WIZARD_FILE)) throw absentWizard();
  return readFileSync(WIZARD_FILE, "utf8");
}

/** The client candidate card the wizard owns inside the desktop rail. */
function readCandidateCardSource(): string {
  if (!existsSync(CANDIDATE_CARD_FILE)) throw new Error("absent candidate card: application-candidate-card.tsx is not implemented");
  return readFileSync(CANDIDATE_CARD_FILE, "utf8");
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

async function advanceToCvStep(user: WizardUser): Promise<void> {
  await clickContinue(user);
  await clickContinue(user);
}

async function advanceToReview(user: WizardUser): Promise<void> {
  await advanceToCvStep(user);
  await clickContinue(user);
}

/** Uploads one real file through the shared native CV input. */
async function selectCvFile(user: WizardUser, file: File): Promise<void> {
  const input = document.getElementById("application-cv-file") as HTMLInputElement;
  await user.upload(input, file);
}

/** A real `File` for the local selection; the wizard never reads its bytes. */
function cvFile(name = "Mi Cv.PDF", type = "application/pdf"): File {
  return new File(["contenido"], name, { type });
}

/**
 * A real `File` whose declared byte size is stubbed: the wizard reads only the
 * `size` metadata, never the bytes, so the exact inclusive boundary is tested
 * without allocating a real 10 MiB buffer in the test process.
 */
function cvFileWithSize(name: string, size: number, type = "application/pdf"): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/** Drops files onto the shared drop surface, bypassing the picker's accept filter. */
function dropCvFiles(container: HTMLElement, ...files: File[]): void {
  const area = container.querySelector("[data-pf-application-cv-drop]") as HTMLElement;
  fireEvent.drop(area, { dataTransfer: { files, types: ["Files"] } });
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
    const card = readCandidateCardSource();
    expect(source).toMatch(/["']use client["']/);
    for (const primitive of ["card", "field", "select", "textarea", "progress", "avatar", "badge", "separator", "button", "input"]) {
      expect(`${source}\n${card}`).toMatch(new RegExp(`components/ui/${primitive}["']`));
    }
    expect(source).toMatch(/buttonVariants/);
    expect(source).toMatch(/from\s*["']\.\/application-candidate-card["']/);
    // No local re-implementation may shadow the installed primitives.
    for (const candidateSource of [source, card]) {
      expect(candidateSource).not.toMatch(/\b(?:function|const)\s+(?:Card|Field|Select|Textarea|Progress|Avatar|Badge|Separator|Button|Input)\b/);
    }
  });

  it("reuses the shared draft vocabulary without transport, storage, router, timer, or remote image", () => {
    const source = readWizardSource();
    const card = readCandidateCardSource();
    expect(source).toMatch(/from\s*["']\.\/application-draft["']/);
    expect(source).toMatch(/APPLICATION_DRAFT_SOURCES|APPLICATION_DRAFT_SOURCE_LABELS/);
    expect(source).toMatch(/from\s*["']\.\/application-candidate-draft["']/);
    expect(source).toMatch(/APPLICATION_CANDIDATE_FIELDS|APPLICATION_CANDIDATE_FIELD_IDS/);
    expect(source).toMatch(/next\/link/);
    expect(source).toMatch(/candidato\/login/);
    expect(source).not.toMatch(/next\/navigation|useRouter|useSearchParams|useParams|usePathname/);
    expect(source).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|Math\.random|Date\.now|new Date\(|randomUUID/);
    expect(source).not.toMatch(/<form[^>]*(?:method|action)=|onSubmit=/);
    for (const candidateSource of [source, card]) {
      expect(candidateSource).not.toMatch(/\bfetch\(|requestJson|XMLHttpRequest|axios/);
      expect(candidateSource).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(candidateSource).not.toMatch(/src=\{?["']https?:\/\//);
      expect(candidateSource).not.toMatch(/https?:\/\/[^"'\s]+\.(?:png|jpe?g|webp|gif|svg)/i);
      expect(candidateSource).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/);
      expect(candidateSource).not.toMatch(/(?:bg|text|border|ring|from|to|via)-primary-\d/);
      expect(candidateSource).not.toMatch(RAW_COLOR_UTILITY);
    }
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

describe("VAF-03 step rail, editable candidate data and rail composition", () => {
  it("renders the ordered four-step rail with only the first step current and reachable", async () => {
    const { container } = await renderWizard();
    const rail = [...container.querySelectorAll("ol")].find((list) =>
      STEP_LABELS.every((label) => (list.textContent ?? "").includes(label)),
    );
    expect(rail).toBeDefined();
    const items = within(rail as HTMLElement).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    STEP_LABELS.forEach((label, index) => expect(items[index]).toHaveTextContent(label));
    expect(currentStepLabel(container)).toContain("Tus datos");
    expect(progressText()).toContain("Paso 1 de 4");
    // The profile step states its instruction in neutral Mexican Spanish.
    expect(
      container.querySelector("[data-pf-application-step='profile']"),
    ).toHaveTextContent("Revisa y actualiza tus datos de contacto para esta postulación.");
    // One forward control only: no control can jump straight to the review step.
    expect(screen.getAllByRole("button", { name: /continuar/i })).toHaveLength(1);
    const jumps = [...container.querySelectorAll("a,button")].filter((node) =>
      /revisar/i.test(node.textContent ?? ""),
    );
    expect(jumps).toHaveLength(0);
  });

  it("renders the desktop rail with the live candidate card and the slotted vacancy summary", async () => {
    const { container } = await renderWizard();
    const aside = container.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(aside!.className).toMatch(/lg:sticky/);
    expect(aside!.className).not.toMatch(/(?:^|\s)sticky(?:\s|$)/);
    const candidateCard = aside!.querySelector("[data-pf-application-candidate]");
    expect(candidateCard).not.toBeNull();
    expect(within(candidateCard as HTMLElement).getByRole("heading", { level: 2, name: "Tu perfil" })).toBeTruthy();
    expect(within(aside as HTMLElement).getByText("Resumen de la vacante")).toBeTruthy();
    const grid = container.querySelector("[data-pf-application-grid]");
    expect(grid).not.toBeNull();
    expect(grid!.className).toMatch(/lg:grid-cols-\[minmax\(0,1fr\)_21rem\]/);
    expect(grid!.className).not.toMatch(/(?:^|\s)grid-cols-\d/);
    expect(container.querySelector("[data-pf-application-form-host]")).not.toBeNull();
  });

  it("prefills the six local candidate fields from the frozen identity and profile", async () => {
    expect(CANDIDATE_TITLE).not.toBe("");
    expect(CANDIDATE_PHONE).not.toBe("");
    expect(CANDIDATE_CITY).not.toBe("");
    expect(CANDIDATE_COUNTRY).not.toBe("");
    const { container } = await renderWizard();
    expect(screen.getByLabelText("Nombre completo")).toHaveValue(CANDIDATE_IDENTITY.fullName);
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue(CANDIDATE_IDENTITY.email);
    expect(screen.getByLabelText("Teléfono")).toHaveValue(CANDIDATE_PROFILE.phone);
    expect(screen.getByLabelText("Título profesional")).toHaveValue(CANDIDATE_PROFILE.professionalTitle);
    expect(screen.getByLabelText("Ciudad")).toHaveValue(CANDIDATE_PROFILE.city);
    expect(screen.getByLabelText("País")).toHaveValue(CANDIDATE_PROFILE.country);
    expect(screen.getByLabelText("Nombre completo")).toHaveAttribute("id", "application-full-name");
    expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Teléfono")).toHaveAttribute("type", "tel");
    // Until a real image resolves, the avatar frame shows the deterministic initials.
    expect(container.querySelector("[data-slot='avatar-fallback']")).toHaveTextContent("XB");
  });

  it("offers no unsupported control, no fake completeness metric and no implementation status", async () => {
    const { container } = await renderWizard();
    const text = container.textContent ?? "";
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(text).not.toContain("Solo lectura");
    expect(text).not.toMatch(IMPLEMENTATION_STATUS_COPY);
    expect(text).not.toMatch(/años de experiencia/i);
    expect(text).not.toMatch(/disponibilidad/i);
    expect(text).not.toMatch(/sube tu cv|curr[íi]culum/i);
    expect(text).not.toMatch(/porcentaje|\d\s?%|completitud|perfil complet/iu);
  });

  it("mirrors the edited candidate live in the rail card, with a local portrait and initials fallback", async () => {
    stubLoadedImage();
    const { user, container } = await renderWizard();
    const card = container.querySelector("[data-pf-application-candidate]") as HTMLElement;
    expect(card).toHaveTextContent(CANDIDATE_IDENTITY.fullName);
    expect(card).toHaveTextContent(CANDIDATE_TITLE);
    expect(card).toHaveTextContent(CANDIDATE_IDENTITY.email);
    expect(card).toHaveTextContent(CANDIDATE_PHONE);
    expect(card).toHaveTextContent(`${CANDIDATE_CITY}, ${CANDIDATE_COUNTRY}`);
    for (const skill of [...CANDIDATE_PROFILE.skills]) expect(card).toHaveTextContent(skill);
    const image = container.querySelector("[data-slot='avatar-image']") as HTMLImageElement | null;
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe(AVATAR_SRC);
    // The fixture portrait is decorative: its alt never carries the edited name.
    expect(image?.getAttribute("alt")).toBe("");

    await user.clear(screen.getByLabelText("Nombre completo"));
    await user.type(screen.getByLabelText("Nombre completo"), "Ana López");
    await user.clear(screen.getByLabelText("Título profesional"));
    await user.type(screen.getByLabelText("Título profesional"), "Ingeniera de Datos");
    expect(card).toHaveTextContent("Ana López");
    expect(card).toHaveTextContent("Ingeniera de Datos");
    expect(card).not.toHaveTextContent(CANDIDATE_TITLE);
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.getAttribute("alt") ?? "").not.toContain("Ana López");
  });

  it("keeps the fixture portrait decorative so an edited name never relabels the photo", async () => {
    stubLoadedImage();
    const { user, container } = await renderWizard();
    const portrait = () => container.querySelector<HTMLImageElement>("[data-slot='avatar-image']");
    expect(portrait()?.getAttribute("src")).toBe(AVATAR_SRC);
    expect(portrait()?.getAttribute("alt")).toBe("");

    await user.clear(screen.getByLabelText("Nombre completo"));
    await user.type(screen.getByLabelText("Nombre completo"), "Ana López");
    expect(portrait()?.getAttribute("src")).toBe(AVATAR_SRC);
    expect(portrait()?.getAttribute("alt")).toBe("");
    expect(portrait()?.getAttribute("alt") ?? "").not.toContain("Ana López");
    expect(portrait()?.getAttribute("alt") ?? "").not.toContain(CANDIDATE_IDENTITY.fullName);
  });

  it("never invents a value for a cleared field", async () => {
    const { user, container } = await renderWizard();
    const card = container.querySelector("[data-pf-application-candidate]") as HTMLElement;
    await user.clear(screen.getByLabelText("Ciudad"));
    await user.clear(screen.getByLabelText("País"));
    expect(card.querySelector("[data-pf-application-candidate-location]")).toHaveTextContent("Sin especificar");
    await user.clear(screen.getByLabelText("Teléfono"));
    expect(card.querySelector("[data-pf-application-candidate-phone]")).toHaveTextContent("Sin especificar");
    expect(card).not.toHaveTextContent(CANDIDATE_PHONE);
    await advanceToReview(user);
    const review = container.querySelector('[data-pf-application-step="review"]') as HTMLElement;
    expect(review).toHaveTextContent("Sin especificar");
    expect(review).not.toHaveTextContent(CANDIDATE_PHONE);
    expect(review).not.toHaveTextContent(CANDIDATE_CITY);
  });

  it("blames the edited field, focuses it, and never advances on invalid data", async () => {
    const { user, container } = await renderWizard();
    const email = screen.getByLabelText("Correo electrónico");
    await user.clear(email);
    await clickContinue(user);
    expect(currentStepLabel(container)).toContain("Tus datos");
    expect(progressText()).toContain("Paso 1 de 4");
    expect(container.querySelector("#application-email-error")).toHaveTextContent("El correo electrónico es obligatorio.");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveFocus();

    await user.type(email, "correo-invalido");
    await clickContinue(user);
    expect(container.querySelector("#application-email-error")).toHaveTextContent("El correo electrónico no es válido.");
    expect(email).toHaveFocus();

    await user.clear(email);
    await user.type(email, "ana@correo.mx");
    await clickContinue(user);
    expect(currentStepLabel(container)).toContain("Tu postulación");
    expect(container.querySelector("#application-email-error")).toBeNull();
  });

  it("keeps the raw edits across back navigation and reviews them normalized", async () => {
    const { user, container } = await renderWizard();
    const fullName = screen.getByLabelText("Nombre completo");
    await user.clear(fullName);
    await user.type(fullName, "  Ana López  ");
    await advanceToReview(user);
    expect(progressText()).toContain("Paso 4 de 4");
    const text = container.textContent ?? "";
    expect(text).toContain("Ana López");
    expect(text).not.toContain("  Ana López  ");
    expect(text).toContain(CANDIDATE_PHONE);
    expect(text).toContain(CANDIDATE_CITY);
    expect(text).not.toMatch(IMPLEMENTATION_STATUS_COPY);
    expect(screen.getByRole("link", { name: /iniciar sesión para enviar/i })).toHaveAttribute("href", "/candidato/login");
    await user.click(screen.getByRole("button", { name: /atrás/i }));
    await user.click(screen.getByRole("button", { name: /atrás/i }));
    await user.click(screen.getByRole("button", { name: /atrás/i }));
    expect(progressText()).toContain("Paso 1 de 4");
    expect(screen.getByLabelText("Nombre completo")).toHaveValue("  Ana López  ");
  });
});

describe("VAF-03 application step", () => {
  it("defaults to the job board source and maps the shared vocabulary into installed Select items", async () => {
    const { user, container } = await renderWizard();
    await clickContinue(user);
    expect(currentStepLabel(container)).toContain("Tu postulación");
    expect(progressText()).toContain("Paso 2 de 4");
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
    expect(progressText()).toContain("Paso 3 de 4");
    await clickContinue(user);
    expect(progressText()).toContain("Paso 4 de 4");
  });

  it("blocks 2001 code points with an alert and does not skip to review", async () => {
    const { user, container } = await renderWizard();
    await clickContinue(user);
    await pasteLetter(user, "🙂".repeat(2001));
    await clickContinue(user);
    expect(screen.getByRole("alert")).toHaveTextContent(/2000|caracteres|l[íi]mite/i);
    expect(currentStepLabel(container)).toContain("Tu postulación");
    expect(progressText()).toContain("Paso 2 de 4");
  });

  it("focuses the letter and connects its visible error beside the counter when invalid", async () => {
    const { user, container } = await renderWizard();
    await clickContinue(user);
    const letter = screen.getByRole("textbox");
    expect(letter).toHaveAttribute("id", "application-cover-letter");
    expect(letter).toHaveAttribute("aria-describedby", "application-cover-letter-help");
    expect(letter).not.toHaveAttribute("aria-invalid", "true");

    await pasteLetter(user, "🙂".repeat(2001));
    await clickContinue(user);

    expect(letter).toHaveAttribute("aria-invalid", "true");
    const describedBy = (letter.getAttribute("aria-describedby") ?? "")
      .split(/\s+/u)
      .filter((id) => id !== "");
    expect(describedBy).toContain("application-cover-letter-help");
    expect(describedBy).toContain("application-cover-letter-error");
    expect(new Set(describedBy).size).toBe(describedBy.length);
    expect(container.querySelectorAll("#application-cover-letter-error")).toHaveLength(1);
    const error = container.querySelector("#application-cover-letter-error");
    expect(error).not.toBeNull();
    expect(error).toHaveTextContent(/2000|caracteres|l[íi]mite/i);
    expect(screen.getByRole("alert")).toBe(error);
    expect(letter).toHaveFocus();

    // Fixing the letter clears both the message and the described-by reference.
    await user.clear(letter);
    await user.type(letter, "Hola");
    expect(letter).not.toHaveAttribute("aria-invalid", "true");
    expect(letter).toHaveAttribute("aria-describedby", "application-cover-letter-help");
    expect(container.querySelector("#application-cover-letter-error")).toBeNull();
  });
});

describe("VAF-03 review step", () => {
  it("reviews the vacancy, profile, source and blank letter, then gates sending behind login", async () => {
    const { user, container } = await renderWizard();
    await advanceToReview(user);
    expect(progressText()).toContain("Paso 4 de 4");
    const text = container.textContent ?? "";
    expect(text).toContain(job.title);
    expect(text).toContain(job.company.name);
    expect(text).toContain(CANDIDATE_IDENTITY.fullName);
    expect(text).toContain(CANDIDATE_IDENTITY.email);
    expect(text).toContain("Portal de empleo");
    expect(text).toContain(EMPTY_LETTER);
    expect(text).toContain("Sin CV seleccionado");
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
    expect(progressText()).toContain("Paso 3 de 4");
    await clickContinue(user);
    expect(progressText()).toContain("Paso 4 de 4");
    const text = container.textContent ?? "";
    expect(text).toContain("Portal de empleo");
    expect(text).toContain("Hola equipo");
    expect(text).not.toContain("  Hola equipo  ");
    expect(text).not.toContain(EMPTY_LETTER);
    // The review step and its sign-in note stay in neutral Mexican Spanish.
    expect(text).toContain("Revisa tu postulación antes de continuar.");
    expect(text).toMatch(/Para enviar tu postulación necesitas iniciar sesión/u);
  });

  it("preserves the selected source and letter across back navigation", async () => {
    const { user, container } = await renderWizard();
    await clickContinue(user);
    await pasteLetter(user, "Hola");
    await clickContinue(user);
    expect(progressText()).toContain("Paso 3 de 4");
    await clickContinue(user);
    expect(progressText()).toContain("Paso 4 de 4");
    await user.click(screen.getByRole("button", { name: /atrás/i }));
    expect(progressText()).toContain("Paso 3 de 4");
    await user.click(screen.getByRole("button", { name: /atrás/i }));
    expect(progressText()).toContain("Paso 2 de 4");
    expect(screen.getByRole("textbox")).toHaveValue("Hola");
    expect(screen.getByRole("combobox")).toHaveTextContent("Portal de empleo");
    await user.click(screen.getByRole("button", { name: /atrás/i }));
    expect(progressText()).toContain("Paso 1 de 4");
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

describe("VAF-07 wizard focus management", () => {
  const stepTitle = (container: HTMLElement) =>
    container.querySelector("[data-pf-application-step-title]") as HTMLElement;

  it("moves focus into the incoming step title on every transition and never on initial mount", async () => {
    const { user, container } = await renderWizard();
    // Initial mount keeps the page's own focus: nothing is stolen.
    expect(stepTitle(container)).toHaveTextContent("Tus datos");
    expect(stepTitle(container)).toHaveAttribute("tabindex", "-1");
    expect(stepTitle(container)).toHaveAttribute("role", "heading");
    expect(stepTitle(container)).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);

    await clickContinue(user);
    expect(stepTitle(container)).toHaveTextContent("Tu postulación");
    expect(stepTitle(container)).toHaveFocus();

    await clickContinue(user);
    expect(stepTitle(container)).toHaveTextContent("Tu CV");
    expect(stepTitle(container)).toHaveFocus();

    await clickContinue(user);
    expect(stepTitle(container)).toHaveTextContent("Revisar");
    expect(stepTitle(container)).toHaveFocus();

    // Backward: the CV, application and profile titles each receive focus too.
    await user.click(screen.getByRole("button", { name: /atrás/i }));
    expect(stepTitle(container)).toHaveTextContent("Tu CV");
    expect(stepTitle(container)).toHaveFocus();
    await user.click(screen.getByRole("button", { name: /atrás/i }));
    expect(stepTitle(container)).toHaveTextContent("Tu postulación");
    expect(stepTitle(container)).toHaveFocus();
    await user.click(screen.getByRole("button", { name: /atrás/i }));
    expect(stepTitle(container)).toHaveTextContent("Tus datos");
    expect(stepTitle(container)).toHaveFocus();
  });

  it("keeps focus on the offending field instead of the step title when validation blocks", async () => {
    const { user, container } = await renderWizard();
    const email = screen.getByLabelText("Correo electrónico");
    await user.clear(email);
    await clickContinue(user);
    expect(email).toHaveFocus();
    expect(stepTitle(container)).not.toHaveFocus();

    await user.type(email, "ana@correo.mx");
    await clickContinue(user);
    expect(stepTitle(container)).toHaveTextContent("Tu postulación");
    expect(stepTitle(container)).toHaveFocus();

    const letter = screen.getByRole("textbox");
    await pasteLetter(user, "🙂".repeat(2001));
    await clickContinue(user);
    expect(letter).toHaveFocus();
    expect(stepTitle(container)).not.toHaveFocus();
  });
});

describe("VAF-07 CV step integration", () => {
  it("keeps the CV optional: skipping it reaches the review with no selection", async () => {
    const { user, container } = await renderWizard();
    await advanceToReview(user);
    expect(progressText()).toContain("Paso 4 de 4");
    const review = container.querySelector('[data-pf-application-step="review"]') as HTMLElement;
    expect(review.querySelector("[data-pf-application-review-cv]")).toHaveTextContent("Sin CV seleccionado");
  });

  it("shows the selected name/format/size on the step and reviews the same metadata", async () => {
    const { user, container } = await renderWizard();
    await advanceToCvStep(user);
    expect(currentStepLabel(container)).toContain("Tu CV");
    expect(progressText()).toContain("Paso 3 de 4");
    expect(document.getElementById("application-cv-file")).not.toBeNull();

    await selectCvFile(user, cvFile("Mi Cv.PDF"));
    const item = container.querySelector("[data-pf-application-cv-selected]") as HTMLElement;
    expect(item).toHaveTextContent("Mi Cv.PDF");
    expect(item).toHaveTextContent("PDF");
    expect(item).toHaveTextContent(/\d+(?:\.\d+)?\s?(?:KB|MB)/u);

    await clickContinue(user);
    expect(progressText()).toContain("Paso 4 de 4");
    const reviewCv = container.querySelector("[data-pf-application-review-cv]") as HTMLElement;
    expect(reviewCv).toHaveTextContent("Mi Cv.PDF");
    expect(reviewCv).toHaveTextContent("PDF");
  });

  it("replaces a valid selection with a new valid one", async () => {
    const { user, container } = await renderWizard();
    await advanceToCvStep(user);
    await selectCvFile(user, cvFile("primero.pdf"));
    await selectCvFile(user, cvFile("segundo.docx"));
    const item = container.querySelector("[data-pf-application-cv-selected]") as HTMLElement;
    expect(item).toHaveTextContent("segundo.docx");
    expect(item).not.toHaveTextContent("primero.pdf");
    expect(container.querySelector("[data-pf-application-cv-drop]")).toHaveTextContent(/reemplaz/u);
  });

  it("keeps the last valid file and shows the error when a replacement is rejected", async () => {
    const { user, container } = await renderWizard();
    await advanceToCvStep(user);
    await selectCvFile(user, cvFile("bueno.pdf"));
    dropCvFiles(container, cvFile("notas.txt", "text/plain"));

    expect(screen.getByRole("alert")).toHaveTextContent("El CV debe estar en formato PDF, DOC o DOCX.");
    const item = container.querySelector("[data-pf-application-cv-selected]") as HTMLElement;
    expect(item).toHaveTextContent("bueno.pdf");
    expect(document.getElementById("application-cv-file")).toHaveAttribute("aria-invalid", "true");
  });

  it("requires exactly one file, rejecting a multi-file drop", async () => {
    const { user, container } = await renderWizard();
    await advanceToCvStep(user);
    dropCvFiles(container, cvFile("uno.pdf"), cvFile("dos.pdf"));
    expect(screen.getByRole("alert")).toHaveTextContent("Selecciona un solo archivo para tu CV.");
    expect(container.querySelector("[data-pf-application-cv-selected]")).toBeNull();
  });

  it("rejects a file one byte over the 10 MiB limit and accepts a file declaring exactly 10 MiB", async () => {
    const { user, container } = await renderWizard();
    await advanceToCvStep(user);
    await selectCvFile(user, cvFileWithSize("grande.pdf", 10 * 1024 * 1024 + 1));
    expect(screen.getByRole("alert")).toHaveTextContent("El CV no puede superar los 10 MB.");
    expect(container.querySelector("[data-pf-application-cv-selected]")).toBeNull();

    // The inclusive upper bound is accepted: exactly 10 MiB is not over the limit.
    await selectCvFile(user, cvFileWithSize("limite.pdf", 10 * 1024 * 1024));
    expect(screen.queryByRole("alert")).toBeNull();
    const selected = container.querySelector("[data-pf-application-cv-selected]") as HTMLElement;
    expect(selected).toHaveTextContent("limite.pdf");
    expect(selected).toHaveTextContent("10 MB");
  });

  it("removes the selection and returns focus to the visible picker", async () => {
    const { user, container } = await renderWizard();
    await advanceToCvStep(user);
    await selectCvFile(user, cvFile("Mi Cv.PDF"));
    await user.click(screen.getByRole("button", { name: "Quitar Mi Cv.PDF" }));
    expect(container.querySelector("[data-pf-application-cv-selected]")).toBeNull();
    expect(screen.getByRole("button", { name: "Elegir archivo" })).toHaveFocus();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("retains the raw profile, source, letter and File across back navigation", async () => {
    const { user, container } = await renderWizard();
    const fullName = screen.getByLabelText("Nombre completo");
    await user.clear(fullName);
    await user.type(fullName, "  Ana López  ");
    await clickContinue(user);
    await pasteLetter(user, "  Hola equipo  ");
    await clickContinue(user);
    await selectCvFile(user, cvFile("Mi Cv.PDF"));
    await clickContinue(user);
    expect(progressText()).toContain("Paso 4 de 4");

    await user.click(screen.getByRole("button", { name: /atrás/i }));
    expect(progressText()).toContain("Paso 3 de 4");
    expect(container.querySelector("[data-pf-application-cv-selected]")).toHaveTextContent("Mi Cv.PDF");
    await user.click(screen.getByRole("button", { name: /atrás/i }));
    expect(progressText()).toContain("Paso 2 de 4");
    expect(screen.getByRole("textbox")).toHaveValue("  Hola equipo  ");
    await user.click(screen.getByRole("button", { name: /atrás/i }));
    expect(progressText()).toContain("Paso 1 de 4");
    expect(screen.getByLabelText("Nombre completo")).toHaveValue("  Ana López  ");
  });

  it("clears the local CV on remount, because nothing was persisted", async () => {
    const first = await renderWizard();
    await advanceToCvStep(first.user);
    await selectCvFile(first.user, cvFile("Mi Cv.PDF"));
    expect(first.container.querySelector("[data-pf-application-cv-selected]")).not.toBeNull();
    first.unmount();

    await renderWizard();
    await advanceToCvStep(first.user);
    expect(document.querySelector("[data-pf-application-cv-selected]")).toBeNull();
  });

  it("never reads, serializes, stores or sends the selected file", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("network disabled")));
    vi.stubGlobal("fetch", fetchSpy);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL });
    const { user } = await renderWizard();
    await advanceToCvStep(user);
    await selectCvFile(user, cvFile("Mi Cv.PDF"));
    await clickContinue(user);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("composes the CV step from the shared pure model with no transport or storage", () => {
    const wizard = readWizardSource();
    const step = readFileSync(join(APPLICATION_DIR, "application-cv-step.tsx"), "utf8");
    const model = readFileSync(join(APPLICATION_DIR, "application-cv.ts"), "utf8");
    expect(wizard).toMatch(/from\s*["']\.\/application-cv["']/);
    expect(wizard).toMatch(/from\s*["']\.\/application-cv-step["']/);
    expect(wizard).toMatch(/parseApplicationCvSelection/);
    for (const source of [step, model]) {
      expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|axios/u);
      expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/u);
      expect(source).not.toMatch(/FileReader|createObjectURL/u);
    }
    // The final honest login gate is untouched: no submit and no fake receipt.
    expect(wizard).toMatch(/candidato\/login/);
    expect(wizard).not.toMatch(/onSubmit=|<form[^>]*(?:method|action)=/u);
  });
});
