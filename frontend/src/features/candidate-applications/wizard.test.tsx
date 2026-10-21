import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
vi.mock("@/features/candidate/profile-actions", () => ({ loadProfileAction: vi.fn() }));
import { loadProfileAction } from "@/features/candidate/profile-actions";
vi.mock("@/features/identity/actions", () => ({ loadMeAction: vi.fn() }));
vi.mock("@/features/candidate-cvs/actions", () => ({ loadCvsAction: vi.fn() }));
vi.mock("@/features/candidate-cvs/upload", () => ({ uploadCv: vi.fn() }));
vi.mock("./actions", () => ({ loadScreeningAction: vi.fn(), submitApplicationAction: vi.fn() }));
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoResource: vi.fn(() => ({ status: "success", data: { items: [{ id: "CA", name: "Canadá" }] }, retry: vi.fn() })) }));
import { useGeoResource } from "@/features/geo/use-geo-catalog";
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
import { signIn } from "next-auth/react";
import { notifyActionResult } from "@/components/feedback/notify";
import { loadMeAction } from "@/features/identity/actions";
import { loadCvsAction } from "@/features/candidate-cvs/actions";
import { uploadCv } from "@/features/candidate-cvs/upload";
import { cv, library } from "@/features/candidate-cvs/test-fixtures";
import { loadScreeningAction, submitApplicationAction } from "./actions";
import { CandidateApplicationWizard } from "./wizard";
import { id, key, screening, submitted, questionId, optionId } from "./test-fixtures";
const user = () => userEvent.setup();
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadProfileAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  vi.mocked(loadMeAction).mockResolvedValue({ ok: true, data: { role: "candidate", user: { id, full_name: "Ana Pérez", email: "ana@example.test" } } });
  vi.mocked(loadCvsAction).mockResolvedValue({ ok: true, data: library });
  vi.mocked(loadScreeningAction).mockResolvedValue({ ok: true, data: screening });
  vi.mocked(submitApplicationAction).mockResolvedValue({ ok: true, data: submitted });
});
afterEach(cleanup);
const restrictedJob = { id, title: "Backend Go", company: { name: "Acme" }, work_mode: "remote", remote_scope: { kind: "countries" as const, countries: [{ id: "MX", name: "México" }, { id: "CO", name: "Colombia" }] } };
function profileCountry(country: { id: string; name: string } | null) {
  vi.mocked(loadProfileAction).mockResolvedValue({ ok: true, data: { languages: { languages: [] }, profile: { user_id: id, salary_currency: "MXN", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", location: country ? { country, state: null, municipality: null, postal_code: null, label: country.name } : null } } });
}
it.each([null, { id: "US", name: "Estados Unidos" }])("blocks a known ineligible country before writing %j", async country => {
  profileCountry(country);
  render(<CandidateApplicationWizard job={restrictedJob} />);
  expect(await screen.findByText("Esta vacante solo acepta postulantes de: México y Colombia.")).toBeVisible();
  await toSummary();
  expect(screen.getByRole("button", { name: "Enviar postulación" })).toBeDisabled();
  if (!country) expect(screen.getByRole("link", { name: "Completar perfil" })).toHaveAttribute("href", "/candidato/perfil");
  else {
    expect(screen.getByText("Tu perfil indica Estados Unidos. Esta vacante no acepta postulaciones desde ahí.")).toBeVisible();
    // The profile is complete; the fix is changing the location, not completing it.
    expect(screen.getByRole("link", { name: "Cambiar ubicación" })).toHaveAttribute("href", "/candidato/perfil");
    expect(screen.queryByRole("link", { name: "Completar perfil" })).toBeNull();
  }
  expect(submitApplicationAction).not.toHaveBeenCalled();
});
it("treats a candidate without a profile yet as having no country", async () => {
  vi.mocked(loadProfileAction).mockResolvedValue({ ok: true, data: { languages: { languages: [] }, profile: null } });
  render(<CandidateApplicationWizard job={restrictedJob} />);
  expect(await screen.findByText("Agrega tu país en tu perfil para postularte.")).toBeVisible();
  await toSummary();
  expect(screen.getByRole("button", { name: "Enviar postulación" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Completar perfil" })).toHaveAttribute("href", "/candidato/perfil");
  expect(submitApplicationAction).not.toHaveBeenCalled();
});
it("keeps answers and shows the server country rejection without retrying", async () => {
  profileCountry({ id: "MX", name: "México" });
  vi.mocked(submitApplicationAction).mockResolvedValue({ ok: false, reason: "applicant_country_required", allowed: ["CO", "MX"], reference: { status: 422, code: "applicant_country_required" } });
  render(<CandidateApplicationWizard job={restrictedJob} />); await toSummary();
  await user().click(screen.getByRole("button", { name: "Enviar postulación" }));
  expect(await screen.findByText("Agrega tu país en tu perfil para postularte.")).toBeVisible();
  expect(screen.getByText("Experiencia Go")).toBeVisible();
  expect(screen.getByText("Esta vacante solo acepta postulantes de: Colombia y México.")).toBeVisible();
  expect(submitApplicationAction).toHaveBeenCalledTimes(1);
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", reference: expect.objectContaining({ status: 422, code: "applicant_country_required" }) }));
});
it("resolves new server countries from the shared catalog, preserving order", async () => {
  profileCountry({ id: "MX", name: "México" });
  vi.mocked(submitApplicationAction).mockResolvedValue({ ok: false, reason: "applicant_country_not_allowed", allowed: ["CA", "CO"], reference: { status: 422, code: "applicant_country_not_allowed" } });
  render(<CandidateApplicationWizard job={restrictedJob} />); await toSummary();
  await user().click(screen.getByRole("button", { name: "Enviar postulación" }));
  expect(await screen.findByText("Esta vacante solo acepta postulantes de: Canadá y Colombia.")).toBeVisible();
  expect(screen.getByText("Tu perfil indica México. Esta vacante no acepta postulaciones desde ahí.")).toBeVisible();
  expect(useGeoResource).toHaveBeenCalledWith("countries", expect.anything());
  expect(screen.getByText("Experiencia Go")).toBeVisible();
  expect(submitApplicationAction).toHaveBeenCalledTimes(1);
});
it("lets the server decide after a failed profile read and retries that read only explicitly", async () => {
  render(<CandidateApplicationWizard job={restrictedJob} />); await toSummary();
  expect(screen.getByRole("button", { name: "Enviar postulación" })).toBeEnabled();
  expect(screen.queryByText("Agrega tu país en tu perfil para postularte.")).not.toBeInTheDocument();
  expect(loadProfileAction).toHaveBeenCalledTimes(1);
  profileCountry({ id: "MX", name: "México" });
  await user().click(screen.getByRole("button", { name: "Reintentar" }));
  await waitFor(() => expect(loadProfileAction).toHaveBeenCalledTimes(2));
  expect(screen.getByText("Experiencia Go")).toBeVisible();
});
it.each(["onsite", "hybrid"])("does not gate %s vacancies", async work_mode => {
  profileCountry(null);
  render(<CandidateApplicationWizard job={{ ...restrictedJob, work_mode }} />); await toSummary();
  expect(screen.getByRole("button", { name: "Enviar postulación" })).toBeEnabled();
  expect(screen.queryByRole("region", { name: "Países de postulación" })).not.toBeInTheDocument();
});
it.each(["paused", "closed"] as const)("replaces screening with the %s StateCard", async availability => {
  vi.mocked(loadScreeningAction).mockResolvedValue({ ok: false, reason: "vacancy_unavailable", vacancy: { id, title: "Backend Go", company: { id, name: "Acme" }, availability }, reference: {} });
  mount();
  expect((await screen.findByRole("heading", { name: availability === "paused" ? "Vacante pausada" : "Vacante cerrada" })).closest('[data-slot="card"]')).not.toBeNull();
  expect(screen.getByRole("link", { name: "Ver otras vacantes" })).toHaveAttribute("href", "/vacantes");
  expect(screen.queryByRole("button", { name: "Continuar" })).toBeNull();
});
it("disables submission after the vacancy stops accepting applications", async () => {
  vi.mocked(submitApplicationAction).mockResolvedValue({ ok: false, reason: "vacancy_not_accepting_applications", reference: { status: 409 } });
  mount(); await toSummary();
  await user().click(screen.getByRole("button", { name: "Enviar postulación" }));
  expect(await screen.findByText("Esta vacante dejó de recibir postulaciones.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Enviar postulación" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Ver otras vacantes" })).toHaveAttribute("href", "/vacantes");
});
const mount = () => render(<CandidateApplicationWizard job={{ id, title: "Backend Go", company: { name: "Acme" } }} />);
async function toCv() { await screen.findByDisplayValue("Ana Pérez"); await user().click(screen.getByRole("button", { name: "Continuar" })); await screen.findByRole("button", { name: cv.name }); }
async function toQuestions() { await toCv(); await user().click(screen.getByRole("button", { name: cv.name })); await user().click(screen.getByRole("button", { name: "Continuar" })); }
async function toSummary() { await toQuestions(); fireEvent.change(screen.getByLabelText("Cuéntanos tu experiencia"), { target: { value: "Experiencia Go" } }); await user().click(screen.getByRole("button", { name: "Inmediata" })); await user().click(screen.getByRole("button", { name: "Continuar" })); }
it("mirrors the Datos card slots and two identity fields while initially loading", async () => {
  let finish!: (result: Awaited<ReturnType<typeof loadMeAction>>) => void;
  vi.mocked(loadMeAction).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { container } = mount();
  const card = container.querySelector('[data-slot="card"]')!;
  expect(card).not.toBeNull();
  for (const slot of ["card-header", "card-title", "card-description", "card-content", "card-footer"]) expect(card.querySelector(`[data-slot="${slot}"]`)).not.toBeNull();
  expect(card.querySelectorAll('[data-slot="field"]')).toHaveLength(2);
  expect(card).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByRole("status")).toHaveTextContent("Cargando postulación");
  const slots = (root: Element) => Array.from(root.querySelectorAll('[data-slot^="card-"]')).map(node => node.getAttribute("data-slot"));
  const skeletonSlots = slots(card);
  finish({ ok: true, data: { role: "candidate", user: { id, full_name: "Ana Pérez", email: "ana@example.test" } } });
  await screen.findByDisplayValue("Ana Pérez");
  expect(slots(container.querySelector('[data-slot="card"]')!)).toEqual(skeletonSlots);
});
it("mirrors the previous question controls while changed questions are being loaded", async () => {
  let finish!: (result: Awaited<ReturnType<typeof loadScreeningAction>>) => void;
  mount(); await toSummary();
  const slots = (root: Element) => Array.from(root.querySelectorAll('[data-slot^="card-"]')).map(node => node.getAttribute("data-slot"));
  const loadedSlots = slots(document.querySelector('[data-slot="card"]')!);
  vi.mocked(loadScreeningAction).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  vi.mocked(submitApplicationAction).mockResolvedValueOnce({ ok: false, reason: "questionnaire_changed", reference: {} });
  await user().click(screen.getByRole("button", { name: "Enviar postulación" }));
  expect(screen.getByRole("status")).toHaveTextContent("Cargando postulación");
  const card = document.querySelector('[data-slot="card"]')!;
  expect(slots(card)).toEqual(loadedSlots);
  expect(card.querySelectorAll('[data-slot="field"]')).toHaveLength(screening.questions.length);
  expect(card.querySelector('[data-slot="field-description"]')).not.toBeNull();
  finish({ ok: true, data: screening });
  expect(await screen.findByLabelText("Cuéntanos tu experiencia")).toBeVisible();
});
it("separates wizard back/continue actions without reserving a result slot before an action result", async () => {
  const { container } = mount();
  await screen.findByDisplayValue("Ana Pérez");
  expect(container.querySelector('[data-pf-action-status-slot]')).toBeNull();
  expect(screen.getByRole("button", { name: "Continuar" })).toHaveClass("bg-primary", "w-full", "sm:w-auto");
  await toCv();
  const back = screen.getByRole("button", { name: "Atrás" });
  expect(back).not.toHaveClass("bg-primary");
  expect(back.closest('[data-slot="card-footer"]')).toHaveClass("flex-col", "sm:flex-row");
  expect(container.querySelector('[data-pf-action-status-slot]')?.closest('[data-slot="card-footer"]')).toBeFalsy();
});
it.each([
  ["already_applied", "Ya te postulaste a esta vacante", "Ya enviada", "Mis postulaciones"],
  ["not_found", "Esta vacante ya no está disponible", "No disponible", "Explorar vacantes"],
] as const)("makes %s a visible, actionable result state", async (reason, title, badge, action) => {
  vi.mocked(loadScreeningAction).mockResolvedValue({ ok: false, reason, reference: {} });
  mount();
  const heading = await screen.findByRole("heading", { name: title });
  expect(heading.closest('[data-slot="empty-title"]')).toHaveClass("text-xl", "font-semibold");
  const card = heading.closest('[data-slot="card"]')!;
  expect(card.querySelector('[data-slot="card-header"] [data-slot="badge"]')).toHaveTextContent(badge);
  expect(screen.getByRole("link", { name: action }).closest('[data-slot="empty-content"]')).not.toBeNull();
  expect(screen.getByRole("link", { name: action })).toHaveClass("bg-primary", "w-full", "sm:w-auto");
});
it("shows the Datos sign-in card without a form and preserves the callback URL", async () => {
  vi.mocked(loadMeAction).mockResolvedValue({ ok: false, reason: "unauthenticated", reference: {} }); mount();
  await user().click(await screen.findByRole("button", { name: "Ingresar como candidato" }));
  expect(signIn).toHaveBeenCalledWith("cognito", { callbackUrl: `/vacantes/${id}/postular` });
  expect(screen.queryByRole("textbox")).toBeNull();
});
it("blocks recruiter and unregistered identities", async () => {
  vi.mocked(loadMeAction).mockResolvedValue({ ok: true, data: { role: "recruiter", user: { id, full_name: "Empresa", email: "e@example.test" } } });
  mount(); expect(await screen.findByText("Esta cuenta es de empresa")).toBeVisible(); expect(loadCvsAction).not.toHaveBeenCalled();
  cleanup(); vi.mocked(loadMeAction).mockResolvedValue({ ok: true, data: { role: null, user: null } }); mount();
  expect(await screen.findByRole("link", { name: "Completar mi cuenta de candidato" })).toHaveAttribute("href", "/candidato/ingresar");
});
it("renders readonly identity, mandatory CV, required answers, counter and exact summary/submit", async () => {
  mount(); expect(await screen.findByDisplayValue("Ana Pérez")).toHaveAttribute("readonly"); expect(screen.getByDisplayValue("ana@example.test")).toHaveAttribute("readonly");
  await toCv(); await user().click(screen.getByRole("button", { name: "Continuar" })); expect(await screen.findByText("Elige un CV para continuar.")).toBeVisible();
  await user().click(screen.getByRole("button", { name: cv.name })); await user().click(screen.getByRole("button", { name: "Continuar" }));
  await user().click(screen.getByRole("button", { name: "Continuar" })); expect(screen.getByLabelText("Cuéntanos tu experiencia")).toHaveFocus();
  const input = screen.getByLabelText("Cuéntanos tu experiencia"); expect(input).toHaveAttribute("maxlength", "4000");
  fireEvent.change(input, { target: { value: "Experiencia Go" } }); expect(screen.getByText("14 de 2000 caracteres")).toBeVisible();
  await user().click(screen.getByRole("button", { name: "Inmediata" })); await user().click(screen.getByRole("button", { name: "Continuar" }));
  expect(screen.getByRole("heading", { name: "Resumen" })).toBeVisible(); expect(screen.getByText("Experiencia Go")).toBeVisible(); expect(screen.getByText(cv.name)).toBeVisible();
  await user().click(screen.getByRole("button", { name: "Enviar postulación" }));
  expect(submitApplicationAction).toHaveBeenCalledWith(id, expect.stringMatching(/^[\da-f-]{36}$/), { cv_id: cv.id, questionnaire_revision: screening.questionnaire_revision, answers: [{ question_id: id, text: "Experiencia Go" }, { question_id: questionId, option_id: optionId }] });
  const sent = await screen.findByRole("heading", { name: "Postulación enviada" });
  expect(sent).toBeVisible();
  expect(sent.closest('[data-slot="card"]')?.querySelector('[data-slot="card-header"] [data-slot="badge"]')).toHaveTextContent("Enviada");
  expect(screen.getByRole("link", { name: "Mis postulaciones" })).toHaveAttribute("href", "/candidato/postulaciones");
});
it.each(["a".repeat(1999) + "😀", "😀".repeat(2000)])("accepts and submits a 2000-code-point answer (%#)", async answer => {
  mount(); await toQuestions();
  const input = screen.getByLabelText("Cuéntanos tu experiencia");
  expect(input).toHaveAttribute("maxlength", "4000");
  // jsdom change does not enforce native maxlength; emulate the browser's UTF-16 cap.
  fireEvent.change(input, { target: { value: answer.slice(0, (input as HTMLTextAreaElement).maxLength) } });
  expect(screen.getByText("2000 de 2000 caracteres")).toBeVisible();
  await user().click(screen.getByRole("button", { name: "Inmediata" }));
  await user().click(screen.getByRole("button", { name: "Continuar" }));
  await user().click(screen.getByRole("button", { name: "Enviar postulación" }));
  expect(submitApplicationAction).toHaveBeenCalledWith(id, expect.any(String), expect.objectContaining({ answers: [{ question_id: id, text: answer }, { question_id: questionId, option_id: optionId }] }));
});
it("rejects 2001 code points with FieldError and sends nothing", async () => {
  mount(); await toQuestions();
  const input = screen.getByLabelText("Cuéntanos tu experiencia");
  fireEvent.change(input, { target: { value: "a".repeat(2000) + "😀" } });
  expect(screen.getByText("2001 de 2000 caracteres")).toBeVisible();
  await user().click(screen.getByRole("button", { name: "Inmediata" }));
  await user().click(screen.getByRole("button", { name: "Continuar" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Tu respuesta supera el límite de caracteres.");
  expect(input).toHaveFocus(); expect(input).toHaveAttribute("aria-invalid", "true");
  expect(submitApplicationAction).not.toHaveBeenCalled();
});
it("validates files before uploading and chooses the newly uploaded library CV", async () => {
  vi.mocked(uploadCv).mockResolvedValue({ ok: true, data: { ...cv, id: key, name: "Nuevo.docx" } }); mount(); await toCv();
  const input = screen.getByLabelText("Subir un CV nuevo");
  fireEvent.change(input, { target: { files: [new File(["x"], "bad.exe", { type: "text/plain" })] } });
  expect(await screen.findByText("Sube un PDF o un documento de Word (.docx).")).toBeVisible(); expect(input).toHaveFocus(); expect(uploadCv).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { files: [new File(["x"], "Nuevo.docx")] } });
  const picked = await screen.findByRole("button", { name: "Nuevo.docx" }); expect(picked).toHaveAttribute("aria-pressed", "true");
});
it("does not blindly repeat an uncertain CV upload and can check the library", async () => {
  vi.mocked(uploadCv).mockResolvedValue({ ok: false, reason: "no_response", reference: {} }); mount(); await toCv();
  fireEvent.change(screen.getByLabelText("Subir un CV nuevo"), { target: { files: [new File(["x"], "Nuevo.pdf", { type: "application/pdf" })] } });
  const check = await screen.findByRole("button", { name: "Comprobar biblioteca" });
  expect(screen.getByLabelText("Subir un CV nuevo")).toBeDisabled();
  await user().click(check); await waitFor(() => expect(loadCvsAction).toHaveBeenCalledTimes(2)); expect(screen.getByLabelText("Subir un CV nuevo")).not.toBeDisabled();
});
it.each(["cv_too_large", "cv_unsupported_type", "cv_content_mismatch", "cv_library_full"] as const)("retains upload rejection %s next to the file", async reason => {
  vi.mocked(uploadCv).mockResolvedValue({ ok: false, reason, reference: {} }); mount(); await toCv();
  fireEvent.change(screen.getByLabelText("Subir un CV nuevo"), { target: { files: [new File(["x"], "Nuevo.pdf", { type: "application/pdf" })] } });
  await waitFor(() => expect(screen.getByLabelText("Subir un CV nuevo")).toHaveAttribute("aria-invalid", "true")); expect(screen.getByRole("alert")).toBeVisible(); expect(screen.getByLabelText("Subir un CV nuevo")).toHaveFocus();
});
it("shows unavailable CV storage and retries only explicitly", async () => {
  vi.mocked(loadCvsAction).mockResolvedValueOnce({ ok: false, reason: "storage_unavailable", reference: { status: 503, code: "cv_storage_unavailable" } });
  mount(); expect(await screen.findByRole("heading", { name: "Los CVs no están disponibles en este momento" })).toBeVisible();
  expect(screen.getByText("Puedes intentarlo más tarde; lo que ya escribiste se conserva.")).toBeVisible();
  expect(loadCvsAction).toHaveBeenCalledTimes(1); expect(submitApplicationAction).not.toHaveBeenCalled();
  await user().click(screen.getByRole("button", { name: "Reintentar" }));
  await toCv(); expect(loadCvsAction).toHaveBeenCalledTimes(2);
});
it("backs up a failed explicit storage retry with ActionStatus and no automatic retry", async () => {
  vi.mocked(loadCvsAction).mockResolvedValue({ ok: false, reason: "storage_unavailable", reference: { status: 503, code: "cv_storage_unavailable" } });
  mount(); await user().click(await screen.findByRole("button", { name: "Reintentar" }));
  expect(screen.getByRole("status")).toHaveTextContent("Los CVs no están disponibles en este momento");
  expect(screen.getByRole("status")).toHaveTextContent("Puedes intentarlo más tarde; lo que ya escribiste se conserva.");
  expect(loadCvsAction).toHaveBeenCalledTimes(2); expect(submitApplicationAction).not.toHaveBeenCalled();
});
it("uses the storage copy when a generic read retry reaches unavailable CV storage", async () => {
  vi.mocked(loadCvsAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} }).mockResolvedValueOnce({ ok: false, reason: "storage_unavailable", reference: { status: 503, code: "cv_storage_unavailable" } });
  mount(); await user().click(await screen.findByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("heading", { name: "Los CVs no están disponibles en este momento" })).toBeVisible();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title: "Los CVs no están disponibles en este momento", description: "Puedes intentarlo más tarde; lo que ya escribiste se conserva." }));
});
it("keeps answers and selected CV when the CV-step upload is unavailable", async () => {
  vi.mocked(uploadCv).mockResolvedValue({ ok: false, reason: "storage_unavailable", reference: { status: 503, code: "cv_storage_unavailable" } });
  mount(); await toSummary();
  await user().click(screen.getByRole("button", { name: "Atrás" })); await user().click(screen.getByRole("button", { name: "Atrás" }));
  fireEvent.change(screen.getByLabelText("Subir un CV nuevo"), { target: { files: [new File(["pdf"], "cv.pdf", { type: "application/pdf" })] } });
  const title = "Los CVs no están disponibles en este momento", description = "Puedes intentarlo más tarde; lo que ya escribiste se conserva.";
  expect(await screen.findByRole("heading", { name: title })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(description);
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ title, description }));
  expect(uploadCv).toHaveBeenCalledTimes(1); expect(loadCvsAction).toHaveBeenCalledTimes(1);
  await user().click(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("button", { name: cv.name })).toHaveAttribute("aria-pressed", "true");
  await user().click(screen.getByRole("button", { name: "Continuar" }));
  expect(screen.getByLabelText("Cuéntanos tu experiencia")).toHaveValue("Experiencia Go");
  expect(screen.getByRole("button", { name: "Inmediata" })).toHaveAttribute("aria-pressed", "true");
  expect(submitApplicationAction).not.toHaveBeenCalled();
});
it("keeps written answers across unavailable CV reloads after a stale-CV rejection", async () => {
  vi.mocked(submitApplicationAction).mockResolvedValueOnce({ ok: false, reason: "cv_unavailable", reference: { status: 422 } });
  mount(); await toSummary();
  vi.mocked(loadCvsAction).mockResolvedValueOnce({ ok: false, reason: "storage_unavailable", reference: { status: 503, code: "cv_storage_unavailable" } });
  await user().click(screen.getByRole("button", { name: "Enviar postulación" }));
  expect(await screen.findByRole("heading", { name: "Los CVs no están disponibles en este momento" })).toBeVisible();
  expect(loadCvsAction).toHaveBeenCalledTimes(2); expect(submitApplicationAction).toHaveBeenCalledTimes(1);
  await user().click(screen.getByRole("button", { name: "Reintentar" }));
  await user().click(await screen.findByRole("button", { name: cv.name }));
  await user().click(screen.getByRole("button", { name: "Continuar" }));
  expect(screen.getByLabelText("Cuéntanos tu experiencia")).toHaveValue("Experiencia Go");
  expect(screen.getByRole("button", { name: "Inmediata" })).toHaveAttribute("aria-pressed", "true");
  expect(loadScreeningAction).toHaveBeenCalledTimes(1); expect(submitApplicationAction).toHaveBeenCalledTimes(1);
});
it.each(["cvs", "upload", "apply"] as const)("shows the existing company-account state on %s wrong_role", async source => {
  const failure = { ok: false, reason: "wrong_role", reference: { status: 403, code: "wrong_role" } } as const;
  if (source === "cvs") vi.mocked(loadCvsAction).mockResolvedValue(failure);
  mount();
  if (source === "upload") {
    await toCv(); vi.mocked(uploadCv).mockResolvedValue(failure);
    fireEvent.change(screen.getByLabelText("Subir un CV nuevo"), { target: { files: [new File(["pdf"], "cv.pdf", { type: "application/pdf" })] } });
  }
  if (source === "apply") { vi.mocked(submitApplicationAction).mockResolvedValue(failure); await toSummary(); await user().click(screen.getByRole("button", { name: "Enviar postulación" })); }
  expect(await screen.findByRole("heading", { name: "Esta cuenta es de empresa" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Ir a empresa" })).toBeVisible(); expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
});
it("keeps the actual vacancy and company next to the final submission, not just above long answers", async () => {
  const { container } = mount(); await toSummary();
  const footer = screen.getByRole("button", { name: "Enviar postulación" }).closest('[data-slot="card-footer"]')!;
  expect(footer).toHaveTextContent("Backend Go");
  expect(footer).toHaveTextContent("Acme");
  expect(container.querySelectorAll('[aria-label="Destino de la postulación"]')).toHaveLength(1);
  expect(footer).not.toHaveTextContent("Salario no publicado"); // This prop carries no salary projection.
});
it("skips empty questions", async () => {
  vi.mocked(loadScreeningAction).mockResolvedValue({ ok: true, data: { ...screening, questions: [] } }); mount(); await toCv(); await user().click(screen.getByRole("button", { name: cv.name })); await user().click(screen.getByRole("button", { name: "Continuar" })); expect(screen.getByRole("heading", { name: "Resumen" })).toBeVisible();
});
it.each(["no_response", "server_error", "unrecognized_response"] as const)("explicitly retries %s with the same key and body", async reason => {
  vi.mocked(submitApplicationAction).mockResolvedValueOnce({ ok: false, reason, reference: {} }).mockResolvedValueOnce({ ok: true, data: submitted });
  mount(); await toSummary();
  const reserved = document.querySelector('[data-slot="card-footer"] [data-pf-action-status-slot]');
  expect(reserved).not.toBeNull();
  await user().click(screen.getByRole("button", { name: "Enviar postulación" }));
  expect(document.querySelector('[data-slot="card-footer"] [data-pf-action-status-slot]')).toBe(reserved);
  expect(submitApplicationAction).toHaveBeenCalledTimes(1); await user().click(await screen.findByRole("button", { name: "Reintentar" }));
  expect(submitApplicationAction).toHaveBeenCalledTimes(2); expect(vi.mocked(submitApplicationAction).mock.calls[1]).toEqual(vi.mocked(submitApplicationAction).mock.calls[0]);
});
it("reloads changed questions preserving CV and rotates the key", async () => {
  vi.mocked(submitApplicationAction).mockResolvedValueOnce({ ok: false, reason: "questionnaire_changed", reference: {} }).mockResolvedValueOnce({ ok: true, data: submitted });
  mount(); await toSummary(); vi.mocked(loadScreeningAction).mockResolvedValue({ ok: true, data: { ...screening, questionnaire_revision: "revision-2" } });
  await user().click(screen.getByRole("button", { name: "Enviar postulación" })); expect(await screen.findByText("Las preguntas cambiaron. Revisa tus respuestas.")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Cuéntanos tu experiencia"), { target: { value: "Actualizada" } }); await user().click(screen.getByRole("button", { name: "Inmediata" })); await user().click(screen.getByRole("button", { name: "Continuar" }));
  expect(screen.getByText(cv.name)).toBeVisible(); await user().click(screen.getByRole("button", { name: "Enviar postulación" }));
  const calls = vi.mocked(submitApplicationAction).mock.calls; expect(calls[1][1]).not.toBe(calls[0][1]); expect(calls[1][2]).toMatchObject({ questionnaire_revision: "revision-2", cv_id: cv.id });
});
it("returns to questions, not an empty summary, after a failed changed-question reload", async () => {
  vi.mocked(submitApplicationAction).mockResolvedValue({ ok: false, reason: "questionnaire_changed", reference: {} }); mount(); await toSummary();
  vi.mocked(loadScreeningAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} }).mockResolvedValueOnce({ ok: true, data: { ...screening, questionnaire_revision: "revision-2" } });
  await user().click(screen.getByRole("button", { name: "Enviar postulación" }));
  await user().click(await screen.findByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("heading", { name: "Preguntas" })).toBeVisible(); expect(screen.queryByRole("button", { name: "Enviar postulación" })).toBeNull(); expect(submitApplicationAction).toHaveBeenCalledTimes(1);
});
it.each(["invalid_request", "idempotency_conflict", "invalid_idempotency_key", "idempotency_key_required", "forbidden"] as const)("retains a persistent %s result without automatic retry", async reason => {
  vi.mocked(submitApplicationAction).mockResolvedValue({ ok: false, reason, reference: {} }); mount(); await toSummary(); await user().click(screen.getByRole("button", { name: "Enviar postulación" }));
  expect(submitApplicationAction).toHaveBeenCalledTimes(1); expect(screen.getByRole("status")).toBeVisible(); expect(screen.getByRole("heading", { name: "Resumen" })).toBeVisible(); expect(screen.getByText("Experiencia Go")).toBeVisible();
});
it("offers sign-in after a submit session expires", async () => {
  vi.mocked(submitApplicationAction).mockResolvedValue({ ok: false, reason: "unauthenticated", reference: {} }); mount(); await toSummary(); await user().click(screen.getByRole("button", { name: "Enviar postulación" })); expect(await screen.findByRole("button", { name: "Ingresar como candidato" })).toBeVisible();
});
it("maps invalid answer details and focuses first visually invalid question", async () => {
  vi.mocked(submitApplicationAction).mockResolvedValue({ ok: false, reason: "invalid_answers", reference: {}, details: [{ question_id: questionId, reason: "unknown_option" }, { question_id: id, reason: "too_long" }] });
  mount(); await toSummary(); await user().click(screen.getByRole("button", { name: "Enviar postulación" }));
  await waitFor(() => expect(screen.getByLabelText("Cuéntanos tu experiencia")).toHaveFocus()); expect(screen.getAllByRole("alert")).toHaveLength(2);
});
it("reloads an unknown invalid question with a general error", async () => {
  vi.mocked(submitApplicationAction).mockResolvedValue({ ok: false, reason: "invalid_answers", reference: {}, details: [{ question_id: optionId, reason: "required" }] });
  mount(); await toSummary(); await user().click(screen.getByRole("button", { name: "Enviar postulación" })); await waitFor(() => expect(loadScreeningAction).toHaveBeenCalledTimes(2)); expect(await screen.findByText("No pudimos validar las preguntas. Revísalas otra vez.")).toBeVisible();
});
it.each([["already_applied", "Ya te postulaste a esta vacante"], ["not_found", "Esta vacante ya no está disponible"], ["cv_unavailable", "Ese CV ya no está en tu biblioteca. Elige otro."]] as const)("handles %s", async (reason, text) => {
  vi.mocked(submitApplicationAction).mockResolvedValue({ ok: false, reason, reference: {} }); mount(); await toSummary(); await user().click(screen.getByRole("button", { name: "Enviar postulación" })); expect(await screen.findByText(text)).toBeVisible();
  if (reason === "cv_unavailable") expect(screen.getByLabelText("Subir un CV nuevo")).toBeVisible();
});
