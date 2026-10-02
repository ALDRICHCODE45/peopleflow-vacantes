import Link from "next/link";
import { RocketIcon, SaveIcon } from "lucide-react";
import { cn } from "cn";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { VacancyPreview } from "../VacancyPreview";
import type { VacancyFormValues } from "./model";
import type { VacancyPrototypeValues } from "./prototype-model";

/** Where the employer completes the company profile the publication gate needs. */
const COMPANY_PROFILE_HREF = "/empresa/sitio";
/** Describes the publication action while the company profile is incomplete. */
const PUBLICATION_GUIDANCE_ID = "vacancy-publication-guidance";

export type DraftRailProps = {
  /** Current draft state, forwarded verbatim to the draft preview. */
  values: VacancyFormValues;
  /** Local-only complementary state; only the preview reads it. */
  prototypeValues: VacancyPrototypeValues;
  /**
   * Whether the company profile already satisfies the publication gate. The
   * wizard owns the readiness decision; the rail only renders it.
   */
  profileReady: boolean;
  /** Whether the wizard already recorded a local publication of this draft. */
  published: boolean;
  /** Publication attempt; the wizard validates and owns the resulting state. */
  onPublish: () => void;
};

/**
 * Publication rail of the review step: the live draft preview, the publication
 * action, and the independent draft-save affordance. It renders only inside the
 * review step, never beside the editable steps, so the preview cannot compete
 * with the field the recruiter is editing.
 *
 * The publication action is a real gate control: while the company profile is
 * incomplete it is disabled and the rail explains why with a semantic link to
 * the company site, while saving a draft stays enabled because a draft never
 * depends on the profile. The rail issues no request, no stored write and no
 * navigation of its own; the enclosing form owns the draft submit and the wizard
 * owns the publication outcome it shows.
 */
export function DraftRail({
  values,
  prototypeValues,
  profileReady,
  published,
  onPublish,
}: DraftRailProps) {
  return (
    <aside
      aria-label="Vista previa y guardado"
      className="flex flex-col gap-4 xl:sticky xl:top-6"
    >
      <VacancyPreview {...values} prototype={prototypeValues} />

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="font-heading text-base font-medium">
              Publicar vacante
            </h2>
          </CardTitle>
          <CardDescription>
            Publicar requiere una vacante completa y el perfil de tu empresa
            confirmado.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            type="button"
            className="h-10 w-full"
            disabled={!profileReady}
            aria-describedby={profileReady ? undefined : PUBLICATION_GUIDANCE_ID}
            onClick={onPublish}
          >
            <RocketIcon data-icon="inline-start" />
            Publicar vacante
          </Button>

          {!profileReady && (
            <div
              id={PUBLICATION_GUIDANCE_ID}
              data-pf-publication-guidance=""
              className="flex flex-col gap-2 rounded-2xl bg-muted p-3"
            >
              <p className="text-sm text-foreground">
                Completa el perfil de tu empresa antes de publicar la vacante.
              </p>
              <Link
                href={COMPANY_PROFILE_HREF}
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "h-10 w-full",
                )}
              >
                Completar perfil de empresa
              </Link>
            </div>
          )}

          {profileReady && published && (
            <p
              role="status"
              data-pf-publication-status="published"
              className="text-sm text-foreground"
            >
              La vacante quedó publicada.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="font-heading text-base font-medium">
              Guardar borrador
            </h2>
          </CardTitle>
          <CardDescription>
            Toda vacante nueva empieza como borrador. Guardarlo requiere una
            sesión de reclutador.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button type="submit" className="h-10 w-full">
            <SaveIcon data-icon="inline-start" />
            Guardar borrador
          </Button>
        </CardContent>
      </Card>
    </aside>
  );
}
