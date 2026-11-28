"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { CircleAlertIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { meetsPasswordPolicy } from "@/lib/auth/password-policy";
import { signUpAction } from "@/lib/auth/sign-up/actions";
import { displayName, validEmail, type SignUpActionResult, type SignUpField } from "@/lib/auth/sign-up/contract";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Spinner } from "../../ui/spinner";
import { AUTH_FOCUS_RING, AUTH_LINK_CLASS, AuthAlert } from "../auth-alert";
import styles from "../login-screen.module.css";
import { navigateTo } from "../sign-in/navigate";
import { rememberPendingEmail, rememberVerifiedEmail } from "../sign-in/pending-email";
import { AUTH_PATHS, type SignInAudience } from "../sign-in/routes";
import { FIELD_ERRORS, SIGN_UP_ALERTS, SIGN_UP_FIELD_COPY, TERMS_LABEL, type SignUpAlertKind } from "./copy";
import { PasswordRequirements } from "./PasswordRequirements";

const FIELD_CLASS = "h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] text-foreground placeholder:text-muted-foreground/70 read-only:text-muted-foreground md:text-[15px]";

type FieldName = SignUpField | "terms";
type FieldErrors = Partial<Record<FieldName, string>>;
type FocusTarget = FieldName | "alert";

const FIELD_ORDER: readonly FieldName[] = ["name", "email", "password", "terms"];

function ErrorText({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-[13px] leading-[18px] text-status-danger">
      <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{children}
    </p>
  );
}

/**
 * «Crea tu perfil» (artboard 01 · Crear cuenta, A4.4): name, email, a new
 * password with live requirements and the terms consent. On success the email
 * (never the password) goes to «Verifica tu correo» in session storage, never
 * in the URL. Validation mirrors the server action, which validates again.
 */
export function SignUpForm({ audience }: { audience: SignInAudience }) {
  const paths = AUTH_PATHS[audience];
  const copy = SIGN_UP_FIELD_COPY[audience];
  const idBase = `${audience}-sign-up`;
  const ids = {
    name: `${idBase}-name`, email: `${idBase}-email`, password: `${idBase}-password`, terms: `${idBase}-terms`,
    requirements: `${idBase}-requirements`, alert: `${idBase}-alert`,
    error: (field: FieldName) => `${idBase}-${field}-error`,
  };

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [terms, setTerms] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [alertKind, setAlertKind] = React.useState<SignUpAlertKind | null>(null);
  const [focusRequest, setFocusRequest] = React.useState<{ target: FocusTarget; n: number } | null>(null);
  const lock = React.useRef(false);
  const refs: Record<FocusTarget, React.RefObject<HTMLElement | null>> = {
    name: React.useRef<HTMLInputElement>(null),
    email: React.useRef<HTMLInputElement>(null),
    password: React.useRef<HTMLInputElement>(null),
    terms: React.useRef<HTMLInputElement>(null),
    alert: React.useRef<HTMLDivElement>(null),
  };

  const requestFocus = (target: FocusTarget) => setFocusRequest((previous) => ({ target, n: (previous?.n ?? 0) + 1 }));

  React.useEffect(() => {
    if (focusRequest) refs[focusRequest.target].current?.focus();
    // refs are stable; only a new request moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  function localErrors(): FieldErrors {
    const found: FieldErrors = {};
    if (name.trim() === "") found.name = FIELD_ERRORS.nameMissing;
    else if (displayName(name) === null) found.name = FIELD_ERRORS.nameLength;
    if (!validEmail(email)) found.email = FIELD_ERRORS.email;
    if (!meetsPasswordPolicy(password)) found.password = FIELD_ERRORS.password;
    if (!terms) found.terms = FIELD_ERRORS.terms;
    return found;
  }

  function showFieldErrors(found: FieldErrors) {
    setErrors(found);
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) requestFocus(first);
  }

  function fail(kind: SignUpAlertKind, fieldErrors: FieldErrors = {}) {
    lock.current = false;
    setPending(false);
    setErrors(fieldErrors);
    setAlertKind(kind);
    requestFocus("alert");
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    setAlertKind(null);
    const found = localErrors();
    if (Object.keys(found).length > 0) return showFieldErrors(found);
    setErrors({});
    setShowPassword(false);
    lock.current = true;
    setPending(true);

    const typedEmail = email.trim();
    let result: SignUpActionResult;
    try {
      result = await signUpAction({ name: displayName(name), email: typedEmail, password });
    } catch {
      result = { ok: false, reason: "unavailable" };
    }

    if (result.ok) {
      if (result.confirmed) {
        // A pool that confirms on its own: nothing to verify, «Ingresar» says so.
        rememberVerifiedEmail(typedEmail);
        flushSync(() => setPassword(""));
        return navigateTo(paths.login);
      }
      rememberPendingEmail(typedEmail, "sign-up");
      // Committed before the browser leaves, so no password is held past here.
      flushSync(() => setPassword(""));
      return navigateTo(paths.verify);
    }

    switch (result.reason) {
      case "email_taken":
        return fail("email_taken", { email: "" });
      case "invalid_password":
        lock.current = false;
        setPending(false);
        return showFieldErrors({ password: FIELD_ERRORS.password });
      case "invalid_input": {
        lock.current = false;
        setPending(false);
        const messages: Record<SignUpField, string> = { name: FIELD_ERRORS.nameLength, email: FIELD_ERRORS.email, password: FIELD_ERRORS.password };
        return showFieldErrors(Object.fromEntries(result.fields.map((field) => [field, messages[field]])));
      }
      case "too_many_attempts":
        return fail("too_many_attempts");
      default:
        return fail("network");
    }
  }

  const alert = alertKind ? SIGN_UP_ALERTS[alertKind] : null;
  const describedBy = (field: FieldName, extra: string[] = []) => {
    const parts = [...extra, errors[field] ? ids.error(field) : null, field === "email" && alertKind === "email_taken" ? ids.alert : null].filter(Boolean);
    return parts.length > 0 ? parts.join(" ") : undefined;
  };
  const invalid = (field: FieldName) => (errors[field] !== undefined ? true : undefined);

  return (
    <div className="mt-8">
      {alert && (
        <AuthAlert ref={refs.alert as React.Ref<HTMLDivElement>} id={ids.alert} tone={alert.tone} title={alert.title} body={alert.body} offline={alertKind === "network"}>
          {alertKind === "email_taken" && (
            <p className="flex flex-wrap gap-x-4">
              <Link href={paths.login} className={AUTH_LINK_CLASS}>Ingresa</Link>
              <Link href={paths.forgot} className={AUTH_LINK_CLASS}>Restablecer contraseña</Link>
            </p>
          )}
        </AuthAlert>
      )}

      <form noValidate onSubmit={onSubmit} aria-busy={pending || undefined} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.name} className="text-[13px] font-medium text-foreground">Nombre completo</Label>
          <Input
            ref={refs.name as React.Ref<HTMLInputElement>}
            id={ids.name}
            name="name"
            autoComplete="name"
            // HTML counts UTF-16 units; the shared rule enforces 2–120 code points.
            maxLength={240}
            value={name}
            onChange={(event) => setName(event.target.value)}
            readOnly={pending}
            aria-required="true"
            aria-invalid={invalid("name")}
            aria-describedby={describedBy("name")}
            className={FIELD_CLASS}
          />
          {errors.name && <ErrorText id={ids.error("name")}>{errors.name}</ErrorText>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.email} className="text-[13px] font-medium text-foreground">{copy.emailLabel}</Label>
          <Input
            ref={refs.email as React.Ref<HTMLInputElement>}
            id={ids.email}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={copy.emailPlaceholder}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            readOnly={pending}
            aria-required="true"
            aria-invalid={invalid("email")}
            aria-describedby={describedBy("email")}
            className={FIELD_CLASS}
          />
          {errors.email && <ErrorText id={ids.error("email")}>{errors.email}</ErrorText>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.password} className="text-[13px] font-medium text-foreground">Contraseña</Label>
          <div className="relative">
            <Input
              ref={refs.password as React.Ref<HTMLInputElement>}
              id={ids.password}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              readOnly={pending}
              aria-required="true"
              aria-invalid={invalid("password")}
              aria-describedby={describedBy("password", [ids.requirements])}
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
          <PasswordRequirements id={ids.requirements} password={password} strict={errors.password !== undefined} />
          {errors.password && <ErrorText id={ids.error("password")}>{errors.password}</ErrorText>}
        </div>

        <div className="flex flex-col gap-1.5">
          {/* The label is the 44 px target; the legal pages do not exist yet, so no reading links (A4.4 risk). */}
          <label htmlFor={ids.terms} className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px] text-foreground">
            <input
              ref={refs.terms as React.Ref<HTMLInputElement>}
              id={ids.terms}
              type="checkbox"
              name="terms"
              checked={terms}
              onChange={(event) => setTerms(event.target.checked)}
              disabled={pending}
              aria-required="true"
              aria-invalid={invalid("terms")}
              aria-describedby={describedBy("terms")}
              className={`size-[18px] shrink-0 accent-[var(--pf-login-cta-bg)] ${AUTH_FOCUS_RING}`}
            />
            <span>{TERMS_LABEL}</span>
          </label>
          {errors.terms && <ErrorText id={ids.error("terms")}>{errors.terms}</ErrorText>}
        </div>

        <Button
          type="submit"
          aria-disabled={pending || undefined}
          className={`${styles.cta} ${styles.cta} mt-1 h-12 w-full gap-2.5 text-[15px] font-semibold aria-disabled:cursor-progress aria-disabled:opacity-75`}
        >
          {pending ? <><Spinner aria-hidden="true" />{copy.pending}</> : copy.submit}
        </Button>
      </form>
    </div>
  );
}
