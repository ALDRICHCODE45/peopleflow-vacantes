"use client";

import { forwardRef, type ReactNode, type Ref } from "react";
import { History, Info, Minus, Plus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { BusinessDateField } from "@/features/employer-vacancies/delivery-config/date-field";
import { groupMissing } from "@/features/jobs/drafts/pipeline/publication-model";
import { MAX_BAJAS, MAX_CARRIED, businessDaysUntil, candidateKey, startingStages, type CarryCandidate, type SourceStage, type StartContext, type StartableCredit, type UnavailableHire } from "./model";

const dayFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" });
const day = (value: string | null) => { const date = value ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? dayFormat.format(date).replace(".", "") : null; };
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
export const countBajas = (count: number) => plural(count, "baja elegida", "bajas elegidas");
export const countCandidates = (count: number) => plural(count, "candidato", "candidatos");
const initials = (name: string) => name.trim().split(/\s+/u).slice(0, 2).map(part => Array.from(part)[0]).join("").toUpperCase();
/** The person's initials on a row (artboard 04); the name beside it already says who it is, so it is decorative. */
const Person = ({ name }: { name: string }) => <Avatar aria-hidden="true" className="size-8 shrink-0"><AvatarFallback className="bg-secondary text-xs font-medium text-muted-foreground">{initials(name)}</AvatarFallback></Avatar>;
/** Tinted note (artboard 04 `.note`): coverage and audit remarks read as information, not as body copy. */
const Note = ({ icon: Icon, children }: { icon: typeof Info; children: ReactNode }) => <p className="flex items-start gap-2.5 rounded-2xl bg-primary/5 p-3 text-xs leading-4 text-foreground"><Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" /><span>{children}</span></p>;
const itemClass = "flex min-w-0 flex-col gap-2 rounded-2xl border p-3 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-primary/5";

/** Every step opens with a focusable heading: the dialog moves focus to it so the change of step is announced. */
export const StepHeading = forwardRef<HTMLHeadingElement, { children: ReactNode }>(function StepHeading({ children }, ref) {
  return <h3 ref={ref} tabIndex={-1} className="font-heading text-sm font-medium outline-none">{children}</h3>;
});

export const REASON_COPY = {
  still_placed: "Sigue en Placement. Solo se reemplaza a quien no se sostuvo.",
  already_replaced: "Ya tiene un reemplazo.",
} as const;
export const NO_BAJAS_HINT_ID = "replacement-bajas-hint";

export function BajasStep({ headingRef, credits, unavailable, selected, errors, preselected, coverage, hint, onToggle }: {
  headingRef: Ref<HTMLHeadingElement>; credits: readonly StartableCredit[]; unavailable: readonly UnavailableHire[]; selected: ReadonlySet<string>;
  errors: Readonly<Record<string, string>>; preselected: StartableCredit | undefined; coverage: { covered: number; required: number | null } | undefined;
  hint: ReactNode; onToggle: (creditId: string, checked: boolean) => void;
}) {
  return <FieldSet className="gap-3">
    <StepHeading ref={headingRef}>¿A quién reemplaza?</StepHeading>
    <p className="text-sm text-muted-foreground">
      {preselected
        ? `${preselected.candidate.full_name} viene marcado porque iniciaste el reemplazo desde su tarjeta. Si otra persona también se fue, márcala para sumarla: un mismo reemplazo puede cubrir varias bajas.`
        : "Elige a quién se fue. Un mismo reemplazo puede cubrir varias bajas."}
    </p>
    <ul aria-label="Bajas" className="flex flex-col gap-2">
      {credits.map(credit => {
        const base = `replacement-credit-${credit.credit_id}`;
        const hired = day(credit.hired_at); const left = day(credit.left_at);
        return <li key={credit.credit_id} className={itemClass}>
          <Field orientation="horizontal" className="items-start">
            <Checkbox id={base} aria-labelledby={`${base}-name`} aria-describedby={`${base}-meta${errors[credit.credit_id] ? ` ${base}-error` : ""}`} checked={selected.has(credit.credit_id)} onCheckedChange={checked => onToggle(credit.credit_id, checked)} />
            <Person name={credit.candidate.full_name} />
            <FieldContent>
              <FieldLabel htmlFor={base} id={`${base}-name`} className="font-medium">{credit.candidate.full_name}</FieldLabel>
              <span id={`${base}-meta`} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {[hired && `Placement el ${hired}`, left && `se fue el ${left}`].filter(Boolean).join(" · ")}
                <Badge variant="review" dot>No se sostuvo</Badge>
              </span>
              {errors[credit.credit_id] && <FieldError id={`${base}-error`}>{errors[credit.credit_id]}</FieldError>}
            </FieldContent>
          </Field>
        </li>;
      })}
      {unavailable.map(hire => {
        const base = `replacement-unavailable-${hire.id}`;
        return <li key={hire.id} className={`${itemClass} opacity-80`}>
          <Field orientation="horizontal" className="items-start" data-disabled>
            <Checkbox id={base} disabled aria-labelledby={`${base}-name`} aria-describedby={`${base}-reason`} checked={false} />
            <Person name={hire.name} />
            <FieldContent>
              <FieldLabel htmlFor={base} id={`${base}-name`} className="font-medium">{hire.name}</FieldLabel>
              <span id={`${base}-reason`} className="text-xs text-muted-foreground">{REASON_COPY[hire.reason]}</span>
              {hire.reason === "still_placed" && <Badge variant="success" dot>Sigue en Placement</Badge>}
            </FieldContent>
          </Field>
        </li>;
      })}
    </ul>
    {coverage && <Note icon={Info}>
      Cobertura actual: <b className="font-medium">{coverage.required === null ? `${coverage.covered} plazas` : `${coverage.covered} de ${coverage.required} plazas`}</b>. Cada baja que elijas suma una plaza al objetivo del reemplazo; el proceso original no se modifica.
    </Note>}
    {hint}
  </FieldSet>;
}

export const RESPONSIBLE_ME = "me";
export function ConditionsStep({ headingRef, ctx, responsible, onResponsible, targetValue, minTarget, targetError, onTarget, date, dateError, onDate, publish, onPublish, missing, errors, pending }: {
  headingRef: Ref<HTMLHeadingElement>; ctx: StartContext; responsible: string; onResponsible: (value: string) => void;
  targetValue: string; minTarget: number; targetError: string | undefined; onTarget: (value: string) => void;
  date: string | null; dateError: string | undefined; onDate: (value: string | null) => void;
  publish: boolean; onPublish: (value: boolean) => void; missing: readonly string[] | null; errors: { responsible?: string }; pending: boolean;
}) {
  const people = ctx.members.filter(member => member.role !== "stakeholder").sort((a, b) => a.user.full_name.localeCompare(b.user.full_name, "es-MX"));
  const items = [{ value: RESPONSIBLE_ME, label: "Yo, quien inicia el reemplazo" }, ...people.map(member => ({ value: member.user.id, label: member.user.full_name }))];
  const value = Number(targetValue);
  const days = date ? businessDaysUntil(ctx.calendar, date) : null;
  const blocked = missing !== null;
  const labels = blocked ? groupMissing(missing).flatMap(group => group.items.map(item => item.label)) : [];
  return <div className="flex flex-col gap-4">
    <StepHeading ref={headingRef}>Condiciones del reemplazo</StepHeading>
    <Field data-invalid={!!errors.responsible || undefined}>
      <FieldLabel htmlFor="replacement-responsible">Reclutador responsable</FieldLabel>
      <Select items={items} value={responsible} onValueChange={next => { if (next) onResponsible(next); }}>
        <SelectTrigger id="replacement-responsible" className="min-h-10 w-full" disabled={pending} aria-invalid={!!errors.responsible || undefined} aria-describedby={`replacement-responsible-help${errors.responsible ? " replacement-responsible-error" : ""}`}><SelectValue placeholder="Elige a una persona" /></SelectTrigger>
        <SelectContent><SelectGroup>{items.map(item => <SelectItem key={item.value} value={item.value} className="min-h-10">{item.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      <FieldDescription id="replacement-responsible-help">El reemplazo abre con su propio equipo: nadie del equipo original pasa automáticamente.</FieldDescription>
      {errors.responsible && <FieldError id="replacement-responsible-error">{errors.responsible}</FieldError>}
    </Field>
    {/* Objetivo and Fecha compromiso share a row on desktop so the dialog fits 1440×900 without scrolling; they stack on a phone. */}
    <div className="grid gap-4 sm:grid-cols-2 sm:items-start">
      <Field data-invalid={!!targetError || undefined}>
        <FieldLabel htmlFor="replacement-target">Objetivo</FieldLabel>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" className="size-10" aria-label="Quitar un candidato" disabled={pending || !(value > minTarget)} onClick={() => onTarget(String(value - 1))}><Minus aria-hidden="true" /></Button>
          <Input id="replacement-target" type="number" inputMode="numeric" min={minTarget} max={MAX_BAJAS} step={1} className="h-10 w-24 text-center" value={targetValue} disabled={pending} aria-invalid={!!targetError || undefined} aria-describedby={`replacement-target-help${targetError ? " replacement-target-error" : ""}`} onChange={event => onTarget(event.target.value)} />
          <Button type="button" variant="outline" size="icon" className="size-10" aria-label="Agregar un candidato" disabled={pending || !(value < MAX_BAJAS)} onClick={() => onTarget(String(Number.isFinite(value) ? value + 1 : minTarget))}><Plus aria-hidden="true" /></Button>
        </div>
        <FieldDescription id="replacement-target-help">Candidatos a entregar. Por defecto, uno por cada baja; no puede ser menor.</FieldDescription>
        {targetError && <FieldError id="replacement-target-error">{targetError}</FieldError>}
      </Field>
      <BusinessDateField id="replacement-date" label="Fecha compromiso" value={date} calendar={ctx.calendar} errorMessage={dateError} disabled={pending} onChange={onDate}
        description={days === null ? "Día hábil en México, desde hoy y hasta dentro de un año." : `Plazo desde hoy: ${plural(days, "día hábil", "días hábiles")}.`} />
    </div>
    <Field orientation="horizontal" className="items-start rounded-2xl border p-3" data-disabled={blocked || undefined}>
      <Switch aria-labelledby="replacement-publish-label" aria-describedby={`replacement-publish-help${blocked ? " replacement-publish-missing" : ""}`} checked={publish && !blocked} disabled={pending || blocked} onCheckedChange={onPublish} />
      <FieldContent>
        <span id="replacement-publish-label" className="text-sm font-medium">Publicar al iniciar</span>
        <FieldDescription id="replacement-publish-help">
          Por defecto es privado: nadie fuera de tu equipo lo ve. Si lo publicas, sale como un aviso normal, sin mencionar que es un reemplazo. Publicar después no reinicia el plazo: el reloj corre desde que inicias el reemplazo.
        </FieldDescription>
        {blocked && <div id="replacement-publish-missing" className="text-sm text-status-review">
          {labels.length > 0 ? <>Para publicar al iniciar falta, en la vacante original:<ul className="ml-4 list-disc">{labels.map(label => <li key={label}>{label}</li>)}</ul></> : "Para publicar al iniciar, la vacante original aún no está lista."}
        </div>}
      </FieldContent>
    </Field>
  </div>;
}

export type CandidateFilter = "all" | "in_process" | "discarded";
export function CandidatesStep({ headingRef, candidates, truncated, stages, chosen, errors, filter, onFilter, onToggle, onStage, pending }: {
  headingRef: Ref<HTMLHeadingElement>; candidates: readonly CarryCandidate[]; truncated: boolean; stages: readonly SourceStage[];
  chosen: Readonly<Record<string, string>>; errors: Readonly<Record<string, string>>; filter: CandidateFilter; onFilter: (value: CandidateFilter) => void;
  onToggle: (candidate: CarryCandidate, checked: boolean) => void; onStage: (key: string, stageId: string) => void; pending: boolean;
}) {
  const options = startingStages(stages).map(stage => ({ value: stage.id, label: stage.name }));
  const counts = { all: candidates.length, in_process: candidates.filter(item => !item.discarded).length, discarded: candidates.filter(item => item.discarded).length };
  const visible = candidates.filter(item => filter === "all" || (filter === "discarded") === item.discarded);
  const full = Object.keys(chosen).length >= MAX_CARRIED;
  return <div className="flex flex-col gap-3">
    <StepHeading ref={headingRef}>Candidatos que retomas</StepHeading>
    <p className="text-sm text-muted-foreground">Opcional. Elige personas descartadas o que siguen en el proceso original. Empiezan en la etapa que confirmes, menos Placement.</p>
    {candidates.length === 0 ? <p className="rounded-2xl border border-dashed p-4 text-sm text-muted-foreground">No hay candidatos del proceso original para retomar.</p> : <>
      <ToggleGroup aria-label="Filtrar candidatos" variant="outline" value={[filter]} disabled={pending} className="flex-wrap" onValueChange={values => { const next = values[0]; if (next === "all" || next === "in_process" || next === "discarded") onFilter(next); }}>
        {([["all", "Todos"], ["in_process", "En proceso"], ["discarded", "Descartados"]] as const).map(([value, label]) =>
          <ToggleGroupItem key={value} value={value} className="min-h-10 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground">{label} <span className="text-muted-foreground">{counts[value]}</span></ToggleGroupItem>)}
      </ToggleGroup>
      <ul aria-label="Candidatos del proceso original" className="flex flex-col gap-2">
        {visible.map(item => {
          const key = candidateKey(item.candidate); const base = `replacement-candidate-${item.candidate.kind}-${item.candidate.id}`;
          const checked = key in chosen;
          // Desktop: who they are on the left, the starting stage on the right; a phone stacks them (artboard 04).
          return <li key={key} className={cn(itemClass, "sm:flex-row sm:items-center sm:justify-between sm:gap-4")}>
            <Field orientation="horizontal" className="min-w-0 flex-1 items-start">
              <Checkbox id={base} aria-labelledby={`${base}-name`} aria-describedby={`${base}-meta${errors[key] ? ` ${base}-error` : ""}`} checked={checked} disabled={pending || (!checked && full)} onCheckedChange={next => onToggle(item, next)} />
              <Person name={item.candidate.full_name} />
              <FieldContent>
                <FieldLabel htmlFor={base} id={`${base}-name`} className="font-medium">{item.candidate.full_name}</FieldLabel>
                <span id={`${base}-meta`} className="text-xs text-muted-foreground">{item.discarded ? "Descartado" : "En proceso"} · antes: {item.stage.name}</span>
                {errors[key] && <FieldError id={`${base}-error`}>{errors[key]}</FieldError>}
              </FieldContent>
            </Field>
            <div className="flex flex-col gap-1 sm:w-56 sm:shrink-0">
              <span id={`${base}-stage-label`} className="text-xs font-medium text-muted-foreground">Empieza en</span>
              <Select items={options} value={chosen[key] ?? null} onValueChange={next => { if (next) onStage(key, next); }}>
                <SelectTrigger className="min-h-10 w-full" disabled={pending || !checked} aria-labelledby={`${base}-stage-label ${base}-name`} aria-invalid={!!errors[key] || undefined}><SelectValue placeholder="Elige una etapa" /></SelectTrigger>
                <SelectContent><SelectGroup>{options.map(option => <SelectItem key={option.value} value={option.value} className="min-h-10">{option.label}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </div>
          </li>;
        })}
      </ul>
      {full && <p className="text-xs text-muted-foreground">Puedes retomar hasta {MAX_CARRIED} candidatos por reemplazo.</p>}
      {truncated && <p className="text-xs text-muted-foreground">Mostramos los primeros 1000 candidatos del proceso original.</p>}
    </>}
    <Note icon={History}>Elegir candidatos queda en el historial: quién los retomó y en qué etapa empiezan. Ninguno entra directo a Placement; solo puede llegar con un movimiento posterior.</Note>
  </div>;
}
