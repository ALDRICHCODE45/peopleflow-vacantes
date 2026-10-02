"use client";

import * as React from "react";
import { BookOpenIcon, Building2Icon, WrenchIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { CompanyCareersView } from "@/features/company-profile/company-careers-view";
import {
  createEmployerSiteDraft,
  draftToSiteContent,
  updateDraftField,
  type EmployerSiteDraft,
  type EmployerSiteField,
} from "./employer-site-draft";

/**
 * Local-only section editor for `/empresa/sitio`.
 *
 * It owns the whole draft in React state and renders the shared public careers
 * renderer as its preview, so typing updates the preview immediately and nothing
 * is fetched, stored, published, uploaded or navigated. The page never becomes a
 * public company profile: the preview is the employer's own identity-only draft,
 * and the renderer stays the single source of the public layout.
 */

/** The three editable sections, in content order. */
type SiteSection = "identidad" | "historia" | "capacidades";

const SECTIONS: readonly Readonly<{
  value: SiteSection;
  label: string;
  Icon: typeof Building2Icon;
}>[] = [
  { value: "identidad", label: "Identidad", Icon: Building2Icon },
  { value: "historia", label: "Historia", Icon: BookOpenIcon },
  { value: "capacidades", label: "Capacidades", Icon: WrenchIcon },
];

/** One editable field: its draft key, its visible label and its control shape. */
type FieldDefinition = Readonly<{
  field: EmployerSiteField;
  label: string;
  description: string;
  multiline: boolean;
  controlClass: string;
}>;

const INPUT = "h-10";
const SHORT_TEXTAREA = "min-h-24";
const LONG_TEXTAREA = "min-h-32";

/**
 * The fields of each section. Only identity, story and capabilities are
 * editable here; the remaining facts of the renderer contract stay unauthored
 * so the preview never invents a benefit, a statistic or a credential.
 */
const SECTION_FIELDS: Readonly<Record<SiteSection, readonly FieldDefinition[]>> = {
  identidad: [
    {
      field: "name",
      label: "Nombre de la empresa",
      description: "El nombre público que encabeza el sitio.",
      multiline: false,
      controlClass: INPUT,
    },
    {
      field: "tagline",
      label: "Lema",
      description: "Una línea breve que resuma de qué se trata tu empresa.",
      multiline: true,
      controlClass: SHORT_TEXTAREA,
    },
  ],
  historia: [
    {
      field: "about",
      label: "Sobre la empresa",
      description: "Describe a tu empresa en uno o dos párrafos.",
      multiline: true,
      controlClass: LONG_TEXTAREA,
    },
    {
      field: "mission",
      label: "Misión",
      description: "Explica el propósito que guía el trabajo del equipo.",
      multiline: true,
      controlClass: SHORT_TEXTAREA,
    },
  ],
  capacidades: [
    {
      field: "whatWeDo",
      label: "Qué hace la empresa",
      description: "Enumera lo que hace tu empresa, separado por comas.",
      multiline: true,
      controlClass: SHORT_TEXTAREA,
    },
  ],
};

/** Stable ids: the editor never mints a random id and never collides with the preview. */
const INTRO_ID = "sitio-editor-titulo";
const PREVIEW_ID = "sitio-preview-titulo";

/** Layout-only adjustments to the installed tab rail: overflow, focus, no repaint. */
const TAB_LIST =
  "max-w-full justify-start overflow-auto focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/** The preview renders the public renderer at its embedded level. */
const PREVIEW_HEADING_LEVEL = 2;
const PREVIEW_ID_PREFIX = "preview-";

export function CompanySiteEditor() {
  const [draft, setDraft] = React.useState<EmployerSiteDraft>(createEmployerSiteDraft);
  const [section, setSection] = React.useState<SiteSection>("identidad");

  /** One local field update: the draft is replaced, never mutated. */
  const handleChange = React.useCallback((field: EmployerSiteField, value: string) => {
    setDraft((current) => updateDraftField(current, field, value));
  }, []);

  const content = draftToSiteContent(draft);

  return (
    <div data-pf-sitio-editor className="flex flex-col gap-6">
      <section aria-labelledby={INTRO_ID} className="flex flex-col gap-1.5">
        <h2
          id={INTRO_ID}
          className="font-heading text-xl font-semibold tracking-tight text-foreground"
        >
          Editor del sitio de empleo
        </h2>
        <p className="max-w-prose text-[13.5px] text-muted-foreground">
          Edita la identidad, la historia y las capacidades de tu sitio. La vista
          previa se actualiza mientras escribes.
        </p>
      </section>

      <div
        data-pf-sitio-layout
        className="grid min-w-0 items-start gap-6 lg:grid-cols-2"
      >
        {/* Editing column: one content-first section at a time. */}
        <section
          data-pf-sitio-form
          aria-label="Edición del sitio de empleo"
          className="flex min-w-0 flex-col gap-4"
        >
          <Tabs
            value={section}
            onValueChange={(value) => setSection(value as SiteSection)}
          >
            <TabsList
              variant="line"
              aria-label="Secciones del sitio de empleo"
              tabIndex={0}
              className={TAB_LIST}
            >
              {SECTIONS.map((item) => (
                <TabsTrigger
                  key={item.value}
                  value={item.value}
                  data-pf-sitio-tab={item.value}
                >
                  <item.Icon aria-hidden="true" />
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={section}>
              <FieldGroup className="gap-4">
                {SECTION_FIELDS[section].map((definition) => {
                  const fieldId = `sitio-${definition.field}-field`;
                  const descriptionId = `${fieldId}-description`;
                  return (
                    <Field key={definition.field} data-pf-sitio-field={definition.field}>
                      <FieldLabel htmlFor={fieldId}>{definition.label}</FieldLabel>
                      {definition.multiline ? (
                        <Textarea
                          id={fieldId}
                          data-pf-sitio-input={definition.field}
                          aria-describedby={descriptionId}
                          value={draft[definition.field]}
                          onChange={(event) =>
                            handleChange(definition.field, event.target.value)
                          }
                          className={definition.controlClass}
                        />
                      ) : (
                        <Input
                          id={fieldId}
                          data-pf-sitio-input={definition.field}
                          aria-describedby={descriptionId}
                          value={draft[definition.field]}
                          onChange={(event) =>
                            handleChange(definition.field, event.target.value)
                          }
                          className={definition.controlClass}
                        />
                      )}
                      <FieldDescription id={descriptionId}>
                        {definition.description}
                      </FieldDescription>
                    </Field>
                  );
                })}
              </FieldGroup>
            </TabsContent>
          </Tabs>
        </section>

        {/* Preview column: the shared renderer over the local draft and no jobs. */}
        <section
          data-pf-sitio-preview
          aria-labelledby={PREVIEW_ID}
          className="flex min-w-0 flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <h2
              id={PREVIEW_ID}
              className="font-heading text-xl font-semibold tracking-tight text-foreground"
            >
              Vista previa
            </h2>
          </div>
          <Card data-pf-sitio-preview-surface size="sm" className="min-w-0">
            <CardContent className="min-w-0">
              <CompanyCareersView
                content={content}
                jobs={[]}
                headingLevel={PREVIEW_HEADING_LEVEL}
                idPrefix={PREVIEW_ID_PREFIX}
              />
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
