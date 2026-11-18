"use client";

import { useId, type CSSProperties } from "react";
import Link from "next/link";
import { Check, Copy, Eye, Files, Lock, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CARD } from "@/features/company-metrics/sections/summary-strip";
import { Ring } from "@/features/candidate/dashboard/charts";
import { cn } from "@/lib/utils";
import type { Completeness, KeyDataKey } from "../profile-completeness";
import { companyReceives } from "./visibility";
import styles from "./profile.module.css";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const CHIP = "inline-flex min-h-[22px] items-center gap-1 rounded-full px-2 py-[3px] text-xs leading-4 font-medium";
export const COPY_NOTE = "Recibe una copia de estos datos al momento de postularte; si después editas tu perfil, esa copia no cambia (salvo tu teléfono).";

/** The thin brand ring with «n de 10 datos clave»; each missing item opens and focuses its field. */
export function CompletenessCard({ completeness, onGoto, className }: { completeness: Completeness; onGoto: (key: KeyDataKey) => void; className?: string }) {
  const id = useId();
  const { completed, total, percentage, items } = completeness;
  const complete = completed === total;
  return <section aria-labelledby={id} data-pf-profile-completeness="" style={{ "--d": 2 } as CSSProperties} className={cn(CARD, "gap-4 p-4 sm:p-5", styles.rise, className)}>
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3.5">
      <Ring value={percentage} total={100} size={56} stroke={5} brand label={`Perfil completo al ${percentage} %`}>
        {complete ? <Check className="size-5 text-primary-text" strokeWidth={2.5} /> : <b className="text-[13px] font-semibold tracking-tight tabular-nums">{percentage}%</b>}
      </Ring>
      <div className="min-w-0">
        <h3 id={id} className="text-[15px] leading-[22px] font-semibold">{complete ? "Perfil completo" : completed >= 5 ? "Te falta poco" : "Completa tu perfil"}</h3>
        <p data-pf-profile-completeness-value="" className="text-xs text-muted-foreground tabular-nums">{completed} de {total} datos clave</p>
      </div>
    </div>
    <ul aria-label="Datos clave" className="flex flex-wrap gap-1.5">{items.map(item => <li key={item.key}>
      {item.done
        ? <span className={cn(CHIP, "bg-[color-mix(in_oklab,var(--primary)_8%,var(--card))] text-foreground ring-1 ring-primary/15 ring-inset")}><Check aria-hidden="true" className="size-3 text-primary-text" strokeWidth={3} />{capitalize(item.label)}</span>
        : <button type="button" data-pf-profile-goto={item.key} onClick={() => onGoto(item.key)} className={cn(CHIP, "min-h-8 border border-dashed border-border text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none")}><Plus aria-hidden="true" className="size-3" /><span className="sr-only">Agregar </span>{capitalize(item.label)}</button>}
    </li>)}</ul>
  </section>;
}

/** «Qué recibe la empresa», written from the visibility map. */
export function CompanyReceivesCard() {
  const id = useId();
  const copy = companyReceives();
  return <section aria-labelledby={id} data-pf-profile-receives="" style={{ "--d": 3 } as CSSProperties} className={cn(CARD, "gap-3 p-4 sm:p-5", styles.rise)}>
    <div>
      <h3 id={id} className="text-[15px] leading-[22px] font-semibold">Qué recibe la empresa</h3>
      <p className="mt-1.5 text-muted-foreground">Al postularte, la empresa ve esta ficha y el CV que elijas en ese momento.</p>
    </div>
    <ul className="flex flex-col gap-2 text-[13px] leading-[18px]">
      {copy.company && <li className="flex items-start gap-2"><Eye aria-hidden="true" className="mt-px size-3.5 shrink-0 text-primary-text" /><span>{copy.company}</span></li>}
      {copy.private && <li className="flex items-start gap-2"><Lock aria-hidden="true" className="mt-px size-3.5 shrink-0 text-muted-foreground" /><span>{copy.private}</span></li>}
      <li className="flex items-start gap-2"><Copy aria-hidden="true" className="mt-px size-3.5 shrink-0 text-muted-foreground" /><span>{COPY_NOTE}</span></li>
    </ul>
    <Link href="/candidato/cvs" className={buttonVariants({ variant: "ghost", className: "-mb-2 -ml-3 min-h-10 self-start" })}><Files data-icon="inline-start" aria-hidden="true" />Ver mis CVs</Link>
  </section>;
}
