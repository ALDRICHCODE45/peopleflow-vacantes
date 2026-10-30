import Link from "next/link";
import { ArrowRight, ClipboardList } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemHeader, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import type { AccountAssessment } from "../model";
const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" });
export const answerable = (item: AccountAssessment) => item.status === "created" || item.status === "in_progress";
/** Inbox eligibility additionally respects the invitation's real expiry deadline. */
export const actionableAssessment = (item: AccountAssessment, now = Date.now()) => answerable(item) && Date.parse(item.expires_at) > now;
const href = (item: AccountAssessment) => `/candidato/evaluaciones/${item.id}`;
const labels = { created: "Pendiente", in_progress: "En curso", finished: "Finalizada", expired: "Expirada", revoked: "Revocada" } as const;

/** Item outline follows item-demo: a task within an application, never a nested Card. */
export function AssessmentBlock({ item }: { item: AccountAssessment }) {
  // A stale created/in_progress projection cannot offer a closed invitation.
  if (answerable(item) && !actionableAssessment(item)) item = { ...item, status: "expired" };
  return <Item variant="outline" className="grid grid-cols-1 items-stretch" aria-label={`Evaluación ${labels[item.status]}`}>
    <ItemHeaderContent item={item} />
    <ItemContent className="min-w-0">
      {answerable(item) ? <>
        <ItemDescription className="line-clamp-none break-words">Conoce tu forma de trabajar: afirmaciones sobre cómo sueles actuar.</ItemDescription>
        <ItemDescription className="line-clamp-none break-words">~{item.estimated_minutes} min · {item.total_count} preguntas · Tu avance se guarda</ItemDescription>
        <ItemDescription className="line-clamp-none break-words">Disponible hasta el {date.format(new Date(item.expires_at))}</ItemDescription>
        <Progress value={item.answered_count} max={item.total_count} aria-label="Preguntas respondidas" />
      </> : <>
        <ItemDescription className="line-clamp-none break-words">{item.status === "finished" && item.finished_at ? `Terminaste el ${date.format(new Date(item.finished_at))}. Tus respuestas quedaron guardadas.` : "Ya no está disponible"}</ItemDescription>
        <ItemDescription className="line-clamp-none break-words">Solo lectura · La decisión siempre la toma una persona.</ItemDescription>
      </>}
    </ItemContent>
    {answerable(item) && <ItemActions><Link href={href(item)} className={cn(buttonVariants(), "min-h-10 w-full sm:w-auto")}>{item.status === "in_progress" ? "Continuar evaluación" : "Responder evaluación"}<ArrowRight aria-hidden="true" data-icon="inline-end" /></Link></ItemActions>}
  </Item>;
}
function ItemHeaderContent({ item }: { item: AccountAssessment }) {
  return <ItemHeader>
    <ItemTitle><ClipboardList aria-hidden="true" className="size-4" />Evaluación</ItemTitle>
    <Badge variant={answerable(item) ? "accent" : item.status === "finished" ? "success" : "neutral"} dot>{labels[item.status]}{item.status === "in_progress" && ` · ${item.answered_count} de ${item.total_count}`}</Badge>
  </ItemHeader>;
}
export function PendingAssessments({ items }: { items: AccountAssessment[] }) {
  const pending = items.filter(answerable);
  if (!pending.length) return null;
  return <Card aria-label="Pendientes">
    <CardHeader className="border-b"><CardTitle><h2>Pendientes</h2></CardTitle><CardDescription>El siguiente paso de tu búsqueda.</CardDescription><CardAction><Badge variant="accent">{pending.length} por responder</Badge></CardAction></CardHeader>
    <CardContent><ItemGroup>{pending.map(item => <Item key={item.id}>
      <ItemMedia variant="icon"><ClipboardList aria-hidden="true" /></ItemMedia>
      <ItemContent><ItemTitle>Evaluación · {item.vacancy.title}</ItemTitle><ItemDescription>{item.company.name} · Disponible hasta el {date.format(new Date(item.expires_at))}</ItemDescription></ItemContent>
      <ItemActions><Link href={href(item)} className={cn(buttonVariants({ variant: "outline" }))}>Revisar pendiente<ArrowRight aria-hidden="true" data-icon="inline-end" /></Link></ItemActions>
    </Item>)}</ItemGroup></CardContent>
  </Card>;
}
export function StandaloneAssessments({ items }: { items: AccountAssessment[] }) {
  if (!items.length) return null;
  return <section aria-label="Evaluaciones" className="grid gap-4 lg:grid-cols-2">{items.map(item => <Card key={item.id}>
    <CardHeader><CardTitle><h3>{item.vacancy.title}</h3></CardTitle><CardDescription>{item.company.name} · Evaluación sin postulación</CardDescription></CardHeader>
    <CardContent><AssessmentBlock item={item} /></CardContent>
  </Card>)}</section>;
}
