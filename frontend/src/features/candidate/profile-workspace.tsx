"use client";

import * as React from "react";
import { Check, CircleAlert, Info, Pencil, Save, Undo2 } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateCard } from "@/components/feedback/state-card";
import { Spinner } from "@/components/ui/spinner";
import { ActionStatus } from "@/components/feedback/action-status";
import { dismissActionResult, notifyActionResult } from "@/components/feedback/notify";
import { CARD } from "@/features/company-metrics/sections/summary-strip";
import { useIdentity } from "@/features/identity/identity-session";
import { locationErrorMessages } from "@/features/geo/model";
import { cn } from "@/lib/utils";
import type { CandidateIdentity } from "./model";
import { parseProfileDraft, profileToDraft, type CandidateProfileDraft, type ProfileDraftIssue, type ProfileBaseline } from "./profile-draft";
import { ProfileFormFields, type ProfileCategory } from "./profile-form-fields";
import { loadProfileAction, saveProfileAction } from "./profile-actions";
import { profileFromWire, profileToWrite } from "./profile-adapter";
import type { ProfileFailure, ProfileLanguages, ProfileRead } from "./profile-api";
import type { ProfileSaveOutcome } from "./profile-save";
import { profileFieldIssues, sortProfileIssues } from "./profile-field-errors";
import { draftCompleteness, type KeyDataKey } from "./profile-completeness";
import { ProfileFicha } from "./profile/ficha";
import { updatedText } from "./profile/format";
import { LAYOUT, MAIN, RAIL, RAIL_FIRST } from "./profile/layout";
import { CompanyReceivesCard, CompletenessCard } from "./profile/rail";
import { SaveBar } from "./profile/save-bar";
import { categoryOf, changedSections, discardSection, PROFILE_SECTIONS, sectionTitle } from "./profile/sections";
import { SectionRead, VisibilityTag } from "./profile/section-read";
import { ProfileSkeleton } from "./profile/skeleton";
import styles from "./profile/profile.module.css";


const PARTIAL = "Guardamos tu perfil, pero no los idiomas. Revisa y vuelve a guardar.";
const UNCERTAIN = "No pudimos confirmar si se guardó";
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** The control that receives focus for an issue path, in whichever section owns it. */
function focusSelector(path: string) {
  if (path.startsWith("location.")) return '[data-pf-profile-field="location"] [aria-invalid="true"]';
  if (path === "languages") return "[data-pf-profile-language-add]";
  if (path === "education") return "[data-pf-profile-education-add]";
  return `[data-pf-profile-field="${path}"]`;
}
/** Where a missing key data point is completed: its field, the first incomplete row, or the add action. */
function gotoSelectors(key: KeyDataKey, draft: CandidateProfileDraft): string[] {
  if (key === "location") return ['[data-pf-profile-field="location"] input'];
  if (key === "education") {
    const index = draft.education.findIndex(study => !study.level || !study.status);
    if (index < 0) return ["[data-pf-profile-education-add]"];
    return [`[data-pf-profile-field="education.${index}.${draft.education[index].level ? "status" : "level"}"]`];
  }
  if (key === "languages") {
    const index = draft.languages.findIndex(row => !row.code || !row.level);
    if (index < 0) return ["[data-pf-profile-language-add]"];
    return [`[data-pf-profile-field="languages.${index}.${draft.languages[index].code ? "level" : "code"}"]`];
  }
  return [`[data-pf-profile-field="${key}"]`];
}
/** A read placeholder («Agregar estudio», «Agregar idioma») lands on the add action of an empty list. */
function addSelectors(section: ProfileCategory, draft: CandidateProfileDraft): readonly string[] {
  if (section === "education" && !draft.education.length) return ['[data-pf-profile-group="education"] button'];
  if (section === "languages" && !draft.languages.length) return ["[data-pf-profile-language-add]"];
  return firstControl(section);
}
const firstControl = (section: ProfileCategory) => [`[data-pf-profile-section="${section}"] [data-pf-profile-section-form] [data-pf-profile-field]`, `[data-pf-profile-section="${section}"] [data-pf-profile-section-form] button`];

/** Identity comes from the existing authenticated boundary, never a prototype. */
export function ProfileWorkspace() {
  const session = useIdentity();
  const identity = session.result?.ok && session.result.data.role === "candidate" ? session.result.data.user : null;
  if (!identity) return <ProfileSkeleton />;
  return <ProfileLoader key={identity.id} identity={{ userId: identity.id, email: identity.email, fullName: identity.full_name, userType: "candidate" }} />;
}
function editorBaseline(profile: ProfileRead | null, languages: ProfileLanguages): ProfileBaseline {
  if (profile) return profileFromWire(profile, languages);
  return {
    phone: null, linkedinUrl: null, portfolioUrl: null, professionalTitle: null,
    currentCompany: null, yearsOfExperience: null, summary: null, birthDate: null,
    location: null, seniority: null, education: [], skills: [],
    currentSalaryGross: null, currentSalaryNet: null, expectedSalary: null,
    salaryCurrency: "MXN", expectedSalaryPeriod: null, languages: languages.languages,
    createdAt: null, updatedAt: null,
  };
}
function ProfileLoader({ identity }: { identity: CandidateIdentity }) {
  const [state, setState] = React.useState<{ baseline: ProfileBaseline; isNew: boolean } | ProfileFailure | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    let active = true;
    loadProfileAction().catch((): ProfileFailure => ({ ok: false, reason: "no_response", reference: {} })).then(result => {
      if (!active) return;
      setState(result.ok ? { baseline: editorBaseline(result.data.profile, result.data.languages), isNew: result.data.profile === null } : result);
    });
    return () => { active = false; };
  }, [attempt]);
  if (state === null) return <ProfileSkeleton />;
  if ("ok" in state) return <DashboardPageContent width="screen-2xl"><StateCard icon={CircleAlert} tone="error" title="No pudimos cargar tu perfil" description="Tus datos no cambiaron."
    primaryAction={state.reason === "unauthenticated" ? { label: "Iniciar sesión", href: "/candidato/login" } : { label: "Reintentar", onClick: () => { setState(null); setAttempt(value => value + 1); } }}
    secondaryAction={{ label: "Ir al panel", href: "/candidato" }} /></DashboardPageContent>;
  return <ProfileEditor identity={identity} initial={state.baseline} initiallyNew={state.isNew} />;
}

/**
 * Artboard 04 «Así te ven las empresas»: the ficha a company receives, the five sections edited in place (one at a
 * time), the completeness rail and a fixed «Cambios sin guardar» bar. One form and one save write the whole profile;
 * validation, focus-first-error, the save outcomes and Comprobar are unchanged from the tabbed editor.
 */
function ProfileEditor({ identity, initial, initiallyNew }: { identity: CandidateIdentity; initial: ProfileBaseline; initiallyNew: boolean }) {
  const [baseline, setBaseline] = React.useState(initial);
  const [isNew, setIsNew] = React.useState(initiallyNew);
  const [draft, setDraft] = React.useState(() => profileToDraft(initial));
  const [issues, setIssues] = React.useState<readonly ProfileDraftIssue[]>([]);
  const [editing, setEditing] = React.useState<ProfileCategory | null>(null);
  const [focus, setFocus] = React.useState<{ selectors: readonly string[] } | null>(null);
  const [status, setStatus] = React.useState<{ text: string; tone: "success" | "error" | "warning" | "info" } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [uncertain, setUncertain] = React.useState(false);
  const busy = React.useRef(false);
  const form = React.useRef<HTMLFormElement>(null);
  const baseDraft = profileToDraft(baseline);
  const dirty = !equal(draft, baseDraft);
  const changed = changedSections(draft, baseDraft);
  const completeness = draftCompleteness(draft);
  React.useEffect(() => {
    if (!focus) return;
    for (const selector of focus.selectors) {
      const target = form.current?.querySelector<HTMLElement>(selector);
      if (target) { target.focus(); return; }
    }
  }, [focus]);
  function open(section: ProfileCategory, selectors: readonly string[] = firstControl(section)) {
    setEditing(section); setFocus({ selectors });
  }
  function markIssues(next: readonly ProfileDraftIssue[]) {
    const ordered = sortProfileIssues(next);
    setIssues(ordered);
    if (ordered[0]) open(categoryOf(ordered[0].path), [focusSelector(ordered[0].path)]);
  }
  function announce(text: string, tone: "success" | "error" | "warning" | "info", failure?: ProfileFailure) {
    setStatus({ text, tone });
    notifyActionResult({ key: "candidate-profile", type: tone, title: tone === "warning" ? "Perfil guardado parcialmente" : text, description: tone === "warning" ? text : tone === "error" ? "Tus cambios siguen aquí. Revisa los datos antes de continuar." : "", ...(tone === "error" ? { reference: { ...failure?.reference, at: new Date().toISOString() } } : {}) });
  }
  function adopt(outcome: ProfileSaveOutcome) {
    if (!("profile" in outcome) && !("languages" in outcome)) return;
    const languages = "languages" in outcome && outcome.languages ? outcome.languages.languages : baseline.languages;
    const next = "profile" in outcome && outcome.profile ? profileFromWire(outcome.profile, { languages }) : { ...baseline, languages };
    setBaseline(next);
    if ("profile" in outcome && outcome.profile) setIsNew(false);
    const canonical = profileToDraft(next);
    // A rejected/uncertain language write must not erase its unsaved rows.
    setDraft(current => ({ ...("profile" in outcome && outcome.profile ? canonical : current), languages: "languages" in outcome && outcome.languages ? canonical.languages : current.languages }));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || uncertain || (!isNew && !dirty)) return;
    const parsed = parseProfileDraft(draft, baseline);
    if (!parsed.ok) { markIssues(parsed.issues); announce("Revisa los datos marcados", "error"); return; }
    const base = parseProfileDraft(baseDraft, baseline);
    const profile = profileToWrite(parsed.profile);
    const languages = { languages: parsed.profile.languages };
    const input = { ...(isNew || !base.ok || !equal(profile, profileToWrite(base.profile)) ? { profile } : {}), ...(!equal(languages.languages, baseline.languages) ? { languages } : {}) };
    busy.current = true; setPending(true); setIssues([]); dismissActionResult("candidate-profile");
    let outcome: ProfileSaveOutcome;
    try { outcome = await saveProfileAction(input); }
    catch { outcome = { kind: "uncertain", part: "profile", failure: { ok: false, reason: "no_response", reference: {} } }; }
    busy.current = false; setPending(false);
    adopt(outcome);
    if (outcome.kind === "saved") announce(isNew ? "Perfil creado." : "Perfil guardado.", "success");
    else if (outcome.kind === "partial") {
      if (outcome.failure.fields) markIssues(profileFieldIssues(outcome.failure.fields, draft.dial));
      announce(PARTIAL, "warning", outcome.failure);
    }
    else if (outcome.kind === "uncertain") { setUncertain(true); announce(UNCERTAIN, "error", outcome.failure); }
    else if (outcome.kind === "invalid") { markIssues(outcome.issues); announce("Revisa los datos marcados", "error"); }
    else if (outcome.kind === "failed") {
      if (outcome.failure.fields) markIssues(profileFieldIssues(outcome.failure.fields, draft.dial));
      if (outcome.failure.locationIssues) markIssues(outcome.failure.locationIssues.map(issue => ({ path: `location.${issue.field}`, message: locationErrorMessages[issue.reason] })));
      announce(outcome.failure.reason === "unauthenticated" ? "Tu sesión expiró" : "No se guardó el perfil", "error", outcome.failure);
    } else { setDraft(baseDraft); announce("No hay cambios para guardar", "info"); }
  }
  async function reconcile() {
    if (busy.current) return;
    busy.current = true; setPending(true);
    try {
      const result = await loadProfileAction();
      if (!result.ok) { announce(UNCERTAIN, "error", result); return; }
      const next = editorBaseline(result.data.profile, result.data.languages);
      setIsNew(result.data.profile === null);
      // Re-read baselines only. Never discard outstanding user edits or resend.
      setBaseline(next); setUncertain(false); setIssues([]); announce("Perfil comprobado.", "info");
    } catch { announce(UNCERTAIN, "error"); }
    finally { busy.current = false; setPending(false); }
  }
  function restore() { setDraft(baseDraft); setIssues([]); setFocus(null); setStatus({ text: "Restauramos la copia original en esta vista.", tone: "info" }); }
  function discard(section: ProfileCategory) {
    setDraft(current => discardSection(current, baseDraft, section));
    setIssues(current => current.filter(issue => categoryOf(issue.path) !== section)); setStatus(null);
    setFocus({ selectors: firstControl(section) });
  }
  function close(section: ProfileCategory) { setEditing(null); setFocus({ selectors: [`[data-pf-profile-edit="${section}"]`] }); }
  const describedBy = status ? "profile-action-status" : undefined;
  const actions = (large: boolean) => <>
    <Button type="button" variant="outline" data-pf-profile-reset className={cn("transition-colors duration-200 motion-reduce:transition-none", large ? "min-h-11" : "min-h-10")} disabled={!dirty || pending || uncertain} onClick={restore}><Undo2 data-icon="inline-start" aria-hidden="true" />Restaurar copia original</Button>
    <Button type="submit" data-pf-profile-review variant={uncertain ? "outline" : "default"} className={cn("transition-colors duration-200 motion-reduce:transition-none", large ? "min-h-11" : "min-h-10")} disabled={(!isNew && !dirty) || pending || uncertain} aria-busy={pending} aria-describedby={describedBy}>{pending && !uncertain ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <Save data-icon="inline-start" aria-hidden="true" />}{pending && !uncertain ? "Guardando…" : "Guardar perfil"}</Button>
    {uncertain && <Button type="button" className={large ? "min-h-11" : "min-h-10"} disabled={pending} aria-busy={pending} onClick={reconcile}>{pending && <Spinner data-icon="inline-start" aria-hidden="true" />}{pending ? "Comprobando…" : "Comprobar"}</Button>}
  </>;
  const updated = updatedText(baseline.updatedAt);
  return <DashboardPageContent data-pf-profile-workspace width="screen-2xl"><form ref={form} noValidate data-pf-profile-form onSubmit={submit} className="flex min-w-0 flex-col gap-6">
    <header data-pf-profile-header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">Tu perfil</h2>
        <p role="status" aria-live="polite" data-pf-profile-status className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-muted-foreground tabular-nums sm:text-sm">
          <Badge variant={dirty ? "review" : "neutral"} dot={dirty} data-pf-profile-dirty>{dirty ? "Cambios pendientes" : "Sin cambios pendientes"}</Badge>
          {isNew ? <span>Se crea al guardar por primera vez</span> : updated && <span data-pf-profile-updated>Actualizado el {updated}</span>}
        </p>
      </div>
      <div data-pf-profile-actions className="flex flex-wrap items-center gap-2 max-sm:hidden">{actions(true)}</div>
    </header>
    {status && <ActionStatus id="profile-action-status" tone={status.tone} text={status.text} />}
    {isNew && <div data-pf-profile-new className={cn(CARD, "flex-row items-start gap-3 bg-[color-mix(in_oklab,var(--primary)_5%,var(--card))] px-5 py-4 ring-primary/15")}>
      <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary-text" />
      <p><b className="font-semibold">Completa tu perfil para postularte más rápido.</b> <span className="text-muted-foreground">Empieza por cualquier sección; tu perfil se crea al guardar por primera vez.</span></p>
    </div>}
    <div className={LAYOUT}>
      <div className={MAIN}>
        <ProfileFicha fullName={identity.fullName} email={identity.email} draft={draft} baseline={baseline} onEdit={(section, path) => open(section, [focusSelector(path)])} />
        {PROFILE_SECTIONS.map(({ key, title }, index) => {
          const isEditing = editing === key;
          const sectionChanged = changed.includes(key);
          const flagged = !isEditing && issues.some(issue => categoryOf(issue.path) === key);
          return <section key={key} aria-labelledby={`pf-section-${key}`} data-pf-profile-section={key} data-editing={isEditing || undefined} style={{ "--d": Math.min(index + 2, 4) } as React.CSSProperties}
            className={cn(CARD, "gap-4 p-4 transition-colors duration-150 motion-reduce:transition-none sm:px-7 sm:py-6", styles.rise, isEditing && styles.editing)}>
            <div className="flex min-h-10 flex-wrap items-center gap-x-3.5 gap-y-1.5">
              <h3 id={`pf-section-${key}`} className="text-[17px] leading-[26px] font-semibold sm:text-lg sm:leading-7">{title}</h3>
              {sectionChanged && <Badge variant="review" dot>Sin guardar</Badge>}
              {flagged && <Badge variant="danger" dot>Revisa los datos</Badge>}
              <span className="max-sm:order-last max-sm:basis-full"><VisibilityTag section={key} /></span>
              <span aria-hidden="true" className="flex-1" />
              {!isEditing && <Button type="button" variant="ghost" data-pf-profile-edit={key} aria-label={`Editar ${title}`} className="-my-1 min-h-10" onClick={() => open(key)}><Pencil data-icon="inline-start" aria-hidden="true" />Editar</Button>}
            </div>
            {isEditing ? <div data-pf-profile-section-form className="flex min-w-0 flex-col gap-6">
              <fieldset disabled={pending || uncertain} className="min-w-0">
                <ProfileFormFields draft={draft} issues={issues} onChange={next => { if (!busy.current && !uncertain) { setDraft(next); setIssues([]); setStatus(null); } }} category={key} disabled={pending || uncertain} />
              </fieldset>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <p className="min-w-50 flex-1 text-xs text-muted-foreground">Los cambios se guardan al pulsar «Guardar perfil».</p>
                <Button type="button" variant="ghost" className="min-h-10 max-sm:min-h-11 max-sm:w-full" disabled={!sectionChanged || pending || uncertain} onClick={() => discard(key)}>Descartar cambios de {title.toLowerCase()}</Button>
                <Button type="button" variant="outline" className="min-h-10 max-sm:min-h-11 max-sm:w-full" onClick={() => close(key)}><Check data-icon="inline-start" aria-hidden="true" />Listo</Button>
              </div>
            </div> : <div className="flex min-w-0 flex-col gap-4"><SectionRead section={key} draft={draft} baseline={baseline} email={identity.email} onAdd={() => open(key, addSelectors(key, draft))} /></div>}
          </section>;
        })}
      </div>
      <div data-pf-profile-rail className={RAIL}>
        <CompletenessCard completeness={completeness} className={completeness.completed < completeness.total ? RAIL_FIRST : undefined} onGoto={key => open(categoryOf(key), gotoSelectors(key, draft))} />
        <CompanyReceivesCard />
      </div>
    </div>
    {(dirty || isNew || pending || uncertain) && <SaveBar changed={changed.map(sectionTitle)} isNew={isNew} pending={pending} uncertain={uncertain}>{actions(false)}</SaveBar>}
  </form></DashboardPageContent>;
}
