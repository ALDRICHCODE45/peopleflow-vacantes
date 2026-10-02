import { MailIcon, MapPinIcon, PhoneIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

import {
  applicationCandidateInitials,
  type ApplicationCandidateDraft,
} from "./application-candidate-draft";

/**
 * Identity card of the desktop application rail: the avatar plus the live local
 * candidate data the step 1 form edits, and the read-only skills the frozen
 * profile already declares. It is presentational only — it owns no state, no
 * request, no storage, and no submit — so every value it paints comes straight
 * from the wizard's local draft. It never claims a completeness score and never
 * invents a fact the candidate did not type.
 */
type ApplicationCandidateCardProps = {
  draft: ApplicationCandidateDraft;
  /** The frozen profile skills; already normalized by the candidate model. */
  skills: readonly string[];
  avatarSrc: string;
};

/** Honest placeholder for a field the candidate left empty. */
const UNSPECIFIED = "Sin especificar";

/** Shared shape of one term/value row, mirroring the vacancy summary rail. */
const metaRow = "flex items-start justify-between gap-3";
const metaTerm = "flex items-center gap-2 text-xs text-muted-foreground";
const metaValue = "text-right font-medium break-words text-foreground";
const metaIcon = "size-3.5 shrink-0";

/** A blank draft value reads as "not declared", never as an invented one. */
function declared(value: string): string {
  const trimmed = value.trim();
  return trimmed === "" ? UNSPECIFIED : trimmed;
}

/** City and country as one line, or the neutral placeholder when both are blank. */
function locationOf(draft: ApplicationCandidateDraft): string {
  const parts = [draft.city, draft.country].map((part) => part.trim()).filter((part) => part !== "");
  return parts.length === 0 ? UNSPECIFIED : parts.join(", ");
}

export function ApplicationCandidateCard({
  draft,
  skills,
  avatarSrc,
}: ApplicationCandidateCardProps) {
  const visibleSkills = skills.slice(0, 6);

  return (
    <Card data-pf-application-candidate>
      <CardHeader className="border-b">
        <h2 className="font-heading text-base font-medium text-foreground">Tu perfil</h2>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Avatar size="lg" className="size-12">
            {/* Decorative portrait: the frozen fixture photo stays the same while
                the visitor edits the profile, so naming it with the edited name
                would relabel someone else's portrait. The adjacent visible name
                already labels the profile, so an empty alt is the truthful
                choice and keeps the photo out of the accessibility tree. */}
            <AvatarImage src={avatarSrc} alt="" />
            <AvatarFallback>{applicationCandidateInitials(draft.fullName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p
              data-pf-application-candidate-name
              className="truncate font-heading text-sm font-semibold text-foreground"
            >
              {declared(draft.fullName)}
            </p>
            <p
              data-pf-application-candidate-title
              className="truncate text-xs text-muted-foreground"
            >
              {declared(draft.professionalTitle)}
            </p>
          </div>
        </div>

        <dl className="flex flex-col gap-3 text-sm">
          <div className={metaRow}>
            <dt className={metaTerm}>
              <MailIcon aria-hidden="true" className={metaIcon} />
              Correo
            </dt>
            <dd data-pf-application-candidate-email className={metaValue}>
              {declared(draft.email)}
            </dd>
          </div>
          <div className={metaRow}>
            <dt className={metaTerm}>
              <PhoneIcon aria-hidden="true" className={metaIcon} />
              Teléfono
            </dt>
            <dd data-pf-application-candidate-phone className={metaValue}>
              {declared(draft.phone)}
            </dd>
          </div>
          <div className={metaRow}>
            <dt className={metaTerm}>
              <MapPinIcon aria-hidden="true" className={metaIcon} />
              Ubicación
            </dt>
            <dd data-pf-application-candidate-location className={metaValue}>
              {locationOf(draft)}
            </dd>
          </div>
        </dl>

        {visibleSkills.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">Habilidades</p>
            <ul data-pf-application-candidate-skills className="flex flex-wrap gap-1.5">
              {visibleSkills.map((skill) => (
                <li key={skill}>
                  <Badge variant="outline" className="text-[11px] font-normal capitalize text-muted-foreground">
                    {skill}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
