"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Briefcase, Building2, FileText, ListChecks, UserRound } from "lucide-react";
import { RoleBlocked } from "@/features/identity/identity-states";
import { CvStorageUnavailable } from "@/features/candidate-cvs/storage-unavailable";
import { failureCopy as cvFailureCopy, failureStatus as cvFailureStatus } from "@/features/candidate-cvs/feedback";
import { loadMeAction } from "@/features/identity/actions";
import type { IdentityResult } from "@/features/identity/model";
import { loadCvsAction } from "@/features/candidate-cvs/actions";
import type { CvFailure, CvLibrary } from "@/features/candidate-cvs/model";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { loadScreeningAction, submitApplicationAction } from "./actions";
import { CvPicker } from "./cv-picker";
import { failureCopy, uncertain } from "./feedback";
import type { ApplicationBody, Failure, Result, Screening } from "./model";

type Job = { id: string; title: string; company: { name: string } };
type Step = "Datos" | "CV" | "Preguntas" | "Resumen";
const noResponse = { ok: false, reason: "no_response", reference: {} } as const;
function libraryFailure(result: CvFailure): Failure {
  const reason = result.reason;
  return { ok: false, reason: reason === "unauthenticated" || reason === "wrong_role" || reason === "forbidden" || reason === "no_response" || reason === "server_error" ? reason : "unrecognized_response", reference: result.reference };
}
const answerMessages = { required: "Responde esta pregunta.", unknown_option: "Elige una opción disponible.", too_long: "Tu respuesta supera el límite de caracteres.", wrong_type: "Revisa el formato de tu respuesta." };
function Loading({ step = "Datos", questions = [] }: { step?: Step; questions?: readonly Screening["questions"][number][] }) {
  return <section aria-busy="true" aria-label="Formulario de postulación" className="flex min-w-0 flex-col gap-6">
    <span role="status" className="sr-only">Cargando postulación</span>
    <div aria-hidden="true"><Progress value={null}><ProgressLabel><Skeleton className="h-5 w-72 max-w-full" /></ProgressLabel></Progress></div>
    {/* Skeleton keeps the wizard anatomy, including the current questions during a schema reload. */}
    <Card aria-hidden="true">
      <CardHeader className="border-b"><CardTitle><Skeleton className="h-7 w-32" /></CardTitle><CardDescription><Skeleton className="h-5 w-80 max-w-full" /></CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-6"><FieldGroup>
        {step === "Datos" ? [0, 1].map(index => <Field key={index}><Skeleton className="w-32"><FieldLabel>&nbsp;</FieldLabel></Skeleton><Skeleton><Input disabled tabIndex={-1} className="invisible min-h-10" /></Skeleton></Field>) : questions.map(question => <Field key={question.id}>
          {question.type === "open" ? <><Skeleton><FieldLabel className="invisible">{question.prompt}</FieldLabel></Skeleton><Skeleton><Textarea disabled tabIndex={-1} className="invisible min-h-32" /></Skeleton><Skeleton className="w-40"><FieldDescription>&nbsp;</FieldDescription></Skeleton></> : <FieldSet><FieldLegend variant="label"><Skeleton><span className="invisible">{question.prompt}</span></Skeleton></FieldLegend><Skeleton><ToggleGroup disabled variant="outline" orientation="vertical" className="invisible w-full">{question.options.map(option => <ToggleGroupItem key={option.id} value={option.id} tabIndex={-1} className="min-h-10 justify-start whitespace-normal break-words">{option.label}</ToggleGroupItem>)}</ToggleGroup></Skeleton></FieldSet>}
        </Field>)}
      </FieldGroup></CardContent>
      <CardFooter className="flex-col items-stretch gap-3 border-t sm:flex-row sm:items-start">
        {step !== "Datos" && <Skeleton><Button variant="outline" disabled tabIndex={-1} className="invisible min-h-10 w-full sm:w-auto">Atrás</Button></Skeleton>}
        <div className="flex w-full justify-end sm:ml-auto sm:w-auto"><Skeleton className="w-full sm:w-auto"><Button disabled tabIndex={-1} className="invisible min-h-10 w-full sm:w-auto">Continuar</Button></Skeleton></div>
      </CardFooter>
    </Card>
  </section>;
}
function ResultCard({ title, description, state, tone = "neutral", children }: { title: string; description: string; state: string; tone?: BadgeVariant; children?: React.ReactNode }) {
  return <Card>
    <CardHeader className="border-b"><CardTitle><Badge variant={tone}>{state}</Badge></CardTitle></CardHeader>
    <CardContent><Empty className="px-4 py-8 sm:py-10">
      <EmptyHeader className="max-w-md"><EmptyTitle className="text-xl font-semibold"><h2>{title}</h2></EmptyTitle><EmptyDescription>{description}</EmptyDescription></EmptyHeader>
      {children && <EmptyContent className="max-w-md flex-col sm:flex-row sm:justify-center [&_[data-pf-action-bar-actions]]:min-w-0 [&_[data-pf-action-bar-actions]]:shrink [&_[data-pf-action-bar-actions]]:max-sm:flex-1">{children}</EmptyContent>}
    </Empty></CardContent>
  </Card>;
}
export function CandidateApplicationWizard({ job }: { job: Job }) {
  const [identity, setIdentity] = useState<IdentityResult>();
  const [step, setStep] = useState<Step>("Datos");
  const [screening, setScreening] = useState<Screening>();
  const [library, setLibrary] = useState<CvLibrary>();
  const [libraryError, setLibraryError] = useState<CvFailure>();
  const [selected, setSelected] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cvError, setCvError] = useState<string>();
  const [failure, setFailure] = useState<Failure>();
  const [notice, setNotice] = useState<string>();
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const key = useRef<string | null>(null);
  const snapshot = useRef<ApplicationBody | null>(null);
  const locked = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusTarget = useRef<string | undefined>(undefined);
  const transition = useRef(false);
  const loadingQuestions = useRef<Screening["questions"]>([]);
  function go(next: Step) { transition.current = true; setStep(next); }
  useEffect(() => {
    if (focusTarget.current) { root.current?.querySelector<HTMLElement>(`[data-question-id="${focusTarget.current}"] textarea, [data-question-id="${focusTarget.current}"] button`)?.focus(); focusTarget.current = undefined; }
    else if (transition.current) { heading.current?.focus(); transition.current = false; }
  }, [step, errors, screening]);
  useEffect(() => { let active = true; void loadMeAction().catch(() => noResponse).then(result => { if (active) setIdentity(result); }); return () => { active = false; }; }, []);
  // Candidate-only reads are never made for company accounts or anonymous visitors.
  const candidate = identity?.ok && identity.data.role === "candidate" ? identity.data.user : null;
  useEffect(() => {
    if (!candidate) return;
    let active = true;
    void Promise.all([loadScreeningAction(job.id), loadCvsAction()]).then(([form, cvs]) => {
      if (!active) return;
      if (form.ok) setScreening(form.data); else setFailure(form);
      if (cvs.ok) setLibrary(cvs.data); else { setLibraryError(cvs); if (cvs.reason !== "storage_unavailable") setFailure(libraryFailure(cvs)); }
    }).catch(() => { if (active) setFailure(noResponse); });
    return () => { active = false; };
  }, [candidate, job.id]);
  const steps: Step[] = screening?.questions.length === 0 ? ["Datos", "CV", "Resumen"] : ["Datos", "CV", "Preguntas", "Resumen"];
  const copy = failure ? failureCopy(failure) : undefined;
  const isUncertain = !!failure && uncertain(failure) && snapshot.current !== null;
  function report(result: Failure) {
    setFailure(result);
    notifyActionResult({ key: "application-submit", type: "error", ...failureCopy(result), reference: { ...result.reference, at: new Date().toISOString() } });
  }
  async function reloadQuestions(message: string) {
    loadingQuestions.current = screening?.questions ?? [];
    go("Preguntas");
    setLoading(true); setScreening(undefined); setAnswers({}); setErrors({}); setNotice(message);
    const result = await loadScreeningAction(job.id).catch((): Result<Screening> => noResponse);
    setLoading(false);
    if (result.ok) { setScreening(result.data); go(result.data.questions.length ? "Preguntas" : "Resumen"); }
    else setFailure(result);
  }
  async function retryCvs() {
    if (locked.current) return;
    locked.current = true; setLoading(true);
    try {
      const result = await loadCvsAction().catch(() => noResponse);
      if (result.ok) { setLibrary(result.data); setLibraryError(undefined); }
      else { setLibraryError(result); if (result.reason !== "storage_unavailable") setFailure(libraryFailure(result)); }
      notifyActionResult(result.ok ? { key: "application-cvs-load", type: "success", title: "Biblioteca actualizada", description: "Ya puedes continuar con tu postulación." } : { key: "application-cvs-load", type: "error", ...cvFailureCopy(result), reference: { ...result.reference, at: new Date().toISOString() } });
    } finally { locked.current = false; setLoading(false); }
  }
  async function retryRead() {
    if (locked.current) return;
    locked.current = true; setLoading(true);
    try {
      if (!candidate) {
        const me = await loadMeAction(); setIdentity(me); setFailure(undefined);
        notifyActionResult(me.ok ? { key: "application-load", type: "success", title: "Cuenta cargada", description: "Comprobamos el acceso de tu cuenta." } : { key: "application-load", type: "error", title: "No pudimos cargar tu cuenta", description: "Puedes reintentar sin enviar una postulación.", reference: { ...me.reference, at: new Date().toISOString() } });
        return;
      }
      {
        const [form, cvs] = await Promise.all([loadScreeningAction(job.id), loadCvsAction()]);
        if (form.ok) { setScreening(form.data); if (step === "Preguntas") go(form.data.questions.length ? "Preguntas" : "Resumen"); }
        if (cvs.ok) { setLibrary(cvs.data); setLibraryError(undefined); } else setLibraryError(cvs);
        const error = !form.ok ? form : !cvs.ok && cvs.reason !== "storage_unavailable" ? libraryFailure(cvs) : undefined;
        setFailure(error);
        const readFailure = !form.ok ? form : !cvs.ok ? cvs : undefined;
        const readCopy = !form.ok ? failureCopy(form) : !cvs.ok ? cvFailureCopy(cvs) : undefined;
        notifyActionResult(readFailure && readCopy ? { key: "application-load", type: "error", ...readCopy, reference: { ...readFailure.reference, at: new Date().toISOString() } } : { key: "application-load", type: "success", title: "Postulación cargada", description: "Ya puedes continuar con tu postulación." });
      }
    } catch { report(noResponse); }
    finally { locked.current = false; setLoading(false); }
  }
  function next() {
    if (step === "Datos") { go("CV"); return; }
    if (step === "CV") {
      if (!library?.items.some(cv => cv.id === selected)) { setCvError("Elige un CV para continuar."); root.current?.querySelector<HTMLElement>('[aria-label="CV de tu biblioteca"] button, #apply-cv-upload')?.focus(); return; }
      setCvError(undefined); go(screening?.questions.length ? "Preguntas" : "Resumen"); return;
    }
    if (step === "Preguntas" && screening) {
      const invalid: Record<string, string> = {};
      for (const question of screening.questions) {
        const value = answers[question.id]?.trim() ?? "";
        if (!value) invalid[question.id] = answerMessages.required;
        else if (question.type === "open" && Array.from(value).length > screening.limits.open_answer_max_length) invalid[question.id] = answerMessages.too_long;
        else if (question.type === "single_choice" && !question.options.some(option => option.id === value)) invalid[question.id] = answerMessages.unknown_option;
      }
      setErrors(invalid);
      if (Object.keys(invalid).length) { focusTarget.current = screening.questions.find(question => invalid[question.id])?.id; return; }
      go("Resumen");
    }
  }
  async function submit() {
    if (locked.current || !screening || !selected) return;
    locked.current = true; setPending(true);
    const body: ApplicationBody = isUncertain && snapshot.current ? snapshot.current : { cv_id: selected, questionnaire_revision: screening.questionnaire_revision, answers: screening.questions.map(question => question.type === "open" ? { question_id: question.id, text: (answers[question.id] ?? "").trim() } : { question_id: question.id, option_id: answers[question.id] ?? "" }) };
    key.current ??= crypto.randomUUID(); snapshot.current = body; setFailure(undefined); setNotice(undefined);
    try {
      const result = await submitApplicationAction(job.id, key.current, body).catch(() => noResponse);
      if (result.ok) { setSuccess(true); notifyActionResult({ key: "application-submit", type: "success", title: "Postulación enviada", description: "Puedes consultarla en Mis postulaciones." }); return; }
      report(result);
      if (uncertain(result)) return;
      snapshot.current = null;
      if (result.reason === "questionnaire_changed") { key.current = crypto.randomUUID(); await reloadQuestions("Las preguntas cambiaron. Revisa tus respuestas."); }
      else if (result.reason === "invalid_answers") {
        const known = result.details?.length && result.details.every(detail => screening.questions.some(question => question.id === detail.question_id));
        if (!known) { await reloadQuestions("No pudimos validar las preguntas. Revísalas otra vez."); }
        else {
          const invalid = Object.fromEntries(result.details!.map(detail => [detail.question_id, answerMessages[detail.reason]]));
          setErrors(invalid); focusTarget.current = screening.questions.find(question => invalid[question.id])?.id; go("Preguntas");
        }
      } else if (result.reason === "cv_unavailable") {
        setSelected(""); setCvError("Ese CV ya no está en tu biblioteca. Elige otro."); go("CV");
        const cvs = await loadCvsAction().catch(() => noResponse); if (cvs.ok) { setLibrary(cvs.data); setLibraryError(undefined); } else setLibraryError(cvs);
      }
    } finally { locked.current = false; setPending(false); }
  }
  const applicationsLink = <Link href="/candidato/postulaciones" className={buttonVariants({ className: "min-h-10 w-full sm:w-auto" })}>Mis postulaciones</Link>;
  if (success) return <ResultCard title="Postulación enviada" state="Enviada" tone="success" description="El equipo recibió tu postulación. Puedes consultarla en Mis postulaciones.">{applicationsLink}</ResultCard>;
  if (failure?.reason === "already_applied") return <ResultCard title="Ya te postulaste a esta vacante" state="Ya enviada" tone="info" description="Consulta tu postulación en Mis postulaciones.">{applicationsLink}</ResultCard>;
  if (failure?.reason === "not_found") return <ResultCard title="Esta vacante ya no está disponible" state="No disponible" description="No puedes enviar una postulación a esta vacante. Puedes explorar otras oportunidades."><Link href="/vacantes" className={buttonVariants({ className: "min-h-10 w-full sm:w-auto" })}>Explorar vacantes</Link></ResultCard>;
  if (!identity) return <Loading />;
  if ((!identity.ok && identity.reason === "unauthenticated") || failure?.reason === "unauthenticated") return <ResultCard title="Datos" state="Sesión requerida" tone="review" description="Ingresa con tu cuenta de candidato para postularte."><Button className="min-h-10 w-full sm:w-auto" onClick={() => void signIn("cognito", { callbackUrl: `/vacantes/${job.id}/postular` })}>Ingresar como candidato</Button></ResultCard>;
  if ((identity.ok && identity.data.role === "recruiter") || failure?.reason === "wrong_role" || libraryError?.reason === "wrong_role") return <RoleBlocked kind="recruiter" />;
  if (libraryError?.reason === "storage_unavailable") return <CvStorageUnavailable retry={() => void retryCvs()} pending={loading} status={<ActionStatus id="application-cvs-status" tone="error" text={cvFailureStatus(libraryError, cvFailureCopy(libraryError))} />} statusId="application-cvs-status" />;
  if (identity.ok && identity.data.role === null) return <ResultCard title="Datos" state="Cuenta pendiente" tone="review" description="Completa tu cuenta antes de postularte."><Link href="/candidato/ingresar" className={buttonVariants({ className: "min-h-10 w-full sm:w-auto" })}>Completar mi cuenta de candidato</Link></ResultCard>;
  if (!candidate || !library || !screening) {
    if ((!failure || loading) && identity.ok) return <Loading step={step} questions={loadingQuestions.current} />;
    return <ResultCard title="No pudimos cargar la postulación" state="Error de carga" tone="danger" description="Tus datos siguen aquí. Puedes reintentar sin enviar una postulación."><ActionBar status={<ActionStatus id="application-read-status" tone="error" text={copy?.title ?? "No pudimos cargar tu cuenta"} />}><Button disabled={loading} aria-describedby="application-read-status" className="min-h-10 w-full sm:w-auto" onClick={() => void retryRead()}>{loading && <Spinner aria-hidden="true" data-icon="inline-start" />}Reintentar</Button></ActionBar></ResultCard>;
  }
  const cv = library.items.find(item => item.id === selected);
  const busy = pending || uploading || loading;
  const forwardAction = <Button disabled={busy} aria-busy={pending} aria-describedby={copy ? "application-status" : undefined} className="min-h-10 w-full sm:w-auto" onClick={() => step === "Resumen" ? void submit() : next()}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{pending ? "Enviando…" : step === "Resumen" ? isUncertain ? "Reintentar" : "Enviar postulación" : "Continuar"}</Button>;
  return <div ref={root} className="flex min-w-0 flex-col gap-6">
    <Progress value={steps.indexOf(step) + 1} max={steps.length} aria-valuetext={`Paso ${steps.indexOf(step) + 1} de ${steps.length}`}><ProgressLabel>{steps.join(" → ")}</ProgressLabel></Progress>
    <Card>
      <CardHeader className="border-b"><CardTitle><h2 ref={heading} tabIndex={-1} className="font-heading text-xl font-semibold">{step}</h2></CardTitle><CardDescription className="max-w-prose">{step === "Datos" ? "Estos datos vienen de tu cuenta de candidato." : step === "CV" ? "Selecciona el CV que recibirá el equipo." : step === "Preguntas" ? "Todas las preguntas son obligatorias." : "Revisa la vacante, tu CV y tus respuestas antes de enviar."}</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-6">
        {notice && <ActionStatus id="application-notice" tone="warning" text={notice} />}
        {step === "Datos" && <FieldGroup><Field><FieldLabel htmlFor="apply-name">Nombre completo</FieldLabel><Input id="apply-name" readOnly value={candidate.full_name} className="min-h-10" /></Field><Field><FieldLabel htmlFor="apply-email">Correo electrónico</FieldLabel><Input id="apply-email" readOnly value={candidate.email} className="min-h-10" /></Field></FieldGroup>}
        {step === "CV" && <CvPicker library={library} selected={selected} onSelect={value => { setSelected(value); setCvError(undefined); }} onLibrary={setLibrary} error={cvError} onBusy={setUploading} onWrongRole={setLibraryError} />}
        {step === "Preguntas" && <FieldGroup>{screening.questions.map(question => <Field key={question.id} data-question-id={question.id} data-invalid={!!errors[question.id]}>
          {question.type === "open" ? <><FieldLabel htmlFor={`answer-${question.id}`}>{question.prompt}</FieldLabel><Textarea id={`answer-${question.id}`} required maxLength={2 * screening.limits.open_answer_max_length} value={answers[question.id] ?? ""} aria-invalid={!!errors[question.id]} aria-describedby={`counter-${question.id} error-${question.id}`} className="min-h-32" onChange={event => { setAnswers(current => ({ ...current, [question.id]: event.target.value })); setErrors(current => ({ ...current, [question.id]: "" })); }} /><FieldDescription id={`counter-${question.id}`} aria-live="polite">{Array.from(answers[question.id] ?? "").length} de {screening.limits.open_answer_max_length} caracteres</FieldDescription></> : <FieldSet><FieldLegend id={`label-${question.id}`} variant="label">{question.prompt}</FieldLegend><ToggleGroup variant="outline" orientation="vertical" className="w-full" aria-labelledby={`label-${question.id}`} aria-invalid={!!errors[question.id]} aria-describedby={`error-${question.id}`} value={answers[question.id] ? [answers[question.id]] : []} onValueChange={values => { if (values[0]) { setAnswers(current => ({ ...current, [question.id]: values[0] })); setErrors(current => ({ ...current, [question.id]: "" })); } }}>{question.options.map(option => <ToggleGroupItem key={option.id} value={option.id} className="min-h-10 justify-start whitespace-normal break-words">{option.label}</ToggleGroupItem>)}</ToggleGroup></FieldSet>}
          {errors[question.id] && <FieldError id={`error-${question.id}`}>{errors[question.id]}</FieldError>}
        </Field>)}</FieldGroup>}
        {step === "Resumen" && <dl className="flex flex-col gap-5">
          <div><dt className="flex items-center gap-2 text-xs text-muted-foreground"><UserRound aria-hidden="true" className="size-4" />Nombre completo</dt><dd>{candidate.full_name}</dd></div>
          <div><dt className="flex items-center gap-2 text-xs text-muted-foreground"><FileText aria-hidden="true" className="size-4" />CV</dt><dd className="break-words">{cv?.name}</dd></div>
          {screening.questions.map(question => <div key={question.id}><dt className="flex items-center gap-2 text-xs text-muted-foreground"><ListChecks aria-hidden="true" className="size-4" />{question.prompt}</dt><dd className="whitespace-pre-wrap break-words">{question.type === "open" ? answers[question.id]?.trim() : question.options.find(option => option.id === answers[question.id])?.label}</dd></div>)}
        </dl>}
      </CardContent>
      <CardFooter className="flex-col flex-wrap items-stretch gap-3 border-t sm:flex-row sm:items-start sm:[&>[data-pf-action-bar]]:min-w-0 sm:[&>[data-pf-action-bar]]:w-auto sm:[&>[data-pf-action-bar]]:flex-1 [&_[data-pf-action-bar-actions]]:min-w-0 [&_[data-pf-action-bar-actions]]:shrink [&_[data-pf-action-bar-actions]]:max-sm:flex-1 [&_[data-pf-action-bar-actions]]:max-sm:flex-col">
        {step === "Resumen" && <div role="group" aria-label="Destino de la postulación" className="flex w-full min-w-0 flex-col gap-2 sm:basis-full">
          <p className="flex items-start gap-2 break-words font-medium"><Briefcase aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span className="min-w-0">{job.title}</span></p>
          <p className="flex items-start gap-2 text-sm text-muted-foreground"><Building2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span className="min-w-0 break-words">{job.company.name}</span></p>
        </div>}
        {step !== "Datos" && !isUncertain && <Button variant="outline" disabled={busy} className="min-h-10 w-full sm:w-auto" onClick={() => go(steps[steps.indexOf(step) - 1])}>Atrás</Button>}
        {step === "Resumen" || copy ? <ActionBar status={copy ? <ActionStatus id="application-status" tone={failure?.reason === "questionnaire_changed" ? "warning" : "error"} text={copy.title} /> : null}>{forwardAction}</ActionBar> : <div className="flex w-full justify-end sm:ml-auto sm:w-auto">{forwardAction}</div>}
      </CardFooter>
    </Card>
  </div>;
}
