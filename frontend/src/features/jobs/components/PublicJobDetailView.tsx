import { Fragment } from "react";
import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon, BanknoteIcon, Building2Icon, CalendarDaysIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { DraftRichDescriptionContent } from "../drafts/ui/draft-rich-description";
import { vacancyApplicationHref } from "../application/application-draft";
import { formatPublishedDate } from "../formatters";
import type { PublicJobDetail } from "../types";
import { PublicCompanyAvatar } from "./PublicCompanyAvatar";
import { PublicApplicants, PublicScreeningInfo } from "./public-application-info";
import { PublicJobFacts, publicJobHeroFacts } from "./public-job-facts";
import { publicDetailBenefits, publicDetailSections } from "./public-detail-content";
import { PublicSalary } from "./public-salary";
import { PublicShareButton } from "./public-share-button";
import { PUBLIC_ACTION_CARD, PUBLIC_COMPANY_FOOTER, PUBLIC_DETAIL_ASIDE, PUBLIC_DETAIL_BENEFITS, PUBLIC_DETAIL_BODY, PUBLIC_DETAIL_CARD, PUBLIC_DETAIL_GRID, PUBLIC_DETAIL_HEADER, PUBLIC_DETAIL_HERO, PUBLIC_DETAIL_SECTION } from "./public-vacancy-layout";

/** Public contract only; the existing shell and application routes remain authoritative. */
export function PublicJobDetailView({ job }: { job: PublicJobDetail }) {
  const sections = publicDetailSections(job);
  const benefits = publicDetailBenefits(job);
  const companyContext = [job.location, publicJobHeroFacts(job).find(fact => fact.key === "work_mode")?.value].filter(Boolean).join(" · ");
  return <article className="flex w-full flex-col gap-6">
    <nav aria-label="Ruta de navegación" className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      <Link href="/vacantes" aria-label="Volver a vacantes" className={cn(buttonVariants({ variant: "ghost" }), "min-h-10")}><ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />Vacantes</Link>
      <span aria-hidden="true">/</span><span aria-current="page" className="text-foreground">Detalle de la vacante</span>
    </nav>
    <Card className={PUBLIC_DETAIL_HERO}>
      <CardHeader className={PUBLIC_DETAIL_HEADER}>
        <div className="col-start-1 row-span-3 row-start-1"><PublicCompanyAvatar company={job.company} detail /></div>
        <CardDescription className="col-start-2 row-start-1">{job.company.name}</CardDescription>
        <CardTitle className="col-start-2 row-start-2 min-w-0"><h1 className="font-heading text-2xl font-semibold tracking-tight text-balance break-words sm:text-4xl">{job.title}</h1></CardTitle>
        <div className="col-start-2 row-start-3 flex min-w-0 flex-wrap gap-2">{publicJobHeroFacts(job).map(({ key, value, Icon }) => <Badge key={key} variant="secondary">{key === "work_mode" && <Icon aria-hidden="true" />}{value}</Badge>)}</div>
      </CardHeader>
      <CardContent><p className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDaysIcon aria-hidden="true" className="size-4 shrink-0" /><span>Publicada el <time dateTime={job.published_at}>{formatPublishedDate(job.published_at)}</time></span></p></CardContent>
    </Card>
    <div className={PUBLIC_DETAIL_GRID}>
      <div className="flex min-w-0 flex-col gap-6">
        <Card className={PUBLIC_DETAIL_CARD}>
          <CardHeader><CardTitle><h2 className="text-lg font-semibold">La vacante de un vistazo</h2></CardTitle></CardHeader>
          <CardContent><PublicJobFacts job={job} /></CardContent>
        </Card>
        {sections.length > 0 && <Card className={PUBLIC_DETAIL_CARD}>
          <CardHeader><nav aria-label="Secciones de la vacante" className="pf-job-section-nav">{sections.map(section => <a key={section.id} href={`#${section.id}`}>{section.label}</a>)}</nav></CardHeader>
          <CardContent className={PUBLIC_DETAIL_BODY}>
            {sections.map(({ id }, index) => <Fragment key={id}>
              {index > 0 && <Separator />}
              <section id={id} className={PUBLIC_DETAIL_SECTION}>
                {id === "descripcion" && <>
                  <h2 className="text-xl font-semibold tracking-tight">Sobre la vacante</h2>
                  <div className="pf-job-description max-w-prose break-words">
                    {job.source === "vacancy" && job.description !== null
                      ? <DraftRichDescriptionContent description={job.description} />
                      : <div className="flex flex-col gap-5">{job.description_plain.split(/\n\s*\n/u).map((text, key) => <p key={key} className="whitespace-pre-line">{text}</p>)}</div>}
                  </div>
                </>}
                {id === "requisitos" && <>
                  <div className="flex flex-col gap-2"><h2 className="text-xl font-semibold tracking-tight">Lo que buscamos</h2><p className="text-muted-foreground">Conocimientos y experiencia para este puesto.</p></div>
                  {job.requirements.required?.trim() && <div className="flex max-w-prose flex-col gap-4"><h3 className="font-semibold">Requisitos indispensables</h3><p className="whitespace-pre-wrap break-words">{job.requirements.required}</p></div>}
                  {job.requirements.preferred?.trim() && <div className="flex max-w-prose flex-col gap-4"><h3 className="font-semibold">También valoramos</h3><p className="whitespace-pre-wrap break-words">{job.requirements.preferred}</p></div>}
                </>}
                {id === "habilidades" && <>
                  <h2 className="text-xl font-semibold tracking-tight">Habilidades</h2>
                  <ul className="flex flex-wrap gap-2">{job.skills.map((skill, key) => <li key={key} className="min-w-0 max-w-full"><Badge variant="secondary" className="h-auto max-w-full whitespace-normal break-words">{skill}</Badge></li>)}</ul>
                </>}
                {id === "beneficios" && <>
                  <div className="flex flex-col gap-2"><h2 className="text-xl font-semibold tracking-tight">Beneficios para ti</h2><p className="text-muted-foreground">Más allá de tu compensación.</p></div>
                  <ul className={PUBLIC_DETAIL_BENEFITS}>{benefits.map(({ label, Icon }, key) => <li key={key} className="flex min-w-0 items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground"><Icon aria-hidden="true" className="size-5" strokeWidth={1.6} /></span><span className="text-sm break-words">{label}</span>
                  </li>)}</ul>
                </>}
              </section>
            </Fragment>)}
          </CardContent>
        </Card>}
      </div>
      <aside aria-label="Compensación y postulación" className={PUBLIC_DETAIL_ASIDE}>
        <Card className={PUBLIC_ACTION_CARD}>
          <CardHeader><CardTitle><h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><BanknoteIcon aria-hidden="true" className="size-5" />Compensación</h2></CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-6">
            <PublicSalary job={job} detail />
            <Separator />
            <div className="flex flex-col gap-3"><h3 className="font-semibold">¿Te ves en este equipo?</h3><p className="text-sm leading-relaxed text-muted-foreground">Da el siguiente paso en tu carrera con {job.company.name}.</p></div>
            <div className="flex flex-col gap-2">
              <Link href={vacancyApplicationHref(job.id)} className={cn(buttonVariants(), "h-12 w-full")}>Postularme<ArrowRightIcon aria-hidden="true" data-icon="inline-end" /></Link>
              <PublicShareButton />
              <PublicApplicants applicants={job.applicants} />
              <PublicScreeningInfo count={job.screening_questions} />
            </div>
          </CardContent>
          <CardFooter className={PUBLIC_COMPANY_FOOTER}><Building2Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" /><div className="flex min-w-0 flex-col gap-1"><p className="text-sm font-medium break-words">{job.company.name}</p>{companyContext && <p className="text-sm text-muted-foreground">{companyContext}</p>}</div></CardFooter>
        </Card>
      </aside>
    </div>
  </article>;
}
