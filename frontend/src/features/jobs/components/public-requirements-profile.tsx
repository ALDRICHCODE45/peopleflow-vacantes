"use client";

import { EDUCATION_LEVEL_LABELS } from "@/features/candidate/model";
import { plural } from "@/features/employer-vacancies/plural";
import { useLanguageCatalog } from "@/features/languages/use-language-catalog";
import type { ReactNode } from "react";
import { BriefcaseBusinessIcon, GraduationCapIcon, LanguagesIcon, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PUBLIC_DETAIL_FACTS } from "./public-vacancy-layout";
import type { PublicJobDetail } from "../types";

type Profile = PublicJobDetail["requirements_profile"];
const numberFormat = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });

/** Only language requirements need the catalog; empty profiles never trigger a read. */
function LanguageRequirements({ languages }: { languages: Profile["languages"] }) {
  const catalog = useLanguageCatalog();
  if (catalog.status === "error") return <span className="flex flex-col items-start gap-2">No pudimos cargar los nombres.<Button type="button" variant="outline" className="min-h-10 w-fit" onClick={catalog.retry}>Reintentar idiomas</Button></span>;
  if (catalog.status !== "success") return <>Cargando idiomas…</>;
  return <>{languages.map(language => {
    const name = catalog.data?.items.find(item => item.code === language.code)?.name ?? "Idioma no disponible";
    return `${name} ${language.min_level === "native" ? "Nativo" : `${language.min_level} o más`}`;
  }).join(", ")}</>;
}

/** Structured requirements read like «La vacante de un vistazo»: icon, label and value per row. */
export function PublicRequirementsProfile({ profile }: { profile: Profile }) {
  const years = profile.min_years_of_experience;
  const education = profile.min_education_level;
  const completed = education === "high_school" || education === "tsu" || education === "phd" ? "concluido" : "concluida";
  const rows: { key: string; label: string; Icon: LucideIcon; value: ReactNode }[] = [];
  if (profile.languages.length > 0) rows.push({ key: "languages", label: "Idiomas", Icon: LanguagesIcon, value: <LanguageRequirements languages={profile.languages} /> });
  if (years !== null) rows.push({ key: "years", label: "Experiencia mínima", Icon: BriefcaseBusinessIcon, value: plural(Number(years), "año", "años").replace(/^\S+/u, numberFormat.format(Number(years))) });
  if (education !== null) rows.push({ key: "education", label: "Estudios mínimos", Icon: GraduationCapIcon, value: `${EDUCATION_LEVEL_LABELS[education]} ${completed}${profile.accepts_in_progress_education ? " (acepta en curso)" : ""}` });
  if (!rows.length) return null;
  return <dl data-requirements-profile="" className={PUBLIC_DETAIL_FACTS}>
    {rows.map(({ key, label, Icon, value }) => <div key={key} data-fact={key} className="flex min-w-0 flex-col gap-2">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground"><Icon aria-hidden="true" className="size-4 shrink-0" />{label}</dt>
      <dd className="break-words text-sm font-medium">{value}</dd>
    </div>)}
  </dl>;
}
