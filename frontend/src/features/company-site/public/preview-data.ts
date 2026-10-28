import "server-only";
import { getCountries, getMunicipalities, getStates } from "@/features/geo/client";
import type { SiteBlock } from "../model";
import type { PublicSite } from "./schema";
import type { CompanySitePreviewData } from "./presentation-types";
import { listCompanyJobs } from "./read";

/** Anonymous catalog resolution shared by published sites and the draft editor route.
 * Failed catalogs omit the label rather than displaying wire codes as place names. */
export async function resolveOfficeLabels(blocks: SiteBlock[]): Promise<Map<string, string>> {
  const offices = blocks.flatMap(block => block.type === "offices" ? block.content.items : []);
  const locations = offices.flatMap(office => office.location ? [office.location] : []);
  const labels = new Map<string, string>();
  if (!locations.length) return labels;
  const [countries, states] = await Promise.all([getCountries(), locations.some(location => location.country === "MX" && location.state) ? getStates() : Promise.resolve(null)]);
  const stateCodes = [...new Set(locations.filter(location => location.country === "MX" && location.municipality && location.state).map(location => location.state!))];
  const municipalities = new Map(await Promise.all(stateCodes.map(async state => [state, await getMunicipalities(state)] as const)));
  for (const location of locations) {
    const country = countries.ok ? countries.data.items.find(item => item.id === location.country)?.name : undefined;
    const state = states?.ok ? states.data.items.find(item => item.id === location.state)?.name : undefined;
    const catalog = location.state ? municipalities.get(location.state) : undefined;
    const municipality = catalog?.ok ? catalog.data.items.find(item => item.id === location.municipality)?.name : undefined;
    if (country && (!location.state || state) && (!location.municipality || municipality)) labels.set(JSON.stringify(location), [municipality, state, country].filter(Boolean).join(", "));
  }
  return labels;
}

/** The route owns profile loading. This helper adds only public jobs and geo labels. */
export async function loadPreviewData(company: PublicSite["company"], blocks: SiteBlock[]): Promise<CompanySitePreviewData> {
  const [jobs, officeLabels] = await Promise.all([listCompanyJobs(company.id), resolveOfficeLabels(blocks)]);
  return { company, jobs: jobs.ok ? jobs.data.items : [], jobsAvailable: jobs.ok, officeLabels };
}
