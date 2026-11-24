import { afterEach, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { legacyDetail, vacancyDetail } from "../api/public-fixtures";
import type { RelatedResult, RelatedCompany } from "../related/read";
import { JobPostingScript } from "./job-posting-script";

afterEach(cleanup);
async function mount(job: Parameters<typeof JobPostingScript>[0]["job"], company: RelatedResult<RelatedCompany>) {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<div><JobPostingScript job={job} company={Promise.resolve(company)} siteUrl="https://empleo.test" /></div>); });
  return view.container.querySelector('script[type="application/ld+json"]');
}

it("embeds the JobPosting with the careers URL once the company read resolves", async () => {
  const script = await mount(vacancyDetail, { ok: true, data: { ...vacancyDetail.company, description: null, sector: null, size: null, careersHref: "/empresas/acme" } });
  expect(JSON.parse(script!.textContent!)).toMatchObject({ "@type": "JobPosting", hiringOrganization: { name: "Acme", sameAs: "https://empleo.test/empresas/acme" } });
});

it("still embeds it, without sameAs, when the company read failed", async () => {
  const data = JSON.parse((await mount(vacancyDetail, { ok: false }))!.textContent!);
  expect(data.hiringOrganization).not.toHaveProperty("sameAs");
});

it("escapes «<» so posting text cannot close the script element, and skips catalog rows", async () => {
  const script = await mount({ ...vacancyDetail, description_plain: "</script><b>x" }, { ok: false });
  expect(script!.textContent).not.toContain("</script>");
  expect(JSON.parse(script!.textContent!).description).toBe("</script><b>x");
  expect(await mount(legacyDetail, { ok: false })).toBeNull();
});
