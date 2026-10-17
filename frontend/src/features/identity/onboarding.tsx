"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { IconUserCircle } from "@tabler/icons-react";
import { Card, CardHeader, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ActionBar, ActionStatus } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { createCandidateAccountAction } from "./actions";
import { useIdentity } from "./identity-session";
import { RoleBlocked } from "./identity-states";
import { normalizedName, validName, type IdentityFailure, type IdentityReason } from "./model";

const messages: Record<IdentityReason, { title: string; description: string }> = {
  unauthenticated: { title: "Tu sesión expiró", description: "Vuelve a ingresar para continuar." },
  account_exists: { title: "Esta cuenta ya es de empresa", description: "No se cambió su rol. Usa otro email para tu cuenta de candidato." },
  email_in_use: { title: "Este email ya está en uso", description: "No se creó la cuenta. Usa otro email o consulta a soporte; no vinculamos cuentas por email." },
  email_not_verified: { title: "Verifica tu email", description: "Verifica tu email desde el correo de Cognito y vuelve a ingresar." },
  validation_error: { title: "Revisa el nombre marcado", description: "Corrige tu nombre antes de continuar." },
  identity_unavailable: { title: "No pudimos verificar tu identidad", description: "No se creó la cuenta. Es seguro reintentar cuando quieras." },
  no_response: { title: "No hubo respuesta del servidor", description: "No confirmamos la creación. Reintentar es seguro: no duplica tu cuenta ni cambia su rol." },
  server_error: { title: "El servidor tuvo un problema", description: "No confirmamos la creación. Reintentar es seguro: no duplica tu cuenta ni cambia su rol." },
  unrecognized_response: { title: "No pudimos confirmar el resultado", description: "Reintentar es seguro: no duplica tu cuenta ni cambia su rol." },
};
const retryable = new Set<IdentityReason>(["identity_unavailable", "no_response", "server_error", "unrecognized_response"]);
const nameError = "Escribe un nombre de 2 a 120 caracteres.";

export function CandidateOnboarding() {
  const identity = useIdentity();
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [failure, setFailure] = React.useState<IdentityFailure | null>(null);
  const [created, setCreated] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  const lock = React.useRef(false);
  const statusId = React.useId();
  React.useEffect(() => {
    // Server validation resolves while the input is disabled. Focus only after
    // the pending render has released it (rules §13.6).
    if (fieldError && !pending) input.current?.focus();
  }, [fieldError, pending]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || created || !identity.email) return;
    const full_name = normalizedName(name);
    if (!validName(full_name)) { setFieldError(nameError); input.current?.focus(); return; }
    lock.current = true; setPending(true); setFailure(null); setFieldError(null);
    let result;
    try { result = await createCandidateAccountAction({ full_name }); }
    catch { result = { ok: false, reason: "no_response", reference: {} } as const; }
    if (result.ok && result.data.role === "candidate") {
      setCreated(true);
      notifyActionResult({ key: "candidate-account", type: "success", title: "Cuenta de candidato creada", description: "Tu cuenta está lista. Te llevamos a tu área de candidato." });
      // The entry router replaces the route from this confirmed identity,
      // without another read or a second navigation from the form.
      identity.update(result.data);
    } else {
      const error: IdentityFailure = result.ok ? { ok: false, reason: "unrecognized_response", reference: {} } : result;
      setFailure(error);
      if (error.reason === "validation_error") { setFieldError(nameError); input.current?.focus(); }
      notifyActionResult({ key: "candidate-account", type: "error", ...messages[error.reason], reference: { ...error.reference, at: new Date().toISOString() } });
      if (error.reason === "unauthenticated") router.replace("/candidato/login");
    }
    lock.current = false; setPending(false);
  }
  const status = failure ? <ActionStatus id={statusId} tone="error" text={messages[failure.reason].description} /> : created ? <ActionStatus id={statusId} tone="success" text="Cuenta de candidato creada" /> : null;
  if (failure?.reason === "account_exists") return <><RoleBlocked kind="account-exists" />{status}</>;
  return <form onSubmit={submit} noValidate>
    <Card aria-labelledby="candidate-account-title">
      <CardHeader className="border-b">
        <IconUserCircle aria-hidden="true" className="size-9" />
        <h2 id="candidate-account-title" className="font-heading text-2xl font-semibold">Crear mi cuenta de candidato</h2>
        <CardDescription>Vas a crear una cuenta de candidato con {identity.email}. Esta cuenta no podrá usarse para publicar vacantes.</CardDescription>
      </CardHeader>
      <CardContent><FieldGroup><Field data-invalid={Boolean(fieldError)}>
        <FieldLabel htmlFor="candidate-full-name">Nombre completo</FieldLabel>
        {/* HTML counts UTF-16 units; 240 permits 120 astral code points.
            The shared validator enforces 2–120 normalized code points. */}
        <Input ref={input} id="candidate-full-name" className="min-h-10" autoComplete="name" maxLength={240} required value={name} disabled={pending || created} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? "candidate-name-error" : undefined} onChange={event => { setName(event.target.value); setFieldError(null); }} />
        {fieldError && <FieldError id="candidate-name-error">{fieldError}</FieldError>}
      </Field></FieldGroup></CardContent>
      <CardFooter className="border-t [&_[data-pf-action-bar-actions]]:min-w-0 [&_[data-pf-action-bar-actions]]:shrink">
        <ActionBar status={status}><Button type="submit" className="h-auto min-h-10 max-w-full whitespace-normal" disabled={pending || created || !identity.email} aria-busy={pending} aria-describedby={failure || created ? statusId : undefined}>
          {pending && <Spinner data-icon="inline-start" aria-hidden="true" />}{pending ? "Creando cuenta…" : failure && retryable.has(failure.reason) ? "Reintentar" : "Crear mi cuenta de candidato"}
        </Button></ActionBar>
      </CardFooter>
    </Card>
  </form>;
}
