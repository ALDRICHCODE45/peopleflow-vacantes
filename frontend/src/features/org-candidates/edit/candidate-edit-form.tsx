"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { BriefcaseBusiness, ContactRound, GraduationCap, Languages, Link, MapPin, Pencil, RotateCcw, Tags, Trash2, TriangleAlert, type LucideIcon } from "lucide-react";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { LocationField } from "@/features/geo/location-field";
import { EducationFields } from "@/features/candidate/education-fields";
import { LanguageListEditor } from "@/features/languages/language-field";
import { SENIORITIES, SENIORITY_LABELS } from "@/features/candidate/model";
import { saveOrgCandidateEditAction } from "./edit-actions";
import { CandidateEditSummary } from "./candidate-edit-summary";
import { CANDIDATE_EDIT_CONFLICT_NOTICE, candidateEditErrors, candidateEditFailureMessage, sameEditValue, type CandidateEditBody, type CandidateEditField, type CandidateEditFailure, type EditableOrgCandidate } from "./edit-model";
import { candidateEditValues, copyDraftField, editedDraftFields, editValueLabel, educationSummary, originalEditValues, prepareCandidateEdit, valuesToEditDraft, type CandidateEditDraft } from "./edit-draft";

export type CandidateEditFormHandle = { /** Parent must route every Sheet close (X, Escape, outside) through this guard. */ requestClose: () => void };
type Props = { candidate: EditableOrgCandidate; onSaved: (detail: EditableOrgCandidate) => void; onCancel: () => void; onConflict: () => void | Promise<void> };
type Editor = { candidate: EditableOrgCandidate; draft: CandidateEditDraft; resets: CandidateEditField[]; undo: Partial<Record<CandidateEditField, CandidateEditDraft>>; warnings: Partial<Record<CandidateEditField, string>> };
const initialEditor = (candidate: EditableOrgCandidate): Editor => ({ candidate, draft: valuesToEditDraft(candidateEditValues(candidate)), resets: [], undo: {}, warnings: {} });
function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
 return <FieldSet><FieldLegend className="text-xs uppercase tracking-wide text-muted-foreground"><span className="flex items-center gap-2"><Icon aria-hidden="true" className="size-4" />{title}</span></FieldLegend><FieldGroup>{children}</FieldGroup></FieldSet>;
}

/** Mounted inside the existing Sheet, below its header; never mounts another Sheet. */
export const CandidateEditForm = forwardRef<CandidateEditFormHandle, Props>(function CandidateEditForm({ candidate, onSaved, onCancel, onConflict }, ref) {
 const [editor, setEditor] = useState(() => initialEditor(candidate));
 const [errors, setErrors] = useState<Record<string, string>>({});
 const [failure, setFailure] = useState<CandidateEditFailure | null>(null);
 const [pending, setPending] = useState(false);
 const [discard, setDiscard] = useState(false);
 const [confirmationBody, setConfirmationBody] = useState<CandidateEditBody | null>(null);
 const [conflicted, setConflicted] = useState(false);
 const [awaitingFresh, setAwaitingFresh] = useState(false);
 const form = useRef<HTMLFormElement>(null);
 const busy = useRef(false);
 const alive = useRef(true);
 const saved = useRef(false);
 const { draft } = editor;
 const dirty = editor.resets.length > 0 || editedDraftFields(valuesToEditDraft(candidateEditValues(editor.candidate)), draft).length > 0;
 useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
 useEffect(() => {
  if (!dirty) return;
  const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
  window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
 }, [dirty]);
 // A conflict refresh replaces the baseline/etag, not the user's intent. Untouched fields
 // adopt the new record; overlapping changes are shown for review, never auto-submitted.
 useEffect(() => {
  if (candidate.id === editor.candidate.id && candidate.kind === editor.candidate.kind && candidate.etag === editor.candidate.etag) return;
  setEditor(current => {
   if (candidate.id !== current.candidate.id || candidate.kind !== current.candidate.kind) return initialEditor(candidate);
   const oldValues = candidateEditValues(current.candidate); const freshValues = candidateEditValues(candidate);
   const touched = new Set([...editedDraftFields(valuesToEditDraft(oldValues), current.draft), ...current.resets]);
   let next = valuesToEditDraft(freshValues); const warnings: Editor["warnings"] = {};
   for (const field of touched) {
    next = copyDraftField(next, current.draft, field);
    if (!sameEditValue(oldValues[field], freshValues[field])) warnings[field] = field === "location" ? candidate.profile.location?.label ?? "Sin especificar" : editValueLabel(field, freshValues[field]);
   }
   return { ...current, candidate, draft: next, warnings };
  });
  setAwaitingFresh(false);
 }, [candidate, editor.candidate]);
 function requestClose() { if (busy.current) return; if (dirty && !saved.current) setDiscard(true); else onCancel(); }
 useImperativeHandle(ref, () => ({ requestClose }));
 function change(field: CandidateEditField, next: CandidateEditDraft) {
  if (busy.current) return;
  setEditor(current => ({ ...current, draft: next, resets: current.resets.filter(value => value !== field) }));
  setFailure(null);
 }
 function restore(field: CandidateEditField) {
  if (busy.current) return;
  setEditor(current => {
   const original = originalEditValues(current.candidate); if (!original) return current;
   if (current.resets.includes(field)) return { ...current, draft: copyDraftField(current.draft, current.undo[field] ?? valuesToEditDraft(candidateEditValues(current.candidate)), field), resets: current.resets.filter(value => value !== field) };
   return { ...current, draft: copyDraftField(current.draft, valuesToEditDraft(original), field), resets: [...current.resets, field], undo: { ...current.undo, [field]: current.draft } };
  });
 }
 const issues = Object.entries(errors).map(([path, message]) => ({ path, message }));
 function firstInvalid() {
  const first = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
  return first?.hasAttribute("data-edit-collection") ? first.querySelector<HTMLElement>('[aria-invalid="true"]:is(input,button,select,textarea)') ?? first.querySelector<HTMLElement>('[data-pf-profile-field]:not(:disabled)') ?? first.querySelector<HTMLElement>('button:not(:disabled)') ?? first : first;
 }
 function focusInvalid() { requestAnimationFrame(() => firstInvalid()?.focus()); }
 function validate() {
  const result = prepareCandidateEdit(editor.candidate, draft, editor.resets); setErrors(result.errors);
  if (Object.keys(result.errors).length) { focusInvalid(); return null; }
  return Object.keys(result.body.set).length || result.body.reset?.length ? result.body : null;
 }
 async function reloadConflict() {
  setAwaitingFresh(true);
  try { await onConflict(); } catch { /* Keep the draft and require a successful read before saving. */ }
 }
 async function submit() {
  if (busy.current || awaitingFresh || !confirmationBody) return;
  const body = confirmationBody;
  busy.current = true; setPending(true); setFailure(null);
  let result;
  try { result = await saveOrgCandidateEditAction({ kind: editor.candidate.kind, id: editor.candidate.id }, editor.candidate.etag, body); }
  catch { result = { ok: false, reason: "no_response", reference: {} } as const; }
  if (!alive.current) return;
  busy.current = false; setPending(false); setConfirmationBody(null);
  if (result.ok) {
   saved.current = true;
   notifyActionResult({ key: "candidate-edit", type: "success", title: "Cambios guardados", description: editor.candidate.kind === "organic" ? "Los datos se actualizaron solo para tu empresa." : "Los cambios quedaron en el historial de cambios del candidato." });
   onSaved(result.data); return;
  }
  setFailure(result);
  if (result.fields) { setErrors(candidateEditErrors(result.fields)); focusInvalid(); }
  notifyActionResult({ key: "candidate-edit", type: "error", title: result.reason === "precondition_failed" ? "Esto cambió en otro lugar" : "No se guardaron los cambios", description: candidateEditFailureMessage(result.reason), reference: { ...result.reference, at: new Date().toISOString() } });
  if (result.reason === "precondition_failed") { setConflicted(true); await reloadConflict(); }
 }
 function reference(field: CandidateEditField) {
  const original = originalEditValues(editor.candidate);
  const corrected = editor.candidate.kind === "organic" && editor.candidate.corrected_fields.includes(field);
  let originalLabel = original ? editValueLabel(field, original[field]) : "Sin especificar";
  if (field === "education" && editor.candidate.original) originalLabel = educationSummary(editor.candidate.original.profile);
  if (field === "location" && editor.candidate.original) originalLabel = editor.candidate.original.profile.location?.label ?? "Sin especificar";
  const restoring = editor.resets.includes(field);
  return <>
   {/* One layout child keeps Field's *:w-full off the badge and inline action. */}
   {original && (corrected || field === "education") && <div data-edit-correction className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
    {corrected && <Badge variant="accent">Corregido</Badge>}
    <FieldDescription className="min-w-0 max-w-full break-words">Original: {originalLabel}</FieldDescription>
    {restoring && <FieldDescription className="min-w-0 max-w-full break-words">Se restaurará el original al guardar</FieldDescription>}
    {corrected && <Button type="button" variant="link" className="min-h-10 w-fit px-0" disabled={pending} onClick={() => restore(field)}><RotateCcw aria-hidden="true" data-icon="inline-start" />{restoring ? "Deshacer restauración" : "Restaurar original"}</Button>}
   </div>}
   {editor.warnings[field] && <FieldDescription id={`edit-${field}-conflict`}><span className="flex items-center gap-2 text-status-review"><TriangleAlert aria-hidden="true" className="size-4 shrink-0" />Alguien más cambió este dato</span><span className="block break-words">Valor guardado: {editor.warnings[field]}</span></FieldDescription>}
  </>;
 }
 function scalar(field: Exclude<CandidateEditField, "location" | "education" | "languages" | "seniority"> | "dial", label: string, type = "text") {
  const key = field === "dial" ? "phone" : field; const id = `edit-${field}`;
  const invalid = !!errors[field] || (["email", "phone"].includes(field) && !!errors.contact);
  const describedBy = [errors[field] && `${id}-error`, errors.contact && ["email", "phone"].includes(field) && "edit-contact-error", editor.warnings[key] && `edit-${key}-conflict`, field === "skills" && "edit-skills-help", field === "years_of_experience" && "edit-years-help"].filter(Boolean).join(" ") || undefined;
  const props = { id, value: draft[field], className: "min-h-10", "aria-invalid": invalid, "aria-describedby": describedBy, onChange: (event: { target: { value: string } }) => change(key, { ...draft, [field]: event.target.value }) };
  return <Field data-invalid={invalid}><FieldLabel htmlFor={id}>{label}</FieldLabel>{field === "skills" ? <Textarea {...props} /> : <Input {...props} type={type} inputMode={field === "years_of_experience" ? "decimal" : undefined} />}
   {field === "skills" && <FieldDescription id="edit-skills-help">Separa las habilidades con comas o saltos de línea. Máximo 30.</FieldDescription>}
   {field === "years_of_experience" && <FieldDescription id="edit-years-help">Puedes usar decimales, por ejemplo 1.5.</FieldDescription>}
   {errors[field] && <FieldError id={`${id}-error`}>{errors[field]}</FieldError>}{field !== "dial" && reference(field)}
  </Field>;
 }
 const seniorities = [{ value: "", label: "Sin especificar" }, ...SENIORITIES.map(value => ({ value, label: SENIORITY_LABELS[value] }))];
 return <>
  <form ref={form} noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); if (!busy.current && !awaitingFresh) setConfirmationBody(validate()); }}>
   <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
    <FieldSet disabled={pending} className="min-w-0"><FieldLegend className="sr-only">Editar datos del candidato</FieldLegend><FieldGroup>
     {conflicted && <p role="status" className="flex items-start gap-2 text-sm text-status-review"><TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span>{CANDIDATE_EDIT_CONFLICT_NOTICE}</span></p>}
     <Section title="Contacto" icon={ContactRound}>
      {scalar("full_name", "Nombre completo")}<FieldDescription>Agrega al menos un correo o un teléfono; puedes incluir ambos.</FieldDescription>
      {scalar("email", "Correo electrónico", "email")}<FieldGroup className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">{scalar("dial", "Lada de país", "tel")}{scalar("phone", "Teléfono", "tel")}</FieldGroup>
      {errors.contact && <FieldError id="edit-contact-error">{errors.contact}</FieldError>}
      <FieldDescription>México: +52 y 10 dígitos. Otros países: lada y número, de 8 a 15 dígitos en total.</FieldDescription>
     </Section><Separator />
     <Section title="Ubicación" icon={MapPin}><LocationField label="Ubicación" hideLegend value={draft.location} onChange={location => change("location", { ...draft, location })} depth="municipality" postalCode defaultCountry={null} disabled={pending} required={draft.location.country === "MX" ? ["country", "state", "municipality"] : ["country"]} errors={issues.filter(issue => issue.path.startsWith("location.")).map(issue => ({ field: issue.path.slice(9), reason: "unknown" as const, message: issue.message }))} />{reference("location")}</Section><Separator />
     <Section title="Perfil profesional" icon={BriefcaseBusiness}>
      {scalar("professional_title", "Título profesional")}{scalar("current_company", "Empresa actual")}
      <Field data-invalid={!!errors.seniority}><FieldLabel htmlFor="edit-seniority">Seniority</FieldLabel><Select items={seniorities} value={draft.seniority || null} disabled={pending} onValueChange={seniority => change("seniority", { ...draft, seniority: seniority ?? "" })}><SelectTrigger id="edit-seniority" className="min-h-10 w-full" aria-invalid={!!errors.seniority} aria-describedby={errors.seniority ? "edit-seniority-error" : undefined}><SelectValue placeholder="Sin especificar" /></SelectTrigger><SelectContent><SelectGroup>{seniorities.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select>{errors.seniority && <FieldError id="edit-seniority-error">{errors.seniority}</FieldError>}{reference("seniority")}</Field>
      {scalar("years_of_experience", "Años de experiencia")}
     </Section><Separator />
     <Section title="Estudios" icon={GraduationCap}><div data-edit-collection aria-invalid={!!errors.education} tabIndex={errors.education ? -1 : undefined}><EducationFields embedded value={draft.education} disabled={pending} issues={issues} onChange={education => change("education", { ...draft, education })} /></div>{reference("education")}</Section><Separator />
     <Section title="Idiomas" icon={Languages}><div data-edit-collection aria-invalid={!!errors.languages} tabIndex={errors.languages ? -1 : undefined}><LanguageListEditor value={draft.languages} disabled={pending} issues={issues} onChange={languages => change("languages", { ...draft, languages })} /></div>{reference("languages")}</Section><Separator />
     <Section title="Habilidades" icon={Tags}>{scalar("skills", "Habilidades")}</Section><Separator />
     <Section title="Enlaces" icon={Link}>{scalar("linkedin_url", "LinkedIn", "url")}{scalar("portfolio_url", "Portafolio", "url")}</Section>
    </FieldGroup></FieldSet>
   </div>
   <SheetFooter className="shrink-0 border-t max-sm:[&_[data-pf-action-bar]]:flex-col max-sm:[&_[data-pf-action-bar-actions]]:self-end"><ActionBar status={pending ? <ActionStatus id="candidate-edit-status" tone="info" text="Guardando cambios…" /> : awaitingFresh ? <ActionStatus id="candidate-edit-status" tone="error" text="Actualiza los datos para continuar." action={<Button type="button" variant="link" className="min-h-10" onClick={() => void reloadConflict()}>Actualizar datos</Button>} /> : Object.keys(errors).length ? <ActionStatus id="candidate-edit-status" tone="error" text="Revisa los datos marcados." /> : failure && failure.reason !== "precondition_failed" ? <ActionStatus id="candidate-edit-status" tone="error" text={candidateEditFailureMessage(failure.reason)} /> : conflicted ? <ActionStatus id="candidate-edit-status" tone="info" text="Revisa los datos antes de guardar." /> : null}>
    <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={requestClose}>Cancelar</Button><Button id="candidate-edit-save" type="submit" className="min-h-10" disabled={pending || awaitingFresh || !dirty} aria-busy={pending} aria-describedby="candidate-edit-status">{pending && <Spinner aria-hidden="true" data-icon="inline-start" />}{pending ? "Guardando…" : "Guardar cambios"}</Button>
   </ActionBar></SheetFooter>
  </form>
  <ConfirmActionDialog open={discard} onOpenChange={setDiscard} icon={Trash2} title="Tienes cambios sin guardar" description="Si cierras, perderás los datos que capturaste." cancelLabel="Seguir editando" confirmLabel="Descartar" tone="destructive" onConfirm={onCancel} />
  <ConfirmActionDialog open={confirmationBody !== null} onOpenChange={open => { if (!open) setConfirmationBody(null); }} finalFocus={() => saved.current ? false : firstInvalid() ?? document.getElementById("candidate-edit-save")} icon={Pencil} title={`¿Guardar cambios de ${confirmationBody?.set.full_name ?? draft.full_name.trim()}?`} description={editor.candidate.kind === "organic" ? "Solo se actualizarán los datos de tu empresa. El perfil del candidato no cambia." : "Los cambios quedarán en el historial de cambios del candidato."} confirmLabel="Guardar cambios" pendingLabel="Guardando…" pending={pending} onConfirm={() => void submit()}>
   {confirmationBody && <CandidateEditSummary body={confirmationBody} />}
  </ConfirmActionDialog>
 </>;
});
