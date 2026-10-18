import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon, BanknoteIcon, Building2Icon, CalendarClockIcon, CheckCircle2Icon, GiftIcon, ListChecksIcon, SparklesIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { benefitLabel } from "../drafts/ui/draft-labels";
import { DraftRichDescriptionContent } from "../drafts/ui/draft-rich-description";
import { vacancyApplicationHref } from "../application/application-draft";
import { formatPublicSalary, formatPublishedDate } from "../formatters";
import type { PublicJobDetail } from "../types";
import { PublicJobFacts } from "./public-job-facts";

/** V2 public detail: VAC-4 only, without inferred or private draft metadata. */
export function PublicJobDetailView({ job }: { job: PublicJobDetail }) {
  const salary = formatPublicSalary(job);
  const hasRequirements = job.requirements.required || job.requirements.preferred;
  const benefits = [...job.benefits.predefined.map(benefitLabel), ...job.benefits.custom];
  return <article className="flex w-full flex-col gap-6">
    <nav aria-label="Ruta de navegación">
      <Link href="/vacantes" aria-label="Volver a vacantes" className={cn(buttonVariants({ variant: "ghost" }), "min-h-10")}><ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />Vacantes</Link>
    </nav>
    <Card>
      <CardHeader className="border-b">
        <CardTitle><h1 className="flex items-start gap-4 font-heading text-2xl font-semibold break-words md:text-3xl">
          <Avatar size="lg" aria-hidden="true"><AvatarFallback><Building2Icon aria-hidden="true" className="size-5" /></AvatarFallback></Avatar>
          <span className="min-w-0">{job.title}</span>
        </h1></CardTitle>
        <CardDescription>{job.company.name}</CardDescription>
      </CardHeader>
      <CardContent><PublicJobFacts job={job} /></CardContent>
      <CardFooter className="border-t">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><CalendarClockIcon aria-hidden="true" className="size-3.5 shrink-0" /><time dateTime={job.published_at}>Publicada el {formatPublishedDate(job.published_at)}</time></span>
      </CardFooter>
    </Card>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader className="border-b"><CardTitle><h2 className="font-heading text-xl font-semibold">Sobre la vacante</h2></CardTitle></CardHeader>
          <CardContent className="max-w-prose">
            {job.source === "vacancy" && job.description !== null
              ? <DraftRichDescriptionContent description={job.description} />
              : <div className="flex flex-col gap-4 text-sm leading-relaxed">{job.description_plain.split(/\n\s*\n/u).map((text, index) => <p key={index} className="whitespace-pre-line break-words">{text}</p>)}</div>}
          </CardContent>
        </Card>
        {job.source === "vacancy" && hasRequirements && <Card>
          <CardHeader className="border-b"><CardTitle><h2 className="flex items-center gap-2 font-heading text-xl font-semibold"><ListChecksIcon aria-hidden="true" className="size-5" />Requisitos</h2></CardTitle></CardHeader>
          <CardContent><dl className="flex max-w-prose flex-col gap-4">
            {job.requirements.required && <div className="flex flex-col gap-1"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2Icon aria-hidden="true" className="size-3.5" />Obligatorios</dt><dd className="whitespace-pre-line break-words">{job.requirements.required}</dd></div>}
            {job.requirements.preferred && <div className="flex flex-col gap-1"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><SparklesIcon aria-hidden="true" className="size-3.5" />Deseables</dt><dd className="whitespace-pre-line break-words">{job.requirements.preferred}</dd></div>}
          </dl></CardContent>
        </Card>}
        {job.source === "vacancy" && benefits.length > 0 && <Card>
          <CardHeader className="border-b"><CardTitle><h2 className="flex items-center gap-2 font-heading text-xl font-semibold"><GiftIcon aria-hidden="true" className="size-5" />Beneficios</h2></CardTitle></CardHeader>
          <CardContent><ul className="grid gap-3 sm:grid-cols-2">{benefits.map((benefit, index) => <li key={index} className="min-w-0"><Item variant="outline" size="sm"><ItemMedia variant="icon"><GiftIcon aria-hidden="true" /></ItemMedia><ItemContent className="min-w-0"><span className="break-words">{benefit}</span></ItemContent></Item></li>)}</ul></CardContent>
        </Card>}
      </div>
      <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
        {salary !== null && <Card>
          <CardHeader><CardTitle><h2 className="flex items-center gap-2 font-heading text-lg font-semibold"><BanknoteIcon aria-hidden="true" className="size-5" />{job.source === "vacancy" ? "Compensación" : "Salario"}</h2></CardTitle></CardHeader>
          <CardContent><p className="font-heading text-xl font-semibold break-words">{salary}</p></CardContent>
        </Card>}
        <Card>
          <CardHeader><CardTitle><h2 className="font-heading text-lg font-semibold">Postulación</h2></CardTitle></CardHeader>
          <CardFooter><Link href={vacancyApplicationHref(job.id)} className={cn(buttonVariants(), "min-h-10 w-full")}>Postularme<ArrowRightIcon aria-hidden="true" data-icon="inline-end" /></Link></CardFooter>
        </Card>
      </aside>
    </div>
  </article>;
}
