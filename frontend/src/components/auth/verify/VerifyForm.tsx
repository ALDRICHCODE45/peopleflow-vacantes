"use client";

import * as React from "react";
import Link from "next/link";
import { CircleAlertIcon } from "lucide-react";
import { confirmSignUpAction, resendCodeAction } from "@/lib/auth/sign-up/actions";
import { validCode, validEmail, type ConfirmSignUpActionResult, type ResendCodeActionResult } from "@/lib/auth/sign-up/contract";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Spinner } from "../../ui/spinner";
import { AUTH_FOCUS_RING, AUTH_LINK_CLASS, AuthAlert } from "../auth-alert";
import { AuthHeading } from "../auth-heading";
import styles from "../login-screen.module.css";
import { navigateTo } from "../sign-in/navigate";
import {
  forgetPendingEmail,
  rememberPendingEmail,
  rememberVerifiedEmail,
  takePendingVerification,
  type PendingOrigin,
} from "../sign-in/pending-email";
import { AUTH_PATHS, type SignInAudience } from "../sign-in/routes";
import { CodeInput, emptyCode, type CodeInputHandle } from "./CodeInput";
import {
  ASK_EMAIL,
  BACK_TO_SIGN_IN,
  CHANGE_EMAIL,
  CODE_HINT,
  EXPIRED_ACTION,
  RESEND_COOLDOWN_SECONDS,
  RESEND_LABEL,
  RESEND_LEAD,
  VERIFY_ALERTS,
  VERIFY_ERRORS,
  VERIFY_EYEBROW,
  VERIFY_HEADING,
  formatCooldown,
  type VerifyAlertKind,
} from "./copy";
import { useCooldown } from "./use-cooldown";

const FIELD_CLASS = "h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] text-foreground placeholder:text-muted-foreground/70 read-only:text-muted-foreground md:text-[15px]";

type Arrival = { email: string | null; origin: PendingOrigin | null };
type ResendMode = "arrival" | "button" | "expired";
type FocusTarget = "alert" | "email" | "verify" | { box: number };

/**
 * «Verifica tu correo» (artboard 01, A4.4). The email comes only from session
 * storage (sign-up or the sign-in not_confirmed handoff), else the person types
 * it; it is kept there without its origin so a reload keeps the email but never
 * resends again. Arrival from sign-in resends a code (Cognito sent none on
 * InitiateAuth); arrival from sign-up does not (SignUp just sent one).
 *
 * Success does not sign in: Cognito's confirmation returns no tokens, and the
 * password is deliberately not carried here (not in storage, not in memory
 * across screens), so «Ingresar» opens with «Tu correo quedó verificado.» and
 * the email filled in. «Cambiar correo» starts the sign-up again: an
 * unconfirmed Cognito user cannot change its sign-in email.
 */
export function VerifyForm({ audience }: { audience: SignInAudience }) {
  const paths = AUTH_PATHS[audience];
  const idBase = `${audience}-verify`;
  const ids = { alert: `${idBase}-alert`, codeError: `${idBase}-code-error`, email: `${idBase}-email`, emailError: `${idBase}-email-error` };

  const [arrival, setArrival] = React.useState<Arrival | undefined>(undefined);
  const [email, setEmail] = React.useState<string | null>(null);
  const [typedEmail, setTypedEmail] = React.useState("");
  const [emailError, setEmailError] = React.useState(false);
  const [digits, setDigits] = React.useState<string[]>(emptyCode);
  const [codeError, setCodeError] = React.useState(false);
  const [codeRejected, setCodeRejected] = React.useState(false);
  const [alertKind, setAlertKind] = React.useState<VerifyAlertKind | null>(null);
  const [pending, setPending] = React.useState<"verify" | "resend" | null>(null);
  const [focusRequest, setFocusRequest] = React.useState<{ target: FocusTarget; n: number } | null>(null);
  const cooldown = useCooldown();
  const lock = React.useRef(false);
  const mounted = React.useRef(true);
  const taken = React.useRef(false);
  const code = React.useRef<CodeInputHandle>(null);
  const alertRef = React.useRef<HTMLDivElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const verifyRef = React.useRef<HTMLButtonElement>(null);

  const requestFocus = (target: FocusTarget) => setFocusRequest((previous) => ({ target, n: (previous?.n ?? 0) + 1 }));

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  React.useEffect(() => {
    if (!focusRequest) return;
    const { target } = focusRequest;
    if (target === "alert") alertRef.current?.focus();
    else if (target === "email") emailRef.current?.focus();
    else if (target === "verify") verifyRef.current?.focus();
    else code.current?.focus(target.box);
  }, [focusRequest]);

  async function resend(to: string, mode: ResendMode) {
    if (lock.current) return;
    lock.current = true;
    setPending("resend");
    let result: ResendCodeActionResult;
    try {
      result = await resendCodeAction({ email: to });
    } catch {
      result = { ok: false, reason: "unavailable" };
    }
    if (!mounted.current) return;
    lock.current = false;
    setPending(null);
    if (result.ok) {
      cooldown.start(RESEND_COOLDOWN_SECONDS);
      setAlertKind(mode === "arrival" ? "unverified" : "resent");
      if (mode !== "arrival") {
        // The previous code no longer works.
        setDigits(emptyCode());
        setCodeRejected(false);
        setCodeError(false);
      }
      if (mode === "expired") requestFocus({ box: 0 });
      return;
    }
    setAlertKind(result.reason === "too_many_attempts" ? "too_many_attempts" : "network");
    requestFocus("alert");
  }

  React.useEffect(() => {
    // Read once, also under StrictMode's double effects: taking the email consumes it.
    if (taken.current) return;
    taken.current = true;
    const carried = takePendingVerification();
    if (!carried) {
      setArrival({ email: null, origin: null });
      return;
    }
    // Kept for a reload of this screen, without the handoff that would resend again.
    rememberPendingEmail(carried.email, null);
    setArrival(carried);
    setEmail(carried.email);
    if (carried.origin === "sign-up") cooldown.start(RESEND_COOLDOWN_SECONDS);
    if (carried.origin === "sign-in") void resend(carried.email, "arrival");
    // Runs once on arrival; resend/cooldown are stable for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onEmailSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validEmail(typedEmail)) {
      setEmailError(true);
      requestFocus("email");
      return;
    }
    const chosen = typedEmail.trim();
    setEmailError(false);
    rememberPendingEmail(chosen, null);
    setEmail(chosen);
    requestFocus({ box: 0 });
  }

  function onDigitsChange(next: string[]) {
    setDigits(next);
    setCodeError(false);
    setCodeRejected(false);
  }

  async function onVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || email === null) return;
    const value = digits.join("");
    if (!validCode(value)) {
      setCodeError(true);
      const firstEmpty = digits.findIndex((digit) => digit === "");
      requestFocus({ box: firstEmpty === -1 ? 0 : firstEmpty });
      return;
    }
    lock.current = true;
    setPending("verify");
    setAlertKind(null);
    let result: ConfirmSignUpActionResult;
    try {
      result = await confirmSignUpAction({ email, code: value });
    } catch {
      result = { ok: false, reason: "unavailable" };
    }
    if (!mounted.current) return;
    if (result.ok) {
      forgetPendingEmail();
      rememberVerifiedEmail(email);
      // Stay locked while the browser leaves.
      return navigateTo(paths.login);
    }
    lock.current = false;
    setPending(null);
    switch (result.reason) {
      case "code_mismatch":
      case "invalid_input":
        setAlertKind("code_mismatch");
        setCodeRejected(true);
        return requestFocus({ box: 0 });
      case "code_expired":
        setAlertKind("code_expired");
        setCodeRejected(true);
        return requestFocus("alert");
      case "too_many_attempts":
        setAlertKind("too_many_attempts");
        return requestFocus("alert");
      default:
        setAlertKind("network");
        return requestFocus("alert");
    }
  }

  const origin = arrival?.origin ?? null;
  const eyebrow = origin === "sign-up" ? VERIFY_EYEBROW[audience].signUp : VERIFY_EYEBROW[audience].unverified;
  const alert = alertKind ? VERIFY_ALERTS[alertKind] : null;
  const alertAboutCode = alertKind === "code_mismatch" || alertKind === "code_expired";
  const busy = pending !== null;
  const coolingDown = cooldown.remaining > 0;

  const subheading = email === null
    ? (arrival ? ASK_EMAIL.subheading : null)
    : <>
        Escribe el código de 6 dígitos que enviamos a <b className="font-semibold text-foreground">{email}</b>.{" "}
        <Link href={paths.signUp} onClick={() => forgetPendingEmail()} className={AUTH_LINK_CLASS}>{CHANGE_EMAIL}</Link>
      </>;

  return (
    <>
      <AuthHeading eyebrow={eyebrow} heading={VERIFY_HEADING} subheading={subheading} />

      {arrival && (
        <div className="mt-8">
          {alert && (
            <AuthAlert ref={alertRef} id={ids.alert} tone={alert.tone} title={alert.title} body={alert.body} offline={alertKind === "network"}>
              {alertKind === "code_expired" && email !== null && (
                <button
                  type="button"
                  onClick={() => void resend(email, "expired")}
                  className={`${AUTH_LINK_CLASS} bg-transparent p-0`}
                >
                  {EXPIRED_ACTION}
                </button>
              )}
            </AuthAlert>
          )}

          {email === null ? (
            <form noValidate onSubmit={onEmailSubmit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.email} className="text-[13px] font-medium text-foreground">{ASK_EMAIL.label}</Label>
                <Input
                  ref={emailRef}
                  id={ids.email}
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={typedEmail}
                  onChange={(event) => setTypedEmail(event.target.value)}
                  aria-invalid={emailError || undefined}
                  aria-describedby={emailError ? ids.emailError : undefined}
                  className={FIELD_CLASS}
                />
                {emailError && (
                  <p id={ids.emailError} className="flex items-start gap-1.5 text-[13px] leading-[18px] text-status-danger">
                    <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{VERIFY_ERRORS.email}
                  </p>
                )}
              </div>
              <Button type="submit" className={`${styles.cta} ${styles.cta} h-12 w-full text-[15px] font-semibold`}>{ASK_EMAIL.submit}</Button>
            </form>
          ) : (
            <form noValidate onSubmit={onVerify} aria-busy={busy || undefined} className="flex flex-col gap-5">
              <CodeInput
                ref={code}
                digits={digits}
                onDigitsChange={onDigitsChange}
                onFilled={() => requestFocus("verify")}
                hint={CODE_HINT}
                invalid={codeRejected || codeError}
                readOnly={pending === "verify"}
                describedBy={[alertAboutCode ? ids.alert : null, codeError ? ids.codeError : null].filter(Boolean).join(" ") || undefined}
              />
              {codeError && (
                <p id={ids.codeError} className="-mt-3 flex items-start gap-1.5 text-[13px] leading-[18px] text-status-danger">
                  <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{VERIFY_ERRORS.incomplete}
                </p>
              )}
              <Button
                ref={verifyRef}
                type="submit"
                aria-disabled={pending === "verify" || undefined}
                className={`${styles.cta} ${styles.cta} h-12 w-full gap-2.5 text-[15px] font-semibold aria-disabled:cursor-progress aria-disabled:opacity-75`}
              >
                {pending === "verify" ? <><Spinner aria-hidden="true" />Verificando…</> : "Verificar"}
              </Button>
              <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-[14px] text-muted-foreground">
                {RESEND_LEAD}
                <button
                  type="button"
                  aria-disabled={coolingDown || busy || undefined}
                  onClick={() => { if (!coolingDown) void resend(email, "button"); }}
                  className={`${AUTH_LINK_CLASS} bg-transparent px-1 text-[14px] aria-disabled:cursor-not-allowed aria-disabled:opacity-70 aria-disabled:no-underline`}
                >
                  {coolingDown ? `${RESEND_LABEL} en ${formatCooldown(cooldown.remaining)}` : RESEND_LABEL}
                </button>
              </p>
            </form>
          )}

          {origin !== "sign-up" && (
            <p className="mt-8 text-center text-[13px] text-muted-foreground">
              <Link href={paths.login} className={`inline-flex min-h-11 items-center px-1 font-medium text-foreground underline-offset-4 hover:underline ${AUTH_FOCUS_RING}`}>{BACK_TO_SIGN_IN}</Link>
            </p>
          )}
        </div>
      )}
    </>
  );
}
