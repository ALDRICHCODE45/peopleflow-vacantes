"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowLeft, ArrowRight, RefreshCw, Repeat } from "lucide-react";
import { notifyActionResult } from "@/components/feedback/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import { loadStartContextAction, startReplacementAction } from "./actions";
import type { StartFailure } from "./failure";
import { BLOCKER_COPY, MAX_CARRIED, candidateKey, defaultStartingStage, startBodySchema, startingStages, type CarryCandidate, type SourceStage, type StartBody, type StartContext, type UnavailableHire } from "./model";
import { BajasStep, CandidatesStep, ConditionsStep, NO_BAJAS_HINT_ID, RESPONSIBLE_ME, countBajas, countCandidates, type CandidateFilter } from "./steps";

export type StartReplacementDialogProps = {
  /** The SOURCE vacancy: the latest process of its chain, closed. */
  draftId: string;
  /** Vacancy title, shown under «Iniciar reemplazo». */
  title?: string;
  /** Company name, shown after the title as «<title> · <company>»; omitted while unknown. */
  companyName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set when the flow starts from a person's card «⋯» menu; ignored unless that credit is still startable. */
  preselectedCreditId?: string;
  /** Stages of the SOURCE board (`board.stages`); Placement is never offered as a starting stage. */
  stages: readonly SourceStage[];
  /** Hires the caller knows cannot be replaced (still in Placement): listed disabled with the reason in text. */
  unavailableHires?: readonly UnavailableHire[];
  /** Called with the new draft id once the replacement exists; the caller navigates to its board. */
  onStarted: (newDraftId: string) => void;
};
type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; ctx: StartContext };
const STEPS = ["Bajas", "Condiciones", "Candidatos"] as const;

export function StartReplacementDialog(props: StartReplacementDialogProps) {
  return props.open ? <Session key={props.draftId} {...props} /> : null;
}

/** Icon tile + «Iniciar reemplazo» + «<title> · <company>» (artboard 04); either part of the meta may be missing. */
function TitleBlock({ title, companyName, titleRef }: { title?: string; companyName?: string; titleRef: RefObject<HTMLHeadingElement | null> }) {
  const meta = [title, companyName].filter(Boolean).join(" · ");
  return <div className="flex items-start gap-3.5">
    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-primary/10 text-primary"><Repeat className="size-5" /></span>
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">Iniciar reemplazo</DialogTitle>
      {meta && <DialogDescription>{meta}</DialogDescription>}
    </div>
  </div>;
}

function Session(props: StartReplacementDialogProps) {
  const { draftId, onOpenChange } = props;
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const title = useRef<HTMLHeadingElement>(null);
  const refresh = useCallback(async () => {
    const result = await loadStartContextAction(draftId);
    if (!alive.current) return result;
    setLoad(result.ok ? { status: "ready", ctx: result.data } : { status: "error", message: result.message });
    return result;
  }, [draftId]);
  useEffect(() => {
    alive.current = true;
    // The first state is already «loading»; `refresh` only sets state after the read resolves.
    void refresh();
    return () => { alive.current = false; };
  }, [refresh]);
  const retry = () => { setLoad({ status: "loading" }); void refresh(); };
  return <Dialog open onOpenChange={next => { if (!busy) onOpenChange(next); }}>
    <DialogContent initialFocus={title} showCloseButton={!busy}
      className="grid-rows-[auto_minmax(0,1fr)_auto] gap-4 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-h-[min(46rem,calc(100dvh-2rem))] sm:max-w-xl">
      {load.status === "ready"
        ? <Flow {...props} ctx={load.ctx} titleRef={title} reload={refresh} onBusy={setBusy} />
        : <>
          <DialogHeader className="pr-10"><TitleBlock title={props.title} companyName={props.companyName} titleRef={title} /></DialogHeader>
          {load.status === "loading"
            ? <div role="status" aria-label="Cargando bajas" className="flex flex-col gap-3"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
            : <div className="flex flex-col items-start gap-3"><p role="alert" className="text-sm text-destructive">{load.message}</p><Button type="button" variant="outline" className="min-h-10" onClick={retry}><RefreshCw aria-hidden="true" data-icon="inline-start" />Reintentar</Button></div>}
          <DialogFooter><Button type="button" variant="outline" className="min-h-10" onClick={() => onOpenChange(false)}>Cerrar</Button></DialogFooter>
        </>}
    </DialogContent>
  </Dialog>;
}

type Errors = { target?: string; date?: string; responsible?: string; credits: Record<string, string>; candidates: Record<string, string> };
const noErrors: Errors = { credits: {}, candidates: {} };
/** Which step shows the failure, so the person lands where the fix is. */
function failureStep(failure: StartFailure, current: 1 | 2 | 3): 1 | 2 | 3 {
  if (failure.credits) return 1;
  if (failure.fields || failure.missing) return 2;
  if (failure.candidates) return 3;
  return current;
}

function Flow({ ctx, draftId, title, companyName, stages, unavailableHires = [], preselectedCreditId, titleRef, reload, onBusy, onOpenChange, onStarted }:
  StartReplacementDialogProps & { ctx: StartContext; titleRef: RefObject<HTMLHeadingElement | null>; reload: () => Promise<unknown>; onBusy: (busy: boolean) => void }) {
  const view = ctx.replacements; const start = view.start_replacement;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(() => preselectedCreditId && start.startable_credits.some(credit => credit.credit_id === preselectedCreditId) ? [preselectedCreditId] : []);
  const [responsible, setResponsible] = useState<string>(RESPONSIBLE_ME);
  const [targetText, setTargetText] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [publish, setPublish] = useState(false);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<CandidateFilter>("all");
  const [errors, setErrors] = useState<Errors>(noErrors);
  const [banner, setBanner] = useState<string | null>(null);
  const [rejectedMissing, setRejectedMissing] = useState<readonly string[] | null>(null);
  const [pending, setPending] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusId = useRef<string | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const intent = useRef<{ fingerprint: string; key: string } | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const target = focusId.current ? document.getElementById(focusId.current) : null;
    focusId.current = null;
    (target ?? heading.current)?.focus();
  }, [step]);

  const selected = useMemo(() => new Set(selectedIds.filter(id => start.startable_credits.some(credit => credit.credit_id === id))), [selectedIds, start.startable_credits]);
  const orderedCredits = start.startable_credits.filter(credit => selected.has(credit.credit_id));
  const minTarget = orderedCredits.length;
  const targetValue = targetText ?? String(minTarget);
  const targetNumber = Number(targetValue);
  const liveTargetError = targetValue.trim() === "" || !Number.isInteger(targetNumber) || targetNumber > 999 ? "El objetivo debe ser un número entre 1 y 999."
    : targetNumber < minTarget ? `El objetivo no puede ser menor que el número de bajas (${minTarget}).` : undefined;
  const targetError = liveTargetError ?? errors.target;
  const candidates = view.carry_candidates;
  const chosenOrdered = candidates.filter(item => candidateKey(item.candidate) in chosen);
  const preselected = preselectedCreditId ? start.startable_credits.find(credit => credit.credit_id === preselectedCreditId) : undefined;
  const sourceCoverage = view.items.find(item => item.id === draftId)?.coverage;
  const missing = rejectedMissing ?? (start.publish_ready === true ? null : start.missing);

  function clearFailure() { setBanner(null); }
  function toggleCredit(creditId: string, checked: boolean) {
    setSelectedIds(current => checked ? [...current.filter(id => id !== creditId), creditId] : current.filter(id => id !== creditId));
    setErrors(current => ({ ...current, credits: Object.fromEntries(Object.entries(current.credits).filter(([id]) => id !== creditId)) }));
    clearFailure();
  }
  function toggleCandidate(item: CarryCandidate, checked: boolean) {
    const key = candidateKey(item.candidate);
    setChosen(current => {
      if (!checked) return Object.fromEntries(Object.entries(current).filter(([existing]) => existing !== key));
      if (Object.keys(current).length >= MAX_CARRIED) return current;
      return { ...current, [key]: defaultStartingStage(stages, item.stage) };
    });
    setErrors(current => ({ ...current, candidates: Object.fromEntries(Object.entries(current.candidates).filter(([existing]) => existing !== key)) }));
    clearFailure();
  }
  function chooseStage(key: string, stageId: string) {
    setChosen(current => ({ ...current, [key]: stageId }));
    setErrors(current => ({ ...current, candidates: Object.fromEntries(Object.entries(current.candidates).filter(([existing]) => existing !== key)) }));
    clearFailure();
  }
  function goTo(next: 1 | 2 | 3, focus?: string) { focusId.current = focus ?? null; setStep(next); }
  function advanceFromConditions() {
    if (targetError) { document.getElementById("replacement-target")?.focus(); setErrors(current => ({ ...current, target: current.target ?? targetError })); return; }
    if (!date) { setErrors(current => ({ ...current, date: "Elige la fecha compromiso para continuar." })); document.getElementById("replacement-date")?.focus(); return; }
    goTo(3);
  }
  function body(): StartBody {
    return {
      placement_credit_ids: orderedCredits.map(credit => credit.credit_id),
      ...(responsible !== RESPONSIBLE_ME ? { responsible: { user_id: responsible } } : {}),
      target_quantity: targetNumber, commitment_date: date ?? "",
      publish: publish && missing === null,
      carried_candidates: chosenOrdered.map(item => ({ candidate: { kind: item.candidate.kind, id: item.candidate.id }, stage_id: chosen[candidateKey(item.candidate)] })),
    };
  }
  async function submit() {
    if (lock.current) return;
    const parsed = startBodySchema.safeParse(body());
    if (!parsed.success) { setBanner("Revisa los datos antes de iniciar el reemplazo."); return; }
    const fingerprint = JSON.stringify(parsed.data);
    // One key per confirmed intent: an unchanged body after an unconfirmed result replays the same key, a changed one starts a new intent.
    if (intent.current?.fingerprint !== fingerprint) intent.current = { fingerprint, key: crypto.randomUUID() };
    const sent = chosenOrdered.map(item => candidateKey(item.candidate));
    lock.current = true; setPending(true); onBusy(true); setBanner(null); setErrors(noErrors);
    let result: Awaited<ReturnType<typeof startReplacementAction>>;
    try { result = await startReplacementAction({ draftId, ifMatch: ctx.etag, idempotencyKey: intent.current.key, body: parsed.data }); }
    catch { result = { ok: false, reason: "no_response", message: "No pudimos confirmar si se inició el reemplazo. Vuelve a intentarlo: si ya se creó, no se duplicará.", reference: {}, uncertain: true }; }
    if (!alive.current) { lock.current = false; return; }
    if (result.ok) {
      notifyActionResult({ key: `replacement-${draftId}`, type: "success", title: "Reemplazo iniciado", description: "Está en privado. Abre su tablero para trabajar a los candidatos." });
      onStarted(result.data.id); onOpenChange(false);
      lock.current = false; onBusy(false); return;
    }
    if (!result.uncertain) intent.current = null;
    const nextStep = failureStep(result, step);
    setBanner(result.message);
    setErrors({
      credits: Object.fromEntries((result.credits ?? []).map(item => [item.credit_id, item.message])),
      candidates: Object.fromEntries((result.candidates ?? []).flatMap(item => sent[item.index] ? [[sent[item.index], item.message]] : [])),
      target: result.fields?.target_quantity, date: result.fields?.commitment_date, responsible: result.fields?.responsible,
    });
    if (result.reason === "publication_incomplete") { setRejectedMissing(result.missing ?? []); setPublish(false); }
    if (nextStep !== step) goTo(nextStep, result.fields?.target_quantity ? "replacement-target" : result.fields?.commitment_date ? "replacement-date" : result.fields?.responsible ? "replacement-responsible" : undefined);
    else if (result.fields?.target_quantity) document.getElementById("replacement-target")?.focus();
    if (result.reload) await reload();
    lock.current = false; if (alive.current) setPending(false); onBusy(false);
  }

  const header = <DialogHeader className="gap-2 pr-10">
    <TitleBlock title={title} companyName={companyName} titleRef={titleRef} />
    {/* Three bars (artboard 04): the current and finished steps are filled. On a phone the label is the step's name alone so nothing wraps; «Paso N» stays in the list's name and the live status. */}
    <ol aria-label={`Paso ${step} de 3`} className="mt-1 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
      {STEPS.map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={cn("flex min-w-0 flex-col gap-1.5 font-medium", step === index + 1 && "text-foreground")}>
        <span aria-hidden="true" className={cn("h-1 rounded-full bg-border", step >= index + 1 && "bg-primary")} />
        <span className="hidden truncate sm:inline">Paso {index + 1}: {label}</span><span className="truncate sm:hidden">{label}</span>
      </li>)}
    </ol>
    <p role="status" className="sr-only">Paso {step} de 3: {STEPS[step - 1]}</p>
  </DialogHeader>;
  if (!start.allowed) {
    return <>
      {header}
      <p className="text-sm text-muted-foreground">{start.blocker ? BLOCKER_COPY[start.blocker] : "No se puede iniciar un reemplazo para esta vacante por ahora."}</p>
      <DialogFooter><Button type="button" variant="outline" className="min-h-10" onClick={() => onOpenChange(false)}>Cerrar</Button></DialogFooter>
    </>;
  }
  const hint = selected.size === 0 ? <p id={NO_BAJAS_HINT_ID} className="text-sm text-muted-foreground">Elige al menos una baja para continuar.</p> : null;
  return <>
    {header}
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-1 [scrollbar-width:thin]">
      {banner && <p role="alert" className="rounded-2xl border border-status-danger/40 bg-status-danger/10 p-3 text-sm text-status-danger">{banner}</p>}
      {step === 1 && <BajasStep headingRef={heading} credits={start.startable_credits} unavailable={unavailableHires} selected={selected} errors={errors.credits} preselected={preselected} coverage={sourceCoverage} hint={hint} onToggle={toggleCredit} />}
      {step === 2 && <ConditionsStep headingRef={heading} ctx={ctx} responsible={responsible} onResponsible={value => { setResponsible(value); setErrors(current => ({ ...current, responsible: undefined })); clearFailure(); }}
        targetValue={targetValue} minTarget={minTarget} targetError={targetError} onTarget={value => { setTargetText(value); setErrors(current => ({ ...current, target: undefined })); clearFailure(); }}
        date={date} dateError={errors.date} onDate={value => { setDate(value); setErrors(current => ({ ...current, date: undefined })); clearFailure(); }}
        publish={publish} onPublish={setPublish} missing={missing} errors={errors} pending={pending} />}
      {step === 3 && <CandidatesStep headingRef={heading} candidates={candidates} truncated={view.carry_candidates_truncated} stages={startingStages(stages)} chosen={chosen} errors={errors.candidates} filter={filter} onFilter={setFilter} onToggle={toggleCandidate} onStage={chooseStage} pending={pending} />}
    </div>
    {/* Phone: the count above, then «Atrás»/«Cancelar» and the primary side by side in two equal columns. */}
    <DialogFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">{step === 1 ? countBajas(selected.size) : step === 2 ? `${selected.size} ${selected.size === 1 ? "baja" : "bajas"} · objetivo ${targetNumber > 0 ? targetNumber : minTarget}` : countCandidates(chosenOrdered.length)}</p>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        {step === 1
          ? <Button type="button" variant="outline" className="min-h-10 w-full sm:w-auto" onClick={() => onOpenChange(false)}>Cancelar</Button>
          : <Button type="button" variant="outline" className="min-h-10 w-full sm:w-auto" disabled={pending} onClick={() => goTo((step - 1) as 1 | 2)}><ArrowLeft aria-hidden="true" data-icon="inline-start" />Atrás</Button>}
        {step === 1 && <Button type="button" className="min-h-10 w-full sm:w-auto" disabled={selected.size === 0} aria-describedby={selected.size === 0 ? NO_BAJAS_HINT_ID : undefined} onClick={() => goTo(2)}>Siguiente<ArrowRight aria-hidden="true" data-icon="inline-end" /></Button>}
        {step === 2 && <Button type="button" className="min-h-10 w-full sm:w-auto" disabled={pending} onClick={advanceFromConditions}>Siguiente<ArrowRight aria-hidden="true" data-icon="inline-end" /></Button>}
        {step === 3 && <Button type="button" className="min-h-10 w-full sm:w-auto" disabled={pending} aria-busy={pending || undefined} onClick={() => void submit()}>{pending ? <><Spinner aria-hidden="true" data-icon="inline-start" />Iniciando…</> : "Iniciar reemplazo"}</Button>}
      </div>
    </DialogFooter>
  </>;
}
