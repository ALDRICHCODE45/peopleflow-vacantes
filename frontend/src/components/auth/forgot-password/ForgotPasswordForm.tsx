"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { ArrowLeftIcon, CircleAlertIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { confirmForgotPasswordAction, forgotPasswordAction } from "@/lib/auth/forgot-password/actions";
import type { ConfirmForgotPasswordActionResult, ForgotPasswordActionResult } from "@/lib/auth/forgot-password/contract";
import { meetsPasswordPolicy } from "@/lib/auth/password-policy";
import { validCode, validEmail } from "@/lib/auth/sign-up/contract";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Spinner } from "../../ui/spinner";
import { AUTH_FOCUS_RING, AUTH_LINK_CLASS, AuthAlert } from "../auth-alert";
import { AuthHeading } from "../auth-heading";
import styles from "../login-screen.module.css";
import { FIELD_COPY } from "../sign-in/copy";
import { navigateTo } from "../sign-in/navigate";
import { forgetRecoveryEmail, readRecoveryEmail, rememberPasswordResetEmail, rememberRecoveryEmail } from "../sign-in/pending-email";
import { AUTH_PATHS, type SignInAudience } from "../sign-in/routes";
import { PasswordRequirements } from "../sign-up/PasswordRequirements";
import { CodeInput, emptyCode, type CodeInputHandle } from "../verify/CodeInput";
import { RESEND_COOLDOWN_SECONDS, RESEND_LABEL, RESEND_LEAD, formatCooldown } from "../verify/copy";
import { useCooldown } from "../verify/use-cooldown";
import {
  BACK_TO_SIGN_IN,
  LOST_RESPONSE_ADVISORY,
  RECOVER_ALERTS,
  RECOVER_ERRORS,
  RECOVER_EYEBROW,
  REQUEST_COPY,
  RESET_COPY,
  type RecoverAlertKind,
} from "./copy";

const FIELD_CLASS = "h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] text-foreground placeholder:text-muted-foreground/70 read-only:text-muted-foreground md:text-[15px]";
const CTA_CLASS = `${styles.cta} ${styles.cta} h-12 w-full gap-2.5 text-[15px] font-semibold aria-disabled:cursor-progress aria-disabled:opacity-75`;

type Step = "request" | "reset";
type FocusTarget = "alert" | "email" | "password" | "submit" | { box: number };
type Pending = "request" | "reset" | "resend" | null;

function ErrorText({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-[13px] leading-[18px] text-status-danger">
      <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{children}
    </p>
  );
}

/**
 * «¿Olvidaste tu contraseña?» (artboard 01, A4.6): step 1 asks only for the
 * email; step 2 takes the six-digit code and the new password (live
 * requirements, show / hide, no «confirm password»). The request always ends
 * on «Si hay una cuenta con ese correo, te enviamos un código.» — the server
 * action answers `ok` for unknown, unconfirmed and unverified accounts alike.
 *
 * The email lives in component state and, while step 2 is open, in tab-scoped
 * session storage (a reload keeps it but sends nothing by itself); never in the
 * URL. The new password and the code stay in memory only. A changed password
 * does not sign in (ConfirmForgotPassword returns no tokens): «Ingresar» opens
 * with «Tu contraseña se actualizó.» and the email filled in.
 */
export function ForgotPasswordForm({ audience }: { audience: SignInAudience }) {
  const paths = AUTH_PATHS[audience];
  const idBase = `${audience}-recover`;
  const ids = {
    alert: `${idBase}-alert`, email: `${idBase}-email`, emailError: `${idBase}-email-error`,
    password: `${idBase}-password`, passwordError: `${idBase}-password-error`, requirements: `${idBase}-requirements`,
    codeError: `${idBase}-code-error`,
  };

  const [step, setStep] = React.useState<Step | null>(null);
  const [typedEmail, setTypedEmail] = React.useState("");
  const [email, setEmail] = React.useState<string | null>(null);
  const [emailError, setEmailError] = React.useState(false);
  const [digits, setDigits] = React.useState<string[]>(emptyCode);
  const [codeError, setCodeError] = React.useState(false);
  const [codeRejected, setCodeRejected] = React.useState(false);
  // A confirm that failed as `unavailable` (or threw) may still have changed the
  // password at Cognito with the answer lost; a later «código vencido» then
  // points to «Ingresar» too (L29). Cleared only when the account changes.
  const [confirmMaybeApplied, setConfirmMaybeApplied] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [passwordError, setPasswordError] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [alertKind, setAlertKind] = React.useState<RecoverAlertKind | null>(null);
  const [pending, setPending] = React.useState<Pending>(null);
  const [focusRequest, setFocusRequest] = React.useState<{ target: FocusTarget; n: number } | null>(null);
  const cooldown = useCooldown();
  const lock = React.useRef(false);
  const mounted = React.useRef(true);
  const code = React.useRef<CodeInputHandle>(null);
  const alertRef = React.useRef<HTMLDivElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);
  const submitRef = React.useRef<HTMLButtonElement>(null);

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
    else if (target === "password") passwordRef.current?.focus();
    else if (target === "submit") submitRef.current?.focus();
    else code.current?.focus(target.box);
  }, [focusRequest]);

  React.useEffect(() => {
    // A reload of step 2 keeps the email (read, not consumed) and sends nothing.
    const carried = readRecoveryEmail();
    if (carried) {
      setEmail(carried);
      setTypedEmail(carried);
      setStep("reset");
    } else {
      setStep("request");
    }
  }, []);

  async function requestCode(to: string): Promise<ForgotPasswordActionResult> {
    try {
      return await forgotPasswordAction({ email: to });
    } catch {
      return { ok: false, reason: "unavailable" };
    }
  }

  function failWith(kind: RecoverAlertKind) {
    setAlertKind(kind);
    requestFocus("alert");
  }

  async function onRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    if (!validEmail(typedEmail)) {
      setEmailError(true);
      setAlertKind(null);
      requestFocus("email");
      return;
    }
    const chosen = typedEmail.trim();
    setEmailError(false);
    setAlertKind(null);
    lock.current = true;
    setPending("request");
    const result = await requestCode(chosen);
    if (!mounted.current) return;
    lock.current = false;
    setPending(null);
    if (!result.ok) return failWith(result.reason === "too_many_attempts" ? "too_many_attempts" : "network");
    rememberRecoveryEmail(chosen);
    setEmail(chosen);
    setDigits(emptyCode());
    setCodeError(false);
    setCodeRejected(false);
    setStep("reset");
    cooldown.start(RESEND_COOLDOWN_SECONDS);
    setAlertKind("sent");
    requestFocus("alert");
  }

  async function onResend() {
    if (lock.current || email === null || cooldown.remaining > 0) return;
    lock.current = true;
    setPending("resend");
    const result = await requestCode(email);
    if (!mounted.current) return;
    lock.current = false;
    setPending(null);
    if (!result.ok) return failWith(result.reason === "too_many_attempts" ? "too_many_attempts" : "network");
    cooldown.start(RESEND_COOLDOWN_SECONDS);
    // The previous code no longer works; the new password typed so far stays.
    setDigits(emptyCode());
    setCodeRejected(false);
    setCodeError(false);
    setAlertKind("resent");
  }

  function onUseOtherEmail() {
    if (lock.current) return;
    forgetRecoveryEmail();
    setTypedEmail(email ?? typedEmail);
    setEmail(null);
    setDigits(emptyCode());
    setCodeError(false);
    setCodeRejected(false);
    setConfirmMaybeApplied(false);
    setPasswordError(false);
    setAlertKind(null);
    setStep("request");
    requestFocus("email");
  }

  function onDigitsChange(next: string[]) {
    setDigits(next);
    setCodeError(false);
    setCodeRejected(false);
  }

  async function onReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || email === null) return;
    const value = digits.join("");
    const codeMissing = !validCode(value);
    const passwordWeak = !meetsPasswordPolicy(password);
    setCodeError(codeMissing);
    setPasswordError(passwordWeak);
    if (codeMissing || passwordWeak) {
      setAlertKind(null);
      const firstEmpty = digits.findIndex((digit) => digit === "");
      requestFocus(codeMissing ? { box: firstEmpty === -1 ? 0 : firstEmpty } : "password");
      return;
    }
    setShowPassword(false);
    setAlertKind(null);
    lock.current = true;
    setPending("reset");
    let result: ConfirmForgotPasswordActionResult;
    try {
      result = await confirmForgotPasswordAction({ email, code: value, newPassword: password });
    } catch {
      result = { ok: false, reason: "unavailable" };
    }
    if (!mounted.current) return;
    if (result.ok) {
      forgetRecoveryEmail();
      rememberPasswordResetEmail(email);
      // Committed before the browser leaves, so no password is held past here.
      flushSync(() => setPassword(""));
      // Stay locked while the browser leaves.
      return navigateTo(paths.login);
    }
    lock.current = false;
    setPending(null);
    switch (result.reason) {
      case "code_mismatch":
      case "code_expired":
        setCodeRejected(true);
        return failWith("code_rejected");
      case "invalid_password":
        setPasswordError(true);
        return requestFocus("password");
      case "invalid_input":
        if (result.fields.includes("code")) {
          setCodeRejected(true);
          return failWith("code_rejected");
        }
        if (result.fields.includes("password")) {
          setPasswordError(true);
          return requestFocus("password");
        }
        return failWith("network");
      case "too_many_attempts":
        return failWith("too_many_attempts");
      default:
        setConfirmMaybeApplied(true);
        return failWith("network");
    }
  }

  if (step === null) return null;

  const alert = alertKind ? RECOVER_ALERTS[alertKind] : null;
  const alertAboutCode = alertKind === "code_rejected";
  const coolingDown = cooldown.remaining > 0;
  const backLink = (
    <p className="mt-8 text-center text-[13px] text-muted-foreground">
      <Link href={paths.login} className={`inline-flex min-h-11 items-center gap-1.5 px-1 font-medium text-foreground underline-offset-4 hover:underline ${AUTH_FOCUS_RING}`}>
        <ArrowLeftIcon aria-hidden="true" className="size-3.5" />{BACK_TO_SIGN_IN}
      </Link>
    </p>
  );
  const alertBox = alert && (
    <AuthAlert ref={alertRef} id={ids.alert} tone={alert.tone} title={alert.title} body={alert.body} offline={alertKind === "network"}>
      {alertAboutCode && confirmMaybeApplied && (
        <p className="mt-0.5 text-[13px] leading-[18px]">
          {LOST_RESPONSE_ADVISORY.text}{" "}
          <Link href={paths.login} className={`${styles.accentText} font-semibold underline underline-offset-4 ${AUTH_FOCUS_RING}`}>{LOST_RESPONSE_ADVISORY.link}</Link>
        </p>
      )}
    </AuthAlert>
  );

  if (step === "request") {
    return (
      <>
        <AuthHeading eyebrow={RECOVER_EYEBROW} heading={REQUEST_COPY.heading} subheading={REQUEST_COPY.subheading} />
        <div className="mt-8">
          {alertBox}
          <form noValidate onSubmit={onRequest} aria-busy={pending === "request" || undefined} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.email} className="text-[13px] font-medium text-foreground">{REQUEST_COPY.emailLabel}</Label>
              <Input
                ref={emailRef}
                id={ids.email}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                placeholder={FIELD_COPY[audience].emailPlaceholder}
                value={typedEmail}
                onChange={(event) => setTypedEmail(event.target.value)}
                readOnly={pending === "request"}
                aria-invalid={emailError || undefined}
                aria-describedby={emailError ? ids.emailError : undefined}
                className={FIELD_CLASS}
              />
              {emailError && <ErrorText id={ids.emailError}>{RECOVER_ERRORS.email}</ErrorText>}
            </div>
            <Button type="submit" aria-disabled={pending === "request" || undefined} className={`${CTA_CLASS} mt-1`}>
              {pending === "request" ? <><Spinner aria-hidden="true" />{REQUEST_COPY.pending}</> : REQUEST_COPY.submit}
            </Button>
          </form>
          {backLink}
        </div>
      </>
    );
  }

  const subheading = (
    <>
      {RESET_COPY.forLead} <b className="font-semibold text-foreground">{email}</b>.{" "}
      <button type="button" onClick={onUseOtherEmail} className={`${AUTH_LINK_CLASS} bg-transparent p-0`}>{RESET_COPY.useOtherEmail}</button>
    </>
  );
  const passwordDescribedBy = [ids.requirements, passwordError ? ids.passwordError : null].filter(Boolean).join(" ");

  return (
    <>
      <AuthHeading eyebrow={RECOVER_EYEBROW} heading={RESET_COPY.heading} subheading={subheading} />
      <div className="mt-8">
        {alertBox}
        <form noValidate onSubmit={onReset} aria-busy={pending === "reset" || undefined} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <CodeInput
              ref={code}
              digits={digits}
              onDigitsChange={onDigitsChange}
              onFilled={() => requestFocus(password === "" ? "password" : "submit")}
              hint={RESET_COPY.codeHint}
              invalid={codeRejected || codeError}
              readOnly={pending === "reset"}
              describedBy={[alertAboutCode ? ids.alert : null, codeError ? ids.codeError : null].filter(Boolean).join(" ") || undefined}
            />
            {codeError && <ErrorText id={ids.codeError}>{RECOVER_ERRORS.incomplete}</ErrorText>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.password} className="text-[13px] font-medium text-foreground">{RESET_COPY.passwordLabel}</Label>
            <div className="relative">
              <Input
                ref={passwordRef}
                id={ids.password}
                name="new-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(event) => { setPassword(event.target.value); setPasswordError(false); }}
                readOnly={pending === "reset"}
                aria-required="true"
                aria-invalid={passwordError || undefined}
                aria-describedby={passwordDescribedBy}
                className={`${FIELD_CLASS} pr-12`}
              />
              <button
                type="button"
                aria-controls={ids.password}
                aria-pressed={showPassword}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setShowPassword((shown) => !shown)}
                className={`absolute right-0.5 top-0.5 grid size-11 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground ${AUTH_FOCUS_RING}`}
              >
                {showPassword ? <EyeOffIcon aria-hidden="true" className="size-[18px]" /> : <EyeIcon aria-hidden="true" className="size-[18px]" />}
              </button>
            </div>
            <PasswordRequirements id={ids.requirements} password={password} strict={passwordError} />
            {passwordError && <ErrorText id={ids.passwordError}>{RECOVER_ERRORS.password}</ErrorText>}
          </div>

          <Button ref={submitRef} type="submit" aria-disabled={pending === "reset" || undefined} className={`${CTA_CLASS} mt-1`}>
            {pending === "reset" ? <><Spinner aria-hidden="true" />{RESET_COPY.pending}</> : RESET_COPY.submit}
          </Button>
          <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-[14px] text-muted-foreground">
            {RESEND_LEAD}
            <button
              type="button"
              aria-disabled={coolingDown || pending !== null || undefined}
              onClick={() => void onResend()}
              className={`${AUTH_LINK_CLASS} bg-transparent px-1 text-[14px] aria-disabled:cursor-not-allowed aria-disabled:opacity-70 aria-disabled:no-underline`}
            >
              {coolingDown ? `${RESEND_LABEL} en ${formatCooldown(cooldown.remaining)}` : RESEND_LABEL}
            </button>
          </p>
        </form>
        {backLink}
      </div>
    </>
  );
}
