"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SessionProvider, signIn, signOut, useSession } from "next-auth/react";

import { Button } from "../ui/button";

/**
 * Where to land after signing in: only a same-site employer page the area guard
 * sent us from (`/empresa/...`, no scheme, host, backslash or dot segment);
 * anything else falls back to this login page.
 */
function employerReturnPath(value: string | null): string {
  if (!value || !/^\/empresa(\/[A-Za-z0-9_-]+)*\/?$/u.test(value)) return "/empresa/login";
  return value;
}

// Identity here is not proof of company membership or API authorization.
function ManagedLoginControls() {
  const { data: session, status } = useSession();
  const params = useSearchParams();
  const [pending, setPending] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const sessionError = (session as { error?: string } | null)?.error;
  const expired = Boolean(sessionError);
  const authenticated = status === "authenticated" && !expired;
  const error = actionError ?? (expired
    ? "Tu sesión venció. Vuelve a ingresar."
    // A callback error left in the URL is stale once a later attempt signed in.
    : params.has("error") && !authenticated ? "No pudimos completar el acceso. Inténtalo de nuevo." : null);

  async function login() {
    if (pending || status === "loading") return;
    setActionError(null);
    setPending(true);
    try {
      await signIn("cognito", { callbackUrl: employerReturnPath(params.get("callbackUrl")) });
    } catch {
      setActionError("No pudimos iniciar el acceso. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  async function logout() {
    if (pending) return;
    setActionError(null);
    setPending(true);
    try {
      // NextAuth posts its CSRF-protected sign-out before navigating to our
      // same-origin endpoint, which then exits Cognito's managed-login cookie.
      await signOut({ callbackUrl: "/api/auth/cognito/logout" });
    } catch {
      setActionError("No pudimos cerrar la sesión. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-8 flex flex-col gap-5" aria-busy={pending || status === "loading"}>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {authenticated ? (
        <>
          <p role="status" className="text-sm text-muted-foreground">Sesión iniciada.</p>
          <Button nativeButton={false} role="link" render={<Link href="/empresa/dashboard" />}
            className="h-12 w-full rounded-lg text-[15px] font-semibold">
            Ir a mi panel
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Ingresa de forma segura con tu cuenta de empresa.</p>
          <Button type="button" onClick={login} disabled={pending || status === "loading"}
            className="h-12 w-full rounded-lg text-[15px] font-semibold">
            Ingresar con Cognito
          </Button>
        </>
      )}
      {(authenticated || expired) && (
        <Button type="button" variant="outline" onClick={logout} disabled={pending}
          className="h-12 w-full rounded-lg text-[15px]">
          Cerrar sesión
        </Button>
      )}
    </div>
  );
}

export function EmployerAuthControls() {
  return (
    <SessionProvider refetchInterval={60} refetchOnWindowFocus>
      <ManagedLoginControls />
    </SessionProvider>
  );
}
