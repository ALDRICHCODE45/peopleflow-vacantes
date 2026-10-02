import { SaveIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
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

export type DraftRailProps = {
  /** Current draft state, forwarded verbatim to the draft preview. */
  values: VacancyFormValues;
  /** Local-only complementary state; only the preview reads it. */
  prototypeValues: VacancyPrototypeValues;
};

/**
 * Publication rail of the review step: the live draft preview and the save
 * affordance. It renders only inside the review step, never beside the editable
 * steps, so the preview cannot compete with the field the recruiter is editing.
 *
 * The preview receives both states so the dossier stays in sync with the
 * complementary fields, while the save affordance stays a plain form submit the
 * enclosing form owns. The rail never issues a request itself and renders no
 * outcome state of its own.
 */
export function DraftRail({ values, prototypeValues }: DraftRailProps) {
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
