"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { getSession, signIn } from "next-auth/react";
import { CircleAlertIcon, CircleCheckIcon, EyeIcon, EyeOffIcon, HourglassIcon, InfoIcon, WifiOffIcon } from "lucide-react";
import type { SocialProvider, SocialProviderId } from "@/lib/auth/social";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Spinner } from "../../ui/spinner";
import styles from "../login-screen.module.css";
import { ALERT_COPY, FIELD_COPY, MISSING_EMAIL, MISSING_PASSWORD, PROVIDER_LABEL, type SignInAlertKind } from "./copy";
import { navigateTo } from "./navigate";
import { classifySignInResult } from "./outcome";
import { forgetPendingEmail, rememberPendingEmail, takeSignInHandoff, type SignInHandoff } from "./pending-email";
import { ProviderIcon } from "./provider-icons";
import { AUTH_PATHS, type SignInAudience } from "./routes";

/** Notices the page derives from the session or the URL (never reflected text). */
export type SignInNotice = "expired" | "callback" | "email_in_use";

export type SignInFormProps = {
  audience: SignInAudience;
  /** Already validated by the caller (employerReturnPath / candidateAuthHref). */
  callbackUrl: string;
  /** Enabled on the server (resolveSocialProviders); filtered per audience here. */
  socialProviders: readonly SocialProvider[];
  notice?: SignInNotice | null;
  /** True while the session state is loading. */
  disabled?: boolean;
};

/** Artboard 01: employers see Google, Microsoft and LinkedIn; candidates Google and LinkedIn. */
const PROVIDERS_BY_AUDIENCE: Record<SignInAudience, readonly SocialProviderId[]> = {
  employer: ["google", "microsoft", "linkedin"],
  candidate: ["google", "linkedin"],
};

/** Artboard «Ingresando…»: after 10 s the screen offers «No pudimos conectarnos.» with the data intact. */
export const SIGN_IN_TIMEOUT_MS = 10_000;

const TIMED_OUT = Symbol("timed-out");

const FOCUS_RING = "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const FIELD_CLASS = "h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] text-foreground placeholder:text-muted-foreground/70 read-only:text-muted-foreground md:text-[15px]";
const TONE_CLASS = { danger: styles.alertDanger, review: styles.alertReview, info: styles.alertInfo, success: styles.alertSuccess } as const;
const TONE_ICON = { danger: CircleAlertIcon, review: HourglassIcon, info: InfoIcon, success: CircleCheckIcon } as const;

type FieldErrors = { email?: boolean; password?: boolean };
type FocusTarget = "alert" | "email" | "password";

export function SignInForm({ audience, callbackUrl, socialProviders, notice = null, disabled = false }: SignInFormProps) {
  const paths = AUTH_PATHS[audience];
  const copy = FIELD_COPY[audience];
  const idBase = `${audience}-sign-in`;
  const ids = {
    email: `${idBase}-email`, password: `${idBase}-password`, alert: `${idBase}-alert`,
    emailError: `${idBase}-email-error`, passwordError: `${idBase}-password-error`,
  };

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [pending, setPending] = React.useState<"password" | "social" | null>(null);
  const [result, setResult] = React.useState<SignInAlertKind | null>(null);
  const [noticeDismissed, setNoticeDismissed] = React.useState(false);
  const [handoffNotice, setHandoffNotice] = React.useState<SignInHandoff["notice"] | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [focusRequest, setFocusRequest] = React.useState<{ target: FocusTarget; n: number } | null>(null);
  const lock = React.useRef(false);
  const mounted = React.useRef(true);
  // Only the latest attempt may navigate after a late settle (L21).
  const attempts = React.useRef(0);
  const refs = {
    alert: React.useRef<HTMLDivElement>(null),
    email: React.useRef<HTMLInputElement>(null),
    password: React.useRef<HTMLInputElement>(null),
  };

  const requestFocus = (target: FocusTarget) => setFocusRequest((previous) => ({ target, n: (previous?.n ?? 0) + 1 }));

  React.useEffect(() => {
    if (focusRequest) refs[focusRequest.target].current?.focus();
    // refs are stable; only a new request moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  React.useEffect(() => {
    // Back from «Verifica tu correo» or «Recupera tu acceso»: the email is filled in, the password is next.
    const handoff = takeSignInHandoff();
    if (handoff === null) return;
    setEmail(handoff.email);
    setHandoffNotice(handoff.notice);
    requestFocus("password");
  }, []);

  React.useEffect(() => {
    // e-social: back on «Ingresar» with the focus on the password.
    if (notice === "email_in_use") requestFocus("password");
  }, [notice]);

  const alertKind: SignInAlertKind | null = result ?? (noticeDismissed ? null : notice ?? handoffNotice);
  const alert = alertKind ? ALERT_COPY[alertKind] : null;
  const credentialsRejected = result === "invalid_credentials";
  const alertCitedByFields = result === "invalid_credentials" || result === "too_many_attempts";
  const busy = pending !== null;
  const providers = PROVIDERS_BY_AUDIENCE[audience]
    .map((id) => socialProviders.find((provider) => provider.id === id))
    .filter((provider): provider is SocialProvider => provider !== undefined);

  function describedBy(fieldError: string | null): string | undefined {
    const parts = [fieldError, alertCitedByFields ? ids.alert : null].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : undefined;
  }

  function startAttempt(kind: "password" | "social"): number {
    attempts.current += 1;
    lock.current = true;
    setPending(kind);
    setResult(null);
    setNoticeDismissed(true);
    return attempts.current;
  }

  function endAttempt(kind: SignInAlertKind, focus: FocusTarget | null) {
    lock.current = false;
    setPending(null);
    setResult(kind);
    if (focus) requestFocus(focus);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || disabled) return;
    const typedEmail = email.trim();
    const missing: FieldErrors = { email: typedEmail === "", password: password === "" };
    if (missing.email || missing.password) {
      setFieldErrors(missing);
      setResult(null);
      requestFocus(missing.email ? "email" : "password");
      return;
    }
    setFieldErrors({});
    // A carried email from an earlier not_confirmed attempt never outlives a new one.
    forgetPendingEmail();
    // The password never stays visible into the next screen.
    setShowPassword(false);
    const attempt = startAttempt("password");

    let timer: ReturnType<typeof setTimeout> | undefined;
    let answer: Awaited<ReturnType<typeof signIn>> | typeof TIMED_OUT;
    const request = signIn("password", { redirect: false, email: typedEmail, password, callbackUrl });
    try {
      answer = await Promise.race([
        request,
        new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), SIGN_IN_TIMEOUT_MS); }),
      ]);
    } catch {
      answer = undefined;
    } finally {
      clearTimeout(timer);
    }
    if (answer === TIMED_OUT) {
      endAttempt("network", "alert");
      // The request may still succeed after the timeout and set the session
      // cookie. Once it settles (either way), the session decides: a live one
      // continues to the destination instead of leaving the network error.
      void request
        .catch(() => undefined)
        .then(() => getSession())
        .then((session) => {
          if (mounted.current && attempt === attempts.current && session && !session.error) navigateTo(callbackUrl);
        })
        .catch(() => {});
      return;
    }

    switch (classifySignInResult(answer)) {
      case "success":
        // Stay locked while the browser leaves.
        return navigateTo(callbackUrl);
      case "not_confirmed":
        // Only reachable with the right password (credentials.ts), so it reveals nothing new.
        rememberPendingEmail(typedEmail, "sign-in");
        // Committed before the browser leaves, so no password is held past here.
        flushSync(() => setPassword(""));
        return navigateTo(paths.verify);
      case "invalid_credentials":
        setPassword("");
        return endAttempt("invalid_credentials", "alert");
      case "too_many_attempts":
        setPassword("");
        return endAttempt("too_many_attempts", "alert");
      default:
        return endAttempt("network", "alert");
    }
  }

  async function startSocial(provider: SocialProvider) {
    if (lock.current || disabled) return;
    startAttempt("social");
    try {
      // NextAuth posts to /api/auth/signin/cognito?identity_provider=… and Cognito
      // forwards straight to the provider's consent screen (S3).
      await signIn("cognito", { callbackUrl }, { identity_provider: provider.identityProvider });
      lock.current = false;
      setPending(null);
    } catch {
      endAttempt("social_failed", "alert");
    }
  }

  const AlertIcon = alertKind === "network" ? WifiOffIcon : alert ? TONE_ICON[alert.tone] : null;

  return (
    <div className="mt-8">
      {alert && AlertIcon && (
        <div
          ref={refs.alert}
          id={ids.alert}
          role={alert.tone === "info" || alert.tone === "success" ? "status" : "alert"}
          tabIndex={-1}
          className={`${styles.alert} ${styles.alert} ${TONE_CLASS[alert.tone]} mb-5 flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-foreground`}
        >
          <AlertIcon aria-hidden="true" className={`${styles.alertIcon} mt-0.5 size-[18px] shrink-0`} />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-5">{alert.title}</p>
            {alert.body && <p className="mt-0.5 text-[13px] leading-[18px] [overflow-wrap:anywhere]">{alert.body}</p>}
            {alert.resetLink && (
              <Link href={paths.forgot} className={`${styles.accentText} ${styles.accentText} inline-flex min-h-11 items-center text-[13px] font-semibold underline-offset-4 hover:underline ${FOCUS_RING}`}>
                {alert.resetLink}
              </Link>
            )}
          </div>
        </div>
      )}

      <form noValidate onSubmit={onSubmit} aria-busy={busy || undefined} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.email} className="text-[13px] font-medium text-foreground">{copy.emailLabel}</Label>
          <Input
            ref={refs.email}
            id={ids.email}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            placeholder={copy.emailPlaceholder}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            readOnly={busy}
            aria-invalid={fieldErrors.email || credentialsRejected || undefined}
            aria-describedby={describedBy(fieldErrors.email ? ids.emailError : null)}
            className={FIELD_CLASS}
          />
          {fieldErrors.email && (
            <p id={ids.emailError} className="flex items-start gap-1.5 text-[13px] leading-[18px] text-status-danger">
              <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{MISSING_EMAIL}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={ids.password} className="text-[13px] font-medium text-foreground">Contraseña</Label>
            <Link href={paths.forgot} className={`${styles.accentText} ${styles.accentText} inline-flex min-h-11 items-center px-0.5 text-[13px] font-semibold underline-offset-4 hover:underline ${FOCUS_RING}`}>
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
          <div className="relative">
            <Input
              ref={refs.password}
              id={ids.password}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              readOnly={busy}
              aria-invalid={fieldErrors.password || credentialsRejected || undefined}
              aria-describedby={describedBy(fieldErrors.password ? ids.passwordError : null)}
              className={`${FIELD_CLASS} pr-12`}
            />
            <button
              type="button"
              aria-controls={ids.password}
              aria-pressed={showPassword}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              // Keep the caret in the field when toggled with the mouse.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setShowPassword((shown) => !shown)}
              className={`absolute right-0.5 top-0.5 grid size-11 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground ${FOCUS_RING}`}
            >
              {showPassword ? <EyeOffIcon aria-hidden="true" className="size-[18px]" /> : <EyeIcon aria-hidden="true" className="size-[18px]" />}
            </button>
          </div>
          {fieldErrors.password && (
            <p id={ids.passwordError} className="flex items-start gap-1.5 text-[13px] leading-[18px] text-status-danger">
              <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{MISSING_PASSWORD}
            </p>
          )}
        </div>

        <Button
          type="submit"
          aria-disabled={pending === "password" || disabled || undefined}
          className={`${styles.cta} ${styles.cta} mt-1 h-12 w-full gap-2.5 text-[15px] font-semibold aria-disabled:cursor-progress aria-disabled:opacity-75`}
        >
          {pending === "password" ? <><Spinner aria-hidden="true" />Ingresando…</> : "Ingresar"}
        </Button>
      </form>

      {providers.length > 0 && (
        <>
          <div className="my-7 flex items-center gap-4 text-[12px] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
            o continúa con
          </div>
          <div className="flex flex-col gap-3">
            {providers.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                variant="outline"
                disabled={busy || disabled}
                onClick={() => void startSocial(provider)}
                className="h-12 w-full justify-center gap-2.5 text-[14px] font-medium text-foreground"
              >
                <ProviderIcon id={provider.id} />
                {`Continuar con ${PROVIDER_LABEL[provider.id]}`}
              </Button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
