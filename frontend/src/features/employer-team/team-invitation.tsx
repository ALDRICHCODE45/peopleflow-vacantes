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
 * transport, router, session, storage, or persistence. It validates the typed
 * address locally, and a valid submission is intentionally inert, so this
 * surface is structurally unable to add a member.
 */

/** Stable ids, so the affordance never generates a random or duplicated id. */
const PANEL_ID = "team-invitation-panel";
const EMAIL_ID = "team-invitation-email";
const ROLE_ID = "team-invitation-role";
const ERROR_ID = "team-invitation-error";

/** Exact copy this affordance reports when the typed address cannot be invited. */
const EMPTY_EMAIL_ERROR = "Ingresa un correo electrónico para continuar.";
const MALFORMED_EMAIL_ERROR = "Ingresa un correo electrónico válido, por ejemplo nombre@empresa.com.";

/** The address is only checked locally; nothing is sent to any service. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;

const FOCUS = "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none";
const LABEL = "text-[12.5px] font-medium text-foreground";
/** Native select sharing the Input primitive's height, concentric radius, and token surface. */
const SELECT = `h-10 w-full min-w-0 rounded-2xl border border-transparent bg-input/50 px-2.5 text-sm text-foreground transition-[color,box-shadow] duration-200 outline-none ${FOCUS}`;

/**
 * One compact toggle expands a single inline panel, never a modal. The panel
 * validates the address locally and keeps the typed value and chosen role on
 * failure. A valid submission is intentionally inert: the panel stays open
 * with the typed email and selected role preserved, and nothing else happens.
 */
export function TeamInvitation() {
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<TeamMemberRole>("recruiter");
  const [error, setError] = React.useState<string | null>(null);

  /** Cancelar and the main toggle both close the panel and drop every transient value. */
  const close = () => {
    setOpen(false);
    setEmail("");
    setRole("recruiter");
    setError(null);
  };

  const onRoleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setRole(TEAM_MEMBER_ROLES.find((candidate) => candidate === event.target.value) ?? "recruiter");
  };

  /** A new email keystroke begins a new attempt and drops the stale error. */
  const onEmailChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value);
    setError(null);
  };

  /**
   * A valid address passes local validation and then does nothing on purpose:
   * the panel stays open with the typed email and chosen role preserved, and no
   * request, storage write, member mutation, or status message happens.
   */
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const typed = email.trim();
    if (typed === "" || !EMAIL_PATTERN.test(typed)) {
      setError(typed === "" ? EMPTY_EMAIL_ERROR : MALFORMED_EMAIL_ERROR);
      return;
    }
    setError(null);
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
              <Button type="submit" data-pf-team-invitation-submit className="h-10 px-4">Enviar invitación</Button>
              <Button type="button" variant="outline" data-pf-team-invitation-cancel onClick={close} className="h-10 px-4">Cancelar</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
