import * as React from "react";
import styles from "./login-screen.module.css";

/** Eyebrow, title and subtitle of every embedded-auth screen (artboard 01 · Panel dividido). */
export function AuthHeading({ eyebrow, heading, subheading }: { eyebrow: string; heading: string; subheading: React.ReactNode }) {
  return (
    <>
      <p className={`${styles.accentText} ${styles.accentText} mb-3 font-mono text-[11px] font-semibold uppercase tracking-widest`}>{eyebrow}</p>
      <h1 className="font-heading text-[32px] font-bold tracking-tight text-foreground">{heading}</h1>
      <p className="mt-2 text-[15px] text-muted-foreground [overflow-wrap:anywhere]">{subheading}</p>
    </>
  );
}
