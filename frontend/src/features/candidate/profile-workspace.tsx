"use client";

import * as React from "react";
import { cn } from "cn";
import { Building2, CircleAlert, Mail, MapPin, Plus, Save, Undo2 } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StateCard } from "@/components/feedback/state-card";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionStatus } from "@/components/feedback/action-status";
import { dismissActionResult, notifyActionResult } from "@/components/feedback/notify";
import { useIdentity } from "@/features/identity/identity-session";
import { locationErrorMessages } from "@/features/geo/model";
import type { CandidateIdentity } from "./model";
import { parseProfileDraft, profileToDraft, type ProfileDraftIssue, type ProfileBaseline } from "./profile-draft";
import { ProfileFormFields, type ProfileCategory } from "./profile-form-fields";
import { loadProfileAction, saveProfileAction } from "./profile-actions";
import { profileFromWire, profileToWrite } from "./profile-adapter";
import type { ProfileFailure, ProfileLanguages, ProfileRead } from "./profile-api";
import type { ProfileSaveOutcome } from "./profile-save";
import { profileFieldIssues, sortProfileIssues } from "./profile-field-errors";

const CATEGORIES = [{ value: "personal", label: "Personal" }, { value: "experience", label: "Experiencia" }, { value: "education", label: "Educación" }, { value: "compensation", label: "Compensación" }, { value: "languages", label: "Idiomas" }] as const;
const TAB_LIST = "max-w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-md:pr-12 max-md:[mask-image:linear-gradient(to_right,black_80%,transparent)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
// Preserve the validated main layout while the editor loads and saves real data.
const HERO = "border-b border-border/60 gap-y-4 has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_18rem]";
const IDENTITY = "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 md:gap-x-5";
const AVATAR = "size-14 shrink-0 ring-2 ring-primary/25 ring-offset-2 ring-offset-background md:size-20";
const META = "flex min-w-0 flex-wrap gap-x-4 gap-y-2 md:pl-25";
const HEADLINE = "max-w-full break-words text-sm font-medium";
const NAME = "min-w-0 break-words font-heading text-xl font-semibold text-foreground";
const CONTEXT_ITEM = "inline-flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground";
const COMPLETION_ACTION = "col-start-1 row-span-1 row-start-3 w-full md:col-start-2 md:row-span-2 md:row-start-1 md:w-72";
const COMPLETION = "flex flex-col gap-2.5";
const COMPLETION_HEAD = "flex items-baseline justify-between gap-3";
const COMPLETION_TITLE = "font-heading text-sm font-semibold text-foreground";
const COMPLETION_PERCENT = "font-heading text-2xl font-semibold text-primary";
const COMPLETION_BAR = "w-full gap-0";
const COMPLETION_COUNT = "text-sm text-muted-foreground";
const TOOLBAR = "flex flex-col gap-3 px-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between";
const TOOLBAR_COPY = "flex min-w-0 flex-1 flex-col gap-1";
const STATUS = "max-w-prose text-sm text-muted-foreground";
const ACTIONS = "flex flex-col gap-3 sm:flex-row sm:flex-wrap";
const ACTION = "min-h-10 transition-colors duration-200 motion-reduce:transition-none";
const CARD = "border border-border/70 ring-border/60";
const CARD_CONTENT = "flex flex-col gap-4";
const PARTIAL = "Guardamos tu perfil, pero no los idiomas. Revisa y vuelve a guardar.";
const UNCERTAIN = "No pudimos confirmar si se guardó";
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function categoryOf(path: string): ProfileCategory {
  if (path.startsWith("languages")) return "languages";
  if (path.startsWith("location") || ["phone", "linkedinUrl", "portfolioUrl", "birthDate"].includes(path)) return "personal";
  if (["currentSalaryGross", "currentSalaryNet", "expectedSalary", "salaryCurrency", "expectedSalaryPeriod"].includes(path)) return "compensation";
  if (path.startsWith("education") || path === "skills") return "education";
  return "experience";
}
function focusSelector(path: string) {
  if (path.startsWith("location.")) return '[data-pf-profile-field="location"] [aria-invalid="true"]';
  if (path === "languages") return "[data-pf-profile-language-add]";
  if (path === "education") return "[data-pf-profile-education-add]";
  return `[data-pf-profile-field="${path}"]`;
}
export function ProfileSkeleton() {
  return <DashboardPageContent data-pf-profile-workspace width="screen-2xl"><div aria-busy="true" className="flex flex-col gap-5"><span role="status" className="sr-only">Cargando perfil</span>
    <div aria-hidden="true" data-pf-profile-toolbar className={TOOLBAR}>
      <div className={TOOLBAR_COPY}><Skeleton className="h-5 w-40" /></div>
      <div className={ACTIONS}><Skeleton className="h-10 w-36" /><Skeleton className="h-10 w-52" /></div>
    </div>
    <Card aria-hidden="true" data-pf-profile-card className={CARD}>
      <CardHeader data-pf-profile-identity className={HERO}>
        <CardTitle className={IDENTITY}><Skeleton className={`${AVATAR} row-span-2 rounded-full`} /><Skeleton className="h-7 w-48 max-w-full" /><Skeleton className="col-start-2 h-5 w-56 max-w-full" /></CardTitle>
        <CardDescription className={META}><Skeleton className="h-5 w-56" /><Skeleton className="h-4 w-64" /></CardDescription>
        <CardAction className={COMPLETION_ACTION}>
          <div className={COMPLETION}><div className={COMPLETION_HEAD}><Skeleton className="h-5 w-32" /><Skeleton className="h-8 w-12" /></div><Skeleton className="h-1 w-full" /><Skeleton className="h-5 w-40" /></div>
        </CardAction>
      </CardHeader>
      <CardContent><div className={CARD_CONTENT}>
        <div className="flex h-8 max-w-full gap-3 overflow-hidden">{CATEGORIES.map(item => <Skeleton key={item.value} className="h-8 w-24 shrink-0" />)}</div>
        <FieldGroup className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          {["Contacto", "Ubicación"].map(title => <Card size="sm" key={title} className="shadow-none ring-border/70">
            <CardHeader className="border-b"><CardTitle><Skeleton className="h-5 w-36" /></CardTitle>{title === "Ubicación" && <CardAction><Skeleton className="h-10 w-24 rounded-full" /></CardAction>}</CardHeader>
            <CardContent className="flex flex-col gap-4"><FieldSet className="gap-4"><FieldLegend className="sr-only">{title}</FieldLegend>
              <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {(title === "Contacto" ? [false, false, false, true] : [true, true]).map((wide, index) => <Field key={index} className={wide ? "sm:col-span-2" : undefined}><FieldLabel><Skeleton className="h-5 w-28" /></FieldLabel><Skeleton className="h-10 w-full" /></Field>)}
              </FieldGroup>
            </FieldSet></CardContent>
          </Card>)}
        </FieldGroup>
      </div></CardContent>
    </Card></div></DashboardPageContent>;
}

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
function ProfileEditor({ identity, initial, initiallyNew }: { identity: CandidateIdentity; initial: ProfileBaseline; initiallyNew: boolean }) {
  const [baseline, setBaseline] = React.useState(initial);
  const [isNew, setIsNew] = React.useState(initiallyNew);
  const [draft, setDraft] = React.useState(() => profileToDraft(initial));
  const [issues, setIssues] = React.useState<readonly ProfileDraftIssue[]>([]);
  const [activeTab, setActiveTab] = React.useState<ProfileCategory>("personal");
  const [focus, setFocus] = React.useState<{ path: string } | null>(null);
  const [status, setStatus] = React.useState<{ text: string; tone: "success" | "error" | "warning" | "info" } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [uncertain, setUncertain] = React.useState(false);
  const busy = React.useRef(false);
  const form = React.useRef<HTMLFormElement>(null);
  const baseDraft = profileToDraft(baseline);
  const dirty = !equal(draft, baseDraft);
  React.useEffect(() => { if (focus) form.current?.querySelector<HTMLElement>(focusSelector(focus.path))?.focus(); }, [focus]);
  function markIssues(next: readonly ProfileDraftIssue[]) {
    const ordered = sortProfileIssues(next);
    setIssues(ordered);
    if (ordered[0]) { setActiveTab(categoryOf(ordered[0].path)); setFocus({ path: ordered[0].path }); }
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
  const signals = [draft.professionalTitle, draft.currentCompany, draft.yearsOfExperience, draft.summary, draft.phone, draft.location.country, draft.education.some(study => study.level && study.status), draft.skills, draft.expectedSalary, draft.languages.some(row => row.code && row.level)];
  const done = signals.filter(Boolean).length;
  const initials = identity.fullName.split(/\s+/).slice(0, 2).map(part => part[0]).join("");
  return <DashboardPageContent data-pf-profile-workspace width="screen-2xl">{isNew && <p className="mb-5 text-sm text-muted-foreground">Completa tu perfil para postularte más rápido. Se crea al guardar por primera vez.</p>}<form ref={form} noValidate data-pf-profile-form onSubmit={submit} className="flex flex-col gap-5">
    <div data-pf-profile-toolbar className={TOOLBAR}>
      <div className={TOOLBAR_COPY}>
        <p role="status" aria-live="polite" data-pf-profile-status className={STATUS}>
          <Badge variant={dirty ? "review" : "neutral"} data-pf-profile-dirty>{dirty ? "Cambios pendientes" : "Sin cambios pendientes"}</Badge>
        </p>
        {status && <ActionStatus id="profile-action-status" tone={status.tone} text={status.text} />}
      </div>
      <div className={ACTIONS}>
        <Button type="submit" data-pf-profile-review variant={uncertain ? "outline" : "default"} className={ACTION} disabled={(!isNew && !dirty) || pending || uncertain} aria-busy={pending} aria-describedby={status ? "profile-action-status" : undefined}>{pending && !uncertain ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <Save data-icon="inline-start" aria-hidden="true" />}{pending && !uncertain ? "Guardando…" : "Guardar perfil"}</Button>
        <Button type="button" variant="outline" data-pf-profile-reset className={ACTION} disabled={!dirty || pending || uncertain} onClick={() => { setDraft(baseDraft); setIssues([]); setFocus(null); setStatus({ text: "Restauramos la copia original en esta vista.", tone: "info" }); }}><Undo2 data-icon="inline-start" aria-hidden="true" />Restaurar copia original</Button>
        {uncertain && <Button type="button" className={ACTION} disabled={pending} aria-busy={pending} onClick={reconcile}>{pending && <Spinner data-icon="inline-start" aria-hidden="true" />}{pending ? "Comprobando…" : "Comprobar"}</Button>}
      </div>
    </div>
    <Card data-pf-profile-card className={CARD}>
      <CardHeader data-pf-profile-identity className={HERO}>
        <CardTitle className={IDENTITY}>
          <Avatar className={cn(AVATAR, draft.professionalTitle.trim() ? "row-span-2" : "md:row-span-2")}><AvatarFallback className="bg-primary/10 font-semibold text-primary dark:bg-primary/25 dark:text-foreground">{initials}</AvatarFallback></Avatar>
          <h2 id="pf-profile-identity-heading" className={NAME}>{identity.fullName}</h2>
          {draft.professionalTitle.trim()
            ? <p data-pf-profile-headline className={`${HEADLINE} col-start-2`}>{draft.professionalTitle.trim()}</p>
            // On narrow screens the full label gets its own row rather than squeezing beside the avatar.
            : <Button type="button" variant="link" className="col-start-2 h-auto min-h-8 justify-self-start px-0 text-muted-foreground has-data-[icon=inline-start]:pl-0" onClick={() => { setActiveTab("experience"); setFocus({ path: "professionalTitle" }); }}><Plus data-icon="inline-start" aria-hidden="true" />Agrega tu título profesional</Button>}
        </CardTitle>
        <CardDescription data-pf-profile-context className={META}>
          <span className={CONTEXT_ITEM}><Mail className="size-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]" data-pf-profile-email>{identity.email}</span></span>
          {baseline.location?.label.trim() && <span className={CONTEXT_ITEM}><MapPin className="size-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{baseline.location.label}</span></span>}
          {draft.currentCompany.trim() && <span className={CONTEXT_ITEM}><Building2 className="size-3.5 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">Trabaja en {draft.currentCompany.trim()}</span></span>}
        </CardDescription>
        <CardAction className={COMPLETION_ACTION}>
          <div data-pf-profile-completeness className={COMPLETION}>
            <div className={COMPLETION_HEAD}>
              <h3 id="pf-profile-completion-heading" className={COMPLETION_TITLE}>Avance del perfil</h3>
              <span className={COMPLETION_PERCENT}>{done * 10}%</span>
            </div>
            <Progress aria-labelledby="pf-profile-completion-heading" value={done} max={10} className={COMPLETION_BAR} />
            <p data-pf-profile-completeness-value className={COMPLETION_COUNT}>{done} de 10 datos clave</p>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={value => setActiveTab(value as ProfileCategory)} className={CARD_CONTENT}>
          <div className="flex min-w-0 flex-col gap-1">
            <TabsList variant="line" aria-label="Secciones del perfil" tabIndex={0} className={TAB_LIST}>{CATEGORIES.map(item => <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}</TabsList>
          </div>
          <TabsContent value={activeTab}>
            <fieldset disabled={pending || uncertain} className="min-w-0">
              <ProfileFormFields draft={draft} issues={issues} onChange={next => { if (!busy.current && !uncertain) { setDraft(next); setIssues([]); setStatus(null); } }} category={activeTab} disabled={pending || uncertain} />
            </fieldset>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  </form></DashboardPageContent>;
}
