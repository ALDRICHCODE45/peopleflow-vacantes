"use client";

import * as React from "react";

import type { CandidateProfile } from "./model";
import { parseProfileDraft, profileToDraft } from "./profile-draft";
import type { CandidateProfileDraft, ProfileDraftIssue } from "./profile-draft";
import { ProfileFormFields } from "./profile-form-fields";

/**
 * Sole in-memory orchestrator for the `/candidato/perfil` editor. It owns the
 * private draft, the local review, the first-error focus and the reset of one
 * mounted view and nothing else: no fixture, form, transport, storage, router,
 * timer, randomness, callback or backend claim is reachable from here, and the
 * received profile is never mutated or replaced.
 *
 * CDP-07B1 owns the controls; this surface owns the single `<form noValidate>`,
 * the state, the no-save copy and the focus policy.
 */
export type ProfileWorkspaceProps = Readonly<{ profile: CandidateProfile }>;

/** Exact dirty, review and restoration copy for the single polite live region. */
const PRISTINE = "Sin cambios locales";
const DIRTY = "Cambios locales sin guardar";
const DISCLOSURE = "Demo local: tus ediciones viven solo en esta vista abierta. Revisar o restaurar no guarda ni envía nada, y no cambia tu cuenta, tu perfil del backend ni tu CV.";
const VALID_REVIEW = "La revisión local pasó: tus datos están completos en esta vista, pero no se guardó ni se envió nada.";
const RESET_DONE = "Restauramos la copia original en esta vista. No se guardó ni se envió nada.";
const ONE_ERROR = "La revisión local encontró 1 error. Corrige el campo señalado; no se guardó ni se envió nada.";
const manyErrors = (count: number): string => `La revisión local encontró ${count} errores. Corrige los campos señalados; no se guardó ni se envió nada.`;

/** Focus target for one issue path: scalar, indexed language row, or the add button. */
function focusSelector(path: string): string {
  if (path === "languages") return "[data-pf-profile-language-add]";
  const indexed = /^languages\.(\d+)\.(name|level)$/u.exec(path);
  if (indexed !== null) return `#profile-language-${indexed[1]}-${indexed[2]}`;
  return `[data-pf-profile-field="${path}"]`;
}

/** Deterministic serialization of a flat draft, used only for the dirty comparison. */
const serialize = (draft: CandidateProfileDraft): string => JSON.stringify(draft);

/** Token-only paint, 40px targets and a wrapping footer shared by the two actions. */
const FOCUS = "focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50";
const PRIMARY = `inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground ${FOCUS}`;
const SECONDARY = `inline-flex min-h-10 items-center justify-center rounded-md border border-input px-4 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const FOOTER = "flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between";
const STATUS = "text-sm text-muted-foreground";

/** In-memory editor over one received profile: state, summary and focus live here. */
export function ProfileWorkspace({ profile }: ProfileWorkspaceProps) {
  const baseline = React.useMemo(() => profileToDraft(profile), [profile]);
  const [draft, setDraft] = React.useState<CandidateProfileDraft>(baseline);
  const [issues, setIssues] = React.useState<readonly ProfileDraftIssue[]>([]);
  const [announcement, setAnnouncement] = React.useState<string | null>(null);
  const [focusRequest, setFocusRequest] = React.useState<Readonly<{ id: number; path: string }> | null>(null);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const dirty = serialize(draft) !== serialize(baseline);

  // Every submit mints a fresh request, so repeat invalid submits refocus the first failure.
  React.useEffect(() => {
    if (focusRequest === null) return;
    formRef.current?.querySelector<HTMLElement>(focusSelector(focusRequest.path))?.focus();
  }, [focusRequest]);

  /** Field emission: replace the local draft and drop any stale error or summary. */
  const handleChange = (next: CandidateProfileDraft): void => {
    setDraft(next);
    setIssues([]);
    setAnnouncement(null);
    setFocusRequest(null);
  };

  /** Local reset: a fresh clone of the received profile, plus an honest no-save note. */
  const handleReset = (): void => {
    setDraft(profileToDraft(profile));
    setIssues([]);
    setAnnouncement(RESET_DONE);
    setFocusRequest(null);
  };

  /** Local review: parse the draft only. A pass never replaces the profile or saves. */
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const result = parseProfileDraft(draft, profile);
    if (result.ok) {
      setIssues([]);
      setAnnouncement(VALID_REVIEW);
      setFocusRequest(null);
      return;
    }
    const first = result.issues[0];
    setIssues(result.issues);
    setAnnouncement(result.issues.length === 1 ? ONE_ERROR : manyErrors(result.issues.length));
    if (first !== undefined) setFocusRequest((previous) => ({ id: (previous?.id ?? 0) + 1, path: first.path }));
  };

  return (
    <div data-pf-profile-workspace className="flex flex-col gap-5 px-4 py-4 lg:px-6">
      <p role="note" data-pf-profile-disclosure className="max-w-3xl text-sm text-muted-foreground">{DISCLOSURE}</p>
      <form ref={formRef} noValidate data-pf-profile-form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <ProfileFormFields draft={draft} issues={issues} onChange={handleChange} />
        <div data-pf-profile-footer className={FOOTER}>
          <p role="status" aria-live="polite" data-pf-profile-status className={STATUS}>
            <span data-pf-profile-dirty>{dirty ? DIRTY : PRISTINE}</span>
            {announcement === null ? null : <span data-pf-profile-announcement>{` ${announcement}`}</span>}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button type="submit" data-pf-profile-review className={PRIMARY}>Revisar datos</button>
            <button type="button" data-pf-profile-reset onClick={handleReset} disabled={!dirty} className={SECONDARY}>Restaurar copia original</button>
          </div>
        </div>
      </form>
    </div>
  );
}
