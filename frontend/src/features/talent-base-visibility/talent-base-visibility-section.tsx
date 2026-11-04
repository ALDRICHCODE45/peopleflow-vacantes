"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Library, TriangleAlert } from "lucide-react";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { loadCompanyStateAction } from "@/features/employer-company/actions";
import { listTeamMembersAction } from "@/features/employer-team/actions";
import { cn } from "@/lib/utils";
import { loadTalentBaseVisibilityAction, saveTalentBaseVisibilityAction } from "./actions";
import { TALENT_BASE_MODES, type TalentBaseFailure, type TalentBaseMode, type TalentBaseVisibility } from "./model";

type Recruiter = { id: string; name: string; email: string };
type Notice = { lines: string[]; reload?: boolean; login?: boolean };
type State =
  | { kind: "resolving" | "hidden" | "loading" | "error" }
  | { kind: "ready"; saved: TalentBaseVisibility; recruiters: Recruiter[] };

const MODE_COPY: Record<TalentBaseMode, { title: string; description: string }> = {
  all_recruiters: { title: "Todos los reclutadores", description: "Cualquier reclutador de tu empresa puede usar la Base de talento." },
  selected_users: { title: "Usuarios seleccionados", description: "Solo los reclutadores que elijas. Los demás siguen viendo desde el tablero a los candidatos de sus vacantes." },
};
const ROW_ERRORS = {
  viewer_not_member: "Ya no es parte de la empresa",
  viewer_is_owner: "Ahora es owner: ya tiene acceso",
  validation_error: "Aparece repetido en la selección",
} as const;
const EMPTY_WARNING = "Solo el owner verá la Base de talento. Ningún reclutador tendrá acceso hasta que elijas a alguien.";
const LOAD_FAILED = "No pudimos cargar quién ve la Base de talento. Puedes volver a intentarlo.";
const SAVED = "Cambio guardado · queda registrado en la auditoría";
const UNCONFIRMED = "No pudimos confirmar si el cambio se guardó. Inténtalo de nuevo; si ya estaba guardado te avisaremos.";

/** Viewers that are no longer selectable recruiters (offboarded or promoted) drop out of the draft. */
const viewerIds = (document: TalentBaseVisibility, recruiters: readonly Recruiter[]) =>
  document.viewers.map(viewer => viewer.user_id).filter(id => recruiters.some(recruiter => recruiter.id === id));
const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(id => b.includes(id));
const describe = (document: TalentBaseVisibility) => document.mode === "all_recruiters" ? MODE_COPY.all_recruiters.title
  : `${MODE_COPY.selected_users.title} (${document.viewers.length ? document.viewers.map(viewer => viewer.full_name).join(", ") : "solo el owner"})`;

function noticeFor(failure: TalentBaseFailure): Notice {
  switch (failure.reason) {
    case "version_conflict": return { lines: [
      "Alguien más cambió esta configuración mientras la editabas.",
      ...(failure.document ? [`Ahora mismo: ${describe(failure.document)}.`, "Conservamos tu selección; revísala y vuelve a guardar."] : ["Vuelve a cargarla para ver el estado actual."]),
    ], reload: !failure.document };
    case "viewer_not_member": return { lines: ["Alguien de tu selección ya no pertenece a la empresa. Quítalo para guardar."] };
    case "viewer_is_owner": return { lines: ["El owner siempre ve la Base de talento y no se puede seleccionar. Quita a esa persona para guardar."] };
    case "validation_error": {
      const lines = [
        ...(failure.fields?.includes("mode") ? ["Elige quién puede ver la Base de talento."] : []),
        ...(failure.fields?.includes("user_ids") ? ["La selección de usuarios no es válida."] : []),
      ];
      return { lines: lines.length ? lines : ["Revisa la selección e inténtalo de nuevo."] };
    }
    case "users_not_applicable": return { lines: ["«Todos los reclutadores» no lleva usuarios elegidos. Recarga la configuración e inténtalo de nuevo."], reload: true };
    case "forbidden": return { lines: ["Solo el owner puede cambiar quién ve la Base de talento. Tu rol pudo haber cambiado; recarga la página."] };
    case "unauthenticated": return { lines: ["Tu sesión expiró. Inicia sesión en otra pestaña; tu selección sigue aquí."], login: true };
    case "invalid_request": return { lines: ["No pudimos enviar el cambio. Recarga la página e inténtalo de nuevo."] };
    default: return { lines: [UNCONFIRMED] };
  }
}

export function TalentBaseVisibilitySection() {
  const [state, setState] = useState<State>({ kind: "resolving" });
  const [mode, setMode] = useState<TalentBaseMode>("all_recruiters");
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  // A conflict without the current document leaves no version to retry against until the owner reloads.
  const [stale, setStale] = useState(false);
  const submitting = useRef(false);

  const load = useCallback(async (isActive: () => boolean) => {
    const adopt = (next: State) => { if (isActive()) setState(next); };
    try {
      const company = await loadCompanyStateAction();
      // Owner only: any other membership (or an unknown one) renders nothing and reads nothing else.
      if (company.kind !== "exists" || company.role !== "owner") return adopt({ kind: "hidden" });
      if (isActive()) setState({ kind: "loading" });
      const [document, team] = await Promise.all([loadTalentBaseVisibilityAction(), listTeamMembersAction()]);
      if (!document.ok || !team.ok) return adopt({ kind: "error" });
      const recruiters = team.members.flatMap(member => member.role === "recruiter" && member.user ? [{ id: member.user.id, name: member.user.full_name, email: member.user.email }] : []);
      if (!isActive()) return;
      setMode(document.document.mode);
      setSelected(viewerIds(document.document, recruiters));
      setNotice(null); setRowErrors({}); setSaved(false); setLocked(false); setStale(false);
      setState({ kind: "ready", saved: document.document, recruiters });
    } catch { adopt({ kind: "error" }); }
  }, []);
  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => { active = false; };
  }, [load]);
  const reload = () => { setState({ kind: "loading" }); void load(() => true); };

  if (state.kind === "resolving" || state.kind === "hidden") return null;

  const ready = state.kind === "ready" ? state : null;
  const baseline = ready ? viewerIds(ready.saved, ready.recruiters) : [];
  const dirty = !!ready && (mode !== ready.saved.mode || (mode === "selected_users" && !sameIds(selected, baseline)));
  const emptySelection = mode === "selected_users" && selected.length === 0;
  const disabled = pending || locked;

  function toggle(id: string, checked: boolean) {
    setSelected(current => checked ? (current.includes(id) ? current : [...current, id]) : current.filter(item => item !== id));
    setRowErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)));
    setSaved(false);
  }

  async function submit() {
    if (!ready || submitting.current || !dirty || locked || stale) return;
    submitting.current = true;
    setPending(true); setNotice(null); setRowErrors({}); setSaved(false);
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
      setSaved(true);
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

  return (
    <section aria-labelledby="talent-base-heading" id="empresa-base-talento">
      <Card>
        <CardHeader className="border-b border-border/60">
          <CardTitle><h2 id="talent-base-heading" className="flex items-center gap-3 text-xl font-semibold"><span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Library className="size-5" /></span>Base de talento visible para</h2></CardTitle>
          <CardDescription>Define quién puede usar la búsqueda global, el detalle de candidatos fuera de una vacante, los CV de la base y la exportación de contactos.</CardDescription>
        </CardHeader>
        <CardContent>
          {state.kind === "loading" && <div aria-busy="true" className="flex flex-col gap-3"><span role="status" className="sr-only">Cargando visibilidad de la Base de talento</span><Skeleton className="h-16 w-full" aria-hidden="true" /><Skeleton className="h-16 w-full" aria-hidden="true" /></div>}
          {state.kind === "error" && <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-destructive">{LOAD_FAILED}</p>
            <Button type="button" variant="outline" className="min-h-10" onClick={reload}>Reintentar</Button>
          </div>}
          {ready && <div className="flex flex-col gap-5">
            <RadioGroup aria-label="Quién ve la Base de talento" value={mode} disabled={disabled} onValueChange={value => { if (TALENT_BASE_MODES.includes(value as TalentBaseMode)) { setMode(value as TalentBaseMode); setSaved(false); } }}>
              {TALENT_BASE_MODES.map(item => <FieldLabel key={item} htmlFor={`talent-base-${item}`} className="box-border min-w-0 has-data-checked:ring-2 has-data-checked:ring-primary *:data-[slot=field]:p-3">
                <Field orientation="horizontal" className="min-w-0 gap-3">
                  <FieldContent className="min-w-0"><FieldTitle>{MODE_COPY[item].title}</FieldTitle><FieldDescription>{MODE_COPY[item].description}</FieldDescription></FieldContent>
                  <RadioGroupItem id={`talent-base-${item}`} value={item} />
                </Field>
              </FieldLabel>)}
            </RadioGroup>
            {mode === "selected_users" && <FieldSet disabled={disabled}>
              <FieldLegend variant="label">Reclutadores con acceso</FieldLegend>
              {ready.recruiters.length === 0
                ? <p className="text-sm text-muted-foreground">Todavía no hay reclutadores en tu empresa. Invítalos desde Equipo.</p>
                : <div className="flex flex-col gap-3">
                  {ready.recruiters.map(recruiter => {
                    const error = rowErrors[recruiter.id];
                    return <Field key={recruiter.id} orientation="horizontal" data-invalid={error ? true : undefined} className="items-start gap-3">
                      <Checkbox id={`talent-base-user-${recruiter.id}`} checked={selected.includes(recruiter.id)} disabled={disabled} aria-invalid={error ? true : undefined} aria-describedby={error ? `talent-base-user-${recruiter.id}-error` : undefined} onCheckedChange={checked => toggle(recruiter.id, checked)} />
                      <FieldContent>
                        <FieldLabel htmlFor={`talent-base-user-${recruiter.id}`}>{recruiter.name}</FieldLabel>
                        <FieldDescription>{recruiter.email}</FieldDescription>
                        {error && <p id={`talent-base-user-${recruiter.id}-error`} className="text-sm text-destructive">{error}</p>}
                      </FieldContent>
                    </Field>;
                  })}
                </div>}
            </FieldSet>}
            {emptySelection && <p className="flex items-start gap-2 text-sm text-status-review"><TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{EMPTY_WARNING}</p>}
            <div className="flex flex-col gap-1 text-[12.5px] text-muted-foreground">
              <p>El owner siempre tiene acceso a la Base de talento.</p>
              <p>Cada cambio queda registrado en la auditoría de la empresa.</p>
            </div>
            {notice && <div role="alert" className="flex flex-col gap-2 text-sm text-destructive">
              {notice.lines.map(line => <p key={line}>{line}</p>)}
              {(notice.reload || notice.login) && <div className="flex gap-2">
                {notice.reload && <Button type="button" variant="outline" className="min-h-10" onClick={reload}>Volver a cargar</Button>}
                {notice.login && <Link href="/empresa/login" target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", className: "min-h-10" }))}>Iniciar sesión</Link>}
              </div>}
            </div>}
          </div>}
        </CardContent>
        {ready && <CardFooter>
          <ActionBar status={saved ? <ActionStatus id="talent-base-status" tone="success" text={SAVED} /> : undefined}>
            <Button type="button" className="min-h-10" disabled={!dirty || disabled || stale} aria-busy={pending} onClick={() => void submit()}>
              {pending && <Spinner data-icon="inline-start" aria-hidden="true" />}{pending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </ActionBar>
        </CardFooter>}
      </Card>
    </section>
  );
}
