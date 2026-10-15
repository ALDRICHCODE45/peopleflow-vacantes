"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Clock, FileText, RefreshCw, UserRound } from "lucide-react";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardHeader, CardContent, CardFooter } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { REQUESTER_KIND_OPTIONS } from "../ui/draft-labels";
import { listDraftsAction, type DraftListActionFailure } from "./actions";
import type { DraftListRow } from "./client";

const dateFormat = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });
const rowLayout = "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] lg:items-center";
const messages: Record<DraftListActionFailure["reason"], { title: string; description: string }> = {
  unauthenticated: { title: "Tu sesión expiró", description: "Inicia sesión y vuelve a cargar tus borradores. No se modificó ningún borrador." },
  forbidden: { title: "No tienes permiso para esta acción", description: "Usa una cuenta de reclutador con permisos para ver estos borradores. No se modificó ningún borrador." },
  company_inactive: { title: "Falta configurar tu empresa", description: "Revisa la configuración de tu empresa para ver los borradores. No se modificó ningún borrador." },
  company_not_active: { title: "Falta configurar tu empresa", description: "Tu empresa debe estar activa para ver los borradores. No se modificó ningún borrador." },
  invalid_request: { title: "No se pudieron cargar los borradores", description: "Pulsa Actualizar para volver al inicio de la lista. No se modificó ningún borrador." },
  server_error: { title: "El servidor tuvo un problema", description: "Puedes volver a cargar la lista con Actualizar. Tus borradores no se modificaron." },
  no_response: { title: "No hubo respuesta del servidor", description: "Revisa tu conexión y pulsa Actualizar. Tus borradores no se modificaron." },
  unrecognized_response: { title: "No pudimos cargar la lista", description: "Pulsa Actualizar para intentarlo de nuevo. Tus borradores no se modificaron." },
};

function DraftRow({ row }: { row: DraftListRow }) {
  const title = row.title ?? "Sin título";
  const requester = row.requester && (row.requester.id !== null
    ? row.requester.name
    : REQUESTER_KIND_OPTIONS.find(option => option.value === row.requester?.kind)?.label);
  return <li>
    <Card size="sm" className={rowLayout}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><FileText aria-hidden="true" className="size-4" /></div>
          <h3 className="min-w-0 break-words font-heading text-base font-semibold">{title}</h3>
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-3 sm:grid-cols-2">
        {requester !== null && requester !== undefined && <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Building2 aria-hidden="true" className="size-3.5" />Solicitante</p>
          <p className="break-words text-sm">{requester}</p>
        </div>}
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound aria-hidden="true" className="size-3.5" />Reclutador</p>
          <p className="break-words text-sm">{row.principal_recruiter.name ?? "Usuario dado de baja"}</p>
        </div>
        <div className="sm:col-span-2">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock aria-hidden="true" className="size-3.5" />Última actualización</p>
          <time dateTime={row.updated_at} className="text-sm">{dateFormat.format(new Date(row.updated_at))}</time>
        </div>
      </CardContent>
      <CardFooter>
        <Link href={`/empresa/vacantes/borradores/${row.id}`} aria-label={`Abrir ${title}`} className={buttonVariants({ variant: "outline", className: "min-h-10" })}>
          Abrir<ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </CardFooter>
    </Card>
  </li>;
}

export function DraftList() {
  const [items, setItems] = useState<DraftListRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<"initial" | "refresh" | "more" | null>("initial");
  const [failure, setFailure] = useState<DraftListActionFailure | null>(null);
  const [success, setSuccess] = useState<"refresh" | "more" | null>(null);
  const active = useRef(false);
  const busy = useRef(false);

  const load = useCallback(async (mode: "initial" | "refresh" | "more", cursor?: string) => {
    if (busy.current) return;
    busy.current = true;
    setPending(mode); setFailure(null); setSuccess(null);
    try {
      const result = await listDraftsAction({ limit: 20, ...(cursor !== undefined ? { cursor } : {}) });
      if (!active.current) return;
      if (!result.ok) {
        setFailure(result);
        notifyActionResult({ key: "draft-list", type: "error", ...messages[result.reason], reference: { ...result.reference, at: new Date().toISOString() } });
        return;
      }
      setItems(previous => {
        // A saved draft may move between pages: replace duplicates without adding rows.
        const merged = new Map((mode === "more" ? previous : []).map(item => [item.id, item]));
        result.items.forEach(item => merged.set(item.id, item));
        return [...merged.values()];
      });
      setNextCursor(result.nextCursor); setLoaded(true);
      if (mode !== "initial") setSuccess(mode);
      // Extra pages only extend what is on screen; a toast for each one is noise.
      if (mode === "refresh") {
        notifyActionResult({ key: "draft-list", type: "success", title: "Lista actualizada", description: "Ya puedes abrir los borradores de la lista." });
      }
    } catch {
      if (!active.current) return;
      setFailure({ ok: false, reason: "no_response", reference: {} });
      notifyActionResult({ key: "draft-list", type: "error", ...messages.no_response, reference: { at: new Date().toISOString() } });
    } finally {
      busy.current = false;
      if (active.current) setPending(null);
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void load("initial");
    return () => { active.current = false; };
  }, [load]);

  const company = failure && ["company_inactive", "company_not_active"].includes(failure.reason);
  const statusAction = failure?.reason === "unauthenticated"
    ? <Link href="/empresa/login" className={buttonVariants({ variant: "outline", className: "min-h-10" })}>Iniciar sesión</Link>
    : company ? <Link href="/empresa/configuracion" className={buttonVariants({ variant: "outline", className: "min-h-10" })}>Revisar empresa</Link> : undefined;

  return <section aria-labelledby="draft-list-title" className="flex min-w-0 flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="draft-list-title" className="font-heading text-2xl font-semibold">Borradores guardados</h2>
        <p className="max-w-prose text-sm text-muted-foreground">Retoma una vacante sin publicar. Si guardaste cambios mientras revisabas la lista, pulsa Actualizar para verlos.</p>
      </div>
      <Link href="/empresa/vacantes/borradores/nuevo" className={buttonVariants({ className: "min-h-10" })}>Nuevo borrador</Link>
    </div>
    <div aria-busy={pending !== null} className="min-h-40">
      {pending === "initial" && !loaded ? <div className="flex flex-col gap-3">
        <span role="status" className="sr-only">Cargando borradores…</span>
        {[0, 1, 2].map(index => <Card key={index} size="sm" className={rowLayout} aria-hidden="true">
          <CardHeader><Skeleton className="h-9 w-40 max-w-full" /></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full sm:col-span-2" /></CardContent>
          <CardFooter><Skeleton className="h-10 w-20" /></CardFooter>
        </Card>)}
      </div> : loaded && items.length === 0 ? <Empty>
        <EmptyHeader><EmptyTitle>Aún no tienes borradores</EmptyTitle><EmptyDescription>Crea un borrador para preparar tu próxima vacante sin publicarla.</EmptyDescription></EmptyHeader>
        <EmptyContent><Link href="/empresa/vacantes/borradores/nuevo" className={buttonVariants({ variant: "outline", className: "min-h-10" })}>Crear un borrador</Link></EmptyContent>
      </Empty> : <ul aria-label="Borradores guardados" className="flex flex-col gap-3">{items.map(row => <DraftRow key={row.id} row={row} />)}</ul>}
    </div>
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" className="min-h-10 min-w-32" disabled={pending !== null} aria-busy={pending === "refresh"} aria-describedby="draft-list-status" onClick={() => void load("refresh")}>
          {pending === "refresh" ? <Spinner aria-hidden="true" /> : <RefreshCw aria-hidden="true" className="size-4" />}Actualizar
        </Button>
        {nextCursor !== null && <Button className="min-h-10 min-w-32" disabled={pending !== null} aria-busy={pending === "more"} aria-describedby="draft-list-status" onClick={() => void load("more", nextCursor)}>
          {pending === "more" && <Spinner aria-hidden="true" />}Cargar más
        </Button>}
      </div>
      <ActionStatusSlot>
        {failure ? <ActionStatus id="draft-list-status" tone="error" text="No se cargaron los borradores · ver aviso" action={statusAction} />
          : success ? <ActionStatus id="draft-list-status" tone="success" text={success === "more" ? "Borradores cargados" : "Lista actualizada"} /> : <span id="draft-list-status" />}
      </ActionStatusSlot>
    </div>
  </section>;
}
