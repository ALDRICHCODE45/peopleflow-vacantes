import * as React from "react";
import Link from "next/link";

import { PeopleFlowLogo } from "../brand/logo";
import { ThemeToggle } from "../theme/theme-toggle";
import { FloatingLines } from "./FloatingLines";
import styles from "./login-screen.module.css";
import { AUTH_PATHS } from "./sign-in/routes";

// LOGIN-01 / A4.3: shared shell for both login routes; a server component
// whose own client leaves are the persisted ThemeToggle, the OGL FloatingLines
// panel (LOGIN-02 / CCP-R7D2C, kept exactly as is per L11) and the injected
// sign-in controls (EmployerAuthControls / CandidateAuthControls, which render
// the embedded email + password form of artboard 01). The shell adds the
// static copy and the footer links: create an account (A4.4 / A4.5 routes),
// the other audience and the root. The desktop visual panel keeps the STATIC
// branded fallback (theme-aware panel background + the canonical wordmark)
// under the animation and for any WebGL failure.

export type LoginVariant = "employer" | "candidate";

type LoginCopy = {
  eyebrow: string; heading: string; subheading: string;
  registerLead: string; registerAction: string; reciprocalLead: string; reciprocalHref: string;
};

const COPY: Record<LoginVariant, LoginCopy> = {
  employer: {
    eyebrow: "Acceso empresas", heading: "Ingresa a tu cuenta",
    subheading: "Gestiona tus vacantes y tu pipeline.",
    registerLead: "¿No tienes cuenta?", registerAction: "Registra tu empresa",
    reciprocalLead: "¿Eres candidato?", reciprocalHref: AUTH_PATHS.candidate.login,
  },
  candidate: {
    eyebrow: "Acceso candidatos", heading: "Ingresa a tu perfil",
    subheading: "Sigue tus postulaciones y su estado.",
    registerLead: "¿No tienes perfil?", registerAction: "Crea tu perfil",
    reciprocalLead: "¿Eres empresa?", reciprocalHref: AUTH_PATHS.employer.login,
  },
};

const FOCUS_OUTLINE = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const FOCUS_RING = `rounded-md ${FOCUS_OUTLINE}`;
const accentClass = { employer: styles.accentEmployer, candidate: styles.accentCandidate } as const;

export function LoginScreen({ variant, authControls }: { variant: LoginVariant; authControls: React.ReactNode }) {
  const copy = COPY[variant];

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
          and the wordmark stay underneath/above it. The animation renders dark in
          both themes, so the panel wordmark is always the white one, with a soft
          shadow that keeps it legible over the light fallback base. */}
      <div aria-hidden="true" data-login-visual-panel="" className={`${styles.visualPanel} ${styles.visualPanel} relative hidden overflow-hidden border-r border-border lg:block`}>
        <FloatingLines variant={variant} />
        <div className="pointer-events-none relative z-10 p-12">
          <span className="inline-block w-fit">
            <PeopleFlowLogo tone="onDark" className="h-7 w-auto drop-shadow-[0_1px_2px_rgb(0_0_0/0.35)]" />
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

          {authControls}

          <p className="mt-8 flex flex-wrap items-center justify-center gap-x-1.5 text-center text-[14px] text-muted-foreground">
            {copy.registerLead}
            <Link href={AUTH_PATHS[variant].signUp} className={`${styles.accentText} ${styles.accentText} inline-flex min-h-11 items-center px-1 font-semibold ${FOCUS_RING}`}>{copy.registerAction}</Link>
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
