import * as React from "react";
import Link from "next/link";

import { PeopleFlowLogo } from "../brand/logo";
import { ThemeToggle } from "../theme/theme-toggle";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Separator } from "../ui/separator";
import { FloatingLines } from "./FloatingLines";
import styles from "./login-screen.module.css";

// LOGIN-01: shared shell for both login routes; a server component whose own
// client leaves are the existing persisted ThemeToggle and the OGL
// FloatingLines panel (LOGIN-02 / CCP-R7D2C). Authentication is NOT wired:
// there is no <form>, fetch, router, storage, action, credential name or
// submit surface. The credential area is a labelled non-form grouping, every
// auth action is disabled, and both credential inputs are readOnly with a fixed
// empty value, so nothing can be typed, submitted, transmitted or stored. The
// desktop visual panel keeps the STATIC branded fallback (theme-aware panel
// background + the canonical swapped wordmarks) under the animation and for any
// WebGL failure.

export type LoginVariant = "employer" | "candidate";

type LoginCopy = {
  eyebrow: string; heading: string; subheading: string; emailLabel: string;
  emailPlaceholder: string; providers: readonly string[]; registerLead: string;
  registerAction: string; reciprocalLead: string; reciprocalHref: string;
};

const COPY: Record<LoginVariant, LoginCopy> = {
  employer: {
    eyebrow: "Acceso empresas", heading: "Ingresa a tu cuenta",
    subheading: "Gestiona tus vacantes y tu pipeline.",
    emailLabel: "Email corporativo", emailPlaceholder: "tu@empresa.com",
    providers: ["Continuar con Google", "Continuar con Microsoft"],
    registerLead: "¿No tienes cuenta?", registerAction: "Registra tu empresa",
    reciprocalLead: "¿Eres candidato?", reciprocalHref: "/candidato/login",
  },
  candidate: {
    eyebrow: "Acceso candidatos", heading: "Ingresa a tu perfil",
    subheading: "Sigue tus postulaciones y su estado.",
    emailLabel: "Email", emailPlaceholder: "tu@email.com",
    providers: ["Continuar con Google", "Continuar con LinkedIn"],
    registerLead: "¿No tienes perfil?", registerAction: "Crea tu perfil",
    reciprocalLead: "¿Eres empresa?", reciprocalHref: "/empresa/login",
  },
};

const VISUAL_PREVIEW_DISCLOSURE = "Vista previa: acceso aún no disponible.";
const UNAVAILABLE_SUFFIX = "aún no disponible";
const FOCUS_RING = "rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const FIELD_CLASS = "h-12 w-full rounded-lg border border-border bg-background px-4 text-[15px] text-foreground placeholder:text-muted-foreground/70";
const accentClass = { employer: styles.accentEmployer, candidate: styles.accentCandidate } as const;
const providerMark: Record<string, string> = { "Continuar con Google": "G", "Continuar con Microsoft": "M", "Continuar con LinkedIn": "in" };

export function LoginScreen({ variant }: { variant: LoginVariant }) {
  const copy = COPY[variant];
  const emailId = `${variant}-login-email`;
  const passwordId = `${variant}-login-password`;
  const rememberId = `${variant}-login-remember`;

  // <main> gives the route its one main landmark (axe landmark-one-main).
  return (
    <main className={`grid min-h-dvh lg:grid-cols-2 ${accentClass[variant]}`}>
      {/* Desktop visual panel: decorative, aria-hidden and outside the
          accessibility tree, hidden below lg. The panel background is
          theme-aware (warm light / dark baseline) so the OGL leaf's light
          `invert(1)` + `multiply` composition stays neutral; the canonical
          PeopleFlowLogo supplies one mark per theme instead of a permanently
          white wordmark. The OGL leaf owns breakpoint gating, reduced motion,
          theme blending and WebGL-failure containment itself; the static tint
          and the wordmark stay underneath/above it. */}
      <div aria-hidden="true" data-login-visual-panel="" className={`${styles.visualPanel} ${styles.visualPanel} relative hidden overflow-hidden border-r border-border lg:block`}>
        <FloatingLines variant={variant} />
        <div className="pointer-events-none relative z-10 p-12">
          <span className="inline-block w-fit">
            <PeopleFlowLogo className="h-7 w-auto" />
          </span>
        </div>
      </div>

      {/* Form panel: 400px reference column, centered. */}
      <div className="relative flex items-center justify-center bg-card px-6 py-12 sm:px-10">
        <ThemeToggle className="absolute right-5 top-5 z-10 size-11 rounded-lg" />

        <div className="w-full max-w-[400px]">
          {/* The mobile wordmark keeps genuine root navigation reachable. */}
          <Link href="/" className={`mb-8 inline-flex min-h-11 items-center lg:hidden ${FOCUS_RING}`}>
            <PeopleFlowLogo className="h-7 w-auto" />
          </Link>

          <p className={`${styles.accentText} ${styles.accentText} mb-3 font-mono text-[11px] font-semibold uppercase tracking-widest`}>{copy.eyebrow}</p>
          <h1 className="font-heading text-[32px] font-bold tracking-tight text-foreground">{copy.heading}</h1>
          <p className="mt-2 text-[15px] text-muted-foreground">{copy.subheading}</p>

          {/* Safety disclosure: always visible, never a fake state. */}
          <p role="status" className="mt-4 rounded-lg border border-border bg-secondary px-3 py-2 text-[13px] text-muted-foreground">{VISUAL_PREVIEW_DISCLOSURE}</p>

          {/* Visual-only grouping: deliberately NOT a <form>, so no implicit
              submission, GET/POST action or Enter-to-submit surface exists. */}
          <div role="group" aria-label="Datos de acceso (vista previa)" className="mt-8 flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={emailId} className="text-[13px] font-medium text-foreground">{copy.emailLabel}</Label>
              <Input id={emailId} type="email" autoComplete="off" readOnly value="" placeholder={copy.emailPlaceholder} className={FIELD_CLASS} />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor={passwordId} className="text-[13px] font-medium text-foreground">Contraseña</Label>
                {/* Honest unavailable action: plain text, never a fake link. */}
                <span className="text-[13px] text-muted-foreground">
                  ¿Olvidaste tu contraseña? <span className="whitespace-nowrap">({UNAVAILABLE_SUFFIX})</span>
                </span>
              </div>
              <Input id={passwordId} type="password" autoComplete="off" readOnly value="" placeholder="••••••••" className={FIELD_CLASS} />
            </div>

            <label htmlFor={rememberId} className="flex min-h-11 items-center gap-2.5 text-[13px] text-muted-foreground">
              <input id={rememberId} type="checkbox" disabled className={`${styles.checkbox} ${styles.checkbox} size-4 rounded border-border`} />
              Mantener sesión iniciada
            </label>

            <Button type="button" disabled className={`${styles.cta} ${styles.cta} mt-1 h-12 w-full rounded-lg text-[15px] font-semibold`}>Ingresar</Button>
          </div>

          <div className="my-7 flex items-center gap-4 text-[12px] text-muted-foreground">
            <Separator className="h-px flex-1" />o continúa con
            <Separator className="h-px flex-1" />
          </div>

          <div className="flex flex-col gap-3">
            {copy.providers.map((provider) => (
              <Button key={provider} type="button" variant="outline" disabled className="h-12 w-full justify-center gap-2.5 rounded-lg text-[14px] font-medium text-foreground">
                <span aria-hidden="true" className="font-mono text-[13px] text-muted-foreground">{providerMark[provider]}</span>
                {provider}
              </Button>
            ))}
          </div>

          <p className="mt-8 text-center text-[14px] text-muted-foreground">
            {copy.registerLead}{" "}
            {/* Honest unavailable action: no anchor, no invented route. */}
            <span className={`${styles.accentText} ${styles.accentText} font-semibold`}>{copy.registerAction}</span>{" "}
            <span className="text-[13px]">({UNAVAILABLE_SUFFIX})</span>
          </p>
          <p className="mt-3 flex flex-wrap items-center justify-center gap-x-1.5 text-center text-[13px] text-muted-foreground">
            {copy.reciprocalLead}
            <Link href={copy.reciprocalHref} className={`${styles.accentText} ${styles.accentText} inline-flex min-h-11 items-center px-1 font-semibold ${FOCUS_RING}`}>Ingresa aquí</Link>
          </p>
          <p className="mt-3 text-center text-[13px] text-muted-foreground">
            <Link href="/" className={`inline-flex min-h-11 items-center px-1 font-medium text-foreground underline-offset-4 hover:underline ${FOCUS_RING}`}>Volver al inicio</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
