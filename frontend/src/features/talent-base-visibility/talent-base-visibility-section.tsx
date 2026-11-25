"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Library, TriangleAlert, X } from "lucide-react";
import { notifyActionResult } from "@/components/feedback/notify";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ChoiceList } from "@/components/ui/choice-list";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { DraftLeaveGuard, LeaveConfirmDialog, type LeavePrompt } from "@/features/jobs/drafts/ui/draft-leave-guard";
import { SettingsRow } from "@/features/employer-settings/settings-row";
import { listTeamMembersAction } from "@/features/employer-team/actions";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { loadTalentBaseVisibilityAction, saveTalentBaseVisibilityAction } from "./actions";
import { TALENT_BASE_MODES, type TalentBaseFailure, type TalentBaseMode, type TalentBaseVisibility } from "./model";

type Recruiter = { id: string; name: string; email: string };
type Notice = { lines: string[]; reload?: boolean; login?: boolean };
type State =
  | { kind: "loading" | "error" }
  | { kind: "ready"; saved: TalentBaseVisibility; recruiters: Recruiter[] };

const MODE_COPY: Record<TalentBaseMode, { title: string; description: string }> = {
  all_recruiters: { title: "Todos los reclutadores", description: "Cualquier reclutador de tu empresa puede usar la Base de talento." },
  selected_users: { title: "Usuarios seleccionados", description: "Solo los reclutadores que elijas. Los demás siguen viendo desde el tablero a los candidatos de sus vacantes." },
};
const ROW_ERRORS = {
  viewer_not_member: "Ya no es parte de la empresa",
  viewer_is_owner: "Ahora es dueño: ya tiene acceso",
  validation_error: "Aparece repetido en la selección",
} as const;
const EMPTY_WARNING = "Solo el dueño verá la Base de talento. Ningún reclutador tendrá acceso hasta que elijas a alguien.";
const LOAD_FAILED = "No pudimos cargar quién ve la Base de talento. Puedes volver a intentarlo.";
const SHEET_DESCRIPTION = "Define quién puede usar la búsqueda global, el detalle de candidatos fuera de una vacante, los CV de la base y la exportación de contactos.";
const ROW_DESCRIPTION = "Quién puede usar la búsqueda global, los CV de la base y la exportación de contactos.";
/** One wording for closing the sheet, following a link and the browser's Back with unsaved choices. */
const LEAVE_PROMPT: LeavePrompt = {
  title: "¿Salir sin guardar los cambios?",
  description: "Cambiaste quién ve la Base de talento y todavía no lo guardas. Si sales ahora, se pierden.",
  cancelLabel: "Seguir editando",
  confirmLabel: "Descartar cambios",
};
/** The shared list stacks «Seleccionar todo» over its count; here the count sits on the same line, at the end (artboard `settings-redesign/02`). */
const SELECT_ALL_LINE = "[&_[aria-labelledby$='-all']>span:first-child]:flex-row [&_[aria-labelledby$='-all']>span:first-child]:items-center [&_[aria-labelledby$='-all']>span:first-child]:justify-between [&_[aria-labelledby$='-all']>span:first-child]:gap-3";
const UNCONFIRMED = "No pudimos confirmar si el cambio se guardó. Inténtalo de nuevo; si ya estaba guardado te avisaremos.";

/** Viewers that are no longer selectable recruiters (offboarded or promoted) drop out of the draft. */
const viewerIds = (document: TalentBaseVisibility, recruiters: readonly Recruiter[]) =>
  document.viewers.map(viewer => viewer.user_id).filter(id => recruiters.some(recruiter => recruiter.id === id));
const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => Array.from(word)[0]).join("").toLocaleUpperCase("es-MX");
/** What the row shows as the current value: the mode, and for a selection how many recruiters (none = only the owner). */
const summary = (document: TalentBaseVisibility, recruiters: readonly Recruiter[]) => {
  if (document.mode === "all_recruiters") return MODE_COPY.all_recruiters.title;
  const count = viewerIds(document, recruiters).length;
  return count === 0 ? "Solo el dueño" : count === 1 ? "1 reclutador" : `${count} reclutadores`;
};
const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(id => b.includes(id));
const describe = (document: TalentBaseVisibility) => document.mode === "all_recruiters" ? MODE_COPY.all_recruiters.title
  : `${MODE_COPY.selected_users.title} (${document.viewers.length ? document.viewers.map(viewer => viewer.full_name).join(", ") : "solo el dueño"})`;

function noticeFor(failure: TalentBaseFailure): Notice {
  switch (failure.reason) {
    case "version_conflict": return { lines: [
      "Alguien más cambió esta configuración mientras la editabas.",
      ...(failure.document ? [`Ahora mismo: ${describe(failure.document)}.`, "Conservamos tu selección; revísala y vuelve a guardar."] : ["Vuelve a cargarla para ver el estado actual."]),
    ], reload: !failure.document };
    case "viewer_not_member": return { lines: ["Alguien de tu selección ya no pertenece a la empresa. Quítalo para guardar."] };
    case "viewer_is_owner": return { lines: ["El dueño siempre ve la Base de talento y no se puede seleccionar. Quita a esa persona para guardar."] };
    case "validation_error": {
      const lines = [
        ...(failure.fields?.includes("mode") ? ["Elige quién puede ver la Base de talento."] : []),
        ...(failure.fields?.includes("user_ids") ? ["La selección de usuarios no es válida."] : []),
      ];
      return { lines: lines.length ? lines : ["Revisa la selección e inténtalo de nuevo."] };
    }
    case "users_not_applicable": return { lines: ["«Todos los reclutadores» no lleva usuarios elegidos. Recarga la configuración e inténtalo de nuevo."], reload: true };
    case "forbidden": return { lines: ["Solo el dueño puede cambiar quién ve la Base de talento. Tu rol pudo haber cambiado; recarga la página."] };
    case "unauthenticated": return { lines: ["Tu sesión expiró. Inicia sesión en otra pestaña; tu selección sigue aquí."], login: true };
    case "invalid_request": return { lines: ["No pudimos enviar el cambio. Recarga la página e inténtalo de nuevo."] };
    default: return { lines: [UNCONFIRMED] };
  }
}

/**
 * «Base de talento visible para» as one settings row (owner only: the page does not render it for anyone else). The row shows the
 * current mode and opens a sheet (bottom sheet on phones) with the ChoiceList, the recruiter list and its own save. Closing the sheet
 * with changes asks first, and the browser-level leave guard stays active while there are unsaved choices.
 */
export function TalentBaseVisibilityRow() {
  const isMobile = useIsMobile();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [mode, setMode] = useState<TalentBaseMode>("all_recruiters");
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  // A conflict without the current document leaves no version to retry against until the owner reloads.
  const [stale, setStale] = useState(false);
  const submitting = useRef(false);

  const load = useCallback(async (isActive: () => boolean) => {
    // A failed read takes the editor away, so an open sheet and its question go with it.
    const adopt = (next: State) => { if (isActive()) { setState(next); if (next.kind === "error") { setOpen(false); setConfirmDiscard(false); } } };
    try {
      const [document, team] = await Promise.all([loadTalentBaseVisibilityAction(), listTeamMembersAction()]);
      if (!document.ok || !team.ok) return adopt({ kind: "error" });
      const recruiters = team.members.flatMap(member => member.role === "recruiter" && member.user ? [{ id: member.user.id, name: member.user.full_name, email: member.user.email }] : []);
      if (!isActive()) return;
      setMode(document.document.mode);
      setSelected(viewerIds(document.document, recruiters));
      setNotice(null); setRowErrors({}); setLocked(false); setStale(false);
      setState({ kind: "ready", saved: document.document, recruiters });
    } catch { adopt({ kind: "error" }); }
  }, []);
  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => { active = false; };
  }, [load]);
  // «Volver a cargar» inside the sheet keeps it open (and mounted) until the new setting arrives.
  const reload = () => { if (!open) setState({ kind: "loading" }); void load(() => true); };

  const ready = state.kind === "ready" ? state : null;
  const baseline = ready ? viewerIds(ready.saved, ready.recruiters) : [];
  const dirty = !!ready && (mode !== ready.saved.mode || (mode === "selected_users" && !sameIds(selected, baseline)));
  const emptySelection = mode === "selected_users" && selected.length === 0;
  const disabled = pending || locked;

  /** Back to what is saved: what the sheet always starts from and what «Descartar cambios» returns to. */
  function resetDraft() {
    if (!ready) return;
    setMode(ready.saved.mode);
    setSelected(viewerIds(ready.saved, ready.recruiters));
    setNotice(null); setRowErrors({});
  }
  function openSheet() { resetDraft(); setOpen(true); }
  function requestClose() {
    if (submitting.current) return;
    if (dirty) setConfirmDiscard(true);
    else setOpen(false);
  }

  function choose(next: string[]) {
    // Clear the row error of whoever was toggled; the rest keep theirs until the next save.
    const changed = new Set([...next.filter(id => !selected.includes(id)), ...selected.filter(id => !next.includes(id))]);
    setSelected(next);
    setRowErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => !changed.has(key))));
  }

  async function submit() {
    if (!ready || submitting.current || !dirty || locked || stale) return;
    submitting.current = true;
    setPending(true); setNotice(null); setRowErrors({});
    const ordered = ready.recruiters.map(recruiter => recruiter.id).filter(id => selected.includes(id));
    let result: Awaited<ReturnType<typeof saveTalentBaseVisibilityAction>>;
    try { result = await saveTalentBaseVisibilityAction({ mode, userIds: mode === "selected_users" ? ordered : [], version: ready.saved.version }); }
    catch { result = { ok: false, reason: "no_response", reference: {} }; }
    submitting.current = false;
    setPending(false);
    if (result.ok) {
      setState({ kind: "ready", saved: result.document, recruiters: ready.recruiters });
      setMode(result.document.mode);
      setSelected(viewerIds(result.document, ready.recruiters));
      setOpen(false);
      notifyActionResult({ key: "talent-base-visibility", type: "success", title: "Cambio guardado", description: "Quién ve la Base de talento ya está actualizado. Queda registrado en la auditoría." });
      return;
    }
    setNotice(noticeFor(result));
    const reason = result.reason;
    if (reason === "viewer_not_member" || reason === "viewer_is_owner" || reason === "validation_error")
      setRowErrors(Object.fromEntries((result.userIds ?? []).map(id => [id, ROW_ERRORS[reason]])));
    if (reason === "forbidden") setLocked(true);
    if (reason === "version_conflict" && !result.document) setStale(true);
    // A conflict hands over the current document: adopt its version, keep what the owner chose.
    if (reason === "version_conflict" && result.document) setState({ kind: "ready", saved: result.document, recruiters: ready.recruiters });
  }

  const loadFailed = state.kind === "error";
  return (
    <SettingsRow id="pf-talent-base-title" icon={Library} title="Base de talento visible para" description={ROW_DESCRIPTION}
      value={ready ? summary(ready.saved, ready.recruiters) : state.kind === "loading" ? <Skeleton aria-hidden="true" className="h-5 w-28" /> : undefined}
      note={state.kind === "loading" ? <span role="status" className="sr-only">Cargando visibilidad de la Base de talento</span>
        : loadFailed ? <p role="alert" className="text-sm text-destructive">{LOAD_FAILED}</p> : undefined}>
      {loadFailed && <Button type="button" variant="outline" className="min-h-10" onClick={reload}>Reintentar</Button>}
      {ready && <Button type="button" variant="outline" className="min-h-10" aria-haspopup="dialog" aria-describedby="pf-talent-base-title" onClick={openSheet}>Cambiar</Button>}
      {ready && <Sheet open={open} onOpenChange={next => { if (!next) requestClose(); }}>
        <SheetContent side={isMobile ? "bottom" : "right"} showCloseButton={false} className="gap-0 data-[side=right]:w-full">
          {/* Unsaved choices: the browser warns on reload/close and in-app links and Back ask first. Nested here so its dialog stacks above the sheet. */}
          <DraftLeaveGuard dirty={dirty} prompt={LEAVE_PROMPT} />
          <SheetHeader className="border-b pr-16">
            <SheetTitle>Base de talento visible para</SheetTitle>
            <SheetDescription>{SHEET_DESCRIPTION}</SheetDescription>
            <SheetClose render={<Button type="button" variant="ghost" size="icon" aria-label="Cerrar" className="absolute top-4 right-4 size-10 bg-secondary" />}><X aria-hidden="true" /></SheetClose>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4 max-md:px-4">
            <ChoiceList legend="Quién ve la Base de talento" hideLegend value={mode} disabled={disabled}
              onValueChange={value => { if (TALENT_BASE_MODES.includes(value as TalentBaseMode)) setMode(value as TalentBaseMode); }}
              options={TALENT_BASE_MODES.map(item => ({ value: item, title: MODE_COPY[item].title, description: MODE_COPY[item].description }))} />
            {mode === "selected_users" && (ready.recruiters.length === 0
              ? <p className="text-sm text-muted-foreground">Todavía no hay reclutadores en tu empresa. Invítalos desde Equipo.</p>
              : <ChoiceList multiple legend="Reclutadores con acceso" className={SELECT_ALL_LINE} disabled={disabled} value={selected} onValueChange={choose}
                options={ready.recruiters.map(recruiter => ({
                  value: recruiter.id, title: recruiter.name, description: recruiter.email, error: rowErrors[recruiter.id],
                  leading: isMobile ? <Avatar><AvatarFallback className="text-xs font-medium text-foreground">{initials(recruiter.name)}</AvatarFallback></Avatar> : undefined,
                }))} />)}
            {emptySelection && <p className="flex items-start gap-2 text-sm text-status-review"><TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{EMPTY_WARNING}</p>}
            <div className="flex flex-col gap-1 text-[12.5px] text-muted-foreground">
              <p>El dueño siempre tiene acceso a la Base de talento.</p>
              <p>Cada cambio queda registrado en la auditoría de la empresa.</p>
            </div>
            {notice && <div role="alert" className="flex flex-col gap-2 text-sm text-destructive">
              {notice.lines.map(line => <p key={line}>{line}</p>)}
              {(notice.reload || notice.login) && <div className="flex gap-2">
                {notice.reload && <Button type="button" variant="outline" className="min-h-10" onClick={reload}>Volver a cargar</Button>}
                {notice.login && <Link href="/empresa/login" target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", className: "min-h-10" }))}>Iniciar sesión</Link>}
              </div>}
            </div>}
          </div>
          <SheetFooter className="flex-row flex-wrap items-center justify-end border-t max-md:px-4 max-md:pb-4 [&>[data-slot=button]]:max-md:min-h-11 [&>[data-slot=button]]:max-md:flex-1">
            <span role="status" className="order-first flex min-h-5 basis-full items-center">{dirty && <Badge variant="review" dot>Cambios sin guardar</Badge>}</span>
            <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={requestClose}>Cancelar</Button>
            <Button type="button" className="min-h-10" disabled={!dirty || disabled || stale} aria-busy={pending} onClick={() => void submit()}>
              {pending && <Spinner data-icon="inline-start" aria-hidden="true" />}{pending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </SheetFooter>
          <LeaveConfirmDialog open={confirmDiscard} onOpenChange={setConfirmDiscard} prompt={LEAVE_PROMPT}
            onConfirm={() => { setConfirmDiscard(false); resetDraft(); setOpen(false); }} />
        </SheetContent>
      </Sheet>}
    </SettingsRow>
  );
}
