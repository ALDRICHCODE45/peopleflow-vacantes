"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";

/**
 * Temporary local-only bootstrap panel. It performs no automatic action on
 * mount: staging starts only from the explicit "Preparar" action and applying
 * only from the explicit "Aplicar" action, after the human approved the
 * operation in the private local terminal. Only the opaque operation code, its
 * expiry and sanitized codes ever reach this client.
 */
const NONCE_ENDPOINT = "/api/auth/local-bootstrap/nonce";
const STAGE_ENDPOINT = "/api/auth/local-bootstrap/stage";
const APPLY_ENDPOINT = "/api/auth/local-bootstrap/apply";
const CSRF_HEADER = "x-local-bootstrap-csrf";

type Phase = "idle" | "preparing" | "prepared" | "applying";

const MESSAGES: Record<string, string> = {
  invalid_request: "La solicitud no cumple el contrato esperado. No se envió nada a la herramienta.",
  unauthenticated: "Tu sesión no está disponible. Volvé a ingresar con tu cuenta de empresa.",
  bootstrap_forbidden:
    "La operación no está permitida desde este origen o sin la protección anti-CSRF.",
  stage_pending:
    "Ya existe una operación pendiente. Completala o esperá a que expire antes de preparar otra.",
  approval_required:
    "Requiere aprobación en la terminal local privada antes de aplicarla.",
  identity_conflict:
    "Existe un registro local incompatible. Detené la operación y revisalo manualmente.",
  operation_expired: "El código expiró. Prepará una operación nueva.",
  identity_provider_unavailable:
    "No se pudo verificar la identidad con el proveedor. Reintentá más tarde.",
  bootstrap_failed: "La herramienta de bootstrap no pudo completar la operación.",
  local_bootstrap_unavailable: "El bootstrap local está deshabilitado o mal configurado.",
};

const AMBIGUOUS_MESSAGE =
  "No pudimos confirmar el resultado. No reintentes automáticamente: verificá el estado antes de volver a intentar.";
const NETWORK_MESSAGE =
  "No pudimos contactar la herramienta local. Verificá que esté disponible.";

/**
 * Codes that can mean the apply outcome is unknown (a write may or may not have
 * happened). They must never be presented as a failed write and must never be
 * retried automatically; both actions stay disabled until a human verifies.
 */
const UNCERTAIN_CODES = new Set(["bootstrap_failed"]);

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function messageFor(body: Record<string, unknown> | null, fallback: string): string {
  const code = body?.ok === false && typeof body.code === "string" ? body.code : null;
  return code !== null && MESSAGES[code] ? MESSAGES[code] : fallback;
}

export function BootstrapLocalPanel() {
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [operationCode, setOperationCode] = React.useState<string | null>(null);
  const [expiresAt, setExpiresAt] = React.useState<number | null>(null);
  const [csrfToken, setCsrfToken] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [uncertain, setUncertain] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (expiresAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  const busy = phase === "preparing" || phase === "applying";
  const remainingSeconds =
    expiresAt === null ? 0 : Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const expired = expiresAt !== null && remainingSeconds <= 0;
  const canPrepare = phase === "idle";
  const canApply = phase === "prepared" && operationCode !== null && !expired && !uncertain;
  const displayError = uncertain
    ? AMBIGUOUS_MESSAGE
    : expired
      ? MESSAGES.operation_expired
      : error;

  async function prepare(): Promise<void> {
    if (!canPrepare) return;
    setError(null);
    setStatus(null);
    setUncertain(false);
    setOperationCode(null);
    setExpiresAt(null);
    setCsrfToken(null);
    setPhase("preparing");
    try {
      const nonceResponse = await fetch(NONCE_ENDPOINT, { method: "GET", cache: "no-store" });
      const nonceBody = await readJson(nonceResponse);
      if (nonceResponse.status !== 200 || nonceBody?.ok !== true || typeof nonceBody.nonce !== "string") {
        setError(messageFor(nonceBody, NETWORK_MESSAGE));
        setPhase("idle");
        return;
      }
      const token = nonceBody.nonce;
      setCsrfToken(token);

      const stageResponse = await fetch(STAGE_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        headers: { [CSRF_HEADER]: token, "content-type": "application/json" },
        body: "{}",
      });
      const stageBody = await readJson(stageResponse);
      if (
        stageResponse.status === 202 &&
        stageBody !== null &&
        stageBody.ok === true &&
        typeof stageBody.operation_code === "string" &&
        typeof stageBody.expires_in === "number"
      ) {
        const stamp = Date.now();
        setOperationCode(stageBody.operation_code);
        setExpiresAt(stamp + stageBody.expires_in * 1000);
        setNow(stamp);
        setPhase("prepared");
        return;
      }
      setError(messageFor(stageBody, MESSAGES.bootstrap_failed));
      setPhase("idle");
    } catch {
      setError(NETWORK_MESSAGE);
      setPhase("idle");
    }
  }

  async function apply(): Promise<void> {
    if (!canApply || operationCode === null || csrfToken === null) return;
    setError(null);
    setStatus(null);
    setPhase("applying");
    const code = operationCode;
    try {
      const response = await fetch(APPLY_ENDPOINT, {
        method: "POST",
        cache: "no-store",
        headers: { [CSRF_HEADER]: csrfToken, "content-type": "application/json" },
        body: JSON.stringify({ operation_code: code }),
      });
      const body = await readJson(response);
      if (
        response.status === 200 &&
        body !== null &&
        body.ok === true &&
        (body.code === "created" || body.code === "already_exists")
      ) {
        setStatus(
          body.code === "created"
            ? "Operación completada: se creó el usuario local."
            : "Operación completada: el usuario local ya existía.",
        );
        setOperationCode(null);
        setExpiresAt(null);
        setCsrfToken(null);
        setPhase("idle");
        return;
      }
      if (body !== null && body.ok === false && typeof body.code === "string" && MESSAGES[body.code]) {
        if (body.code === "approval_required") {
          setError(MESSAGES[body.code]);
          setPhase("prepared");
          return;
        }
        if (UNCERTAIN_CODES.has(body.code)) {
          setUncertain(true);
          setError(AMBIGUOUS_MESSAGE);
          setPhase("prepared");
          return;
        }
        setError(MESSAGES[body.code]);
        setOperationCode(null);
        setExpiresAt(null);
        setCsrfToken(null);
        setPhase("idle");
        return;
      }
      setUncertain(true);
      setError(AMBIGUOUS_MESSAGE);
      setPhase("prepared");
    } catch {
      setUncertain(true);
      setError(AMBIGUOUS_MESSAGE);
      setPhase("prepared");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Bootstrap local de identidad</h1>
        <p className="text-sm text-muted-foreground">
          Herramienta temporal, solo local, para crear la fila <code>users</code> de un empleador ya
          autenticado. No crea membresías, empresas ni esquema, y esta página no escribe nada hasta
          que confirmás una acción explícita.
        </p>
      </header>

      <section
        className="flex flex-col gap-5 rounded-2xl border border-border p-5"
        aria-busy={busy}
      >
        <div className="flex flex-col gap-2">
          <h2 className="text-base font-semibold">1. Preparar la operación</h2>
          <p className="text-sm text-muted-foreground">
            Genera un código de operación de un solo uso y lo deja pendiente de aprobación en la
            terminal local privada. Esta acción no escribe en la base.
          </p>
          <Button
            type="button"
            onClick={() => void prepare()}
            disabled={!canPrepare}
            className="h-11 self-start rounded-lg px-5 text-[15px] font-semibold"
          >
            {phase === "preparing" ? "Preparando…" : "Preparar operación local"}
          </Button>
        </div>

        {operationCode !== null && (
          <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-4">
            <h2 className="text-base font-semibold">2. Aprobar y aplicar</h2>
            <p className="text-sm text-muted-foreground">
              Aprobá este código en la terminal local privada y después confirmá la aplicación.
            </p>
            <p className="text-sm text-muted-foreground">
              Código de operación (no es una credencial):
            </p>
            <code className="break-all font-mono text-lg font-semibold">{operationCode}</code>
            <p className="text-sm text-muted-foreground">Expira en {remainingSeconds} s.</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void apply()}
              disabled={!canApply}
              className="h-11 self-start rounded-lg px-5 text-[15px] font-semibold"
            >
              {phase === "applying" ? "Aplicando…" : "Aplicar operación aprobada"}
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {displayError && (
            <p role="alert" className="text-sm text-destructive">
              {displayError}
            </p>
          )}
          {status && (
            <p role="status" className="text-sm text-muted-foreground">
              {status}
            </p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2 text-sm text-muted-foreground">
        <h2 className="text-base font-semibold text-foreground">Límites</h2>
        <ul className="list-disc pl-5">
          <li>Solo usuarios: no crea ni modifica empresas, membresías, grupos ni esquema.</li>
          <li>Solo local y deshabilitado por defecto; prohibido en producción.</li>
          <li>
            La ejecución real contra una base de datos requiere una aprobación humana posterior e
            independiente, fuera de esta página.
          </li>
          <li>No compartas códigos, correos, capturas ni valores de configuración en el chat.</li>
        </ul>
      </section>
    </main>
  );
}
