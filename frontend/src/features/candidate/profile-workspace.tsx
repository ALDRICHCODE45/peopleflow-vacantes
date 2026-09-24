"use client";

import * as React from "react";
import { ClipboardCheckIcon, Undo2Icon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CandidateIdentity, CandidateProfile } from "./model";
import { parseProfileDraft, profileToDraft } from "./profile-draft";
import type { CandidateProfileDraft, ProfileDraftIssue } from "./profile-draft";
import { ProfileFormFields } from "./profile-form-fields";
import type { ProfileCategory } from "./profile-form-fields";

/**
 * Sole in-memory orchestrator for the `/candidato/perfil` editor: a large identity
 * hero, an in-flow toolbar and one tabbed Card that mounts only the active
 * category. It owns the private draft, the local review, the first-error focus
 * and the reset of one mounted view, and never mutates the received profile.
 */
export type ProfileWorkspaceProps = Readonly<{ identity: CandidateIdentity; profile: CandidateProfile; avatarSrc: string }>;

const PRISTINE = "Sin cambios pendientes";
const DIRTY = "Cambios pendientes";
const VALID_REVIEW = "La revisión pasó: tus datos están completos en esta vista.";
const partialReview = (percent: number): string => `La revisión pasó: no quedan errores en esta vista, pero el avance del perfil es del ${percent}%.`;
const RESET_DONE = "Restauramos la copia original en esta vista.";
const ONE_ERROR = "La revisión encontró 1 error. Corrige el campo señalado.";
const manyErrors = (count: number): string => `La revisión encontró ${count} errores. Corrige los campos señalados.`;

const IDENTITY_HEADING_ID = "pf-profile-identity-heading";
const COMPLETION_HEADING_ID = "pf-profile-completion-heading";
const NO_TITLE = "Título profesional sin definir";
const NO_LOCATION = "Ubicación sin definir";
const NO_COMPANY = "Empresa sin definir";

const CATEGORY_TABS: readonly Readonly<{ value: ProfileCategory; label: string }>[] = [
  { value: "personal", label: "Personal" },
  { value: "experience", label: "Experiencia" },
  { value: "education", label: "Educación" },
  { value: "compensation", label: "Compensación" },
  { value: "languages", label: "Idiomas" },
];

const PERSONAL_PATHS = ["phone", "linkedinUrl", "portfolioUrl", "birthDate", "city", "country"];
const COMPENSATION_PATHS = ["currentSalaryGross", "currentSalaryNet", "salaryCurrency", "expectedSalary", "expectedSalaryPeriod"];
const EDUCATION_PATHS = ["educationLevel", "fieldOfStudy", "skills"];

function categoryOfIssue(path: string): ProfileCategory {
  if (path === "languages" || path.startsWith("languages.")) return "languages";
  if (COMPENSATION_PATHS.includes(path)) return "compensation";
  if (EDUCATION_PATHS.includes(path)) return "education";
  if (PERSONAL_PATHS.includes(path)) return "personal";
  return "experience";
}

/** Focus target for one issue path: scalar, indexed language row, or the add button. */
function focusSelector(path: string): string {
  if (path === "languages") return "[data-pf-profile-language-add]";
  const indexed = /^languages\.(\d+)\.(name|level)$/u.exec(path);
  if (indexed !== null) return `#profile-language-${indexed[1]}-${indexed[2]}`;
  return `[data-pf-profile-field="${path}"]`;
}

/** Deterministic serialization of a flat draft, used only for the dirty comparison. */
const serialize = (draft: CandidateProfileDraft): string => JSON.stringify(draft);

const declared = (value: string): boolean => value.trim() !== "";

type CompletionSignal = (draft: CandidateProfileDraft) => boolean;
const COMPLETION_SIGNALS: readonly CompletionSignal[] = [
  (draft) => declared(draft.professionalTitle),
  (draft) => declared(draft.currentCompany),
  (draft) => declared(draft.yearsOfExperience),
  (draft) => declared(draft.summary),
  (draft) => declared(draft.phone),
  (draft) => declared(draft.city) && declared(draft.country),
  (draft) => draft.educationLevel !== "" && declared(draft.fieldOfStudy),
  (draft) => declared(draft.skills),
  (draft) => declared(draft.expectedSalary),
  (draft) => draft.languages.some((row) => declared(row.name) && row.level !== ""),
];
const COMPLETION_TOTAL = COMPLETION_SIGNALS.length;

function completionOf(draft: CandidateProfileDraft): Readonly<{ done: number; percent: number }> {
  const done = COMPLETION_SIGNALS.filter((signal) => signal(draft)).length;
  return { done, percent: Math.round((done / COMPLETION_TOTAL) * 100) };
}

function initialsOf(fullName: string): string {
  const letters = fullName.trim().split(/\s+/u).filter((word) => word !== "").slice(0, 2).map((word) => word.charAt(0).toUpperCase());
  return letters.length === 0 ? "?" : letters.join("");
}

const titleOf = (draft: CandidateProfileDraft): string => (declared(draft.professionalTitle) ? draft.professionalTitle.trim() : NO_TITLE);
const locationOf = (draft: CandidateProfileDraft): string => [draft.city, draft.country].map((part) => part.trim()).filter(declared).join(", ") || NO_LOCATION;
const companyOf = (draft: CandidateProfileDraft): string => (declared(draft.currentCompany) ? draft.currentCompany.trim() : NO_COMPANY);

const HERO = "flex flex-col gap-5 border-b border-border/60 bg-muted/40 py-(--card-spacing) sm:flex-row sm:items-center sm:gap-6";
const AVATAR = "size-24 shrink-0 ring-2 ring-primary/25 ring-offset-2 ring-offset-background sm:size-28";
const META = "flex min-w-0 flex-1 flex-col gap-1.5";
const TITLE_ROW = "flex flex-wrap items-center gap-2";
const ROLE_BADGE = "max-w-full";
const NAME = "font-heading text-xl font-semibold text-foreground";
const EMAIL = "text-sm text-muted-foreground";
const CONTEXT = "flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground";
const CONTEXT_ITEM = "inline-flex min-w-0 items-center";
const COMPLETION_ACTION = "w-full sm:ml-auto sm:w-72";
const COMPLETION = "flex flex-col gap-2.5";
const COMPLETION_HEAD = "flex items-baseline justify-between gap-3";
const COMPLETION_TITLE = "font-heading text-sm font-semibold text-foreground";
const COMPLETION_PERCENT = "font-heading text-2xl font-semibold text-primary";
const COMPLETION_BAR = "w-full gap-0";
const COMPLETION_COUNT = "text-sm text-muted-foreground";
const TOOLBAR = "flex flex-col gap-3 px-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between";
const TOOLBAR_COPY = "flex min-w-0 flex-1 flex-col gap-1";
const STATUS = "text-sm text-muted-foreground";
const ACTIONS = "flex flex-col gap-3 sm:flex-row sm:flex-wrap";
const ACTION = "min-h-10 transition-colors duration-200 motion-reduce:transition-none";
const CARD = "gap-0 border border-border/70 py-0 ring-border/60";
const CARD_CONTENT = "flex flex-col gap-4 py-(--card-spacing)";
const TAB_LIST = "max-w-full justify-start overflow-auto focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ProfileWorkspace({ identity, profile, avatarSrc }: ProfileWorkspaceProps) {
  const baseline = React.useMemo(() => profileToDraft(profile), [profile]);
  const [draft, setDraft] = React.useState<CandidateProfileDraft>(baseline);
  const [issues, setIssues] = React.useState<readonly ProfileDraftIssue[]>([]);
  const [announcement, setAnnouncement] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<ProfileCategory>("personal");
  const [focusRequest, setFocusRequest] = React.useState<Readonly<{ id: number; path: string }> | null>(null);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const dirty = serialize(draft) !== serialize(baseline);
  const completion = completionOf(draft);

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

  /** Local reset: a fresh clone of the received profile, plus a clean restoration note. */
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
      // A valid draft may still leave optional signals undeclared, so the copy tracks the meter.
      setAnnouncement(completion.percent === 100 ? VALID_REVIEW : partialReview(completion.percent));
      setFocusRequest(null);
      return;
    }
    const first = result.issues[0];
    setIssues(result.issues);
    setAnnouncement(result.issues.length === 1 ? ONE_ERROR : manyErrors(result.issues.length));
    // Activate the owning tab first, then focus its control after the panel re-renders.
    if (first !== undefined) {
      setActiveTab(categoryOfIssue(first.path));
      setFocusRequest((previous) => ({ id: (previous?.id ?? 0) + 1, path: first.path }));
    }
  };

  return (
    <div data-pf-profile-workspace className="mx-auto w-full max-w-screen-2xl px-4 py-4 lg:px-6">
      <form ref={formRef} noValidate data-pf-profile-form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div data-pf-profile-toolbar className={TOOLBAR}>
          <div className={TOOLBAR_COPY}>
            <p role="status" aria-live="polite" data-pf-profile-status className={STATUS}>
              <span data-pf-profile-dirty>{dirty ? DIRTY : PRISTINE}</span>
              {announcement === null ? null : <span data-pf-profile-announcement>{` ${announcement}`}</span>}
            </p>
          </div>
          <div className={ACTIONS}>
            <Button type="submit" data-pf-profile-review className={ACTION}>
              <ClipboardCheckIcon data-icon="inline-start" />
              Revisar datos
            </Button>
            <Button type="button" variant="outline" data-pf-profile-reset onClick={handleReset} disabled={!dirty} className={ACTION}>
              <Undo2Icon data-icon="inline-start" />
              Restaurar copia original
            </Button>
          </div>
        </div>
        <Card data-pf-profile-card className={CARD}>
          <CardHeader data-pf-profile-identity className={HERO}>
            <Avatar className={AVATAR}>
              <AvatarImage src={avatarSrc} alt={`Fotografía de retrato de ${identity.fullName}`} />
              <AvatarFallback>{initialsOf(identity.fullName)}</AvatarFallback>
            </Avatar>
            <div className={META}>
              <div className={TITLE_ROW}>
                <h2 id={IDENTITY_HEADING_ID} className={NAME}>{identity.fullName}</h2>
                <Badge variant="secondary" data-pf-profile-headline className={ROLE_BADGE}>{titleOf(draft)}</Badge>
              </div>
              <p className={EMAIL}>
                <span data-pf-profile-email>{identity.email}</span>
              </p>
              <p data-pf-profile-context className={CONTEXT}>
                <span className={CONTEXT_ITEM}>{locationOf(draft)}</span>
                <span className={CONTEXT_ITEM}>{companyOf(draft)}</span>
              </p>
            </div>
            <div data-pf-profile-completeness className={COMPLETION_ACTION}>
              <div className={COMPLETION}>
                <div className={COMPLETION_HEAD}>
                  <h3 id={COMPLETION_HEADING_ID} className={COMPLETION_TITLE}>Avance del perfil</h3>
                  <span className={COMPLETION_PERCENT}>{`${completion.percent}%`}</span>
                </div>
                <Progress aria-labelledby={COMPLETION_HEADING_ID} value={completion.done} max={COMPLETION_TOTAL} className={COMPLETION_BAR} />
                <p data-pf-profile-completeness-value className={COMPLETION_COUNT}>{`${completion.done} de ${COMPLETION_TOTAL} datos clave`}</p>
              </div>
            </div>
          </CardHeader>
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ProfileCategory)}>
            <CardContent className={CARD_CONTENT}>
              <TabsList variant="line" aria-label="Secciones del perfil" tabIndex={0} className={TAB_LIST}>
                {CATEGORY_TABS.map((item) => (
                  <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value={activeTab}>
                <ProfileFormFields draft={draft} issues={issues} onChange={handleChange} category={activeTab} />
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      </form>
    </div>
  );
}
