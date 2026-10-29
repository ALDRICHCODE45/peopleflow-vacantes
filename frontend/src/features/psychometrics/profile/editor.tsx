"use client";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { ConfigReadOnlyNotice, useConfigLifecycle } from "@/features/employer-vacancies/vacancy-config/lifecycle";
import type { DraftPipelineStage } from "@/features/jobs/drafts/pipeline/client";
import { loadProfileAction, saveProfileAction } from "../actions";
import { COMPETENCY_IDS, profileBodySchema, type Profile, type ProfileBody, type Result } from "../model";

const names = ["Orden para avanzar", "Cuidado de acuerdos", "Impulso para coordinar", "Apoyo entre pares", "Apertura a probar", "Pausa para decidir", "Manejo de la presión"];
const importance = [{ value: "importance.clave", label: "Clave" }, { value: "importance.importante", label: "Importante" }, { value: "importance.no_relevante", label: "No relevante" }];
const bands = [{ value: "band.low", label: "Bajo" }, { value: "band.medium", label: "Medio" }, { value: "band.high", label: "Alto" }];
const bodyOf = (profile: Profile): ProfileBody => ({ enabled: profile.enabled, test: profile.test, confirmed: profile.confirmed, competencies: profile.competencies, auto_send_stage_ids: profile.auto_send_stage_ids, expires_in_days: profile.expires_in_days });
const noResponse = (): Result<Profile> => ({ ok: false, reason: "no_response", reference: {} });
type Notice = { tone: "success" | "error" | "info"; title: string; description?: string };

/** The artboard's justification expands per competency because the agreed profile requires a rationale per relevant competency.
 * Select follows the official basic composition; InputGroup uses its control without an optional addon. */
export function ProfileEditor({ draftId, profile, etag: initialEtag, stages }: { draftId: string; profile: Profile; etag: string; stages: DraftPipelineStage[] }) {
  const [body, setBody] = useState(() => bodyOf(profile));
  const [baseline, setBaseline] = useState(() => bodyOf(profile));
  const [etag, setEtag] = useState(initialEtag);
  const [confirmedAt, setConfirmedAt] = useState(profile.confirmed_at);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [recovery, setRecovery] = useState<"reload" | "check" | null>(null);
  const [pending, setPending] = useState(false);
  const [finished, setFinished] = useState(false);
  const busy = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const { readOnly } = useConfigLifecycle();
  const disabled = pending || readOnly || finished || !!recovery;
  const dirty = JSON.stringify(body) !== JSON.stringify(baseline);
  function report(next: Notice, reference?: { status?: number; code?: string }) {
    setNotice(next); notifyActionResult({ key: "psychometric-profile-save", type: next.tone, title: next.title, description: next.description, ...(next.tone === "error" ? { reference: { ...reference, at: new Date().toISOString() } } : {}) });
  }
  function edit(next: ProfileBody, requirements = false) {
    if (disabled || busy.current) return;
    setBody(requirements ? { ...next, confirmed: false } : next); setErrors({}); setNotice(null);
  }
  function changeRequirement(index: number, patch: Partial<ProfileBody["competencies"][number]>) {
    edit({ ...body, competencies: body.competencies.map((entry, i) => i === index ? { ...entry, ...patch } : entry) }, true);
  }
  function focusError() { requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); }
  function adopt(data: Profile, nextEtag: string) { const saved = bodyOf(data); setBody(saved); setBaseline(saved); setEtag(nextEtag); setConfirmedAt(data.confirmed_at); setErrors({}); setRecovery(null); }
  async function persist(confirm: boolean) {
    if (disabled || busy.current) return;
    const candidate = { ...body, confirmed: confirm, competencies: body.competencies.map(entry => entry.importance === "importance.no_relevante" ? { ...entry, desired_band: null, rationale: null, task: null } : entry.importance === "importance.importante" ? { ...entry, task: null } : entry) };
    const nextErrors: Record<string, string> = {};
    candidate.competencies.forEach((entry, index) => {
      const key = `competencies[${index}]`;
      if (entry.importance !== "importance.no_relevante" && !entry.desired_band) nextErrors[`${key}.desired_band`] = "Elige una banda deseada";
      if (entry.importance !== "importance.no_relevante" && ((confirm && !entry.rationale?.trim()) || [...(entry.rationale?.trim() ?? "")].length > 1000)) nextErrors[`${key}.rationale`] = "Justifica esta competencia en 1 a 1000 caracteres";
      if ((confirm && entry.importance === "importance.clave" && !entry.task?.trim()) || [...(entry.task?.trim() ?? "")].length > 300) nextErrors[`${key}.task`] = "Describe una tarea en 1 a 300 caracteres";
    });
    if (!Number.isInteger(body.expires_in_days) || body.expires_in_days < 1 || body.expires_in_days > 30) nextErrors.expires_in_days = "Usa un número entero de 1 a 30";
    const parsed = profileBodySchema.safeParse(candidate);
    if (Object.keys(nextErrors).length || !parsed.success) { setErrors(nextErrors); report({ tone: "error", title: "Revisa los datos marcados", description: "Tus cambios siguen aquí. Corrige los campos señalados." }); focusError(); return; }
    busy.current = true; setPending(true);
    const result = await saveProfileAction({ vacancyId: draftId, ifMatch: etag, body: parsed.data }).catch(noResponse);
    if (result.ok && result.etag) { adopt(result.data, result.etag); report({ tone: "success", title: "Perfil guardado", description: "Los cambios se aplican a futuras evaluaciones; no alteran resultados anteriores." }); }
    else {
      const failure = result.ok ? { ...noResponse(), ok: false as const, reason: "unrecognized_response" as const, reference: {} } : result;
      if (failure.reason === "validation_error") {
        const mapped: Record<string, string> = {};
        for (const issue of failure.fields ?? []) {
          const key = issue.field.startsWith("auto_send_stage_ids") ? "auto_send_stage_ids" : issue.field;
          mapped[key] = issue.code === "required" ? "Completa este campo" : issue.code === "too_long" ? "Acorta este texto" : "Revisa este campo";
        }
        setErrors(mapped); focusError(); report({ tone: "error", title: "Revisa los datos marcados", description: "Tus cambios siguen aquí. Corrige los campos señalados." }, failure.reference);
      } else if (failure.reason === "process_finished") { setFinished(true); report({ tone: "info", title: "El proceso ya terminó", description: "Tus cambios no se guardaron. El perfil queda en solo lectura." }); }
      else {
        const conflict = failure.reason === "version_conflict" || failure.reason === "precondition_required";
        const uncertain = ["no_response", "server_error", "unrecognized_response"].includes(failure.reason);
        if (conflict || uncertain) setRecovery(conflict ? "reload" : "check");
        report({ tone: "error", title: conflict ? "Esto cambió en otro lugar" : failure.reason === "unauthenticated" ? "Tu sesión expiró" : failure.reason === "forbidden" ? "No tienes permiso para esta acción" : "No pudimos guardar el perfil", description: conflict ? "Tus cambios siguen aquí. Carga la versión actual antes de guardar." : uncertain ? "Tus cambios siguen aquí. Comprueba si se guardaron antes de reintentar; no se repetirá el envío." : "Tus cambios siguen aquí. Revisa tu acceso antes de reintentar." }, failure.reference);
      }
    }
    busy.current = false; setPending(false);
  }
  async function recover() {
    if (busy.current || !recovery) return;
    busy.current = true; setPending(true);
    const result = await loadProfileAction(draftId).catch(noResponse);
    if (result.ok && result.etag) {
      if (recovery === "reload" || JSON.stringify(bodyOf(result.data)) === JSON.stringify(body)) { adopt(result.data, result.etag); report({ tone: "info", title: "Versión actual cargada" }); }
      else if (JSON.stringify(bodyOf(result.data)) === JSON.stringify(baseline) && result.etag === etag) { setRecovery(null); report({ tone: "info", title: "No se guardó el perfil", description: "Tus cambios siguen aquí. Puedes guardar de nuevo; es seguro." }); }
      else { setRecovery("reload"); report({ tone: "error", title: "Esto cambió en otro lugar", description: "Tus cambios siguen aquí. Carga la versión actual antes de guardar." }); }
    } else report({ tone: "error", title: "No pudimos cargar el perfil", description: "Tus cambios siguen aquí. Reintenta la lectura; no se enviará otro guardado." }, result.ok ? {} : result.reference);
    busy.current = false; setPending(false);
  }
  const errorProps = (key: string) => ({ "aria-invalid": !!errors[key], "aria-describedby": errors[key] ? `${key}-error` : undefined });
  const error = (key: string) => errors[key] && <FieldError id={`${key}-error`}>{errors[key]}</FieldError>;
  return <div ref={root}><Card aria-labelledby="psychometric-profile-title">
    <CardHeader className="border-b max-sm:has-data-[slot=card-action]:grid-cols-1"><CardTitle><h3 id="psychometric-profile-title">Psicometría</h3></CardTitle><CardDescription>Define qué necesitas explorar en la entrevista.</CardDescription><CardAction className="max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:justify-self-start"><Badge variant="accent">{body.confirmed && confirmedAt ? `Perfil confirmado · ${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Mexico_City" }).format(new Date(confirmedAt))}` : "Perfil sin confirmar"}</Badge></CardAction></CardHeader>
    <CardContent><FieldGroup>
      {(readOnly || finished) && <ConfigReadOnlyNotice />}
      <Field orientation="horizontal"><Switch id="psychometric-enabled" checked={body.enabled} disabled={disabled} {...errorProps("enabled")} onCheckedChange={enabled => edit({ ...body, enabled })} /><FieldLabel htmlFor="psychometric-enabled" className="min-h-10">Usar evaluación psicométrica en esta vacante</FieldLabel>{error("enabled")}</Field>
      <FieldDescription>Desactivada por defecto. Activarla no mueve ni descarta candidatos.</FieldDescription>
      <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold">Perfil del puesto</h4><Button type="button" variant="outline" disabled={disabled} onClick={() => report({ tone: "info", title: "No hay reglas de sugerencia disponibles", description: "Conservamos tu perfil. Define los requisitos con ejemplos de trabajo; no se infieren desde la vacante." })}>Sugerir desde la vacante</Button></div>
      <div className="flex flex-col gap-1 text-sm text-muted-foreground"><p>Las sugerencias son editables y requieren tu revisión. Alto no siempre es mejor.</p><p>La relación con esta competencia es una hipótesis. Confírmala con ejemplos de trabajo.</p></div>
      <div>
        <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_7rem] gap-3 pb-1 text-xs text-muted-foreground sm:grid"><span>Competencia</span><span>Importancia</span><span>Banda deseada</span></div>
        {body.competencies.map((entry, index) => { const key = `competencies[${index}]`; const name = names[COMPETENCY_IDS.indexOf(entry.competency_id)]; return <FieldSet key={entry.competency_id} disabled={disabled} className="min-w-0 gap-0"><FieldLegend className="sr-only">{name}</FieldLegend><FieldGroup className="grid grid-cols-2 gap-3 py-3 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_7rem]">
          <p aria-hidden="true" className="col-span-2 min-w-0 font-medium sm:col-span-1 sm:pt-2.5">{name}</p>
          <Field className="min-w-0" data-invalid={!!errors[`${key}.importance`]}><Select items={importance} value={entry.importance} disabled={disabled} onValueChange={value => { if (value) changeRequirement(index, { importance: value as typeof entry.importance, ...(value === "importance.no_relevante" ? { desired_band: null, rationale: null, task: null } : { desired_band: entry.desired_band ?? "band.medium", rationale: entry.rationale ?? "", ...(value === "importance.importante" ? { task: null } : {}) }) }); }}><SelectTrigger id={`${key}.importance`} aria-label={`Importancia de ${name}`} className="min-h-10 w-full" {...errorProps(`${key}.importance`)}><SelectValue /></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectGroup>{importance.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select>{error(`${key}.importance`)}</Field>
          <Field className="min-w-0" data-invalid={!!errors[`${key}.desired_band`]}><Select items={bands} value={entry.desired_band} disabled={disabled || entry.importance === "importance.no_relevante"} onValueChange={value => { if (value) changeRequirement(index, { desired_band: value as NonNullable<typeof entry.desired_band> }); }}><SelectTrigger id={`${key}.desired_band`} aria-label={`Banda deseada de ${name}`} className="min-h-10 w-full" {...errorProps(`${key}.desired_band`)}><SelectValue placeholder="Sin banda" /></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectGroup>{bands.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select>{error(`${key}.desired_band`)}</Field>
          {entry.importance === "importance.clave" && <Field className="col-span-2 gap-1.5 sm:col-span-3" data-invalid={!!errors[`${key}.task`]}><FieldLabel htmlFor={`${key}.task`}>Tarea concreta *</FieldLabel><InputGroup className="min-h-10"><InputGroupInput id={`${key}.task`} aria-label={`Tarea concreta de ${name} *`} className="min-h-10" value={entry.task ?? ""} disabled={disabled} {...errorProps(`${key}.task`)} onChange={event => changeRequirement(index, { task: event.target.value || null })} /></InputGroup>{error(`${key}.task`)}</Field>}
          {entry.importance !== "importance.no_relevante" && <Field className="col-span-2 gap-1.5 sm:col-span-3" data-invalid={!!errors[`${key}.rationale`]}><FieldLabel htmlFor={`${key}.rationale`}>Justificación laboral *</FieldLabel><Textarea id={`${key}.rationale`} aria-label={`Justificación laboral de ${name} *`} className="min-h-16" value={entry.rationale ?? ""} disabled={disabled} {...errorProps(`${key}.rationale`)} onChange={event => changeRequirement(index, { rationale: event.target.value })} />{error(`${key}.rationale`)}</Field>}
        </FieldGroup><Separator /></FieldSet>; })}
      </div>
      <p className="text-sm text-muted-foreground">Sin confirmar, la evaluación funciona y muestra solo bandas. Define el perfil de la vacante para explorar la alineación.</p>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <FieldSet disabled={disabled}><FieldLegend>Crear invitación al entrar a estas etapas</FieldLegend><FieldGroup data-slot="checkbox-group">{stages.map(stage => <Field key={stage.id} orientation="horizontal" data-invalid={!!errors.auto_send_stage_ids}><Checkbox id={`auto-${stage.id}`} disabled={disabled} checked={body.auto_send_stage_ids.includes(stage.id)} {...errorProps("auto_send_stage_ids")} onCheckedChange={checked => edit({ ...body, auto_send_stage_ids: checked ? [...body.auto_send_stage_ids, stage.id] : body.auto_send_stage_ids.filter(id => id !== stage.id) })} /><FieldLabel htmlFor={`auto-${stage.id}`} className="min-h-10">{stage.name}</FieldLabel></Field>)}{error("auto_send_stage_ids")}</FieldGroup><FieldDescription>Puedes elegir varias. No se envía correo: copia y comparte el enlace.</FieldDescription></FieldSet>
        <Field data-invalid={!!errors.expires_in_days}><FieldLabel htmlFor="psychometric-expiry">Vigencia del enlace</FieldLabel><InputGroup><InputGroupInput id="psychometric-expiry" type="number" min={1} max={30} value={Number.isNaN(body.expires_in_days) ? "" : body.expires_in_days} disabled={disabled} {...errorProps("expires_in_days")} onChange={event => edit({ ...body, expires_in_days: event.target.value === "" ? NaN : Number(event.target.value) })} /></InputGroup><FieldDescription>Días · de 1 a 30</FieldDescription>{error("expires_in_days")}</Field>
      </div>
    </FieldGroup></CardContent>
    <CardFooter className="border-t"><div className="flex w-full flex-col gap-3"><p className="text-xs text-muted-foreground">* Justifica las competencias Clave e Importante y cada tarea Clave antes de confirmar. La relación con el trabajo es una hipótesis, no una garantía.</p><ActionBar status={notice && <ActionStatus id="psychometric-save-status" tone={notice.tone} text={notice.title} action={recovery && <Button type="button" variant="outline" disabled={pending} onClick={() => void recover()}>{recovery === "reload" ? "Cargar versión actual" : "Comprobar"}</Button>} />}><Button type="button" variant="outline" disabled={disabled || !dirty} aria-describedby="psychometric-save-status" onClick={() => void persist(body.confirmed)}>Guardar cambios</Button><Button type="button" disabled={disabled} aria-describedby="psychometric-save-status" aria-busy={pending} onClick={() => void persist(true)}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}Confirmar perfil</Button></ActionBar></div></CardFooter>
  </Card></div>;
}
