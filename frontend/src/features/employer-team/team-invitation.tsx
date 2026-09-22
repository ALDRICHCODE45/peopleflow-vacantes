"use client";

import * as React from "react";
import { UserPlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { TEAM_MEMBER_ROLE_LABELS, TEAM_MEMBER_ROLES } from "./model";
import type { TeamMemberRole } from "./model";

/**
 * Local-only employer team invitation affordance for `/empresa/equipo`. It owns
 * no team collection and accepts no props or event handler, and it reaches no
 * transport, router, session, storage, or persistence. A valid submission only
 * clears the form and restores the default role, then states in words that
 * nothing was sent and nothing was saved, so this surface is structurally
 * unable to add a member.
 */

/** Stable ids, so the affordance never generates a random or duplicated id. */
const PANEL_ID = "team-invitation-panel";
const EMAIL_ID = "team-invitation-email";
const ROLE_ID = "team-invitation-role";
const ERROR_ID = "team-invitation-error";

/** Exact copy this affordance always states, plus the only outcome it may report. */
const DISCLOSURE = "Este prototipo no envía correos ni guarda cambios.";
const NO_SEND_STATUS = "Prototipo: no se envió la invitación ni se guardó ningún cambio.";
const EMPTY_EMAIL_ERROR = "Ingresá un correo electrónico para continuar.";
const MALFORMED_EMAIL_ERROR = "Ingresá un correo electrónico válido, por ejemplo nombre@empresa.com.";

/** The address is only checked locally; nothing is sent to any service. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;

const FOCUS = "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none";
const LABEL = "text-[12.5px] font-medium text-foreground";
/** Native select sharing the Input primitive's height, concentric radius, and token surface. */
const SELECT = `h-10 w-full min-w-0 rounded-2xl border border-transparent bg-input/50 px-2.5 text-sm text-foreground transition-[color,box-shadow] duration-200 outline-none ${FOCUS}`;

/**
 * One compact toggle expands a single inline panel, never a modal. The panel
 * validates the address locally and keeps the typed value on failure; after a
 * valid submission it clears the field, restores the default `recruiter` role,
 * and announces the truthful no-send/no-save prototype outcome.
 */
export function TeamInvitation() {
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<TeamMemberRole>("recruiter");
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);

  /** Cancelar and the main toggle both close the panel and drop every transient value. */
  const close = () => {
    setOpen(false);
    setEmail("");
    setRole("recruiter");
    setError(null);
    setStatus(null);
  };

  const onRoleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setRole(TEAM_MEMBER_ROLES.find((candidate) => candidate === event.target.value) ?? "recruiter");
    // A role change begins a new attempt and drops the prior no-send status; the email error is preserved because the address itself has not changed.
    setStatus(null);
  };

  /** A new email keystroke begins a new attempt and drops both the stale error and the prior no-send status. */
  const onEmailChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value);
    setError(null);
    setStatus(null);
  };

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const typed = email.trim();
    if (typed === "" || !EMAIL_PATTERN.test(typed)) {
      setStatus(null);
      setError(typed === "" ? EMPTY_EMAIL_ERROR : MALFORMED_EMAIL_ERROR);
      return;
    }
    setEmail("");
    setRole("recruiter");
    setError(null);
    setStatus(NO_SEND_STATUS);
  };

  return (
    <div data-pf-team-invitation className="flex flex-col gap-3">
      <div className="flex flex-col items-start gap-2">
        <Button
          type="button"
          data-pf-team-invitation-toggle
          aria-expanded={open}
          aria-controls={PANEL_ID}
          onClick={() => (open ? close() : setOpen(true))}
          className="h-10 gap-2 px-3.5"
        >
          <UserPlusIcon aria-hidden="true" className="size-4" />
          Invitar miembro
        </Button>
        <p role="note" data-pf-team-invitation-note className="text-[12.5px] leading-relaxed text-muted-foreground">
          {DISCLOSURE}
        </p>
      </div>
      {open && (
        <div id={PANEL_ID} data-pf-team-invitation-panel className="rounded-3xl border border-border bg-card/50 p-4 sm:p-5">
          <form noValidate data-pf-team-invitation-form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div data-pf-team-invitation-fields className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={EMAIL_ID} className={LABEL}>Correo electrónico</Label>
                <Input
                  id={EMAIL_ID}
                  data-pf-team-invitation-email
                  type="email"
                  value={email}
                  onChange={onEmailChange}
                  aria-invalid={error !== null}
                  aria-describedby={error === null ? undefined : ERROR_ID}
                  placeholder="nombre@empresa.com"
                  className="h-10"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ROLE_ID} className={LABEL}>Rol</Label>
                <select id={ROLE_ID} data-pf-team-invitation-role value={role} onChange={onRoleChange} className={SELECT}>
                  {TEAM_MEMBER_ROLES.map((value) => (
                    <option key={value} value={value}>{TEAM_MEMBER_ROLE_LABELS[value]}</option>
                  ))}
                </select>
              </div>
            </div>
            {error !== null && (
              <p id={ERROR_ID} data-pf-team-invitation-error role="alert" className="text-[12.5px] font-medium text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" data-pf-team-invitation-submit className="h-10 px-4">Probar invitación</Button>
              <Button type="button" variant="outline" data-pf-team-invitation-cancel onClick={close} className="h-10 px-4">Cancelar</Button>
            </div>
            {status !== null && (
              <p data-pf-team-invitation-status role="status" aria-live="polite" className="rounded-2xl border border-border bg-secondary/40 px-4 py-3 text-[12.5px] leading-relaxed text-foreground">
                {status}
              </p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
