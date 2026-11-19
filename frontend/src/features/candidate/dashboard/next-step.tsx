"use client";
import { memo, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Mail, UserRound } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { missingProfileText } from "@/features/candidate/profile-completeness";
import { cn } from "@/lib/utils";
import { Ring } from "./charts";
import { relativeTime, shortDate } from "./format";
import type { Application, Step } from "./insights";
import motion from "./dashboard.module.css";
import { useEntrance } from "./entrance";

const FRAME = "relative isolate flex flex-col gap-3 overflow-hidden rounded-[min(var(--radius-4xl),24px)] p-4 text-sm text-card-foreground sm:gap-4 sm:px-7 sm:pt-6 sm:pb-7";
const PRIMARY = buttonVariants({ className: "min-h-11 w-full sm:min-h-10 sm:w-auto" });
const SECONDARY = buttonVariants({ variant: "ghost", className: "min-h-11 text-primary-text sm:min-h-10" });
const MORE_ITEM = "inline-flex min-h-10 items-center rounded-sm text-left font-medium text-primary-text underline-offset-3 hover:underline";

type View = { icon: ReactNode; ring?: boolean; title: string; context: string; primary: ReactNode; secondary?: ReactNode; short: string };

function view(step: Step, read: (item: Application) => void): View {
  if (step.kind === "assessment") {
    const { item } = step;
    const started = item.answered_count > 0;
    const due = `vence el ${shortDate(item.expires_at)}`;
    return {
      ring: true,
      icon: <Ring value={item.answered_count} total={item.total_count} size={48} stroke={5} label={`Evaluación: ${item.answered_count} de ${item.total_count} preguntas respondidas`}><b className="text-[13px]">{item.answered_count}</b></Ring>,
      title: `${started ? "Termina" : "Responde"} tu evaluación de ${item.company.name}`,
      context: `${item.vacancy.title} · ${started ? `${item.answered_count} de ${item.total_count}` : `~${item.estimated_minutes} min`} · ${due}`,
      primary: <Link className={PRIMARY} href={`/candidato/evaluaciones/${item.id}`}>{started ? "Continuar evaluación" : "Empezar evaluación"}<ArrowRight aria-hidden="true" data-icon="inline-end" /></Link>,
      secondary: item.application_id ? <Link className={SECONDARY} href="/candidato/postulaciones">Ver postulación</Link> : undefined,
      short: `${started ? "Terminar" : "Responder"} tu evaluación · ${due}`,
    };
  }
  if (step.kind === "message") {
    const { item } = step;
    return {
      icon: <Mail className="size-5" />,
      title: `${item.company.name} te escribió`,
      context: [`Sobre ${item.vacancy.title}`, item.updated_at && relativeTime(item.updated_at).replace(/^Hoy/u, "hoy"), "postulación cerrada"].filter(Boolean).join(" · "),
      primary: <Button className={PRIMARY} onClick={() => read(item)}><Mail aria-hidden="true" data-icon="inline-start" />Leer mensaje</Button>,
      secondary: <Link className={SECONDARY} href="/vacantes">Explorar vacantes</Link>,
      short: `Leer el mensaje de ${item.company.name}`,
    };
  }
  const missing = missingProfileText(step.missing);
  return {
    icon: <UserRound className="size-5" />,
    title: `Completa tu perfil: ${step.missing.length === 1 ? "te falta 1 dato" : `te faltan ${step.missing.length} datos`}`,
    context: `Falta ${missing} · ${step.completed} de ${step.total} datos completos`,
    primary: <Link className={PRIMARY} href="/candidato/perfil">Completar perfil<ArrowRight aria-hidden="true" data-icon="inline-end" /></Link>,
    short: `Completar tu perfil · falta ${missing}`,
  };
}

/** Placeholder with the card's footprint while the pending sources load (rule 15: skeleton, never zeros). */
export function NextStepSkeleton({ label }: { label: string }) {
  return <div aria-busy="true" aria-label={label} className={cn(FRAME, motion.next)}>
    <span role="status" className="sr-only">{label}</span>
    <Skeleton aria-hidden="true" className="h-4 w-28" />
    <div aria-hidden="true" className="flex items-center gap-4"><Skeleton className="size-12 shrink-0 rounded-2xl" /><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-5 w-3/4 max-w-80" /><Skeleton className="h-4 w-1/2 max-w-60" /></div></div>
  </div>;
}

/**
 * «Siguiente paso» (artboard 04): ONE action in the focus order, the rest behind «+N más», and nothing at all when
 * nothing is pending. Reading a message opens it here; the caller owns the read acknowledgment.
 */
export const NextStep = memo(function NextStep({ steps, onRead }: { steps: Step[]; onRead: (item: Application) => void }) {
  const id = useId();
  const [more, setMore] = useState(false);
  const [reading, setReading] = useState<Application | null>(null);
  const read = (item: Application) => { setMore(false); setReading(item); onRead(item); };
  const [first, ...rest] = steps;
  const current = first && view(first, read);
  const entrance = useEntrance(current !== undefined);
  return <>
    {current && <section aria-labelledby={id} className={cn(FRAME, motion.next, entrance)}>
      <div className="flex min-h-6 items-center justify-between gap-3">
        <p id={id} className="flex items-center gap-2 text-xs font-semibold tracking-[0.04em] text-primary-text uppercase"><span aria-hidden="true" className="size-1.5 rounded-full bg-primary-text" />Siguiente paso</p>
        {rest.length > 0 && <Popover open={more} onOpenChange={setMore}>
          <PopoverTrigger render={<Button variant="ghost" className="-my-1.5 -mr-2.5 min-h-9 text-muted-foreground" aria-label={`${rest.length} ${rest.length === 1 ? "pendiente más" : "pendientes más"}`} />}>
            +{rest.length} más<ChevronDown aria-hidden="true" data-icon="inline-end" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(340px,calc(100vw-2rem))] gap-2 p-5">
            <PopoverTitle className="font-semibold">También por hacer</PopoverTitle>
            <ul className="flex flex-col gap-1">{rest.map(step => {
              const item = view(step, read);
              return <li key={step.kind === "profile" ? "profile" : `${step.kind}:${step.item.id}`}>
                {step.kind === "message" ? <button type="button" className={MORE_ITEM} onClick={() => read(step.item)}>{item.short}</button>
                  : <Link className={MORE_ITEM} href={step.kind === "assessment" ? `/candidato/evaluaciones/${step.item.id}` : "/candidato/perfil"}>{item.short}</Link>}
              </li>;
            })}</ul>
          </PopoverContent>
        </Popover>}
      </div>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3.5 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-x-5">
        <span aria-hidden={current.ring ? undefined : true} className={cn("grid size-12 shrink-0 place-items-center rounded-2xl text-primary-text", !current.ring && "bg-[color-mix(in_srgb,var(--primary)_10%,var(--card))] ring-1 ring-primary/20")}>{current.icon}</span>
        <div className="min-w-0">
          <h3 className="text-[17px] leading-6 font-semibold tracking-tight text-balance sm:truncate sm:text-lg sm:leading-[26px]">{current.title}</h3>
          <p className="line-clamp-2 text-muted-foreground sm:line-clamp-1">{current.context}</p>
        </div>
        <div className="col-span-full flex flex-col items-stretch gap-1 sm:col-span-1 sm:flex-row sm:items-center">{current.primary}{current.secondary}</div>
      </div>
    </section>}
    <Dialog open={reading !== null} onOpenChange={open => { if (!open) setReading(null); }}>
      {reading && <DialogContent showCloseButton={false} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogDescription>{reading.company.name} · {reading.vacancy.title}</DialogDescription>
          <DialogTitle>Mensaje de la empresa</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm text-pretty text-foreground">{reading.message?.split(/\r?\n/u).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" className="min-h-10" />}>Cerrar</DialogClose>
          <Link className={buttonVariants({ className: "min-h-10" })} href="/vacantes">Explorar vacantes</Link>
        </DialogFooter>
      </DialogContent>}
    </Dialog>
  </>;
});
