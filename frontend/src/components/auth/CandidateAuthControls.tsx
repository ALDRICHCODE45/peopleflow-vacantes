"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SessionProvider, getCsrfToken, signIn, signOut, useSession } from "next-auth/react";
import { candidateAuthHref } from "@/features/identity/return-to";
import { toCognitoSignupUrl } from "@/lib/auth/signup-url";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";

function ManagedCandidateLogin() {
  const { data: session, status } = useSession();
  const params = useSearchParams();
  const callbackUrl = candidateAuthHref("ingresar", params.get("next"));
  const statusId = React.useId();
  const [pending, setPending] = React.useState(false);
  const lock = React.useRef(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const expired = Boolean(session?.error);
  const authenticated = status === "authenticated" && !expired;
  const error = actionError ?? (expired ? "Tu sesión venció. Vuelve a ingresar." : params.has("error") && !authenticated ? "No pudimos completar el acceso. Inténtalo de nuevo." : null);
  async function start(logout = false, signup = false) {
    if (lock.current || status === "loading") return;
    lock.current = true; setPending(true); setActionError(null);
    try {
      if (logout) await signOut({ callbackUrl: "/api/auth/cognito/logout?to=candidato" });
      else if (signup) {
        // NextAuth v4 ignores redirect:false for OAuth. Use its standard CSRF
        // POST so NextAuth still creates the state/PKCE cookies and parameters.
        const csrfToken = await getCsrfToken();
        if (!csrfToken) throw new Error("Sign-in failed");
        const response = await fetch("/api/auth/signin/cognito", {
          method: "post",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ csrfToken, callbackUrl, json: "true" }),
        });
        if (!response.ok) throw new Error("Sign-in failed");
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || !("url" in data) || typeof data.url !== "string" || !data.url.trim()) throw new Error("Sign-in failed");
        // Only an absolute http(s) URL navigates; anything else is a failed sign-in.
        if (!/^https?:$/.test(new URL(data.url).protocol)) throw new Error("Sign-in failed");
        window.location.assign(toCognitoSignupUrl(data.url));
      } else await signIn("cognito", { callbackUrl });
    } catch {
      const message = logout ? "No pudimos cerrar la sesión. Inténtalo de nuevo." : "No pudimos iniciar el acceso. Inténtalo de nuevo.";
      setActionError(message);
      notifyActionResult({ key: "candidate-login", type: "error", title: logout ? "No pudimos cerrar la sesión" : "No pudimos iniciar el acceso", description: message, reference: { at: new Date().toISOString() } });
    } finally { lock.current = false; setPending(false); }
  }
  return <div className="mt-8 flex flex-col gap-5" aria-busy={pending || status === "loading"}>
    {error && !actionError && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {authenticated ? <Button nativeButton={false} role="link" render={<Link href={callbackUrl} />} className="min-h-10">Ir a mi cuenta</Button> : <>
      <p className="text-sm text-muted-foreground">Ingresa con tu email y contraseña. Puedes crear tu acceso en la pantalla segura de Cognito.</p>
      <Button type="button" className="min-h-10" aria-describedby={actionError ? statusId : undefined} onClick={() => void start()} disabled={pending || status === "loading"}>{pending && <Spinner aria-hidden="true" />}Ingresar</Button>
      <Button type="button" variant="outline" className="min-h-10" aria-describedby={actionError ? statusId : undefined} onClick={() => void start(false, true)} disabled={pending || status === "loading"}>Crear cuenta</Button>
    </>}
    {(authenticated || expired) && <Button type="button" variant="outline" className="min-h-10" aria-describedby={actionError ? statusId : undefined} disabled={pending} onClick={() => void start(true)}>Cerrar sesión</Button>}
    <ActionStatusSlot>{actionError && <ActionStatus id={statusId} tone="error" text={actionError} />}</ActionStatusSlot>
  </div>;
}
export function CandidateAuthControls() {
  return <SessionProvider refetchInterval={60} refetchOnWindowFocus><ManagedCandidateLogin /></SessionProvider>;
}
