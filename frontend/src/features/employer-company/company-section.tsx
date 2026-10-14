"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Building2, Factory, Fingerprint, ShieldCheck, UsersRound } from "lucide-react";
import { sileo } from "sileo";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { createCompanyAction, loadCompanyStateAction } from "./actions";
import type { CompanyState, CreateCompanyState } from "./actions";
import { validateCompany } from "./validation";
import type { CompanyFieldErrors } from "./validation";

const STATUS = {
  active: { label: "Activa", variant: "success" },
  pending_verification: { label: "En verificación", variant: "review" },
  suspended: { label: "Suspendida", variant: "danger" },
} as const;
const MESSAGES = {
  forbidden: "Necesitas una cuenta de reclutador para crear una empresa.",
  already_exists: "Ya tienes una empresa o el RFC ya está registrado.",
  industry_unavailable: "Esta industria ya no está disponible. Selecciona otra.",
  unavailable: "No pudimos confirmar la creación. Consulta el estado de tu empresa antes de volver a enviarla.",
};

function LoginNotice() {
  return <div className="flex flex-col items-start gap-3"><p>Inicia sesión para consultar o crear tu empresa.</p><Link href="/empresa/login" className={buttonVariants({ variant: "outline", className: "min-h-10" })}>Iniciar sesión</Link></div>;
}

export function CompanySection() {
  const [state, setState] = useState<CompanyState | { kind: "loading" }>({ kind: "loading" });
  const [input, setInput] = useState({ name: "", rfc: "", industryId: "" });
  const [fields, setFields] = useState<CompanyFieldErrors>({});
  const [result, setResult] = useState<CreateCompanyState | null>(null);
  const [pending, setPending] = useState(false);
  const [reloading, setReloading] = useState(false);
  const submitting = useRef(false);
  const industries = state.kind === "none" ? state.industries : undefined;
  const industryItems = useMemo(() => industries?.map(item => ({ value: item.id, label: item.label_es })) ?? [], [industries]);

  useEffect(() => {
    let active = true;
    loadCompanyStateAction().then(next => { if (active) setState(next); }).catch(() => { if (active) setState({ kind: "unavailable" }); });
    return () => { active = false; };
  }, []);

  async function reload() {
    if (reloading) return;
    setReloading(true);
    try {
      const next = await loadCompanyStateAction();
      // A failed reconciliation must not unlock another uncertain mutation.
      if (next.kind !== "unavailable" || state.kind !== "none") {
        setState(next);
        setResult(null);
      }
    } catch {
      if (state.kind !== "none") setState({ kind: "unavailable" });
    } finally { setReloading(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || reloading || result?.kind === "unavailable") return;
    const validation = validateCompany(input);
    setFields(validation.fields);
    setResult(null);
    if (Object.keys(validation.fields).length) return;
    submitting.current = true;
    setPending(true);
    let next: CreateCompanyState;
    try { next = await createCompanyAction(validation.value); }
    catch { next = { kind: "unavailable" }; }
    submitting.current = false;
    setPending(false);
    if (next.kind === "created") {
      const industryLabel = state.kind === "none" ? state.industries.find(item => item.id === next.company.industry_id)?.label_es ?? "No disponible" : "No disponible";
      setState({ kind: "exists", company: next.company, role: "owner", industryLabel });
      sileo.success({ title: "Empresa creada" });
    } else if (next.kind === "unauthenticated") setState({ kind: "unauthenticated" });
    else {
      setResult(next);
      if (next.kind === "invalid") setFields(next.fields ?? {});
    }
  }

  const retry = <Button type="button" variant="outline" className="min-h-10" disabled={reloading} aria-busy={reloading} onClick={reload}>{reloading && <Spinner data-icon="inline-start" aria-hidden="true" />}{reloading ? "Consultando…" : "Reintentar"}</Button>;
  const errorMessage = result?.kind === "invalid" ? result.message : result && result.kind in MESSAGES ? MESSAGES[result.kind as keyof typeof MESSAGES] : undefined;

  return (
    <section aria-labelledby="company-heading" id="empresa-identidad">
      <Card>
        <CardHeader className="border-b border-border/60">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Building2 className="size-5" /></span>
            <CardTitle><h2 id="company-heading" className="font-heading text-xl font-semibold">Tu empresa</h2></CardTitle>
          </div>
          <CardDescription>Registra tu empresa para preparar tus procesos de reclutamiento.</CardDescription>
        </CardHeader>
        <CardContent>
          {state.kind === "loading" && <div aria-busy="true" className="flex flex-col gap-5"><span role="status" className="sr-only">Cargando empresa</span>{[0, 1, 2].map(key => <div key={key} aria-hidden="true" className="flex flex-col gap-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-10 w-full" /></div>)}</div>}
          {state.kind === "unauthenticated" && <LoginNotice />}
          {state.kind === "unavailable" && <div className="flex flex-col items-start gap-3"><p role="alert">No pudimos consultar tu empresa. Inténtalo de nuevo.</p>{retry}</div>}
          {state.kind === "exists" && <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3"><p className="font-heading text-lg font-semibold">{state.company.name}</p><Badge variant={STATUS[state.company.status].variant} dot>{STATUS[state.company.status].label}</Badge></div>
            <dl className="grid gap-5 sm:grid-cols-3">
              <div className="flex flex-col gap-1"><dt className="flex items-center gap-1 text-[12.5px] text-muted-foreground"><Fingerprint aria-hidden="true" className="size-3.5" />RFC</dt><dd>{state.company.rfc}</dd></div>
              <div className="flex flex-col gap-1"><dt className="flex items-center gap-1 text-[12.5px] text-muted-foreground"><Factory aria-hidden="true" className="size-3.5" />Industria</dt><dd>{state.industryLabel}</dd></div>
              <div className="flex flex-col gap-1"><dt className="flex items-center gap-1 text-[12.5px] text-muted-foreground"><UsersRound aria-hidden="true" className="size-3.5" />Tu rol</dt><dd>{state.role === "owner" ? "Propietario" : "Reclutador"}</dd></div>
            </dl>
          </div>}
          {state.kind === "none" && <form onSubmit={submit} noValidate className="flex flex-col gap-5">
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
            </FieldGroup>
            {errorMessage && <FieldError>{errorMessage}</FieldError>}
            {result?.kind === "unavailable" ? <div className="flex justify-start">{retry}</div> : <Button type="submit" className="min-h-10 self-start" disabled={pending || reloading} aria-busy={pending}>{pending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <ShieldCheck data-icon="inline-start" aria-hidden="true" />}{pending ? "Creando empresa…" : "Crear empresa"}</Button>}
          </form>}
        </CardContent>
      </Card>
    </section>
  );
}
