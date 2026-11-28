import * as React from "react";
import { CheckIcon, CircleIcon, XIcon } from "lucide-react";
import { PASSWORD_REQUIREMENTS, passwordChecks } from "@/lib/auth/password-policy";
import { REQUIREMENT_LABELS, REQUIREMENTS_LABEL, REQUIREMENTS_MET } from "./copy";

/**
 * Live password requirements (artboard «Requisitos en vivo»): each item says
 * its state in hidden text, not only by color and icon; the polite live region
 * speaks only when every requirement is met, never on each key. `strict`
 * (after a refused submit) turns pending items into explicit misses.
 */
export function PasswordRequirements({ id, password, strict }: { id: string; password: string; strict: boolean }) {
  const checks = passwordChecks(password);
  const allMet = PASSWORD_REQUIREMENTS.every((requirement) => checks[requirement]);
  const labelId = `${id}-label`;
  return (
    <div className="mt-1">
      <p id={labelId} className="sr-only">{REQUIREMENTS_LABEL}</p>
      <ul id={id} aria-labelledby={labelId} className="grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] leading-[18px] sm:grid-cols-2">
        {REQUIREMENT_LABELS.map(([requirement, label]) => {
          const met = checks[requirement];
          const state = met ? "met" : strict ? "missing" : "pending";
          const Icon = met ? CheckIcon : strict ? XIcon : CircleIcon;
          return (
            <li
              key={requirement}
              data-state={state}
              className={`flex items-start gap-1.5 ${met ? "text-status-success" : strict ? "text-status-danger" : "text-muted-foreground"}`}
            >
              <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span><span className="sr-only">{met ? "Cumplido: " : "Pendiente: "}</span>{label}</span>
            </li>
          );
        })}
      </ul>
      <p className="sr-only" aria-live="polite">{allMet ? REQUIREMENTS_MET : ""}</p>
    </div>
  );
}
