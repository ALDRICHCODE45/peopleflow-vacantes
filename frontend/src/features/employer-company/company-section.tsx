"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Building2, CircleAlert, Factory, Fingerprint, LogIn, MapPin, ShieldCheck, UsersRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { dismissActionResult, notifyActionResult } from "@/components/feedback/notify";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { StateCard } from "@/components/feedback/state-card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { createCompanyAction, loadCompanyStateAction } from "./actions";
import type { CompanyState, CreateCompanyState } from "./actions";
import { validateCompany } from "./validation";
import type { CompanyFieldErrors } from "./validation";
import { locationReadToValue, locationValueToWrite } from "@/features/geo/model";
import { OptionalLocationField } from "@/features/geo/optional-location-field";
import { CompanyLocationDialog } from "./company-location-dialog";
import type { Company, CompanyEditor, Membership } from "./api/company-client";
import { cn } from "@/lib/utils";

const STATUS = {
  active: { label: "Activa", variant: "success" },
  pending_verification: { label: "En verificación", variant: "review" },
  suspended: { label: "Suspendida", variant: "danger" },
} as const;
const MESSAGES = {
  forbidden: "Necesitas una cuenta de reclutador para crear una empresa.",
  already_exists: "Ya tienes una empresa o el RFC ya está registrado.",
  industry_unavailable: "Esta industria ya no está disponible. Selecciona otra.",
  server_error: "La empresa podría haberse creado. Consulta su estado antes de intentar crearla de nuevo.",
  no_response: "La empresa podría haberse creado. Consulta su estado antes de intentar crearla de nuevo.",
  unrecognized_response: "La empresa podría haberse creado. Consulta su estado antes de intentar crearla de nuevo.",
  unauthenticated: "Inicia sesión en otra pestaña. Tus datos siguen en este formulario.",
};
const TITLES = {
  forbidden: "No tienes permiso para esta acción",
  already_exists: "Esto cambió en otro lugar",
  industry_unavailable: "Revisa los datos de la empresa",
  invalid: "Revisa los datos de la empresa",
  unauthenticated: "Tu sesión expiró",
  server_error: "El servidor tuvo un problema",
  no_response: "No hubo respuesta del servidor",
  unrecognized_response: "No pudimos confirmar el resultado",
};

function needsReload(kind: string | undefined) {
  return kind === "server_error" || kind === "no_response" || kind === "unrecognized_response" || kind === "already_exists";
}
const login = <Link href="/empresa/login" target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", className: "min-h-10" }))}>Iniciar sesión</Link>;

type CompanyFailure = Extract<CompanyState | CreateCompanyState, { reference: object }>;
function notifyCompanyFailure(failure: CompanyFailure, loading: boolean, at: string) {
  const description = loading
    ? failure.kind === "unauthenticated" ? "Inicia sesión para consultar o crear tu empresa."
      : "Puedes volver a consultar sin crear otra empresa."
    : failure.kind === "invalid" ? failure.message ?? "Corrige los campos marcados antes de volver a crear la empresa."
      : MESSAGES[failure.kind];
  notifyActionResult({ key: "company", type: "error", title: TITLES[failure.kind], description, reference: { ...failure.reference, at } });
}

const ROLE_LABEL = { owner: "Dueño", stakeholder: "Stakeholder", recruiter: "Reclutador" } as const;
/** First letter of the first two words: «Grupo Altavista» → «GA». */
const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => Array.from(word)[0]).join("").toLocaleUpperCase("es-MX");

function Fact({ icon: Icon, label, className, children }: { icon: LucideIcon; label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="flex items-center gap-1 text-xs text-muted-foreground"><Icon aria-hidden="true" className="size-3" />{label}</dt>
      <dd className="grid justify-items-start font-medium [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/**
 * The slim identity strip that replaces the old «Datos de tu empresa» card (artboard `settings-redesign/02`): initials, name and
 * state, then RFC, role, industry and location. Only the owner gets «Editar ubicación», which opens the same dialog as before.
 */
function CompanyStrip({ company, role, industryLabel, onAdopt }: { company: Company; role: Membership["role"]; industryLabel: string; onAdopt: (company: CompanyEditor) => void }) {
  const status = STATUS[company.status];
  return (
    <section aria-label="Tu empresa">
      <Card className="grid grid-cols-2 items-start gap-x-6 gap-y-4 py-4 max-md:px-4 md:grid-cols-[auto_minmax(9rem,.9fr)_9.5rem_5.25rem_minmax(0,1.3fr)_minmax(0,1.3fr)] md:px-6">
        <div className="col-span-2 flex min-w-0 items-center gap-3 md:contents">
          <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-xl bg-background text-[15px] font-semibold tracking-wide ring-1 ring-border md:self-center">{initials(company.name)}</span>
          <div className="flex min-w-0 flex-col items-start gap-1 md:self-center">
            <h2 className="font-heading text-lg leading-6 font-semibold [overflow-wrap:anywhere]">{company.name}</h2>
            <Badge variant={status.variant} dot>{status.label}</Badge>
          </div>
        </div>
        <dl className="contents">
          <Fact icon={Fingerprint} label="RFC">{company.rfc}</Fact>
          <Fact icon={UsersRound} label="Tu rol">{ROLE_LABEL[role]}</Fact>
          <Fact icon={Factory} label="Industria" className="col-span-2 md:col-span-1">{industryLabel}</Fact>
          <Fact icon={MapPin} label="Ubicación" className="col-span-2 md:col-span-1">
            <span className={company.location ? undefined : "font-normal text-muted-foreground"}>{company.location?.label ?? "Sin ubicación"}</span>
            {role === "owner" && <CompanyLocationDialog company={company} onAdopt={onAdopt} />}
          </Fact>
        </dl>
      </Card>
    </section>
  );
}

/** The shape of the strip and one group of rows while the company is read. */
function SettingsSkeleton() {
  const row = (key: number) => (
    <li key={key} className="flex items-center gap-3.5 px-4 py-3.5 md:px-5">
      <Skeleton className="size-10 rounded-[14px]" />
      <div className="flex flex-1 flex-col gap-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-3/5" /></div>
      <Skeleton className="h-10 w-24 rounded-2xl" />
    </li>
  );
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span role="status" className="sr-only">Cargando empresa</span>
      <Card aria-hidden="true" className="grid grid-cols-2 items-center gap-x-6 gap-y-4 py-4 max-md:px-4 md:grid-cols-[auto_minmax(9rem,.9fr)_9.5rem_5.25rem_minmax(0,1.3fr)_minmax(0,1.3fr)] md:px-6">
        <Skeleton className="size-12 rounded-xl" />
        <div className="flex flex-col gap-1.5"><Skeleton className="h-5 w-36" /><Skeleton className="h-5 w-14" /></div>
        {[0, 1, 2, 3].map(key => <div key={key} className="flex flex-col gap-1.5"><Skeleton className="h-3 w-12" /><Skeleton className="h-4 w-4/5" /></div>)}
      </Card>
      <div aria-hidden="true">
        <Skeleton className="mb-2 ml-2 h-3 w-24" />
        <Card className="gap-0 py-0"><ul className="flex w-full flex-col divide-y divide-border/60">{[0, 1, 2].map(row)}</ul></Card>
      </div>
    </div>
  );
}

/**
 * Owns the company read and the creation flow. With a company it renders the identity strip and then whatever `children` returns for
 * that membership (the settings rows); without one the create form takes the whole place; a failed read is an error StateCard.
 */
export function CompanySection({ children }: { children?: (membership: { role: Membership["role"]; company: Company }) => ReactNode }) {
  const [state, setState] = useState<CompanyState | { kind: "loading" }>({ kind: "loading" });
  const [input, setInput] = useState({ name: "", rfc: "", industryId: "" });
  const [location, setLocation] = useState(() => locationReadToValue(null));
  const [fields, setFields] = useState<CompanyFieldErrors>({});
  const [result, setResult] = useState<CreateCompanyState | null>(null);
  const [pending, setPending] = useState(false);
  const [reloading, setReloading] = useState(false);
  const submitting = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (Object.keys(fields).length) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fields]);
  const industries = state.kind === "none" ? state.industries : undefined;
  const industryItems = useMemo(() => industries?.map(item => ({ value: item.id, label: item.label_es })) ?? [], [industries]);

  useEffect(() => {
    let active = true;
    const at = new Date().toISOString();
    loadCompanyStateAction().then(next => {
      if (!active) return;
      setState(next);
      if ("reference" in next) notifyCompanyFailure(next, true, at);
    }).catch(() => {
      if (!active) return;
      const failure = { kind: "no_response", reference: {} } as const;
      setState(failure);
      notifyCompanyFailure(failure, true, at);
    });
    return () => { active = false; };
  }, []);

  async function reload() {
    if (reloading) return;
    setReloading(true);
    const at = new Date().toISOString();
    dismissActionResult("company");
    try {
      const next = await loadCompanyStateAction();
      if ("reference" in next) notifyCompanyFailure(next, true, at);
      // Keep entered fields and require reconciliation before another uncertain create.
      if (state.kind === "none" && "reference" in next) setResult(next);
      else { setState(next); setResult(null); }
    } catch {
      const failure = { kind: "no_response", reference: {} } as const;
      notifyCompanyFailure(failure, true, at);
      if (state.kind === "none") setResult(failure);
      else setState(failure);
    } finally { setReloading(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || reloading || needsReload(result?.kind)) return;
    const validation = validateCompany({ ...input, location: locationValueToWrite(location) });
    setFields(validation.fields);
    setResult(null);
    if (Object.keys(validation.fields).length) return;
    submitting.current = true;
    setPending(true);
    const at = new Date().toISOString();
    dismissActionResult("company");
    let next: CreateCompanyState;
    try { next = await createCompanyAction(validation.value); }
    catch { next = { kind: "no_response", reference: {} }; }
    submitting.current = false;
    setPending(false);
    if (next.kind === "created") {
      const industryLabel = state.kind === "none" ? state.industries.find(item => item.id === next.company.industry_id)?.label_es ?? "No disponible" : "No disponible";
      setState({ kind: "exists", company: next.company, role: "owner", industryLabel, canViewTalentBase: true, canViewMetrics: true });
      notifyActionResult({ key: "company", type: "success", title: "Empresa creada", description: "Tu empresa quedó registrada. Ya puedes consultar sus datos aquí." });
      setResult(next);
    } else {
      notifyCompanyFailure(next, false, at);
      setResult(next);
      if (next.kind === "invalid") setFields(next.fields ?? {});
    }
  }

  const retry = <Button type="button" variant="outline" className="min-h-10" disabled={reloading} aria-busy={reloading} aria-describedby="company-action-status" onClick={reload}>{reloading && <Spinner data-icon="inline-start" aria-hidden="true" />}{reloading ? "Consultando…" : "Reintentar"}</Button>;
  const failedResult = result && result.kind !== "created" ? result : null;

  const adopt = (company: CompanyEditor) => setState(current => current.kind === "exists" ? { ...current, company: { ...current.company, ...company } } : current);

  if (state.kind === "loading") return <SettingsSkeleton />;
  if ("reference" in state) {
    const expired = state.kind === "unauthenticated";
    return (
      <StateCard icon={expired ? LogIn : CircleAlert} tone="error" title={expired ? "Tu sesión expiró" : "No pudimos cargar tu empresa"}
        description={expired ? "Inicia sesión para consultar o crear tu empresa." : "Puedes volver a consultar sin crear otra empresa."}>
        <ActionStatus id="company-action-status" tone="error" text="No se cargó · ver aviso" action={expired ? login : retry} />
      </StateCard>
    );
  }
  if (state.kind === "exists") {
    return (
      <div className="flex flex-col gap-6">
        {result?.kind === "created" && <div className="sr-only"><ActionStatus id="company-action-status" tone="success" text="Empresa creada" /></div>}
        <CompanyStrip company={state.company} role={state.role} industryLabel={state.industryLabel} onAdopt={adopt} />
        {children?.({ role: state.role, company: state.company })}
      </div>
    );
  }

  return (
    <section aria-labelledby="company-heading" id="empresa-identidad">
      <Card>
        <CardHeader className="border-b border-border/60">
          <CardTitle><h2 id="company-heading" className="flex items-center gap-3 text-xl font-semibold"><span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Building2 className="size-5" /></span>Tu empresa</h2></CardTitle>
          <CardDescription>Registra tu empresa para preparar tus procesos de reclutamiento.</CardDescription>
        </CardHeader>
        <CardContent>
          <form ref={form} id="company-create" onSubmit={submit} noValidate>
            <FieldGroup>
              <Field data-invalid={!!fields.name}>
                <FieldLabel htmlFor="company-name"><Building2 aria-hidden="true" className="size-3.5" />Nombre de la empresa</FieldLabel>
                <Input id="company-name" className="min-h-10" value={input.name} onChange={event => setInput({ ...input, name: event.target.value })} disabled={pending} aria-invalid={!!fields.name} aria-describedby={fields.name ? "company-name-error" : undefined} />
                <FieldError id="company-name-error">{fields.name}</FieldError>
              </Field>
              <Field data-invalid={!!fields.rfc}>
                <FieldLabel htmlFor="company-rfc"><Fingerprint aria-hidden="true" className="size-3.5" />RFC</FieldLabel>
                <Input id="company-rfc" className="min-h-10" value={input.rfc} onChange={event => setInput({ ...input, rfc: event.target.value })} disabled={pending} aria-invalid={!!fields.rfc} aria-describedby={fields.rfc ? "company-rfc-error" : undefined} />
                <FieldError id="company-rfc-error">{fields.rfc}</FieldError>
              </Field>
              <Field data-invalid={!!fields.industryId}>
                <FieldLabel htmlFor="company-industry"><Factory aria-hidden="true" className="size-3.5" />Industria</FieldLabel>
                <Select items={industryItems} value={input.industryId || null} onValueChange={value => setInput({ ...input, industryId: value ?? "" })} disabled={pending}>
                  <SelectTrigger id="company-industry" className="min-h-10 w-full" aria-invalid={!!fields.industryId} aria-describedby={fields.industryId ? "company-industry-error" : undefined}><SelectValue placeholder="Selecciona una industria" /></SelectTrigger>
                  <SelectContent><SelectGroup>{state.industries.map(item => <SelectItem key={item.id} value={item.id}>{item.label_es}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
                <FieldError id="company-industry-error">{fields.industryId}</FieldError>
              </Field>
              <OptionalLocationField depth="municipality" postalCode label="Ubicación" description="Opcional." value={location} onChange={setLocation} disabled={pending} errors={fields.location} />
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter>
          <div className="flex flex-col items-start gap-2">
            {!needsReload(result?.kind) && <Button type="submit" form="company-create" className="min-h-10" disabled={pending || reloading} aria-busy={pending} aria-describedby={failedResult ? "company-action-status" : undefined}>{pending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <ShieldCheck data-icon="inline-start" aria-hidden="true" />}{pending ? "Creando empresa…" : "Crear empresa"}</Button>}
            <ActionStatusSlot>
              {failedResult && <ActionStatus id="company-action-status" tone="error" text={["server_error", "no_response", "unrecognized_response"].includes(failedResult.kind) ? "Resultado sin confirmar · ver aviso" : "No se creó · ver aviso"} action={failedResult.kind === "unauthenticated" ? login : needsReload(failedResult.kind) ? retry : undefined} />}
            </ActionStatusSlot>
          </div>
        </CardFooter>
      </Card>
    </section>
  );
}
