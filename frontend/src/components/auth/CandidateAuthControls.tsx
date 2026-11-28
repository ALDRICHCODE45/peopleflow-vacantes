"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SessionProvider, useSession } from "next-auth/react";
import { signOutWithAudit } from "@/lib/audit/sign-out";
import { candidateAuthHref } from "@/features/identity/return-to";
import type { SocialProvider } from "@/lib/auth/social";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ActionStatus, ActionStatusSlot } from "@/components/feedback/action-status";
import { notifyActionResult } from "@/components/feedback/notify";
import { signInNotice } from "./sign-in/notice";
import { SignInForm } from "./sign-in/SignInForm";

/**
 * Candidate «Ingresar»: every sign-in (password or social) lands on
 * /candidato/ingresar, which checks or creates the candidate account and then
 * follows the validated `next`. Sign-up is the PeopleFlow route linked by the
 * login shell (A4.4); the hosted Cognito sign-up is gone.
 */
function CandidateSignIn({ socialProviders }: { socialProviders: readonly SocialProvider[] }) {
  const { data: session, status } = useSession();
  const params = useSearchParams();
  const callbackUrl = candidateAuthHref("ingresar", params.get("next"));
  const statusId = React.useId();
  const [pending, setPending] = React.useState(false);
  const lock = React.useRef(false);
  const [logoutError, setLogoutError] = React.useState<string | null>(null);
  const expired = Boolean(session?.error);
  const authenticated = status === "authenticated" && !expired;

  async function logout() {
    if (lock.current) return;
    lock.current = true; setPending(true); setLogoutError(null);
    try {
      await signOutWithAudit("/api/auth/cognito/logout?to=candidato");
    } catch {
      const message = "No pudimos cerrar la sesión. Inténtalo de nuevo.";
      setLogoutError(message);
      notifyActionResult({ key: "candidate-login", type: "error", title: "No pudimos cerrar la sesión", description: message, reference: { at: new Date().toISOString() } });
    } finally { lock.current = false; setPending(false); }
  }

  const logoutControls = <>
    <Button type="button" variant="outline" className="h-12 w-full text-[15px]" aria-describedby={logoutError ? statusId : undefined} disabled={pending} onClick={() => void logout()}>{pending && <Spinner aria-hidden="true" />}Cerrar sesión</Button>
    <ActionStatusSlot>{logoutError && <ActionStatus id={statusId} tone="error" text={logoutError} />}</ActionStatusSlot>
  </>;
  if (!authenticated) {
    return <>
      <SignInForm audience="candidate" callbackUrl={callbackUrl} socialProviders={socialProviders} notice={signInNotice(expired, params)} disabled={status === "loading"} />
      {/* An expired session still holds a cookie: let the person clear it (baseline behavior). */}
      {expired && <div className="mt-3 flex flex-col gap-3" aria-busy={pending}>{logoutControls}</div>}
    </>;
  }
  return <div className="mt-8 flex flex-col gap-5" aria-busy={pending}>
    <Button nativeButton={false} role="link" render={<Link href={callbackUrl} />} className="h-12 w-full text-[15px] font-semibold">Ir a mi cuenta</Button>
    {logoutControls}
  </div>;
}

export function CandidateAuthControls({ socialProviders = [] }: { socialProviders?: readonly SocialProvider[] }) {
  return <SessionProvider refetchInterval={60} refetchOnWindowFocus><CandidateSignIn socialProviders={socialProviders} /></SessionProvider>;
}
