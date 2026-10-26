import { Fragment, type ComponentProps } from "react";
import { BanknoteIcon, Building2Icon, CalendarDaysIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card as SurfaceCard, CardContent as SurfaceContent, CardDescription as SurfaceDescription, CardFooter as SurfaceFooter, CardHeader as SurfaceHeader, CardTitle as SurfaceTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DraftRichDescriptionContent } from "../drafts/ui/draft-rich-description";
import { PublicApplyLink } from "./public-apply-link";
import { formatPublishedDate } from "../formatters";
import type { PublicJobDetail } from "../types";
import type { DraftPublicDetail } from "./public-detail-presentation";
import { PublicCompanyAvatar } from "./PublicCompanyAvatar";
import { PublicApplicants, PublicScreeningInfo } from "./public-application-info";
import { PublicJobFacts, publicJobHeroFacts } from "./public-job-facts";
import { publicDetailBenefits, publicDetailSections } from "./public-detail-content";
import { PublicRequirementsProfile } from "./public-requirements-profile";
import { PublicSalary } from "./public-salary";
import { PublicShareButton } from "./public-share-button";
import { PUBLIC_ACTION_CARD, PUBLIC_COMPANY_FOOTER, PUBLIC_DETAIL_ASIDE, PUBLIC_DETAIL_BENEFITS, PUBLIC_DETAIL_BODY, PUBLIC_DETAIL_CARD, PUBLIC_DETAIL_GRID, PUBLIC_DETAIL_HEADER, PUBLIC_DETAIL_HERO, PUBLIC_DETAIL_SECTION } from "./public-vacancy-layout";

/** The modal owns the surface in previews: semantic groups, not nested Cards. */
function PreviewSection({ children }: ComponentProps<"div">) { return <section className="flex min-w-0 flex-col gap-5 [overflow-wrap:anywhere]">{children}</section>; }
function PreviewHeader({ children, className }: ComponentProps<"div">) { return <header className={cn("grid auto-rows-min items-start gap-2", className)}>{children}</header>; }
function PreviewContent({ children, className }: ComponentProps<"div">) { return <div className={cn("flex min-w-0 flex-col gap-6", className)}>{children}</div>; }
function PreviewFooter({ children }: ComponentProps<"div">) { return <footer className="flex items-center gap-3">{children}</footer>; }
function PreviewText({ children, className }: ComponentProps<"div">) { return <div className={className}>{children}</div>; }

type Props = { job: PublicJobDetail; preview?: false; companyLoading?: never } | { job: DraftPublicDetail; preview: true; companyLoading?: boolean };

/** Shared content; only modal surfaces and unavailable live actions differ. */
export function PublicJobDetailView({ job, preview = false, companyLoading = false }: Props) {
  const company = job.company;
  const hasCompanySlot = company !== null || companyLoading;
  const Card = preview ? PreviewSection : SurfaceCard;
  const CardHeader = preview ? PreviewHeader : SurfaceHeader;
  const CardContent = preview ? PreviewContent : SurfaceContent;
  const CardFooter = preview ? PreviewFooter : SurfaceFooter;
  const CardTitle = preview ? PreviewText : SurfaceTitle;
  const CardDescription = preview ? PreviewText : SurfaceDescription;
  const sections = publicDetailSections(job);
  const benefits = publicDetailBenefits(job);
  const companyContext = [job.location_label, publicJobHeroFacts(job).find(fact => fact.key === "work_mode")?.value].filter(Boolean).join(" · ");
  return <article data-slot="public-job-detail" className="flex w-full flex-col gap-6">
    {companyLoading && <span role="status" className="sr-only">Cargando empresa</span>}
    <Card className={PUBLIC_DETAIL_HERO}>
      <CardHeader className={hasCompanySlot ? PUBLIC_DETAIL_HEADER : undefined}>
        {hasCompanySlot && <div className="col-start-1 row-span-3 row-start-1">{companyLoading ? <Skeleton aria-hidden="true" className="size-16 rounded-2xl" /> : company && <PublicCompanyAvatar company={company} detail />}</div>}
        {hasCompanySlot && <CardDescription className="col-start-2 row-start-1">{companyLoading ? <Skeleton aria-hidden="true" className="h-5 w-36 max-w-full" /> : company?.name}</CardDescription>}
        <CardTitle className={cn("min-w-0", hasCompanySlot && "col-start-2 row-start-2")}><h1 className="font-heading text-2xl font-semibold tracking-tight text-balance break-words sm:text-4xl">{job.title}</h1></CardTitle>
        <div className={cn("flex min-w-0 flex-wrap gap-2", hasCompanySlot && "col-start-2 row-start-3")}>{publicJobHeroFacts(job).map(({ key, value, Icon }) => <Badge key={key} variant="secondary">{key === "work_mode" && <Icon aria-hidden="true" />}{value}</Badge>)}</div>
      </CardHeader>
      {!preview && job.published_at && <CardContent><p className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDaysIcon aria-hidden="true" className="size-4 shrink-0" /><span>Publicada el <time dateTime={job.published_at}>{formatPublishedDate(job.published_at)}</time></span></p></CardContent>}
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
                  <PublicRequirementsProfile profile={job.requirements_profile} />
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
            {companyLoading ? <div className="flex flex-col gap-3"><Skeleton aria-hidden="true" className="h-5 w-48 max-w-full" /><Skeleton aria-hidden="true" className="h-10 w-full" /></div> : company && <div className="flex flex-col gap-3"><h3 className="font-semibold">¿Te ves en este equipo?</h3><p className="text-sm leading-relaxed text-muted-foreground">Da el siguiente paso en tu carrera con {company.name}.</p></div>}
            <div className="flex flex-col gap-2">
              {preview ? <Button type="button" disabled className="h-12 w-full">Disponible al publicar</Button> : <PublicApplyLink jobId={job.id} />}
              {!preview && <PublicShareButton />}
              <PublicApplicants applicants={job.applicants} />
              <PublicScreeningInfo count={job.screening_questions} />
            </div>
          </CardContent>
          {hasCompanySlot && <CardFooter className={PUBLIC_COMPANY_FOOTER}>{companyLoading ? <><Skeleton aria-hidden="true" className="size-5 shrink-0" /><div className="flex min-w-0 flex-col gap-1"><Skeleton aria-hidden="true" className="h-5 w-36 max-w-full" /><Skeleton aria-hidden="true" className="h-5 w-44 max-w-full" /></div></> : company && <><Building2Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" /><div data-public-company-footer="" className="flex min-w-0 flex-col gap-1"><p className="text-sm font-medium break-words">{company.name}</p>{companyContext && <p className="text-sm text-muted-foreground">{companyContext}</p>}</div></>}</CardFooter>}
        </Card>
      </aside>
    </div>
  </article>;
}
