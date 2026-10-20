"use client";

import { useGeoCatalog } from "@/features/geo/use-geo-catalog";
import { PublicJobDetailView } from "../../components/PublicJobDetailView";
import type { DraftPublicDetail } from "../../components/public-detail-presentation";
import { publicJobDetailSchema } from "../../schemas";
import { BENEFITS } from "../lists";
import { CONTRACT_TYPES, PROFESSIONAL_AREAS, SENIORITIES, WORK_MODES, WORK_SCHEDULES } from "../scalars";
import { deriveDraftDescriptionPlain } from "../rich/plain";
import { composeDraftFields, type DraftFormState } from "./draft-form-state";
import { resolveDraftRichDescription } from "./draft-rich-description";

const selected = <T extends string>(options: readonly T[], value: string): T | null => options.find(option => option === value) ?? null;
const values = (rows: readonly { value: string }[]) => rows.map(row => row.value).filter(value => value.trim() !== "");

/** Read-only public projection, not a publishable wire object. No requester or private money crosses it. */
export function draftToPublicDetail(state: DraftFormState, locationLabel = state.locationLabel, company: DraftPublicDetail["company"] = null): DraftPublicDetail {
  const description = resolveDraftRichDescription(state.description);
  const benefits = { predefined: state.benefits.flatMap(value => { const code = selected(BENEFITS, value); return code ? [code] : []; }), custom: values(state.custom_benefits) };
  const skills = values(state.skills);
  // The public schema rejects partial amounts and missing currency/cadence/basis.
  const compensation = state.compensation.public_visible
    ? publicJobDetailSchema.innerType().options[1].shape.compensation.safeParse(
      Object.fromEntries(Object.entries(composeDraftFields(state).compensation as Record<string, unknown>).filter(([key]) => key !== "public_visible")),
    ) : null;
  const remoteCountries = state.remote_scope?.kind === "countries"
    ? state.remote_scope.countries.flatMap(id => { const country = state.remoteCountries.find(item => item.id === id); return country ? [country] : []; }) : [];
  return {
    source: "vacancy", id: "", title: state.title.trim() ? state.title : "Título sin definir",
    company,
    published_at: null, applicants: null, screening_questions: null,
    location: null, location_label: locationLabel || null,
    remote_scope: state.work_mode !== "remote" ? null : state.remote_scope?.kind === "anywhere" ? { kind: "anywhere" }
      : remoteCountries.length ? { kind: "countries", countries: remoteCountries } : null,
    work_mode: selected(WORK_MODES, state.work_mode), work_schedule: selected(WORK_SCHEDULES, state.work_schedule),
    contract_type: selected(CONTRACT_TYPES, state.contract_type), professional_area: selected(PROFESSIONAL_AREAS, state.professional_area),
    seniority: selected(SENIORITIES, state.seniority), legacy_employment_type: null, legacy_salary: null,
    compensation: compensation?.success ? compensation.data : null,
    description: description.kind === "ready" ? description.description : null,
    description_plain: description.kind === "ready" ? deriveDraftDescriptionPlain(description.description) ?? "" : "",
    requirements: { required: state.required_requirements || null, preferred: state.preferred_requirements || null },
    benefits, benefits_total: benefits.predefined.length + benefits.custom.length,
    benefits_preview: { predefined: benefits.predefined.slice(0, 3), custom: benefits.custom.slice(0, Math.max(0, 3 - benefits.predefined.length)) },
    skills, skills_preview: skills.slice(0, 6), skills_total: skills.length,
    excerpt: null, excerpt_truncated: false,
  };
}

export function DraftPublicDetail({ state, company = null, companyLoading = false }: { state: DraftFormState; company?: DraftPublicDetail["company"]; companyLoading?: boolean }) {
  const catalog = useGeoCatalog(state.location.state, state.location.country === "MX");
  const country = catalog.countries.data?.items.find(item => item.id === state.location.country)?.name;
  const region = catalog.states.data?.items.find(item => item.id === state.location.state)?.name;
  const municipality = catalog.municipalities.data?.items.find(item => item.id === state.location.municipality)?.name;
  const locationLabel = state.locationLabel ?? (municipality && region ? `${municipality}, ${region}` : region ?? country ?? null);
  return <PublicJobDetailView job={draftToPublicDetail(state, locationLabel, company)} preview companyLoading={companyLoading} />;
}
