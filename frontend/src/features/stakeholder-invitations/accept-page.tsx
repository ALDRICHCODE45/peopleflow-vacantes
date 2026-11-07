"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, CircleAlert, CircleCheck, Hourglass, Link2, LogIn, ShieldLock } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { Spinner } from "@/components/ui/spinner";
import { useCompanyMembershipState } from "@/features/employer-company/company-membership-context";
import { useIdentity } from "@/features/identity/identity-session";
import { LogoutButton } from "@/features/identity/identity-states";
import { STAKEHOLDER_HOME } from "@/features/identity/stakeholder-routes";
import { acceptStakeholderInvitationAction } from "./actions";
import { INVITATION_PATH, outcomeFor, type AcceptInvitationResult, type AcceptOutcome } from "./model";

function NoSession({ token }: { token: string }) {
  // The token rides only in the login callback; the employer login accepts this same-site path (§1.3).
  const login = `/empresa/login?callbackUrl=${encodeURIComponent(`${INVITATION_PATH}/${token}`)}`;
  return <StateCard icon={LogIn} tone="info" title="Te invitaron a ver métricas en PeopleFlow"
    description="Inicia sesión o crea una cuenta de empresa para aceptar. Al terminar volverás aquí y la invitación se confirmará sola."
    primaryAction={{ label: "Iniciar sesión", href: login }} />;
}

function Confirming() {
  return <StateCard icon={Hourglass} tone="info" title="Confirmando tu invitación…" description="Esto tarda unos segundos." role="status">
    <Spinner aria-hidden="true" />
  </StateCard>;
}

/**
 * `/empresa/invitacion/[token]`: accepts on the server (a Server Action posts the token in the body), then replaces the
 * URL with a token-free outcome. Only a retryable failure keeps the token, so «Reintentar» can resend it; the API makes
 * a same-user replay a no-op (200, nothing written).
 */
export function AcceptInvitationPage({ token }: { token: string }) {
  const identity = useIdentity();
  const router = useRouter();
  const membership = useCompanyMembershipState();
  const [attempt, setAttempt] = React.useState(0);
  const [result, setResult] = React.useState<{ attempt: number; value: AcceptInvitationResult } | null>(null);
  const signedIn = identity.status === "ready";
  // The router and the membership reload are read through a ref: the accept runs once per attempt, never again
  // because one of them changed identity (a reload re-renders this page).
  const latest = React.useRef({ router, membership });
  React.useEffect(() => { latest.current = { router, membership }; });
  React.useEffect(() => {
    if (!signedIn) return;
    let active = true;
    void acceptStakeholderInvitationAction(token)
      .catch((): AcceptInvitationResult => ({ ok: false, reason: "no_response", reference: {} }))
      .then(value => {
        if (!active) return;
        setResult({ attempt, value });
        const outcome = outcomeFor(value);
        if (!outcome) return;
        if (value.ok) latest.current.membership?.reload();
        latest.current.router.replace(`${INVITATION_PATH}?estado=${outcome}`);
      });
    return () => { active = false; };
  }, [signedIn, token, attempt]);
  const current = result?.attempt === attempt ? result.value : null;
  if (identity.status === "unauthenticated" || (current && !current.ok && current.reason === "unauthenticated")) return <NoSession token={token} />;
  if (!current || outcomeFor(current)) return <Confirming />;
  return <StateCard icon={CircleAlert} tone="error" title="No pudimos confirmar tu invitación"
    description="No se completó nada todavía. Puedes reintentar sin riesgo."
    primaryAction={{ label: "Reintentar", onClick: () => setAttempt(value => value + 1) }} />;
}

/** Token-free `/empresa/invitacion?estado=…`: what happened, from the invitee's side (artboard 04). */
export function AcceptOutcomePage({ outcome }: { outcome: AcceptOutcome | null }) {
  const membership = useCompanyMembershipState();
  const state = membership?.state;
  if (outcome === "unido") {
    // The query string proves nothing: the welcome shows only when the membership really is a stakeholder.
    if (membership && membership.userId !== null && state === null) return <Confirming />;
    if (state?.kind === "exists" && state.role === "stakeholder") return <StateCard icon={CircleCheck} tone="info" title={`Te uniste a ${state.company.name}`}
      description="Tienes acceso de solo lectura a las métricas de la empresa. Puedes ver nombres de candidatos en el detalle; cada consulta queda registrada."
      primaryAction={{ label: "Ver métricas", href: STAKEHOLDER_HOME }} />;
  }
  if (outcome === "invalida") return <StateCard icon={Hourglass} tone="empty" title="Este enlace ya no es válido"
    description="Puede haber vencido, haberse revocado o ya se usó. Pide a quien te invitó un enlace nuevo."
    primaryAction={{ label: "Ir al inicio", href: "/" }} />;
  if (outcome === "cuenta-candidato") return <StateCard icon={ShieldLock} tone="forbidden" title="Este enlace es para cuentas de empresa"
    description="Entraste con una cuenta de candidato. Cierra sesión, entra con una cuenta de empresa (o crea una) y vuelve a abrir el enlace que te enviaron.">
    <LogoutButton area="candidate" />
  </StateCard>;
  if (outcome === "ya-miembro") return <StateCard icon={Building2} tone="info" title="Ya perteneces a una empresa"
    description="Tu cuenta ya es parte de otra empresa y solo puede pertenecer a una. Para ver estas métricas, usa otra cuenta de empresa."
    primaryAction={{ label: "Ir a mi empresa", href: "/empresa/dashboard" }}>
    <LogoutButton area="employer" />
  </StateCard>;
  return <StateCard icon={Link2} tone="empty" title="Abre tu enlace de invitación"
    description="Para unirte como stakeholder necesitas el enlace que te envió la persona dueña de la cuenta."
    primaryAction={{ label: "Ir al inicio", href: "/" }} />;
}
