"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SessionProvider, useSession } from "next-auth/react";
import { signOutWithAudit } from "@/lib/audit/sign-out";
import type { SocialProvider } from "@/lib/auth/social";

import { Button } from "../ui/button";
import { signInNotice } from "./sign-in/notice";
import { SignInForm } from "./sign-in/SignInForm";

/**
 * Where to land after signing in: only a same-site employer page the area guard
 * sent us from (`/empresa/...`, no scheme, host, backslash or dot segment);
 * anything else (including this login page itself) falls back to the dashboard, whose guard routes each role.
 */
function employerReturnPath(value: string | null): string {
  if (!value || !/^\/empresa(\/[A-Za-z0-9_-]+)*\/?$/u.test(value) || /^\/empresa\/login\/?$/u.test(value)) return "/empresa/dashboard";
  return value;
}

// Identity here is not proof of company membership or API authorization.
function EmployerSignIn({ socialProviders }: { socialProviders: readonly SocialProvider[] }) {
  const { data: session, status } = useSession();
  const params = useSearchParams();
  const [pending, setPending] = React.useState(false);
  const [logoutError, setLogoutError] = React.useState<string | null>(null);
  const expired = Boolean((session as { error?: string } | null)?.error);
  const authenticated = status === "authenticated" && !expired;

  async function logout() {
    if (pending) return;
    setLogoutError(null);
    setPending(true);
    try {
      // NextAuth posts its CSRF-protected sign-out before navigating to our
      // same-origin endpoint, which ends the session by its kind (logout.ts).
      await signOutWithAudit("/api/auth/cognito/logout");
    } catch {
      setLogoutError("No pudimos cerrar la sesión. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  const logoutButton = (
    <Button type="button" variant="outline" onClick={logout} disabled={pending}
      className="h-12 w-full text-[15px]">
      Cerrar sesión
    </Button>
  );

  if (!authenticated) {
    return (
      <>
        <SignInForm
          audience="employer"
          callbackUrl={employerReturnPath(params.get("callbackUrl"))}
          socialProviders={socialProviders}
          notice={signInNotice(expired, params)}
          disabled={status === "loading"}
        />
        {/* An expired session still holds a cookie: let the person clear it (baseline behavior). */}
        {expired && (
          <div className="mt-3 flex flex-col gap-3" aria-busy={pending}>
            {logoutError && <p role="alert" className="text-sm text-destructive">{logoutError}</p>}
            {logoutButton}
          </div>
        )}
      </>
    );
  }

  // A stale callback error in the URL is ignored once signed in.
  return (
    <div className="mt-8 flex flex-col gap-5" aria-busy={pending}>
      {logoutError && <p role="alert" className="text-sm text-destructive">{logoutError}</p>}
      <p role="status" className="text-sm text-muted-foreground">Sesión iniciada.</p>
      <Button nativeButton={false} role="link" render={<Link href="/empresa/dashboard" />}
        className="h-12 w-full text-[15px] font-semibold">
        Ir a mi panel
      </Button>
      {logoutButton}
    </div>
  );
}

export function EmployerAuthControls({ socialProviders = [] }: { socialProviders?: readonly SocialProvider[] }) {
  return (
    <SessionProvider refetchInterval={60} refetchOnWindowFocus>
      <EmployerSignIn socialProviders={socialProviders} />
    </SessionProvider>
  );
}
