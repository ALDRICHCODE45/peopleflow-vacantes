"use client";

import * as React from "react";
import Link from "next/link";
import { Save, Undo2 } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
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

const CATEGORIES = [{ value: "personal", label: "Personal" }, { value: "experience", label: "Experiencia" }, { value: "education", label: "Educación" }, { value: "compensation", label: "Compensación" }, { value: "languages", label: "Idiomas" }] as const;
const TAB_LIST = "max-w-full justify-start overflow-auto focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const PARTIAL = "Guardamos tu perfil, pero no los idiomas. Revisa y vuelve a guardar.";
const UNCERTAIN = "No pudimos confirmar si se guardó";
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function categoryOf(path: string): ProfileCategory {
  if (path.startsWith("languages")) return "languages";
  if (path.startsWith("location") || ["phone", "linkedinUrl", "portfolioUrl", "birthDate"].includes(path)) return "personal";
  if (["currentSalaryGross", "currentSalaryNet", "expectedSalary", "salaryCurrency", "expectedSalaryPeriod"].includes(path)) return "compensation";
  if (["educationLevel", "fieldOfStudy", "skills"].includes(path)) return "education";
  return "experience";
}
function focusSelector(path: string) {
  if (path.startsWith("location.")) return '[data-pf-profile-field="location"] [aria-invalid="true"]';
  if (path === "languages") return "[data-pf-profile-language-add]";
  const language = /^languages\.(\d+)\.(name|level)$/.exec(path);
  return language ? `#profile-language-${language[1]}-${language[2]}` : `[data-pf-profile-field="${path}"]`;
}
export function ProfileSkeleton() {
  return <DashboardPageContent data-pf-profile-workspace width="screen-2xl"><div aria-busy="true" className="flex flex-col gap-5"><span role="status" className="sr-only">Cargando perfil</span>
    <div aria-hidden="true" className="flex flex-wrap justify-between gap-3"><Skeleton className="h-6 w-40" /><Skeleton className="h-10 w-72" /></div>
    <Card aria-hidden="true"><CardHeader className="border-b"><CardTitle><Skeleton className="h-24 w-64" /></CardTitle><CardDescription><Skeleton className="h-10 w-56" /></CardDescription><CardAction><Skeleton className="h-24 w-64" /></CardAction></CardHeader>
      <CardContent><div className="flex flex-col gap-4"><Skeleton className="h-10 w-full" /><FieldGroup className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">{["Contacto", "Ubicación"].map(title => <Card size="sm" key={title} className="shadow-none ring-border/70"><CardHeader className="border-b"><CardTitle><Skeleton className="h-5 w-36" /></CardTitle></CardHeader><CardContent className="flex flex-col gap-4"><FieldSet><FieldLegend className="sr-only">{title}</FieldLegend><FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">{[0, 1, 2].map(index => <Field key={index} className={index === 2 ? "sm:col-span-2" : undefined}><FieldLabel><Skeleton className="h-5 w-28" /></FieldLabel><Skeleton className="h-10 w-full" /></Field>)}</FieldGroup></FieldSet></CardContent></Card>)}</FieldGroup></div></CardContent>
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
    location: null, educationLevel: null, fieldOfStudy: null, skills: [],
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
  if ("ok" in state) return <DashboardPageContent width="screen-2xl"><Empty><EmptyHeader><EmptyTitle>No pudimos cargar tu perfil</EmptyTitle><EmptyDescription>Tus datos no cambiaron. Vuelve a consultar para continuar.</EmptyDescription></EmptyHeader><EmptyContent>{state.reason === "unauthenticated" ? <Link href="/candidato/login">Iniciar sesión</Link> : <Button variant="outline" onClick={() => { setState(null); setAttempt(value => value + 1); }}>Reintentar</Button>}</EmptyContent></Empty></DashboardPageContent>;
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
    setIssues(next);
    if (next[0]) { setActiveTab(categoryOf(next[0].path)); setFocus({ path: next[0].path }); }
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
    if (!base.ok) { announce("No pudimos preparar el perfil", "error"); return; }
    const profile = profileToWrite(parsed.profile);
    const languages = { languages: parsed.profile.languages };
    const input = { ...(isNew || !equal(profile, profileToWrite(base.profile)) ? { profile } : {}), ...(!equal(languages.languages, baseline.languages) ? { languages } : {}) };
    busy.current = true; setPending(true); setIssues([]); dismissActionResult("candidate-profile");
    let outcome: ProfileSaveOutcome;
    try { outcome = await saveProfileAction(input); }
    catch { outcome = { kind: "uncertain", part: "profile", failure: { ok: false, reason: "no_response", reference: {} } }; }
    busy.current = false; setPending(false);
    adopt(outcome);
    if (outcome.kind === "saved") announce(isNew ? "Perfil creado." : "Perfil guardado.", "success");
    else if (outcome.kind === "partial") announce(PARTIAL, "warning", outcome.failure);
    else if (outcome.kind === "uncertain") { setUncertain(true); announce(UNCERTAIN, "error", outcome.failure); }
    else if (outcome.kind === "invalid") { markIssues(outcome.issues); announce("Revisa los datos marcados", "error"); }
    else if (outcome.kind === "failed") {
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
  const signals = [draft.professionalTitle, draft.currentCompany, draft.yearsOfExperience, draft.summary, draft.phone, draft.location.country, draft.educationLevel && draft.fieldOfStudy, draft.skills, draft.expectedSalary, draft.languages.some(row => row.name.trim() && row.level)];
  const done = signals.filter(Boolean).length;
  const initials = identity.fullName.split(/\s+/).slice(0, 2).map(part => part[0]).join("");
  return <DashboardPageContent data-pf-profile-workspace width="screen-2xl">{isNew && <p className="mb-5 text-sm text-muted-foreground">Completa tu perfil para postularte más rápido. Se crea al guardar por primera vez.</p>}<form ref={form} noValidate data-pf-profile-form onSubmit={submit} className="flex flex-col gap-5">
    <div data-pf-profile-toolbar className="flex flex-wrap items-start justify-between gap-3"><Badge variant={dirty ? "review" : "neutral"} data-pf-profile-dirty>{dirty ? "Cambios pendientes" : "Sin cambios pendientes"}</Badge>
      <ActionBar status={status ? <ActionStatus id="profile-action-status" tone={status.tone} text={status.text} /> : undefined}>
        <Button type="button" variant="outline" className="min-h-10" disabled={!dirty || pending || uncertain} onClick={() => { setDraft(baseDraft); setIssues([]); setStatus(null); }}><Undo2 data-icon="inline-start" aria-hidden="true" />Restaurar cambios</Button>
        {uncertain && <Button type="button" className="min-h-10" disabled={pending} aria-busy={pending} onClick={reconcile}>{pending && <Spinner data-icon="inline-start" aria-hidden="true" />}{pending ? "Comprobando…" : "Comprobar"}</Button>}
        <Button type="submit" variant={uncertain ? "outline" : "default"} className="min-h-10" disabled={(!isNew && !dirty) || pending || uncertain} aria-busy={pending} aria-describedby={status ? "profile-action-status" : undefined}>{pending && !uncertain ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <Save data-icon="inline-start" aria-hidden="true" />}{pending && !uncertain ? "Guardando…" : "Guardar perfil"}</Button>
      </ActionBar></div>
    <Card data-pf-profile-card><CardHeader data-pf-profile-identity className="border-b">
      <CardTitle className="flex min-w-0 flex-col items-start gap-5 sm:flex-row sm:items-center"><Avatar className="size-24 shrink-0 sm:size-28"><AvatarFallback>{initials}</AvatarFallback></Avatar><h2 className="min-w-0 break-words text-xl font-semibold">{identity.fullName}</h2></CardTitle>
      <CardDescription className="flex min-w-0 max-w-prose flex-col gap-1.5"><p>{identity.email}</p><p data-pf-profile-context>{baseline.location?.label ?? "Ubicación sin definir"} · {draft.currentCompany.trim() || "Empresa sin definir"}</p></CardDescription>
      <CardAction className="flex w-full flex-col gap-4 max-md:col-span-2 max-md:col-start-1 max-md:row-start-3 md:w-72"><p data-pf-profile-headline className="break-words text-sm font-medium">{draft.professionalTitle.trim() || "Título profesional sin definir"}</p><div className="flex flex-col gap-2.5"><div className="flex items-baseline justify-between gap-3"><h3 id="profile-completion" className="text-sm font-semibold">Avance del perfil</h3><span className="text-2xl font-semibold">{done * 10}%</span></div><Progress aria-labelledby="profile-completion" value={done} max={10} /><p className="text-sm text-muted-foreground">{done} de 10 datos clave</p></div></CardAction>
    </CardHeader><CardContent><Tabs value={activeTab} onValueChange={value => setActiveTab(value as ProfileCategory)} className="flex flex-col gap-4"><TabsList aria-label="Secciones del perfil" tabIndex={0} className={TAB_LIST}>{CATEGORIES.map(item => <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}</TabsList><TabsContent value={activeTab}><fieldset disabled={pending || uncertain} className="min-w-0"><ProfileFormFields draft={draft} issues={issues} onChange={next => { if (!busy.current && !uncertain) { setDraft(next); setIssues([]); setStatus(null); } }} category={activeTab} disabled={pending || uncertain} /></fieldset></TabsContent></Tabs></CardContent></Card>
  </form></DashboardPageContent>;
}
