"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDownIcon, CircleAlertIcon, ShieldCheckIcon } from "lucide-react";
import { SessionProvider, useSession } from "next-auth/react";
import { signOutWithAudit } from "@/lib/audit/sign-out";
import { completeCompanyStepAction, loadCompanyStepAction } from "@/features/employer-company/company-step-actions";
import { FULL_NAME_ERROR, type CompanyStepFieldErrors, type CompanyStepLoad, type CompanyStepResult } from "@/features/employer-company/company-step";
import { validateCompany } from "@/features/employer-company/validation";
import { EMPLOYER_COMPANY_STEP } from "@/features/identity/employer-onboarding";
import { normalizedName, validName } from "@/features/identity/model";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Spinner } from "../../ui/spinner";
import { AUTH_FOCUS_RING, AUTH_LINK_CLASS, AuthAlert } from "../auth-alert";
import { AuthHeading } from "../auth-heading";
import styles from "../login-screen.module.css";
import { navigateTo } from "../sign-in/navigate";
import { COMPANY_FIELD_ERRORS, COMPANY_STEP_ALERTS, COMPANY_STEP_COPY as COPY, type CompanyStepAlertKind } from "./copy";

const FIELD_CLASS = "h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] text-foreground placeholder:text-muted-foreground/70 read-only:text-muted-foreground md:text-[15px]";
const DASHBOARD = "/empresa/dashboard";
const LOGIN = `/empresa/login?callbackUrl=${encodeURIComponent(EMPLOYER_COMPANY_STEP)}`;
const LOGOUT = "/api/auth/cognito/logout";

type FieldName = "fullName" | "name" | "rfc" | "industryId" | "website";
type FocusTarget = FieldName | "alert";
const FIELD_ORDER: readonly FieldName[] = ["fullName", "name", "rfc", "industryId", "website"];
/** Results that no retry fixes: the form gives way to the explanation and «Salir». */
const BLOCKING = new Set<CompanyStepAlertKind>(["candidate_account", "email_in_use", "email_not_verified", "forbidden"]);

function ErrorText({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-[13px] leading-[18px] text-status-danger">
      <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{children}
    </p>
  );
}

function Hint({ id, children }: { id: string; children: React.ReactNode }) {
  return <p id={id} className="text-[13px] leading-[18px] text-muted-foreground">{children}</p>;
}

/**
 * «Tu empresa» (artboard 01 · company, A4.5 step 3 of 3). Needs a session: the
 * name comes from it (given at «Tu cuenta»), the token never reaches the
 * browser. One submit creates the employer account and then the company
 * (completeCompanyStepAction, safe to repeat); a lock keeps a double submit to
 * one request. Success opens the dashboard with a full navigation so every
 * reader sees the new role and membership.
 */
function CompanyStep() {
  const session = useSession();
  const expired = Boolean((session.data as { error?: string } | null)?.error);
  const authenticated = session.status === "authenticated" && !expired;
  const email = authenticated ? session.data?.user?.email ?? null : null;
  const sessionName = normalizedName(authenticated ? session.data?.user?.name ?? "" : "");
  const askName = !validName(sessionName);

  const [attempt, setAttempt] = React.useState(0);
  const [load, setLoad] = React.useState<CompanyStepLoad | null>(null);
  const [fullName, setFullName] = React.useState("");
  const [name, setName] = React.useState("");
  const [rfc, setRfc] = React.useState("");
  const [industryId, setIndustryId] = React.useState("");
  const [website, setWebsite] = React.useState("");
  const [errors, setErrors] = React.useState<CompanyStepFieldErrors>({});
  const [alertKind, setAlertKind] = React.useState<CompanyStepAlertKind | null>(null);
  const [pending, setPending] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);
  const [focusRequest, setFocusRequest] = React.useState<{ target: FocusTarget; n: number } | null>(null);
  const lock = React.useRef(false);
  const refs: Record<FocusTarget, React.RefObject<HTMLElement | null>> = {
    fullName: React.useRef<HTMLInputElement>(null),
    name: React.useRef<HTMLInputElement>(null),
    rfc: React.useRef<HTMLInputElement>(null),
    industryId: React.useRef<HTMLSelectElement>(null),
    website: React.useRef<HTMLInputElement>(null),
    alert: React.useRef<HTMLDivElement>(null),
  };
  const ids = {
    fullName: "company-step-full-name", name: "company-step-name", rfc: "company-step-rfc", industryId: "company-step-industry",
    website: "company-step-website", alert: "company-step-alert",
    hint: (field: FieldName) => `company-step-${field}-hint`,
    error: (field: FieldName) => `company-step-${field}-error`,
  };

  const requestFocus = (target: FocusTarget) => setFocusRequest((previous) => ({ target, n: (previous?.n ?? 0) + 1 }));
  React.useEffect(() => {
    if (focusRequest) refs[focusRequest.target].current?.focus();
    // refs are stable; only a new request moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  React.useEffect(() => {
    if (session.status === "loading") return;
    if (!authenticated) return navigateTo(LOGIN);
    let active = true;
    setLoad(null);
    void loadCompanyStepAction()
      .catch((): CompanyStepLoad => ({ kind: "unavailable" }))
      .then((next) => {
        if (!active) return;
        if (next.kind === "unauthenticated") return navigateTo(LOGIN);
        if (next.kind === "done") return navigateTo(DASHBOARD);
        setLoad(next);
      });
    return () => { active = false; };
  }, [session.status, authenticated, attempt]);

  async function logout() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOutWithAudit(LOGOUT);
    } catch {
      setSigningOut(false);
    }
  }

  function localErrors(): CompanyStepFieldErrors {
    const found: CompanyStepFieldErrors = {};
    if (askName && !validName(normalizedName(fullName))) found.fullName = FULL_NAME_ERROR;
    const { fields } = validateCompany({ name, rfc, industryId, website });
    Object.assign(found, fields);
    if (name.trim() === "") found.name = COMPANY_FIELD_ERRORS.nameMissing;
    return found;
  }

  function showFieldErrors(found: CompanyStepFieldErrors) {
    setErrors(found);
    const first = FIELD_ORDER.find((field) => found[field]);
    if (first) requestFocus(first);
  }

  function settle(result: CompanyStepResult) {
    switch (result.kind) {
      case "created":
        // Stay locked while the browser leaves.
        return navigateTo(DASHBOARD);
      case "unauthenticated":
        return navigateTo(LOGIN);
      case "invalid": {
        lock.current = false;
        setPending(false);
        if (Object.keys(result.fields).length > 0) return showFieldErrors(result.fields);
        setAlertKind("invalid");
        return requestFocus("alert");
      }
      case "industry_unavailable":
        lock.current = false;
        setPending(false);
        return showFieldErrors({ industryId: COMPANY_FIELD_ERRORS.industryUnavailable });
      case "candidate_account":
      case "email_in_use":
      case "email_not_verified":
      case "forbidden":
        lock.current = false;
        setPending(false);
        setAlertKind(result.kind);
        return requestFocus("alert");
      default:
        lock.current = false;
        setPending(false);
        setAlertKind("network");
        return requestFocus("alert");
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    setAlertKind(null);
    const found = localErrors();
    if (Object.keys(found).length > 0) return showFieldErrors(found);
    setErrors({});
    lock.current = true;
    setPending(true);
    let result: CompanyStepResult;
    try {
      result = await completeCompanyStepAction({ fullName: askName ? normalizedName(fullName) : sessionName, name, rfc, industryId, website });
    } catch {
      result = { kind: "unavailable" };
    }
    settle(result);
  }

  const who = email && (
    <p className="mt-4 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
      {COPY.signedInAs} <b className="font-medium text-foreground">{email}</b>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={() => void logout()} aria-disabled={signingOut || undefined} className={`${AUTH_LINK_CLASS} bg-transparent px-1`}>{COPY.signOut}</button>
    </p>
  );
  const heading = <AuthHeading eyebrow={COPY.eyebrow} heading={COPY.heading} subheading={COPY.subheading} />;

  if (!load) {
    return <>{heading}<p role="status" className="mt-8 flex items-center gap-2 text-sm text-muted-foreground"><Spinner aria-hidden="true" />{COPY.loading}</p></>;
  }

  const blocking = load.kind === "candidate_account" ? "candidate_account" : alertKind && BLOCKING.has(alertKind) ? alertKind : null;
  if (blocking) {
    const alert = COMPANY_STEP_ALERTS[blocking];
    return (
      <>
        {heading}
        <div className="mt-8 flex flex-col gap-3">
          <AuthAlert ref={refs.alert as React.Ref<HTMLDivElement>} id={ids.alert} tone={alert.tone} title={alert.title} body={alert.body}>
            {blocking === "candidate_account" && <Link href="/candidato/dashboard" className={AUTH_LINK_CLASS}>Ir a mi área de candidato</Link>}
          </AuthAlert>
          <Button type="button" variant="outline" onClick={() => void logout()} disabled={signingOut} className="h-12 w-full text-[15px]">Cerrar sesión</Button>
        </div>
        {who}
      </>
    );
  }

  if (load.kind !== "ready") {
    const alert = COMPANY_STEP_ALERTS.network;
    return (
      <>
        {heading}
        <div className="mt-8 flex flex-col gap-3">
          <AuthAlert id={ids.alert} tone={alert.tone} title={alert.title} body={alert.body} offline />
          <Button type="button" onClick={() => setAttempt((value) => value + 1)} className={`${styles.cta} ${styles.cta} h-12 w-full text-[15px] font-semibold`}>{COPY.retry}</Button>
        </div>
        {who}
      </>
    );
  }

  const alert = alertKind ? COMPANY_STEP_ALERTS[alertKind] : null;
  const describedBy = (field: FieldName, hint: boolean) => [hint ? ids.hint(field) : null, errors[field] ? ids.error(field) : null].filter(Boolean).join(" ") || undefined;
  const invalid = (field: FieldName) => (errors[field] !== undefined ? true : undefined);

  return (
    <>
      {heading}
      <div className="mt-8">
        {alert && <AuthAlert ref={refs.alert as React.Ref<HTMLDivElement>} id={ids.alert} tone={alert.tone} title={alert.title} body={alert.body} offline={alertKind === "network"} />}

        <form noValidate onSubmit={onSubmit} aria-busy={pending || undefined} className="flex flex-col gap-5">
          {askName && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.fullName} className="text-[13px] font-medium text-foreground">{COPY.fullNameLabel}</Label>
              <Input ref={refs.fullName as React.Ref<HTMLInputElement>} id={ids.fullName} name="fullName" autoComplete="name" maxLength={240}
                value={fullName} onChange={(event) => setFullName(event.target.value)} readOnly={pending}
                aria-required="true" aria-invalid={invalid("fullName")} aria-describedby={describedBy("fullName", false)} className={FIELD_CLASS} />
              {errors.fullName && <ErrorText id={ids.error("fullName")}>{errors.fullName}</ErrorText>}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.name} className="text-[13px] font-medium text-foreground">{COPY.nameLabel}</Label>
            <Input ref={refs.name as React.Ref<HTMLInputElement>} id={ids.name} name="name" autoComplete="organization"
              value={name} onChange={(event) => setName(event.target.value)} readOnly={pending}
              aria-required="true" aria-invalid={invalid("name")} aria-describedby={describedBy("name", true)} className={FIELD_CLASS} />
            <Hint id={ids.hint("name")}>{COPY.nameHint}</Hint>
            {errors.name && <ErrorText id={ids.error("name")}>{errors.name}</ErrorText>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.rfc} className="text-[13px] font-medium text-foreground">{COPY.rfcLabel}</Label>
            <Input ref={refs.rfc as React.Ref<HTMLInputElement>} id={ids.rfc} name="rfc" autoComplete="off" autoCapitalize="characters" spellCheck={false}
              value={rfc} onChange={(event) => setRfc(event.target.value)} readOnly={pending}
              aria-required="true" aria-invalid={invalid("rfc")} aria-describedby={describedBy("rfc", true)} className={`${FIELD_CLASS} uppercase`} />
            <Hint id={ids.hint("rfc")}>{COPY.rfcHint}</Hint>
            {errors.rfc && <ErrorText id={ids.error("rfc")}>{errors.rfc}</ErrorText>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.industryId} className="text-[13px] font-medium text-foreground">{COPY.industryLabel}</Label>
            <div className="relative">
              <select ref={refs.industryId as React.Ref<HTMLSelectElement>} id={ids.industryId} name="industryId"
                value={industryId} onChange={(event) => setIndustryId(event.target.value)} disabled={pending}
                aria-required="true" aria-invalid={invalid("industryId")} aria-describedby={describedBy("industryId", false)}
                className={`${FIELD_CLASS} appearance-none pr-11 ${AUTH_FOCUS_RING}`}>
                <option value="">{COPY.industryPlaceholder}</option>
                {load.industries.map((item) => <option key={item.id} value={item.id}>{item.label_es}</option>)}
              </select>
              <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            </div>
            {errors.industryId && <ErrorText id={ids.error("industryId")}>{errors.industryId}</ErrorText>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={ids.website} className="text-[13px] font-medium text-foreground">
              {COPY.websiteLabel} <span className="font-normal text-muted-foreground">{COPY.optional}</span>
            </Label>
            <div className="relative">
              <span aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] text-muted-foreground">{COPY.websitePrefix}</span>
              <Input ref={refs.website as React.Ref<HTMLInputElement>} id={ids.website} name="website" type="url" inputMode="url" autoComplete="url"
                placeholder={COPY.websitePlaceholder} value={website} onChange={(event) => setWebsite(event.target.value)} readOnly={pending}
                aria-invalid={invalid("website")} aria-describedby={describedBy("website", false)} className={`${FIELD_CLASS} pl-[4.75rem]`} />
            </div>
            {errors.website && <ErrorText id={ids.error("website")}>{errors.website}</ErrorText>}
          </div>

          <div role="note" className={`${styles.alert} ${styles.alert} ${styles.alertInfo} flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-foreground`}>
            <ShieldCheckIcon aria-hidden="true" className={`${styles.alertIcon} mt-0.5 size-[18px] shrink-0`} />
            <p className="text-[13px] leading-[18px]">{COPY.verificationNote}</p>
          </div>

          <Button type="submit" aria-disabled={pending || undefined}
            className={`${styles.cta} ${styles.cta} mt-1 h-12 w-full gap-2.5 text-[15px] font-semibold aria-disabled:cursor-progress aria-disabled:opacity-75`}>
            {pending ? <><Spinner aria-hidden="true" />{COPY.pending}</> : COPY.submit}
          </Button>
        </form>
        {who}
      </div>
    </>
  );
}

export function CompanyStepForm() {
  return (
    <SessionProvider refetchInterval={60} refetchOnWindowFocus>
      <CompanyStep />
    </SessionProvider>
  );
}
