"use client";
import { useRef, useState } from "react";
import { BriefcaseBusiness, ChevronDown, ListChecks, Settings2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { InputGroup, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { ConfigReadOnlyNotice, useConfigLifecycle } from "@/features/employer-vacancies/vacancy-config/lifecycle";
import type { DraftPipelineStage } from "@/features/jobs/drafts/pipeline/client";
import { loadProfileAction, saveProfileAction } from "../actions";
import { COMPETENCY_IDS, profileBodySchema, type Profile, type ProfileBody, type Result } from "../model";

import { requirementErrors, textLength } from "./requirements";

const names = ["Orden para avanzar", "Cuidado de acuerdos", "Impulso para coordinar", "Apoyo entre pares", "Apertura a probar", "Pausa para decidir", "Manejo de la presión"];
const importance = [{ value: "importance.clave", label: "Clave" }, { value: "importance.importante", label: "Importante" }, { value: "importance.no_relevante", label: "No relevante" }];
const bands = [{ value: "band.low", label: "Bajo" }, { value: "band.medium", label: "Medio" }, { value: "band.high", label: "Alto" }];
const bodyOf = (profile: Profile): ProfileBody => ({ enabled: profile.enabled, test: profile.test, confirmed: profile.confirmed, competencies: profile.competencies, auto_send_stage_ids: profile.auto_send_stage_ids, expires_in_days: profile.expires_in_days });
const noResponse = (): Result<Profile> => ({ ok: false, reason: "no_response", reference: {} });
type Notice = { tone: "success" | "error" | "info"; title: string; description?: string };

/** Master/detail keeps the full profile visible while editing one competency.
 * Segmented choices use the installed Base UI value-array API; stages compose Popover + Checkbox. */
export function ProfileEditor({ draftId, profile, etag: initialEtag, stages }: { draftId: string; profile: Profile; etag: string; stages: DraftPipelineStage[] }) {
  const [body, setBody] = useState(() => bodyOf(profile));
  const [selected, setSelected] = useState(0);
  const [stagesOpen, setStagesOpen] = useState(false);
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
  function focusError(nextErrors: Record<string, string>) {
    const index = body.competencies.findIndex((_, i) => Object.keys(nextErrors).some(key => key.startsWith(`competencies[${i}].`)));
    if (index >= 0) setSelected(index);
    // Wait for the selected detail to mount, then use visual order within it.
    requestAnimationFrame(() => {
      const detail = index >= 0 ? root.current?.querySelector('[data-profile-detail]') : root.current;
      const invalid = detail?.querySelector<HTMLElement>('[aria-invalid="true"]');
      (invalid?.matches('button, input, textarea') ? invalid : invalid?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
    });
  }
  function adopt(data: Profile, nextEtag: string) { const saved = bodyOf(data); setBody(saved); setBaseline(saved); setEtag(nextEtag); setConfirmedAt(data.confirmed_at); setErrors({}); setRecovery(null); }
  async function persist(confirm: boolean) {
    if (disabled || busy.current) return;
    const candidate = { ...body, confirmed: confirm, competencies: body.competencies.map(entry => entry.importance === "importance.no_relevante" ? { ...entry, desired_band: null, rationale: null, task: null } : entry.importance === "importance.importante" ? { ...entry, task: null } : entry) };
    const nextErrors: Record<string, string> = {};
    candidate.competencies.forEach((entry, index) => {
      const key = `competencies[${index}]`;
      for (const [field, message] of Object.entries(requirementErrors(entry, confirm))) nextErrors[`${key}.${field}`] = message;
    });
    if (!Number.isInteger(body.expires_in_days) || body.expires_in_days < 1 || body.expires_in_days > 30) nextErrors.expires_in_days = "Usa un número entero de 1 a 30";
    const parsed = profileBodySchema.safeParse(candidate);
    if (Object.keys(nextErrors).length || !parsed.success) { setErrors(nextErrors); report({ tone: "error", title: "Revisa los datos marcados", description: "Tus cambios siguen aquí. Corrige los campos señalados." }); focusError(nextErrors); return; }
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
        setErrors(mapped); focusError(mapped); report({ tone: "error", title: "Revisa los datos marcados", description: "Tus cambios siguen aquí. Corrige los campos señalados." }, failure.reference);
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
  const entry = body.competencies[selected];
  const key = `competencies[${selected}]`;
  const nameOf = (item: typeof entry) => names[COMPETENCY_IDS.indexOf(item.competency_id)];
  const name = nameOf(entry);
  const relevant = body.competencies.filter(item => item.importance !== "importance.no_relevante");
  const complete = relevant.filter(item => !Object.keys(requirementErrors(item, true)).length).length;
  const firstMissing = body.competencies.find(item => Object.keys(requirementErrors(item, true)).length);
  const missingField = firstMissing && Object.keys(requirementErrors(firstMissing, true))[0];
  const summary = firstMissing ? `${missingField === "task" ? "Falta la tarea de" : missingField === "desired_band" ? "Falta la banda de" : "Falta la justificación de"} ${nameOf(firstMissing)}` : "Perfil completo";
  const stageSummary = stages.filter(stage => body.auto_send_stage_ids.includes(stage.id)).map(stage => stage.name).join(", ") || "Sin etapas automáticas";
  return <div ref={root} className="flex min-w-0 flex-col gap-5 [&_[data-slot=button]]:min-h-10 [&_[data-slot=popover-trigger]]:min-h-10">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-xl font-semibold">Psicometría</h3><p className="text-sm text-muted-foreground">El perfil completo a la vista. Una competencia en detalle.</p></div>
      <Badge variant="accent">{body.confirmed && confirmedAt ? `Perfil confirmado · ${new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Mexico_City" }).format(new Date(confirmedAt))}` : "Perfil sin confirmar"}</Badge>
    </header>
    {(readOnly || finished) && <ConfigReadOnlyNotice />}
    <Card aria-labelledby="psychometric-settings-title">
      <CardHeader className="border-b max-sm:has-data-[slot=card-action]:grid-cols-1"><CardTitle><h4 id="psychometric-settings-title" className="flex items-center gap-2"><Settings2 aria-hidden="true" className="size-4" />Configuración general</h4></CardTitle><CardDescription>Activación, envío automático y vigencia</CardDescription><CardAction className="max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:justify-self-start"><Badge variant="neutral">IPIP · 60 ítems</Badge></CardAction></CardHeader>
      <CardContent><FieldGroup className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem]">
        <div className="flex flex-col gap-2"><Field orientation="horizontal"><Switch id="psychometric-enabled" checked={body.enabled} disabled={disabled} {...errorProps("enabled")} onCheckedChange={enabled => edit({ ...body, enabled })} /><FieldLabel htmlFor="psychometric-enabled" className="min-h-10">Usar evaluación psicométrica</FieldLabel>{error("enabled")}</Field><FieldDescription>Desactivada por defecto. No mueve ni descarta candidatos.</FieldDescription></div>
        <Field data-invalid={!!errors.auto_send_stage_ids}><FieldLabel htmlFor="psychometric-stages">Crear invitación al entrar a estas etapas</FieldLabel>
          <Popover open={stagesOpen && !disabled} onOpenChange={setStagesOpen}>
            <PopoverTrigger render={<Button id="psychometric-stages" size="lg" type="button" variant="outline" className="w-full min-w-0 justify-between" disabled={disabled} {...errorProps("auto_send_stage_ids")} />}><span className="truncate">{stageSummary}</span><ChevronDown aria-hidden="true" className="size-4" /></PopoverTrigger>
            <PopoverContent align="start" className="max-h-80 max-w-[calc(100vw-2rem)] overflow-y-auto"><PopoverHeader><PopoverTitle>Etapas automáticas</PopoverTitle></PopoverHeader><FieldGroup data-slot="checkbox-group">{stages.map(stage => <Field key={stage.id} orientation="horizontal"><Checkbox id={`auto-${stage.id}`} disabled={disabled} checked={body.auto_send_stage_ids.includes(stage.id)} onCheckedChange={checked => edit({ ...body, auto_send_stage_ids: checked ? [...body.auto_send_stage_ids, stage.id] : body.auto_send_stage_ids.filter(id => id !== stage.id) })} /><FieldLabel htmlFor={`auto-${stage.id}`} className="min-h-10">{stage.name}</FieldLabel></Field>)}</FieldGroup></PopoverContent>
          </Popover>{error("auto_send_stage_ids")}
        </Field>
        <Field data-invalid={!!errors.expires_in_days}><FieldLabel htmlFor="psychometric-expiry">Vigencia del enlace</FieldLabel><InputGroup className="min-h-10"><InputGroupInput className="min-h-10" id="psychometric-expiry" type="number" min={1} max={30} step={1} value={Number.isNaN(body.expires_in_days) ? "" : body.expires_in_days} disabled={disabled} {...errorProps("expires_in_days")} onChange={event => edit({ ...body, expires_in_days: event.target.value === "" ? NaN : Number(event.target.value) })} /></InputGroup><FieldDescription>Días · de 1 a 30</FieldDescription>{error("expires_in_days")}</Field>
      </FieldGroup></CardContent>
      <CardFooter className="border-t text-xs text-muted-foreground">No se envía correo: copia y comparte el enlace. La vigencia aplica a nuevas invitaciones. Activar y confirmar son independientes.</CardFooter>
    </Card>
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.5fr)]">
      <Card aria-labelledby="psychometric-master-title">
        <CardHeader className="border-b"><CardTitle><h4 id="psychometric-master-title" className="flex items-center gap-2"><ListChecks aria-hidden="true" className="size-4" />Perfil del puesto</h4></CardTitle><CardDescription>{relevant.length} de 7 relevantes</CardDescription><CardAction><Badge variant="neutral">7</Badge></CardAction></CardHeader>
        <CardContent><ul aria-label="Seleccionar competencia" className="flex flex-col gap-2">{body.competencies.map((item, index) => {
          const missing = Object.keys(requirementErrors(item, true)).length > 0 || Object.keys(errors).some(key => key.startsWith(`competencies[${index}].`));
          const status = item.importance === "importance.no_relevante" ? "—" : missing ? "Pendiente" : "✓";
          return <li key={item.competency_id}><Button type="button" variant="ghost" aria-pressed={index === selected} aria-controls="psychometric-detail" className={cn("h-auto min-h-10 w-full flex-col items-stretch whitespace-normal text-left", index === selected && "bg-card shadow-sm ring-1 ring-primary/40")} onClick={() => setSelected(index)}>
            <span className="font-medium">{nameOf(item)}</span><span className="flex flex-wrap items-center gap-2 text-xs"><Badge variant={item.importance === "importance.clave" ? "accent" : "neutral"}>{importance.find(option => option.value === item.importance)?.label}</Badge><span className="text-muted-foreground">{bands.find(option => option.value === item.desired_band)?.label ?? "Sin banda"}</span><span className="ml-auto" aria-label={status === "✓" ? "Completa" : status === "—" ? "Sin detalle requerido" : "Pendiente"}>{status}</span></span>
          </Button></li>;
        })}</ul></CardContent>
        <CardFooter className="flex-col items-start gap-1 border-t text-xs text-muted-foreground"><span>{complete} de {relevant.length} relevantes completas</span><span>Selecciona una competencia para revisarla.</span></CardFooter>
      </Card>
      <Card id="psychometric-detail" data-profile-detail="" aria-labelledby="psychometric-detail-title" className="min-w-0">
        <CardHeader className="border-b max-xl:has-data-[slot=card-action]:grid-cols-1"><CardTitle><h4 id="psychometric-detail-title" className="flex items-center gap-2"><BriefcaseBusiness aria-hidden="true" className="size-4" />{name}</h4></CardTitle><CardDescription>Competencia {selected + 1} de 7 · {entry.importance === "importance.no_relevante" ? "Sin detalle requerido" : Object.keys(requirementErrors(entry, true)).length ? "Pendiente" : "Completa"}</CardDescription><CardAction className="max-xl:col-start-1 max-xl:row-span-1 max-xl:row-start-3 max-xl:justify-self-start"><Button size="lg" type="button" variant="outline" disabled={disabled} onClick={() => report({ tone: "info", title: "No hay reglas de sugerencia disponibles", description: "Conservamos tu perfil. Define los requisitos con ejemplos de trabajo; no se infieren desde la vacante." })}><Sparkles aria-hidden="true" />Sugerir desde la vacante</Button></CardAction></CardHeader>
        <CardContent><FieldSet key={entry.competency_id} disabled={disabled} className="min-w-0"><FieldLegend className="sr-only">{name}</FieldLegend><FieldGroup>
          <Field data-invalid={!!errors[`${key}.importance`]}><FieldLabel id="psychometric-importance-label">Importancia en el puesto</FieldLabel><ToggleGroup variant="segmented" aria-labelledby="psychometric-importance-label" value={[entry.importance]} disabled={disabled} {...errorProps(`${key}.importance`)} onValueChange={values => {
            const value = values[0]; if (!value) return;
            changeRequirement(selected, { importance: value as typeof entry.importance, ...(value === "importance.no_relevante" ? { desired_band: null, rationale: null, task: null } : { desired_band: entry.desired_band ?? "band.medium", rationale: entry.rationale ?? "", ...(value === "importance.importante" ? { task: null } : {}) }) });
          }}>{importance.map(option => <ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>)}</ToggleGroup>{error(`${key}.importance`)}</Field>
          <Field data-invalid={!!errors[`${key}.desired_band`]}><FieldLabel id="psychometric-band-label">Banda deseada</FieldLabel><ToggleGroup variant="segmented" aria-labelledby="psychometric-band-label" value={entry.desired_band ? [entry.desired_band] : []} disabled={disabled || entry.importance === "importance.no_relevante"} {...errorProps(`${key}.desired_band`)} onValueChange={values => { if (values[0]) changeRequirement(selected, { desired_band: values[0] as NonNullable<typeof entry.desired_band> }); }}>{bands.map(option => <ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>)}</ToggleGroup>{entry.importance === "importance.no_relevante" && <FieldDescription>Sin banda</FieldDescription>}{error(`${key}.desired_band`)}</Field>
          {entry.importance === "importance.clave" && <Field data-invalid={!!errors[`${key}.task`]}><FieldLabel htmlFor={`${key}.task`}>Tarea concreta *</FieldLabel><InputGroup className="min-h-10"><InputGroupInput id={`${key}.task`} aria-label={`Tarea concreta de ${name} *`} className="min-h-10" value={entry.task ?? ""} disabled={disabled} {...errorProps(`${key}.task`)} onChange={event => changeRequirement(selected, { task: event.target.value || null })} /></InputGroup><FieldDescription className="flex flex-wrap justify-between gap-2"><span>Una tarea observable del puesto.</span><span className="tabular-nums">{textLength(entry.task)} / 300</span></FieldDescription>{error(`${key}.task`)}</Field>}
          {entry.importance !== "importance.no_relevante" && <Field data-invalid={!!errors[`${key}.rationale`]}><FieldLabel htmlFor={`${key}.rationale`}>Justificación laboral *</FieldLabel><Textarea id={`${key}.rationale`} aria-label={`Justificación laboral de ${name} *`} className="min-h-28" value={entry.rationale ?? ""} disabled={disabled} {...errorProps(`${key}.rationale`)} onChange={event => changeRequirement(selected, { rationale: event.target.value })} /><FieldDescription className="flex flex-wrap justify-between gap-2"><span>Explica la relación con el trabajo.</span><span className="tabular-nums">{textLength(entry.rationale)} / 1000</span></FieldDescription>{error(`${key}.rationale`)}</Field>}
          <div className="flex flex-col gap-2 text-xs text-muted-foreground"><p>Las sugerencias son editables y requieren tu revisión. Alto no siempre es mejor.</p><p>La relación con esta competencia es una hipótesis. Confírmala con ejemplos de trabajo.</p></div>
        </FieldGroup></FieldSet></CardContent>
        <CardFooter className="flex-wrap justify-between gap-2 border-t text-xs text-muted-foreground"><span>* Necesario para confirmar, no para guardar un borrador.</span><span className="tabular-nums">{selected + 1} / 7</span></CardFooter>
      </Card>
    </div>
    <p className="text-xs text-muted-foreground">Editar los requisitos deja el perfil sin confirmar. Los cambios se aplican a futuras evaluaciones; no alteran resultados anteriores. Sin confirmar, la evaluación funciona y muestra solo bandas. La relación con el trabajo es una hipótesis, no una garantía.</p>
    {/* Standalone form action surface, not a competency card footer. Mobile stacks zones without shrinking controls. */}
    <Card role="region" aria-label="Guardar y confirmar" className="sticky bottom-3 z-10 max-sm:py-3"><CardContent className="max-sm:px-4 [&_[data-pf-action-bar]]:max-sm:flex-wrap [&_[data-pf-action-bar-actions]]:max-sm:w-full [&_[data-pf-action-bar]>div:last-child]:max-sm:basis-full">
      <ActionBar status={<div className="flex flex-col gap-2">
        <div aria-hidden="true" className="flex w-48 max-w-full gap-1 max-sm:hidden">{relevant.map(item => <span data-testid="completeness-segment" key={item.competency_id} className={cn("h-1 flex-1 rounded-full", Object.keys(requirementErrors(item, true)).length ? "bg-border" : "bg-status-success")} />)}</div><p className="text-sm font-medium">{summary}</p>
        {notice ? <ActionStatus id="psychometric-save-status" tone={notice.tone} text={notice.title} action={recovery && <Button size="lg" type="button" variant="outline" disabled={pending} onClick={() => void recover()}>{recovery === "reload" ? "Cargar versión actual" : "Comprobar"}</Button>} /> : <span id="psychometric-save-status" className="text-xs text-muted-foreground max-sm:sr-only">{dirty ? "Cambios sin guardar" : "No hay cambios pendientes."}</span>}
      </div>}><Button size="lg" type="button" variant="outline" disabled={disabled || !dirty} aria-describedby="psychometric-save-status" onClick={() => void persist(body.confirmed)}>Guardar cambios</Button><Button size="lg" type="button" disabled={disabled} aria-describedby="psychometric-save-status" aria-busy={pending} onClick={() => void persist(true)}>{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}Confirmar perfil</Button></ActionBar>
    </CardContent></Card>
  </div>;
}
