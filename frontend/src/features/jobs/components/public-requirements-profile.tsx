"use client";

import { EDUCATION_LEVEL_LABELS } from "@/features/candidate/model";
import { plural } from "@/features/employer-vacancies/plural";
import { useLanguageCatalog } from "@/features/languages/use-language-catalog";
import { Button } from "@/components/ui/button";
import type { PublicJobDetail } from "../types";

type Profile = PublicJobDetail["requirements_profile"];
const numberFormat = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

/** Only language requirements need the catalog; empty profiles never trigger a read. */
function LanguageRequirements({ languages }: { languages: Profile["languages"] }) {
  const catalog = useLanguageCatalog();
  return <>
    <p>Idiomas: {catalog.status === "success" ? languages.map(language => {
      const name = catalog.data?.items.find(item => item.code === language.code)?.name ?? "Idioma no disponible";
      return `${name} ${language.min_level === "native" ? "Nativo" : `${language.min_level} o más`}`;
    }).join(", ") : catalog.status === "error" ? "No pudimos cargar los nombres." : "Cargando idiomas…"}</p>
    {catalog.status === "error" && <Button type="button" variant="outline" className="min-h-10 w-fit" onClick={catalog.retry}>Reintentar idiomas</Button>}
  </>;
}

export function PublicRequirementsProfile({ profile }: { profile: Profile }) {
  const years = profile.min_years_of_experience;
  const education = profile.min_education_level;
  const completed = education === "high_school" || education === "tsu" || education === "phd" ? "concluido" : "concluida";
  return <div className="flex flex-col gap-3">
    {profile.languages.length > 0 && <LanguageRequirements languages={profile.languages} />}
    {years !== null && <p>Experiencia mínima: {plural(Number(years), "año", "años").replace(/^\S+/u, numberFormat.format(Number(years)))}</p>}
    {education !== null && <p>Estudios: {EDUCATION_LEVEL_LABELS[education]} {completed}{profile.accepts_in_progress_education ? " (acepta en curso)" : ""}</p>}
  </div>;
}
