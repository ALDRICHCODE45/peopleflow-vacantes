import { Suspense, use } from "react";
import type { RelatedCompany, RelatedResult } from "../related/read";
import type { PublicJobDetail } from "../types";
import { jobPostingJsonLd } from "./job-posting";

type Props = { job: PublicJobDetail; company: Promise<RelatedResult<RelatedCompany>>; siteUrl: string };

function JsonLd({ job, company, siteUrl }: Props) {
  const profile = use(company);
  const data = jobPostingJsonLd(job, { siteUrl, careersHref: profile.ok ? profile.data.careersHref : null });
  if (data === null) return null;
  // `<` is escaped so no text in the posting can close the script element.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</gu, "\\u003c") }} />;
}

/** The careers URL needs the company profile read; the page never waits for it (the detail renders first). */
export function JobPostingScript(props: Props) {
  return <Suspense fallback={null}><JsonLd {...props} /></Suspense>;
}
