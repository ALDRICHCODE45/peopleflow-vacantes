"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, CircleAlert, Lock, MailX, RefreshCw, RotateCcw, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  getCandidatePreferencesAction, getPreferencesAction, updateCandidatePreferencesAction, updatePreferencesAction,
} from "../actions";
import { adjustmentLabel, CHANNEL_LABELS, lockedLabel, preferenceCopy, preferenceGroups, unsavedChangesLabel } from "../copy";
import {
  NOTIFICATION_CHANNELS, type NotificationChannel, type NotificationFailure, type NotificationPreferences as Catalog,
  type NotificationScope, type PreferenceEntry, type PreferenceItem,
} from "../model";

/** Fixed action pair per scope; bindings are read at call time so a test mock only needs the scope it exercises. */
const ACTIONS = {
  company: { get: () => getPreferencesAction(), update: (entries: PreferenceEntry[], catalog: Catalog) => updatePreferencesAction(entries, catalog) },
  candidate: { get: () => getCandidatePreferencesAction(), update: (entries: PreferenceEntry[], catalog: Catalog) => updateCandidatePreferencesAction(entries, catalog) },
} as const;

type Draft = Record<string, boolean>;
type Status = { kind: "saved" } | { kind: "error"; text: string } | null;
type Load = { status: "loading" } | { status: "error" } | { status: "ready"; saved: Catalog };

const pair = (type: string, channel: NotificationChannel) => `${type}:${channel}`;
const draftOf = (catalog: Catalog): Draft =>
  Object.fromEntries(catalog.items.flatMap(item => NOTIFICATION_CHANNELS.map(channel => [pair(item.type, channel), item.channels[channel].enabled])));
/** Unlocked pairs whose draft differs from the saved catalog: exactly what «Guardar cambios» sends. */
const changesOf = (saved: Catalog, draft: Draft): PreferenceEntry[] => saved.items.flatMap(item => NOTIFICATION_CHANNELS
  .filter(channel => !item.channels[channel].mandatory_locked && draft[pair(item.type, channel)] !== item.channels[channel].enabled)
  .map(channel => ({ type: item.type, channel, enabled: draft[pair(item.type, channel)] })));

function saveError(failure: NotificationFailure): string {
  if (failure.reason === "preference_locked") return "Algunos avisos son obligatorios y no se pueden apagar. Actualizamos la lista.";
  if (failure.reason === "unauthenticated") return "Tu sesión terminó. Inicia sesión de nuevo para guardar tus preferencias.";
  if (failure.reason === "forbidden") return "Tu cuenta no puede cambiar estas preferencias.";
  return "No pudimos guardar tus preferencias. Inténtalo de nuevo.";
}

/**
 * «Mis preferencias» (T4.2, design 05): every type of the caller's catalog × «En la app» and «Correo», grouped like the
 * inbox filter (members) or under «Tus postulaciones» (candidates). Locked pairs show on and disabled, with
 * «Obligatoria». Changes collect in design 05's save bar («N cambios sin guardar», «Descartar», «Guardar cambios»); a
 * save sends only the changed unlocked pairs and renders the PUT answer. A failed save keeps the unsaved choices for a
 * retry, and «Descartar» rolls them back to the last saved catalog; a 422 lock re-reads the catalog. Design 05's
 * «Resumen diario» and the address line are not built: digests are stage 3 and the API returns no address.
 */
export function NotificationPreferences({ scope }: { scope: NotificationScope }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const request = useRef(0);

  const read = useCallback(async () => {
    const id = ++request.current;
    const result = await ACTIONS[scope].get();
    if (id !== request.current) return;
    if (!result.ok) { setLoad(current => current.status === "ready" ? current : { status: "error" }); return; }
    setLoad({ status: "ready", saved: result.data });
    setDraft(draftOf(result.data));
  }, [scope]);

  useEffect(() => { void read(); }, [read]);

  if (load.status === "loading") return <PreferencesSkeleton />;
  if (load.status === "error") return <PreferencesError onRetry={() => { setLoad({ status: "loading" }); void read(); }} />;

  const { saved } = load;
  const changes = changesOf(saved, draft);
  const candidate = scope === "candidate";
  const anyLocked = saved.items.some(item => NOTIFICATION_CHANNELS.some(channel => item.channels[channel].mandatory_locked));

  const toggle = (type: string, channel: NotificationChannel, enabled: boolean) => {
    setDraft(current => ({ ...current, [pair(type, channel)]: enabled }));
    setStatus(null);
  };
  const discard = () => { setDraft(draftOf(saved)); setStatus(null); };
  const reset = () => {
    setDraft(current => ({ ...current, ...Object.fromEntries(saved.items.flatMap(item => NOTIFICATION_CHANNELS
      .filter(channel => !item.channels[channel].mandatory_locked)
      .map(channel => [pair(item.type, channel), item.channels[channel].default]))) }));
    setStatus(null);
  };
  const save = async () => {
    if (changes.length === 0 || saving) return;
    setSaving(true);
    setStatus(null);
    const result = await ACTIONS[scope].update(changes, saved);
    setSaving(false);
    if (result.ok) {
      request.current++;
      setLoad({ status: "ready", saved: result.data });
      setDraft(draftOf(result.data));
      setStatus({ kind: "saved" });
      return;
    }
    setStatus({ kind: "error", text: saveError(result) });
    if (result.reason === "preference_locked") void read();
  };

  return <div className="grid gap-6 pb-4">
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="grid gap-1">
        <h2 className="font-heading text-2xl font-semibold">Notificaciones</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          {candidate ? "Elige cómo te avisamos de tus postulaciones: en la app y por correo."
            : "Elige cómo te llegan los avisos: en la app y por correo. Lo obligatorio no se puede apagar y se muestra como tal."}
        </p>
      </div>
      <Button type="button" variant="outline" className="min-h-10" onClick={reset}><RotateCcw aria-hidden="true" data-icon="inline-start" />Restablecer recomendados</Button>
    </div>
    {!saved.email_deliverable && <Card className="flex-row items-start gap-3 px-6 py-4">
      <MailX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-review" />
      <p className="text-sm">No podemos entregar correos a tu cuenta. Los avisos siguen llegando a la app.</p>
    </Card>}
    {anyLocked && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock aria-hidden="true" className="size-3" />Obligatoria: no se puede apagar</p>}
    <Card className="gap-0 overflow-hidden py-0">
      {preferenceGroups(scope, saved.items).map(group => <PreferenceSection key={group.key} label={group.label} items={group.items}
        draft={draft} showAdjustment={!candidate} onToggle={toggle} />)}
    </Card>
    <SaveBar changes={changes.length} saving={saving} status={status} onDiscard={discard} onSave={() => void save()} />
  </div>;
}

function PreferenceSection({ label, items, draft, showAdjustment, onToggle }: {
  label: string; items: PreferenceItem[]; draft: Draft; showAdjustment: boolean;
  onToggle: (type: string, channel: NotificationChannel, enabled: boolean) => void;
}) {
  const id = useId();
  return <section aria-labelledby={id} className="border-b border-border/60 last:border-b-0">
    <div className="grid items-end gap-3 bg-muted/45 px-6 pt-4 pb-1.5 max-sm:px-4 md:grid-cols-[minmax(0,1fr)_7rem_7rem]">
      <h3 id={id} className="text-xs font-semibold text-muted-foreground">{label}</h3>
      {NOTIFICATION_CHANNELS.map(channel => <span key={channel} aria-hidden="true" className="text-xs font-medium text-muted-foreground max-md:hidden">{CHANNEL_LABELS[channel]}</span>)}
    </div>
    <ul className="divide-y divide-border/60">
      {items.map(item => <PreferenceRow key={item.type} item={item} draft={draft} showAdjustment={showAdjustment} onToggle={onToggle} />)}
    </ul>
  </section>;
}

function PreferenceRow({ item, draft, showAdjustment, onToggle }: {
  item: PreferenceItem; draft: Draft; showAdjustment: boolean; onToggle: (type: string, channel: NotificationChannel, enabled: boolean) => void;
}) {
  const id = useId();
  const copy = preferenceCopy(item.type);
  const value = { in_app: draft[pair(item.type, "in_app")], email: draft[pair(item.type, "email")] };
  const locked = NOTIFICATION_CHANNELS.filter(channel => item.channels[channel].mandatory_locked);
  const lock = lockedLabel(locked);
  const adjustment = showAdjustment && locked.length < NOTIFICATION_CHANNELS.length ? adjustmentLabel(item, value) : null;
  const silent = locked.length === 0 && !value.in_app && !value.email;

  return <li className="grid gap-3 px-6 py-4 max-sm:px-4 md:grid-cols-[minmax(0,1fr)_7rem_7rem] md:items-center">
    <div className="min-w-0">
      <p id={`${id}-title`} className="font-medium">{copy.title}</p>
      {copy.description && <p className="max-w-prose text-xs text-muted-foreground">{copy.description}</p>}
      {(lock || adjustment) && <div className="mt-1.5 flex flex-wrap gap-1.5">
        {lock && <Badge id={`${id}-lock`} variant="neutral"><Lock aria-hidden="true" data-icon="inline-start" />{lock}</Badge>}
        {adjustment && <Badge variant="accent">{adjustment}</Badge>}
      </div>}
      {silent && <p className="mt-1.5 flex items-center gap-1.5 text-xs text-status-review"><TriangleAlert aria-hidden="true" className="size-3.5" />Con esto no te llegará este aviso por ningún medio.</p>}
    </div>
    {NOTIFICATION_CHANNELS.map(channel => {
      const isLocked = item.channels[channel].mandatory_locked;
      return <div key={channel} className="flex items-center justify-between gap-3 md:justify-start">
        <span id={`${id}-${channel}`} className="text-sm md:sr-only">{CHANNEL_LABELS[channel]}</span>
        <Switch checked={isLocked ? true : value[channel]} disabled={isLocked}
          aria-labelledby={`${id}-title ${id}-${channel}`} aria-describedby={isLocked && lock ? `${id}-lock` : undefined}
          onCheckedChange={checked => { if (!isLocked) onToggle(item.type, channel, checked); }} />
      </div>;
    })}
  </li>;
}

/** Design 05 `saveBar`: unsaved count with «Descartar» / «Guardar cambios», or the result of the last save. */
function SaveBar({ changes, saving, status, onDiscard, onSave }: {
  changes: number; saving: boolean; status: Status; onDiscard: () => void; onSave: () => void;
}) {
  return <div aria-live="polite" className="sticky bottom-4 z-10 empty:hidden">
    {(changes > 0 || status) && <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-popover px-4 py-3 shadow-md">
      <div className="min-w-0 flex-1">
        {status?.kind === "error" && <p role="alert" className="flex items-center gap-1.5 text-sm text-status-danger"><CircleAlert aria-hidden="true" className="size-4 shrink-0" />{status.text}</p>}
        {status?.kind === "saved" && changes === 0 && <p className="flex items-center gap-1.5 text-sm text-status-success"><Check aria-hidden="true" className="size-4" />Preferencias guardadas</p>}
        {changes > 0 && <Badge variant="review" dot>{unsavedChangesLabel(changes)}</Badge>}
      </div>
      {changes > 0 && <div className="flex gap-2">
        <Button type="button" variant="ghost" className="min-h-10" disabled={saving} onClick={onDiscard}>Descartar</Button>
        <Button type="button" className="min-h-10" disabled={saving} aria-busy={saving || undefined} onClick={onSave}>Guardar cambios</Button>
      </div>}
    </div>}
  </div>;
}

function PreferencesSkeleton() {
  return <div aria-busy="true" className="grid gap-6">
    <span role="status" className="sr-only">Cargando preferencias</span>
    <div aria-hidden="true" className="grid gap-2"><Skeleton className="h-7 w-44" /><Skeleton className="h-3.5 w-96 max-w-full" /></div>
    <Card aria-hidden="true" className="grid gap-5 px-6 py-6">
      {["40%", "55%", "35%", "50%", "45%"].map(width => <div key={width} className="grid items-center gap-4 md:grid-cols-[minmax(0,1fr)_7rem_7rem]">
        <div className="grid gap-1.5"><Skeleton className="h-3.5" style={{ width }} /><Skeleton className="h-3 w-3/4" /></div>
        <Skeleton className="h-8 w-14 rounded-full" /><Skeleton className="h-8 w-14 rounded-full" />
      </div>)}
    </Card>
  </div>;
}

function PreferencesError({ onRetry }: { onRetry: () => void }) {
  return <div role="alert" className="grid justify-items-center gap-2 px-6 py-10 text-center">
    <span aria-hidden="true" className="mb-1 grid size-10 place-items-center rounded-[14px] bg-destructive/10 text-status-danger"><CircleAlert className="size-5" /></span>
    <h2 className="text-base font-semibold">No pudimos cargar tus preferencias.</h2>
    <p className="max-w-[300px] text-sm text-muted-foreground">Revisa tu conexión e inténtalo de nuevo.</p>
    <Button type="button" variant="outline" className="mt-2 min-h-10" onClick={onRetry}><RefreshCw aria-hidden="true" data-icon="inline-start" />Reintentar</Button>
  </div>;
}
