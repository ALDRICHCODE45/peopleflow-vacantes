"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { loadProfileAction } from "@/features/candidate/profile-actions";
import { countriesSchema, type RemoteScopeRead } from "@/features/geo/model";
import { useGeoResource } from "@/features/geo/use-geo-catalog";
import { ActionStatus } from "@/components/feedback/action-status";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Failure } from "./model";

export type CountryScope = { work_mode?: string | null; remote_scope?: RemoteScopeRead };
export function useCountryGate(job: CountryScope, candidate: boolean, failure?: Failure) {
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof loadProfileAction>>>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!candidate) return;
    let active = true;
    void loadProfileAction().catch(() => ({ ok: false, reason: "no_response", reference: {} } as const)).then(result => { if (active) setProfile(result); });
    return () => { active = false; };
  }, [candidate, attempt]);
  const scope = job.work_mode === "remote" && job.remote_scope?.kind === "countries" ? job.remote_scope.countries : undefined;
  const serverGate = failure?.reason === "applicant_country_required" || failure?.reason === "applicant_country_not_allowed" ? failure : undefined;
  const allowed = serverGate?.allowed ?? scope?.map(country => country.id);
  const needsCatalog = allowed?.some(code => !scope?.some(country => country.id === code)) ?? false;
  const catalog = useGeoResource(needsCatalog ? "countries" : null, countriesSchema);
  const names = allowed?.map(code => scope?.find(country => country.id === code)?.name ?? catalog.data?.items.find(country => country.id === code)?.name);
  // A candidate without a profile yet (null) has no country, exactly like an empty location.
  const country = profile?.ok ? profile.data.profile?.location?.country : undefined;
  const required = serverGate?.reason === "applicant_country_required" || (!serverGate && !!scope && profile?.ok && !country);
  const excluded = serverGate?.reason === "applicant_country_not_allowed" || (!serverGate && !!scope && !!country && !scope.some(item => item.id === country.id));
  const blocked = !!(required || excluded);
  const retryProfile = () => { setProfile(undefined); setAttempt(value => value + 1); };
  // Alert is not installed. Reuse the shared icon/text status composition instead
  // of hand-painting a callout; action results still live in the footer and toast.
  const notice = allowed ? <section aria-label="Países de postulación" className="flex flex-col gap-3">
    {names?.every((name): name is string => !!name) ? <ActionStatus id="application-country-scope" tone="info" text={`Esta vacante solo acepta postulantes de: ${new Intl.ListFormat("es", { style: "long", type: "conjunction" }).format(names)}.`} /> : catalog.status === "error" || catalog.status === "success" ? <><ActionStatus id="application-country-catalog" tone="warning" text="No pudimos mostrar los países aceptados por esta vacante." />{catalog.status === "error" && <Button variant="outline" className="min-h-10 self-start" onClick={catalog.retry}>Reintentar</Button>}</> : <div aria-busy="true"><Skeleton aria-hidden="true" className="h-5 w-full" /><span role="status">Cargando países aceptados</span></div>}
    {!profile && <div aria-busy="true"><Skeleton aria-hidden="true" className="h-5 w-full" /><span role="status">Consultando el país de tu perfil</span></div>}
    {profile && !profile.ok && <><ActionStatus id="application-profile-read" tone="warning" text="No pudimos consultar tu país. El servidor comprobará si puedes postularte al enviar." /><Button variant="outline" className="min-h-10 self-start" onClick={retryProfile}>Reintentar</Button></>}
    {required && <ActionStatus id="application-country-verdict" tone="warning" text="Agrega tu país en tu perfil para postularte." />}
    {excluded && <ActionStatus id="application-country-verdict" tone="warning" text={country ? `Tu perfil indica ${country.name}. Esta vacante no acepta postulaciones desde ahí.` : "Esta vacante no acepta postulaciones desde el país de tu perfil."} />}
    {blocked && <Link href="/candidato/perfil" className={buttonVariants({ variant: "outline", className: "min-h-10 self-start" })}>Completar perfil</Link>}
  </section> : null;
  return { blocked, notice };
}
