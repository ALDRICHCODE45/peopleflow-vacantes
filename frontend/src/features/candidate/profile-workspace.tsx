"use client";

import * as React from "react";
import { Check, CircleAlert, Lock, Pencil, Save, Undo2 } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { Button } from "@/components/ui/button";
import { StateCard } from "@/components/feedback/state-card";
import { Spinner } from "@/components/ui/spinner";
import { ActionStatus } from "@/components/feedback/action-status";
import { dismissActionResult, notifyActionResult } from "@/components/feedback/notify";
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
import { updatedText } from "./profile/format";
import { IdentityCard } from "./profile/identity-card";
import { ASIDE, LAYOUT, TAB_CARD } from "./profile/layout";
import { SaveBar } from "./profile/save-bar";
import { categoryOf, changedTabs, discardTab, PROFILE_TABS, tabTitle } from "./profile/sections";
import { lockedIn, PrivateMark, TabRead } from "./profile/section-read";
import { ProfileSkeleton } from "./profile/skeleton";
import { PANEL_ID, ProfileTabs, tabId } from "./profile/tabs";
import { PROFILE_VISIBILITY, sectionVisibility, type VisibilityField } from "./profile/visibility";
import styles from "./profile/profile.module.css";

const PARTIAL = "Guardamos tu perfil, pero no los idiomas. Revisa y vuelve a guardar.";
const UNCERTAIN = "No pudimos confirmar si se guardó";
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** The control that receives focus for an issue path, in whichever tab owns it. */
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
/** Where «Editar» lands in each tab: the artboard's first field, or the add action of an empty list. */
function editSelectors(tab: ProfileCategory, draft: CandidateProfileDraft): readonly string[] {
  if (tab === "education") return draft.education.length ? ['[data-pf-profile-field="education.0.level"]'] : ['[data-pf-profile-group="education"] button'];
  if (tab === "languages") return draft.languages.length ? ['[data-pf-profile-field="languages.0.code"]'] : ["[data-pf-profile-language-add]"];
  const first = { personal: "phone", experience: "professionalTitle", compensation: "currentSalaryGross" }[tab];
  return [`[data-pf-profile-field="${first}"]`, `#${PANEL_ID} [data-pf-profile-field]`];
}
const EDIT_BUTTON = ["[data-pf-profile-edit]"];
const TITLE = ["[data-pf-profile-title]"];
const isVisibilityField = (path: string): path is VisibilityField => path in PROFILE_VISIBILITY;

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
 * Artboard 01 «Identidad a la izquierda y pestañas»: a sticky light identity card with the completeness meter and
 * «¿Qué ve una empresa?» on the left, and one card with five tabs on the right, each read-only until «Editar». One
 * form and one save write the whole profile; the save bar shows only with changes (or for a new profile). Validation,
 * focus-first-error, the save outcomes, Restaurar and Comprobar are unchanged from the previous editor.
 */
function ProfileEditor({ identity, initial, initiallyNew }: { identity: CandidateIdentity; initial: ProfileBaseline; initiallyNew: boolean }) {
  const [baseline, setBaseline] = React.useState(initial);
  const [isNew, setIsNew] = React.useState(initiallyNew);
  const [draft, setDraft] = React.useState(() => profileToDraft(initial));
  const [issues, setIssues] = React.useState<readonly ProfileDraftIssue[]>([]);
  const [tab, setTab] = React.useState<ProfileCategory>("personal");
  const [editing, setEditing] = React.useState(false);
  const [focus, setFocus] = React.useState<{ selectors: readonly string[] } | null>(null);
  const [status, setStatus] = React.useState<{ text: string; tone: "success" | "error" | "warning" | "info" } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [uncertain, setUncertain] = React.useState(false);
  const busy = React.useRef(false);
  const form = React.useRef<HTMLFormElement>(null);
  const baseDraft = profileToDraft(baseline);
  const dirty = !equal(draft, baseDraft);
  const changed = changedTabs(draft, baseDraft);
  const flagged = [...new Set(issues.map(issue => categoryOf(issue.path)))];
  const completeness = draftCompleteness(draft);
  const audience = sectionVisibility(tab);
  React.useEffect(() => {
    if (!focus) return;
    for (const selector of focus.selectors) {
      const target = form.current?.querySelector<HTMLElement>(selector);
      if (target) { target.focus(); return; }
    }
  }, [focus]);
  /** Opens `next` in edit mode and focuses the first matching control. */
  function open(next: ProfileCategory, selectors: readonly string[] = editSelectors(next, draft)) {
    setTab(next); setEditing(true); setFocus({ selectors });
  }
  function select(next: ProfileCategory) {
    if (next !== tab) { setTab(next); setEditing(false); }
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
    if (outcome.kind === "saved") { setEditing(false); setFocus({ selectors: EDIT_BUTTON }); announce(isNew ? "Perfil creado." : "Perfil guardado.", "success"); }
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
      // With nothing left to save the bar (and the focused Comprobar) goes away: focus the page title.
      if (equal(draft, profileToDraft(next))) setFocus({ selectors: TITLE });
    } catch { announce(UNCERTAIN, "error"); }
    finally { busy.current = false; setPending(false); }
  }
  function restore() { setDraft(baseDraft); setIssues([]); setFocus({ selectors: TITLE }); setStatus({ text: "Restauramos la copia original en esta vista.", tone: "info" }); }
  function discard() {
    setDraft(current => discardTab(current, baseDraft, tab));
    setIssues(current => current.filter(issue => categoryOf(issue.path) !== tab)); setStatus(null);
    setFocus({ selectors: editSelectors(tab, draft) });
  }
  function done() { setEditing(false); setFocus({ selectors: EDIT_BUTTON }); }
  const privateMark = (path: string) => isVisibilityField(path) && lockedIn(tab, path) ? <PrivateMark field={path} /> : null;
  const describedBy = status ? "profile-action-status" : undefined;
  const title = tabTitle(tab);
  const tabChanged = changed.includes(tab);
  const updated = updatedText(baseline.updatedAt);
  return <DashboardPageContent data-pf-profile-workspace width="screen-2xl"><form ref={form} noValidate data-pf-profile-form onSubmit={submit} className="flex min-w-0 flex-col gap-6">
    <header data-pf-profile-header className="flex min-w-0 flex-col gap-1">
      <h2 data-pf-profile-title tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none sm:text-[28px] sm:leading-9">Tu perfil</h2>
      <p data-pf-profile-updated className="text-[13px] text-muted-foreground tabular-nums sm:text-sm">{isNew ? "Se crea al guardar por primera vez" : updated && `Actualizado el ${updated}`}</p>
    </header>
    {status && <ActionStatus id="profile-action-status" tone={status.tone} text={status.text} />}
    <div className={LAYOUT}>
      <div className={ASIDE}>
        <IdentityCard fullName={identity.fullName} draft={draft} baseline={baseline} completeness={completeness} onGoto={key => open(categoryOf(key), gotoSelectors(key, draft))} />
      </div>
      <section aria-label="Datos de tu perfil" data-pf-profile-tabs="" style={{ "--d": 2 } as React.CSSProperties} className={cn(TAB_CARD, styles.rise)}>
        <div className="p-3 sm:border-b sm:border-border sm:px-3.5 sm:pt-1 sm:pb-0">
          <ProfileTabs active={tab} onSelect={select} changed={changed} flagged={flagged} privateTabs={PROFILE_TABS.filter(({ key }) => sectionVisibility(key) === "private").map(({ key }) => key)} />
        </div>
        <div role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(tab)} data-editing={editing || undefined}
          className={cn("min-w-0 rounded-b-[min(var(--radius-4xl),24px)] px-4 pt-1 pb-5 transition-colors duration-150 motion-reduce:transition-none sm:px-7 sm:pt-5 sm:pb-7", editing && styles.editing)}>
          <h3 className="sr-only">{title}</h3>
          <div className="mb-3 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2 sm:mb-4">
            {audience === "private" && <p className="inline-flex items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground"><Lock aria-hidden="true" className="size-3.5" />Solo tú ves esta pestaña</p>}
            {audience === "mixed" && <p className="inline-flex items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground"><Lock aria-hidden="true" className="size-3.5" /><span>Solo tú · la empresa no lo recibe</span></p>}
            <span aria-hidden="true" className="flex-1 max-sm:hidden" />
            <div className="flex flex-wrap gap-2 max-sm:w-full">
              {editing ? <>
                {tabChanged && <Button type="button" variant="ghost" className="min-h-10 max-sm:min-h-11 max-sm:flex-1" disabled={pending || uncertain} aria-label={`Descartar cambios de ${title.toLowerCase()}`} onClick={discard}>Descartar cambios</Button>}
                <Button type="button" variant="outline" className="min-h-10 max-sm:min-h-11 max-sm:flex-1" onClick={done}><Check data-icon="inline-start" aria-hidden="true" />Listo</Button>
              </> : <Button type="button" variant="outline" data-pf-profile-edit={tab} aria-label={`Editar ${title}`} className="min-h-10 max-sm:min-h-11 max-sm:flex-1" onClick={() => open(tab)}><Pencil data-icon="inline-start" aria-hidden="true" />Editar</Button>}
            </div>
          </div>
          {editing
            ? <fieldset disabled={pending || uncertain} className="min-w-0">
              <ProfileFormFields draft={draft} issues={issues} onChange={next => { if (!busy.current && !uncertain) { setDraft(next); setIssues([]); setStatus(null); } }} category={tab} disabled={pending || uncertain} privateMark={privateMark} />
            </fieldset>
            : <div className="flex min-w-0 flex-col gap-7"><TabRead tab={tab} draft={draft} baseline={baseline} email={identity.email} onAdd={() => open(tab)} /></div>}
        </div>
      </section>
    </div>
    {(dirty || isNew || pending || uncertain) && <SaveBar changed={changed.map(tabTitle)} isNew={isNew} pending={pending} uncertain={uncertain}>
      {dirty && <Button type="button" variant="outline" data-pf-profile-reset className="min-h-10 transition-colors duration-200 motion-reduce:transition-none" disabled={pending || uncertain} onClick={restore}><Undo2 data-icon="inline-start" aria-hidden="true" />Restaurar copia original</Button>}
      <Button type="submit" data-pf-profile-review variant={uncertain ? "outline" : "default"} className="min-h-10 transition-colors duration-200 motion-reduce:transition-none" disabled={(!isNew && !dirty) || pending || uncertain} aria-busy={pending} aria-describedby={describedBy}>{pending && !uncertain ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <Save data-icon="inline-start" aria-hidden="true" />}{pending && !uncertain ? "Guardando…" : "Guardar perfil"}</Button>
      {uncertain && <Button type="button" className="min-h-10" disabled={pending} aria-busy={pending} onClick={reconcile}>{pending && <Spinner data-icon="inline-start" aria-hidden="true" />}{pending ? "Comprobando…" : "Comprobar"}</Button>}
    </SaveBar>}
  </form></DashboardPageContent>;
}
