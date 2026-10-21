"use client";
import { useEffect, useRef, useState } from "react";
import { Trash2, UserPlus, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Badge } from "@/components/ui/badge";
import { FieldError, FieldLegend, FieldSet } from "@/components/ui/field";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import type { Board } from "@/features/pipeline-movement/model";
import { checkDuplicatesAction } from "./actions";
import { submitManualCandidate } from "./upload";
import { contact, emptyDraft, prepare, serverErrors, type Draft, type Errors } from "./draft";
import { failureMessage } from "./failure";
import type { DuplicateMatch, IntakeFailure, IntakeResponse } from "./model";
import { IntakeFields } from "./fields";

type Props = { vacancyId: string; stages: Board["stages"]; onClose: () => void; onSuccess: (value: IntakeResponse) => void; onViewExisting: (id: string) => void; disabled?: boolean };
/** Controlled without a Trigger because the board header owns the entry action.
 * Dense-sheet anatomy follows §17; confirmations reuse the shared Basic alert dialog. */
export function ManualIntakeSheet({ vacancyId, stages, onClose, onSuccess, onViewExisting, disabled }: Props) {
 const [open, setOpen] = useState(true);
 const [draft, setDraft] = useState(emptyDraft);
 const [stage, setStage] = useState(stages.find(stage => stage.kind !== "placement")?.id ?? "");
 const [file, setFile] = useState<File | null>(null);
 const [errors, setErrors] = useState<Errors>({});
 const [matches, setMatches] = useState<DuplicateMatch[]>([]);
 const [existing, setExisting] = useState<DuplicateMatch | null>(null);
 const [distinct, setDistinct] = useState(false);
 const [discard, setDiscard] = useState(false);
 const [confirm, setConfirm] = useState(false);
 const [pending, setPending] = useState(false);
 const [failure, setFailure] = useState<IntakeFailure | null>(null);
 const [checkNote, setCheckNote] = useState("");
 const [dirty, setDirty] = useState(false);
 const bodyRef = useRef<HTMLDivElement>(null);
 const busy = useRef(false);
 const succeeded = useRef<string | null>(null);
 const sequence = useRef(0);
 const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
 const alive = useRef(true);
 // The key belongs to a frozen request intent, not an individual fetch attempt.
 const intent = useRef<{ signature: string; file: File; key: string } | null>(null);
 useEffect(() => { alive.current = true; sequence.current++; return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); }; }, []);
 useEffect(() => {
  if (!dirty) return;
  const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
  window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
 }, [dirty]);
 function change(next: Draft) {
  if (busy.current) return;
  if (next.email !== draft.email || next.phone !== draft.phone || next.dial !== draft.dial) {
   sequence.current++; if (timer.current) clearTimeout(timer.current);
   setMatches([]); setDistinct(false); setExisting(null); setCheckNote("");
  }
  setDraft(next); setDirty(true); setFailure(null);
 }
 function close() { if (busy.current) return; if (dirty) setDiscard(true); else onClose(); }
 function check() {
  const value = contact(draft);
  if (!value.email && !value.phone) return;
  const current = ++sequence.current;
  if (timer.current) clearTimeout(timer.current);
  timer.current = setTimeout(async () => {
   let result;
   try { result = await checkDuplicatesAction(vacancyId, value); } catch { result = { ok: false } as const; }
   if (!alive.current || sequence.current !== current || busy.current) return;
   if (result.ok) { setMatches(result.data.matches); setCheckNote(""); }
   else setCheckNote("No pudimos comprobar coincidencias. Se revisarán al guardar.");
  }, 300);
 }
 function firstInvalid() {
  const first = bodyRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
  // Collection errors belong at the editor's first actionable control, before later sections.
  return first?.matches("[data-intake-education], [data-intake-languages]") ? first.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? first : first;
 }
 function focusInvalid() { requestAnimationFrame(() => firstInvalid()?.focus()); }
 function validate() {
  const result = prepare(draft, stage, existing ? { id: existing.id, kind: existing.kind } : null, distinct, file, stages.filter(stage => stage.kind !== "placement").map(stage => stage.id));
  setErrors(result.errors);
  if (Object.keys(result.errors).length) { focusInvalid(); return null; }
  if (matches.length && !existing && !distinct) {
   setFailure({ ok: false, reason: "possible_duplicates", reference: {} }); return null;
  }
  return result.body;
 }
 async function submit() {
  if (busy.current || disabled) return;
  const body = validate(); if (!body || !file) { setConfirm(false); return; }
  busy.current = true; setPending(true); setFailure(null); sequence.current++;
  const signature = JSON.stringify(body);
  if (!intent.current || intent.current.signature !== signature || intent.current.file !== file) intent.current = { signature, file, key: crypto.randomUUID() };
  let result;
  try { result = await submitManualCandidate(vacancyId, body, file, intent.current.key); }
  catch { result = { ok: false, reason: "no_response", reference: {} } as const; }
  if (!alive.current) return;
  busy.current = false; setPending(false); setConfirm(false);
  if (result.ok) {
   busy.current = true;
   notifyActionResult({ key: "manual-intake", type: "success", title: "Candidato agregado", description: "Ya está en el proceso. No recibe ningún aviso." });
   succeeded.current = result.data.id;
   onSuccess(result.data); setOpen(false); return;
  }
  setFailure(result);
  if (result.reason === "possible_duplicates") { setMatches(result.matches ?? []); setDistinct(false); setExisting(null); }
  if (result.fields) { setErrors(serverErrors(result.fields)); focusInvalid(); }
  if (result.reason.startsWith("cv_")) { setErrors({ cv: failureMessage(result.reason) }); focusInvalid(); }
  notifyActionResult({ key: "manual-intake", type: "error", title: "No se pudo agregar", description: failureMessage(result.reason), reference: { ...result.reference, at: new Date().toISOString() } });
 }
 return <Sheet open={open} onOpenChange={next => { if (!next) close(); }} onOpenChangeComplete={next => { if (!next && succeeded.current) {
    const id = succeeded.current; onClose();
    // Let both nested modal focus scopes release before focusing the inserted card.
    setTimeout(() => document.getElementById(`candidate-card-${id}`)?.focus(), 0);
  } }}><SheetContent showCloseButton={false} className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[640px]" finalFocus={() => succeeded.current ? false : document.getElementById("manual-intake-open")}>
  <SheetHeader className="shrink-0 border-b"><div className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-foreground ring-1 ring-primary/40"><UserPlus aria-hidden="true" className="size-5" /></div><Button type="button" variant="ghost" size="icon" className="absolute top-4 right-4 size-10" aria-label="Cerrar formulario" disabled={pending} onClick={close}><X aria-hidden="true" /></Button><SheetTitle>Agregar candidato</SheetTitle><SheetDescription>Registra a una persona que no se postuló. No recibe ningún aviso.</SheetDescription></SheetHeader>
  <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
   <p className="mb-5 text-sm text-muted-foreground">* Obligatorio</p>
   <form id="manual-intake-form" noValidate onSubmit={event => { event.preventDefault(); if (!busy.current && !disabled && validate()) setConfirm(true); }}>
    <FieldSet disabled={pending || disabled} className="min-w-0 gap-5"><FieldLegend className="sr-only">Datos para el ingreso</FieldLegend>
     {existing && <Item variant="outline"><ItemContent><ItemTitle>{existing.full_name}</ItemTitle><ItemDescription>Usarás este registro sin modificar sus datos.</ItemDescription></ItemContent><ItemActions><Button type="button" variant="outline" className="min-h-10" onClick={() => { setExisting(null); setDistinct(false); setDirty(true); }}>Cambiar candidato</Button></ItemActions></Item>}
     {errors.existing && <FieldError tabIndex={-1} aria-invalid>{errors.existing}</FieldError>}
     {/* Remount on the new/existing switch: Chromium does not re-lay out a flex <fieldset> when the
         existing-record card is inserted before these fields, leaving stage and CV at zero height. */}
     <IntakeFields key={existing ? "existing" : "new"} draft={draft} onChange={change} errors={errors} stages={stages} stage={stage} onStage={value => { setStage(value); setDirty(true); }} existing={!!existing} file={file} onFile={value => { setFile(value); setDirty(true); if (value) setErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== "cv"))); }} onContactBlur={check} contactNotice={<>{checkNote && <p role="status" className="text-sm text-muted-foreground">{checkNote}</p>}{matches.length > 0 && !existing && !distinct && <section aria-label="Posibles coincidencias" className="flex flex-col gap-3 rounded-2xl border bg-muted/40 p-4"><h3 className="text-sm font-semibold">Posibles coincidencias</h3><p className="text-sm text-muted-foreground">Ya hay registros con estos datos en tu empresa. Tú decides cuál usar.</p><ItemGroup>{matches.map(match => <Item key={`${match.kind}-${match.id}`} variant="outline"><ItemContent><ItemTitle>{match.full_name}</ItemTitle><ItemDescription>{[match.email_masked, match.phone_masked, match.last_vacancy && `Última vacante: ${match.last_vacancy.title}`].filter(Boolean).join(" · ")}</ItemDescription>{match.in_this_process && <Badge variant="neutral">Ya está en este proceso</Badge>}</ItemContent><ItemActions><Button type="button" variant="outline" className="min-h-10" disabled={pending || match.in_this_process} onClick={() => { sequence.current++; setExisting(match); setDistinct(false); setDirty(true); setErrors({}); setFailure(null); }}>Usar el existente</Button></ItemActions></Item>)}</ItemGroup><Button type="button" variant="outline" className="min-h-10 w-fit" disabled={pending} onClick={() => { sequence.current++; setDistinct(true); setDirty(true); setFailure(null); }}>Es otra persona, crear</Button></section>}{distinct && <p role="status" className="text-sm">Crearás un registro de otra persona.</p>}</>} />
    </FieldSet>
   </form>
  </div>
  <SheetFooter className="shrink-0 border-t max-sm:[&_[data-pf-action-bar]]:flex-col max-sm:[&_[data-pf-action-bar-actions]]:self-end"><ActionBar status={pending ? <ActionStatus id="manual-intake-status" tone="info" text="Agregando candidato…" /> : Object.keys(errors).length ? <ActionStatus id="manual-intake-status" tone="error" text={Object.keys(errors).length === 1 ? "Revisa 1 dato marcado." : `Revisa ${Object.keys(errors).length} datos marcados.`} /> : failure ? <ActionStatus id="manual-intake-status" tone="error" text={failureMessage(failure.reason)} action={failure.participationId ? <Button type="button" variant="link" className="min-h-10" onClick={() => onViewExisting(failure.participationId!)}>Ver ficha</Button> : undefined} /> : null}><Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={close}>Cancelar</Button><Button id="manual-intake-submit" type="submit" form="manual-intake-form" className="min-h-10" disabled={pending || disabled} aria-describedby="manual-intake-status">{pending && <Spinner aria-hidden="true" />}{pending ? "Agregando…" : "Agregar candidato"}</Button></ActionBar></SheetFooter>
  <ConfirmActionDialog open={discard} onOpenChange={setDiscard} icon={Trash2} title="Tienes cambios sin guardar" description="Si cierras, perderás los datos que capturaste." cancelLabel="Seguir editando" confirmLabel="Descartar" tone="destructive" onConfirm={onClose} />
  <ConfirmActionDialog open={confirm} finalFocus={() => succeeded.current ? false : firstInvalid() ?? document.getElementById("manual-intake-submit")} onOpenChange={open => { if (!busy.current) setConfirm(open); }} icon={UserPlus} title={`¿Agregar a ${existing?.full_name ?? draft.full_name.trim()}?`} description={`Entrará a ${stages.find(value => value.id === stage)?.name ?? "la etapa elegida"}. No recibe ningún aviso.`} confirmLabel="Agregar" pendingLabel="Agregando…" pending={pending} confirmDisabled={disabled} onConfirm={() => void submit()} />
 </SheetContent></Sheet>;
}
