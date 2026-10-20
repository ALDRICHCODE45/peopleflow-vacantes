"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Building2, Factory, Fingerprint, MapPin, ShieldCheck, UsersRound } from "lucide-react";
import { dismissActionResult, notifyActionResult } from "@/components/feedback/notify";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { createCompanyAction, loadCompanyStateAction } from "./actions";
import type { CompanyState, CreateCompanyState } from "./actions";
import { validateCompany } from "./validation";
import type { CompanyFieldErrors } from "./validation";
import { locationReadToValue, locationValueToWrite } from "@/features/geo/model";
import { CompanyLocationField } from "./company-location-field";
import { CompanyLocationDialog } from "./company-location-dialog";

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
const login = <Link href="/empresa/login" target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", className: "min-h-10" })}>Iniciar sesión</Link>;

type CompanyFailure = Extract<CompanyState | CreateCompanyState, { reference: object }>;
function notifyCompanyFailure(failure: CompanyFailure, loading: boolean, at: string) {
  const description = loading
    ? failure.kind === "unauthenticated" ? "Inicia sesión para consultar o crear tu empresa."
      : "Puedes volver a consultar sin crear otra empresa."
    : failure.kind === "invalid" ? failure.message ?? "Corrige los campos marcados antes de volver a crear la empresa."
      : MESSAGES[failure.kind];
  notifyActionResult({ key: "company", type: "error", title: TITLES[failure.kind], description, reference: { ...failure.reference, at } });
}

export function CompanySection() {
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
      setState({ kind: "exists", company: next.company, role: "owner", industryLabel });
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

  return (
    <section aria-labelledby="company-heading" id="empresa-identidad">
      <Card>
        <CardHeader className="border-b border-border/60">
          <CardTitle><h2 id="company-heading" className="flex items-center gap-3 text-xl font-semibold"><span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Building2 className="size-5" /></span>Tu empresa</h2></CardTitle>
          <CardDescription>Registra tu empresa para preparar tus procesos de reclutamiento.</CardDescription>
          {state.kind === "exists" && <CardAction><Badge variant={STATUS[state.company.status].variant} dot>{STATUS[state.company.status].label}</Badge></CardAction>}
        </CardHeader>
        <CardContent>
          {state.kind === "loading" && <div aria-busy="true"><span role="status" className="sr-only">Cargando empresa</span><FieldGroup aria-hidden="true">{[0, 1, 2].map(key => <Field key={key}><FieldLabel><Skeleton className="h-5 w-36" /></FieldLabel><Skeleton className="h-10 w-full" /></Field>)}<FieldGroup><FieldSet><FieldLegend><Skeleton className="h-5 w-36" /></FieldLegend><FieldDescription>Opcional.</FieldDescription><FieldGroup><Field><FieldLabel><Skeleton className="h-5 w-20" /></FieldLabel><Skeleton className="h-10 w-full" /></Field></FieldGroup></FieldSet><Skeleton className="h-10 w-40" /></FieldGroup></FieldGroup></div>}
          {state.kind === "unauthenticated" && <ActionStatus id="company-action-status" tone="error" text="No se cargó · ver aviso" action={login} />}
          {(state.kind === "server_error" || state.kind === "no_response" || state.kind === "unrecognized_response") && <ActionStatus id="company-action-status" tone="error" text="No se cargó · ver aviso" action={retry} />}
          {state.kind === "exists" && <div className="flex flex-col gap-5">
            {result?.kind === "created" && <ActionStatus id="company-action-status" tone="success" text="Empresa creada" />}
            <p className="font-heading text-lg font-semibold">{state.company.name}</p>
            <dl className="grid gap-5 sm:grid-cols-3">
              <div className="flex flex-col gap-1"><dt className="flex items-center gap-1 text-[12.5px] text-muted-foreground"><Fingerprint aria-hidden="true" className="size-3.5" />RFC</dt><dd>{state.company.rfc}</dd></div>
              <div className="flex flex-col gap-1"><dt className="flex items-center gap-1 text-[12.5px] text-muted-foreground"><Factory aria-hidden="true" className="size-3.5" />Industria</dt><dd>{state.industryLabel}</dd></div>
              <div className="flex flex-col gap-1"><dt className="flex items-center gap-1 text-[12.5px] text-muted-foreground"><MapPin aria-hidden="true" className="size-3.5" />Ubicación</dt><dd className={state.company.location ? undefined : "text-muted-foreground"}>{state.company.location?.label ?? "Sin ubicación"}</dd></div>
              <div className="flex flex-col gap-1"><dt className="flex items-center gap-1 text-[12.5px] text-muted-foreground"><UsersRound aria-hidden="true" className="size-3.5" />Tu rol</dt><dd>{state.role === "owner" ? "Propietario" : "Reclutador"}</dd></div>
            </dl>
            {state.role === "owner" && <CompanyLocationDialog company={state.company} onAdopt={company => setState(current => current.kind === "exists" ? { ...current, company: { ...current.company, ...company } } : current)} />}
          </div>}
          {state.kind === "none" && <form ref={form} id="company-create" onSubmit={submit} noValidate>
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
              <CompanyLocationField value={location} onChange={setLocation} disabled={pending} errors={fields.location} />
            </FieldGroup>
          </form>}
        </CardContent>
        {state.kind === "loading" && <CardFooter aria-hidden="true"><div className="flex flex-col items-start gap-2"><Skeleton className="h-10 w-40" /><ActionStatusSlot /></div></CardFooter>}
        {state.kind === "none" && <CardFooter>
            <div className="flex flex-col items-start gap-2">
              {!needsReload(result?.kind) && <Button type="submit" form="company-create" className="min-h-10" disabled={pending || reloading} aria-busy={pending} aria-describedby={failedResult ? "company-action-status" : undefined}>{pending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <ShieldCheck data-icon="inline-start" aria-hidden="true" />}{pending ? "Creando empresa…" : "Crear empresa"}</Button>}
              <ActionStatusSlot>
                {failedResult && <ActionStatus id="company-action-status" tone="error" text={["server_error", "no_response", "unrecognized_response"].includes(failedResult.kind) ? "Resultado sin confirmar · ver aviso" : "No se creó · ver aviso"} action={failedResult.kind === "unauthenticated" ? login : needsReload(failedResult.kind) ? retry : undefined} />}
              </ActionStatusSlot>
            </div>
        </CardFooter>}
      </Card>
    </section>
  );
}
