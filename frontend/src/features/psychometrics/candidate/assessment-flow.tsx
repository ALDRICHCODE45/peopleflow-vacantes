"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "cn";
import { Check, LockKeyhole, CircleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { StateCard } from "@/components/feedback/state-card";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { dismissActionResult, notifyActionResult } from "@/components/feedback/notify";
import type { Result } from "../model";
import type { AssessmentData } from "./page";

type Failure = Extract<Result<never>, { ok: false }>;
type Actions = {
  reloadAction: () => Promise<Result<AssessmentData>>;
  consentAction: (body: unknown) => Promise<Result<null>>;
  answerAction: (position: number, body: unknown) => Promise<Result<null>>;
  clearAction: (position: number, body: unknown) => Promise<Result<null>>;
  finishAction: () => Promise<Result<{ status: "finished" }>>;
};
const closed = (failure: Failure) => ["assessment_unavailable", "invitation_closed", "assessment_finished", "invalid_request"].includes(failure.reason);
function message(failure: Failure) {
  if (failure.reason === "rate_limited") {
    const value = failure.retryAfter;
    if (value) {
      const seconds = /^\d+$/.test(value) ? Number(value) : Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 1000));
      if (Number.isFinite(seconds)) return `Demasiados intentos, espera ${seconds} segundos`;
    }
    return "Demasiados intentos. Espera un momento antes de reintentar.";
  }
  return "No pudimos confirmar el guardado. Puedes reintentar sin duplicar tu respuesta.";
}

export function AssessmentFlow({ initial, actions, account = false }: { initial: Result<AssessmentData>; actions: Actions; account?: boolean }) {
  const [data, setData] = useState(initial.ok ? initial.data : null);
  const [failure, setFailure] = useState<Failure | null>(initial.ok ? null : initial);
  const [unavailable, setUnavailable] = useState(initial.ok ? ["expired", "revoked"].includes(initial.data.base.status) : closed(initial));
  const [finished, setFinished] = useState(initial.ok && initial.data.base.status === "finished");
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [position, setPosition] = useState(() => initial.ok ? firstMissing(initial.data) : 0);
  const retry = useRef<null | (() => Promise<void>)>(null);
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const times = useRef(new Map<number, number>());
  // GET items intentionally does not return historical elapsed times. Do not replace
  // them with a shorter partial revisit after a reload: omit optional timing instead.
  const unknownTimes = useRef(new Set(initial.ok ? initial.data.items?.items.filter(i => i.value !== null).map(i => i.position) : []));
  const active = useRef<{ position: number; since: number } | null>(null);
  const current = data?.items?.items[position];
  const showingItem = !!current && !data?.base.consent && !finished && !unavailable;
  const itemPosition = current?.position;

  function pause() {
    const interval = active.current;
    if (interval) {
      times.current.set(interval.position, (times.current.get(interval.position) ?? 0) + Math.max(0, performance.now() - interval.since));
      active.current = null;
    }
  }
  function elapsed(itemPosition: number) {
    const interval = active.current;
    const total = (times.current.get(itemPosition) ?? 0) + (interval?.position === itemPosition ? Math.max(0, performance.now() - interval.since) : 0);
    return unknownTimes.current.has(itemPosition) ? {} : { client_elapsed_ms: Math.min(3600000, Math.round(total)) };
  }
  useEffect(() => {
    if (!showingItem || itemPosition === undefined) return;
    const resume = () => {
      if (document.visibilityState === "visible" && !active.current) active.current = { position: itemPosition, since: performance.now() };
    };
    const visibility = () => { pause(); resume(); };
    resume();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pause);
    window.addEventListener("pageshow", resume);
    return () => {
      pause(); document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pause); window.removeEventListener("pageshow", resume);
    };
  }, [showingItem, itemPosition]); // A value edit must not restart this item's clock.
  useEffect(() => { heading.current?.focus(); }, [position, finished, unavailable]);
  useEffect(() => () => dismissActionResult("assessment-write"), []);

  function report(result: Failure, operation: () => Promise<void>) {
    if (closed(result)) { pause(); setUnavailable(true); setData(null); retry.current = null; return; }
    setFailure(result); retry.current = operation;
    notifyActionResult({ key: "assessment-write", type: "error", title: "No se pudo completar la acción", description: message(result), reference: { ...result.reference, at: new Date().toISOString() } });
  }
  async function run(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setPending(true); setFailure(null); dismissActionResult("assessment-write");
    try { await operation(); }
    catch { report({ ok: false, reason: "no_response", reference: {} }, operation); }
    finally { lock.current = false; setPending(false); }
  }
  async function reload(missing?: number[]) {
    const result = await actions.reloadAction();
    if (!result.ok) { report(result, () => reload(missing)); return; }
    setData(result.data); setAccepted(false); retry.current = null;
    if (["expired", "revoked"].includes(result.data.base.status)) { setUnavailable(true); return; }
    setFinished(result.data.base.status === "finished");
    const target = missing?.length ? Math.min(...missing) - 1 : firstMissing(result.data);
    setPosition(target);
  }
  async function consent() {
    if (!accepted || !data?.base.consent) return;
    const { notice_version, text_sha256 } = data.base.consent;
    const result = await actions.consentAction({ notice_version, text_sha256 });
    if (!result.ok) {
      if (result.reason === "notice_changed") { setAccepted(false); await reload(); return; }
      report(result, consent); return;
    }
    await reload();
  }
  function updateValue(itemPosition: number, value: number | null) {
    setData(previous => previous?.items ? { ...previous, items: { ...previous.items, items: previous.items.items.map(i => i.position === itemPosition ? { ...i, value } : i) } } : previous);
  }
  async function finish() {
    const result = await actions.finishAction();
    if (result.ok) { pause(); setFinished(true); retry.current = null; return; }
    if (result.reason === "incomplete") { await reload(result.missing_positions); return; }
    report(result, finish);
  }
  function write(value: number | null, after?: () => Promise<void>) {
    if (!current) return;
    const itemPosition = current.position;
    const body = value === null ? { event_id: crypto.randomUUID() } : { event_id: crypto.randomUUID(), value, ...elapsed(itemPosition) };
    // Capture the entire event, including time, once. An uncertain retry must replay
    // precisely this body, never manufacture another event or a newer duration.
    const operation = async () => {
      const result = value === null ? await actions.clearAction(itemPosition, body) : await actions.answerAction(itemPosition, body);
      if (!result.ok) { report(result, operation); return; }
      updateValue(itemPosition, value); retry.current = null;
      if (after) await after();
    };
    void run(operation);
  }
  function navigate(target: number) {
    const move = async () => { pause(); setPosition(target); };
    if (current?.value !== null && current?.value !== undefined) write(current.value, move);
    else void run(move);
  }
  function next() {
    if (!data?.items || !current) return;
    if (position < data.items.items.length - 1) { navigate(position + 1); return; }
    const missing = data.items.items.findIndex(i => i.value === null);
    if (missing >= 0) { navigate(missing); return; }
    write(current.value, finish);
  }
  const retryAction = () => void run(retry.current ?? (() => reload()));
  const status = <ActionStatusSlot>{failure && <ActionStatus id="assessment-status" tone="error" text={message(failure)} />}</ActionStatusSlot>;
  const controlsDisabled = pending || !!failure;

  return <main className={cn("mx-auto flex w-full flex-col gap-5 px-5 py-6 text-sm", account ? "max-w-3xl" : "min-h-dvh max-w-lg")}>
    {account && <Link href="/candidato/postulaciones" className={cn(buttonVariants({ variant: "ghost" }), "self-start")}>← Volver a Postulaciones</Link>}
    {unavailable || (data && ["expired", "revoked"].includes(data.base.status)) ? <div className="my-auto"><StateCard headingLevel={1} icon={LockKeyhole} tone="empty" title={account ? "Ya no está disponible" : "Esta evaluación no está disponible"} description={account ? "Puedes volver a tus postulaciones para consultar el estado de tu proceso." : <>Contacta al equipo de reclutamiento que te compartió el enlace para revisar cómo continuar.<br /><br />Puedes cerrar esta página.</>} /></div>
      : finished && data ? <div className="my-auto"><StateCard headingLevel={1} icon={Check} tone="info" title="Gracias por responder" description={<>Tus respuestas quedaron guardadas y la evaluación finalizó.<br /><br />El equipo de {data.base.company_name} revisará la información junto con otras evidencias del proceso de <strong>{data.base.vacancy_title}</strong>.<br /><br />Una persona tomará la decisión y te contactará para los siguientes pasos.<br /><br />Ya puedes cerrar esta página.</>} /></div>
      : !data ? <div className="my-auto"><StateCard headingLevel={1} icon={CircleAlert} tone="error" title="No pudimos cargar la evaluación" description={failure ? message(failure) : "Vuelve a intentarlo. Tus respuestas guardadas se conservan."} primaryAction={{ label: pending ? "Cargando…" : "Reintentar", onClick: retryAction, disabled: pending }} /></div>
      : <>
        <header><p className="font-medium">{data.base.company_name}</p><p className="text-xs text-muted-foreground">{data.base.vacancy_title}</p></header>
        {data.base.consent ? <>
          <section><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold leading-tight">Conoce tu forma<br />de trabajar</h1><p className="mt-3 text-muted-foreground">Responde afirmaciones sobre cómo sueles actuar. No hay respuestas correctas o incorrectas: elige lo que más se parezca a ti.</p></section>
          <div className="flex gap-6 border-y py-3" aria-label="Duración y extensión"><div><strong className="text-base">~{data.base.estimated_minutes} min</strong><p className="text-xs text-muted-foreground">A tu ritmo</p></div><div><strong className="text-base">{data.base.total_count} preguntas</strong><p className="text-xs text-muted-foreground">Tu avance se guarda</p></div></div>
          <Card><CardHeader><CardTitle><h2>Antes de compartir tus respuestas</h2></CardTitle><CardDescription>Aviso v{data.base.consent.notice_version} · pendiente de aprobación y revisión legal</CardDescription></CardHeader><CardContent><p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{data.base.consent.text}</p></CardContent></Card>
          <form onSubmit={event => { event.preventDefault(); void run(consent); }} className="grid gap-4">
            <Field orientation="horizontal"><Checkbox id="assessment-consent" checked={accepted} onCheckedChange={value => setAccepted(value === true)} disabled={pending} /><FieldLabel htmlFor="assessment-consent" className="min-h-10">Acepto y quiero comenzar. Leí el aviso y doy mi consentimiento expreso para el tratamiento descrito.</FieldLabel></Field>
            <Button type="submit" className="min-h-12 w-full" disabled={pending || !accepted} aria-describedby="assessment-status">{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}Aceptar y comenzar</Button>
            {status}
          </form>
          <p className="mt-auto text-center text-xs text-muted-foreground">{account ? "Puedes retomar desde tu cuenta mientras la invitación esté vigente." : "No necesitas crear una cuenta · PeopleFlow"}</p>
        </> : current && data.items ? <>
          <div className="mt-2 grid gap-2"><div className="flex justify-between gap-3"><strong>Pregunta {position + 1} de {data.items.items.length}</strong><span className="text-xs text-muted-foreground">{answeredLabel(data.items.items.filter(i => i.value !== null).length)}</span></div><Progress value={data.items.items.filter(i => i.value !== null).length} max={data.items.items.length} aria-label="Preguntas respondidas" /></div>
          <FieldSet className="mt-3" disabled={controlsDisabled}>
            <FieldLegend className="text-2xl font-semibold leading-snug"><span ref={heading} tabIndex={-1} role="heading" aria-level={1}>{current.text}</span></FieldLegend>
            <FieldDescription>¿Qué tanto te describe esta afirmación?</FieldDescription>
            {/* Official RadioGroup Choice Card composition; native Field padding gives
                large mobile targets, without overriding the radio's geometry. */}
            <FieldGroup><RadioGroup key={current.position} value={current.value === null ? "" : String(current.value)} onValueChange={value => write(Number(value))} aria-label="Qué tanto te describe" disabled={controlsDisabled}>
              {data.items.scale.map(option => <FieldLabel key={option.value} htmlFor={`answer-${option.value}`} className="bg-card has-data-checked:border-primary has-data-checked:bg-primary/5"><Field orientation="horizontal"><RadioGroupItem id={`answer-${option.value}`} value={String(option.value)} /><FieldContent><FieldTitle>{option.label}</FieldTitle></FieldContent></Field></FieldLabel>)}
            </RadioGroup></FieldGroup>
          </FieldSet>
          <p className="text-[13px] text-muted-foreground">Puedes volver a las preguntas anteriores y cambiar tus respuestas antes de finalizar.</p>
          <Button variant="ghost" className="min-h-10 self-start" disabled={controlsDisabled || current.value === null} onClick={() => write(null)}>Borrar respuesta</Button>
          <footer className="mt-auto grid gap-3 pt-6"><div className="grid grid-cols-2 gap-3"><Button variant="outline" className="min-h-12" disabled={controlsDisabled || position === 0} onClick={() => navigate(position - 1)}>Anterior</Button><Button className="min-h-12" disabled={controlsDisabled} onClick={next} aria-describedby="assessment-status">{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{position === data.items.items.length - 1 && data.items.items.every(i => i.value !== null) ? "Finalizar" : "Siguiente"}</Button></div>{status}<p className="text-center text-xs text-muted-foreground">Tu avance se guarda</p><p className="text-center text-xs text-muted-foreground">{account ? "Puedes cerrar y retomar desde tu cuenta mientras esté vigente." : <>Puedes cerrar y retomar desde el mismo enlace<br />mientras esté vigente.</>}</p></footer>
        </> : <Spinner aria-label="Cargando evaluación" />}
        {failure && <Button variant="outline" className="min-h-10" onClick={retryAction} disabled={pending}>Reintentar</Button>}
      </>}
    {(finished || unavailable || !data) && <p className="text-center text-xs text-muted-foreground">PeopleFlow · Evaluación</p>}
  </main>;
}
function answeredLabel(count: number) {
  return count === 1 ? "1 respondida" : `${count} respondidas`;
}
function firstMissing(data: AssessmentData) {
  const index = data.items?.items.findIndex(i => i.value === null) ?? 0;
  return index < 0 ? (data.items?.items.length ?? 1) - 1 : index;
}
