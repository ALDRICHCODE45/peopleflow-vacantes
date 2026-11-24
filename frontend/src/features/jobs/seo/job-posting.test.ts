import { expect, it } from "vitest";
import { legacyDetail, vacancyDetail } from "../api/public-fixtures";
import { shareHeadline } from "../components/share-links";
import { jobPostingJsonLd, jobSocialMetadata } from "./job-posting";

const site = "https://empleo.test";

it("describes a published vacancy as a schema.org JobPosting", () => {
  const data = jobPostingJsonLd({ ...vacancyDetail, company: { ...vacancyDetail.company, logo_url: "https://cdn.test/logo.png" } }, { siteUrl: site, careersHref: "/empresas/acme" });
  expect(data).toMatchObject({
    "@context": "https://schema.org", "@type": "JobPosting", title: "Backend Go", description: "Construye servicios seguros.",
    datePosted: "2026-10-16", employmentType: "FULL_TIME", url: `${site}/vacantes/${vacancyDetail.id}`,
    hiringOrganization: { "@type": "Organization", name: "Acme", logo: "https://cdn.test/logo.png", sameAs: `${site}/empresas/acme` },
    jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressCountry: "MX", addressRegion: "Ciudad de México" } },
    baseSalary: { "@type": "MonetaryAmount", currency: "MXN", value: { "@type": "QuantitativeValue", minValue: 30000, maxValue: 40000, unitText: "MONTH" } },
  });
  expect(data).not.toHaveProperty("jobLocationType");
});

it("omits logo, sameAs and salary when they are absent or hidden", () => {
  const data = jobPostingJsonLd({ ...vacancyDetail, compensation: null }, { siteUrl: site, careersHref: null })!;
  expect(data.hiringOrganization).toEqual({ "@type": "Organization", name: "Acme" });
  expect(data).not.toHaveProperty("baseSalary");
});

it("uses a fixed amount, and skips pay periods schema.org cannot express", () => {
  const fixed = { mode: "fixed" as const, amount: "500.00", min: null, max: null, currency: "USD" as const, pay_period: "hourly" as const, basis: "gross" as const };
  expect(jobPostingJsonLd({ ...vacancyDetail, compensation: fixed }, { siteUrl: site, careersHref: null })).toMatchObject({ baseSalary: { currency: "USD", value: { value: 500, unitText: "HOUR" } } });
  expect(jobPostingJsonLd({ ...vacancyDetail, compensation: { ...fixed, pay_period: "semimonthly" } }, { siteUrl: site, careersHref: null })).not.toHaveProperty("baseSalary");
});

it("never turns a null bound or amount into 0: it omits that bound, or the whole salary when nothing is stated", () => {
  const range = { mode: "range" as const, amount: null, min: "30000.00", max: null, currency: "MXN" as const, pay_period: "monthly" as const, basis: "gross" as const };
  const value = (compensation: typeof range | Record<string, unknown>) => (jobPostingJsonLd({ ...vacancyDetail, compensation } as never, { siteUrl: site, careersHref: null }) as { baseSalary?: { value: Record<string, unknown> } }).baseSalary?.value;
  expect(value(range)).toEqual({ "@type": "QuantitativeValue", minValue: 30000, unitText: "MONTH" });
  expect(value({ ...range, min: null, max: "45000.00" })).toEqual({ "@type": "QuantitativeValue", maxValue: 45000, unitText: "MONTH" });
  expect(value({ ...range, min: null })).toBeUndefined();
  expect(value({ ...range, mode: "fixed", min: null, max: null })).toBeUndefined();
  expect(jobPostingJsonLd({ ...vacancyDetail, compensation: { ...range, min: null } } as never, { siteUrl: site, careersHref: null })).not.toHaveProperty("baseSalary");
});

it("falls back to the first 160 characters of the plain description, and uses the share headline for the title", () => {
  const long = "a".repeat(200);
  const meta = jobSocialMetadata({ ...vacancyDetail, excerpt: null, description_plain: long }, `${site}/x`);
  expect((meta.openGraph as { description: string }).description).toHaveLength(160);
  expect((meta.twitter as { title: string }).title).toBe(shareHeadline({ title: vacancyDetail.title, company: vacancyDetail.company.name }));
});

it("marks remote work as telecommute with the applicant countries and no office", () => {
  const remote = { ...vacancyDetail, work_mode: "remote" as const, work_schedule: "part_time" as const, remote_scope: { kind: "countries" as const, countries: [{ id: "MX", name: "México" }] } };
  const data = jobPostingJsonLd(remote, { siteUrl: site, careersHref: null })!;
  expect(data).toMatchObject({ jobLocationType: "TELECOMMUTE", employmentType: "PART_TIME", applicantLocationRequirements: [{ "@type": "Country", name: "México" }] });
  expect(data).not.toHaveProperty("jobLocation");
});

it("emits nothing for catalog (legacy) rows", () => {
  expect(jobPostingJsonLd(legacyDetail, { siteUrl: site, careersHref: null })).toBeNull();
});

it("builds Open Graph and Twitter metadata with the excerpt and, when present, the company logo", () => {
  const meta = jobSocialMetadata({ ...vacancyDetail, company: { ...vacancyDetail.company, logo_url: "https://cdn.test/logo.png" } }, `${site}/vacantes/${vacancyDetail.id}`);
  expect(meta.openGraph).toMatchObject({ type: "website", title: "Backend Go — Acme", description: "Construye servicios seguros.", url: `${site}/vacantes/${vacancyDetail.id}`, siteName: "PeopleFlow", locale: "es_MX", images: [{ url: "https://cdn.test/logo.png" }] });
  expect(meta.twitter).toMatchObject({ card: "summary", title: "Backend Go — Acme", description: "Construye servicios seguros.", images: ["https://cdn.test/logo.png"] });
  const bare = jobSocialMetadata(vacancyDetail, `${site}/x`);
  expect(bare.openGraph).not.toHaveProperty("images");
  expect(bare.twitter).not.toHaveProperty("images");
});
