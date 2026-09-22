import { CV_LANGUAGE_LABELS, summarizeCvs } from "./portfolio-model";
import type { CandidateCv } from "./portfolio-model";

/**
 * Props-only, server-renderable CV metadata inventory for `/candidato/cvs`.
 * Every header fact, card and disabled affordance derives from `cvs`; the
 * surface owns no fixture, network, persistence, navigation, form, timer or
 * callback, and CDP-08B supplies the frozen metadata at the route boundary.
 */
export type CvWorkspaceProps = Readonly<{ cvs: readonly CandidateCv[] }>;

/** Exact local-scope disclosure, shared actions explanation and empty summary. */
const DISCLOSURE = "Demo local con metadatos ficticios: los archivos no están disponibles para previsualizar ni descargar, no se sube, reemplaza, guarda ni genera nada, y el CV principal no puede cambiar en esta vista.";
const ACTIONS_NOTE = "Acciones no disponibles en esta demo local: no se puede subir, reemplazar, descargar ni cambiar el CV principal.";
const ACTIONS_NOTE_ID = "pf-cv-actions-note";
const EMPTY_SUMMARY = "Todavía no tienes CVs en esta demo local.";

/** Deterministic Spanish date (UTC) and deterministic KB/MB size text. */
const DATE_FORMAT = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const DECIMAL_FORMAT = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const formatDate = (value: string): string => DATE_FORMAT.format(new Date(value));
const formatFileSize = (bytes: number): string => bytes >= 1024 * 1024 ? `${DECIMAL_FORMAT.format(bytes / 1024 / 1024)} MB` : `${DECIMAL_FORMAT.format(Math.round(bytes / 1024))} KB`;
/** Natural Spanish count: singular only for exactly one. */
const countLabel = (count: number, singular: string, plural: string): string => `${count} ${count === 1 ? singular : plural}`;

/** Shared token-only paint: at least a 40px target, disabled affordances muted. */
const ACTION = "inline-flex min-h-10 items-center justify-center rounded-md border border-input px-4 text-sm font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60";
const CARD = "flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card/40 p-4";
const FACTS = "grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2";
const META = "text-[12.5px] text-muted-foreground";

/**
 * Deterministic order over a copy of the props: the primary CV first, then
 * `updatedAt` descending, with the id as the stable tie. The input is untouched.
 */
function orderCvs(cvs: readonly CandidateCv[]): readonly CandidateCv[] {
  return [...cvs].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    const byUpdated = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    if (byUpdated !== 0) return byUpdated;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Derived header summary: natural count plus the exact primary label and filename. */
function summaryText(total: number, primary: CandidateCv | undefined): string {
  if (total === 0) return EMPTY_SUMMARY;
  if (primary === undefined) return `Tienes ${countLabel(total, "CV", "CVs")}, pero ninguno está marcado como principal.`;
  return `Tienes ${countLabel(total, "CV", "CVs")}. Tu CV principal es «${primary.label}» (${primary.fileName}).`;
}

/** One CV as a semantic list card: label, wrapping filename, facts and disabled actions. */
function CvCard({ cv }: { readonly cv: CandidateCv }) {
  const role = cv.isPrimary ? "Principal" : "Secundario";
  const facts: readonly (readonly [string, string])[] = [
    ["Rol", role],
    ["Idioma", CV_LANGUAGE_LABELS[cv.language]],
    ["Actualizado", formatDate(cv.updatedAt)],
    ["Tamaño", formatFileSize(cv.sizeBytes)],
    ["Formato", "PDF"],
  ];
  return (
    <li data-pf-cv-card={cv.id} className={CARD}>
      <div className="min-w-0">
        <p className="text-[15px] font-semibold text-foreground">{cv.label}</p>
        <p data-pf-cv-filename={cv.id} className="mt-0.5 break-all text-sm text-muted-foreground">{cv.fileName}</p>
      </div>
      <dl className={FACTS}>
        {facts.map(([term, value]) => (
          <div key={term}>
            <dt className={META}>{term}</dt>
            <dd className="break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <div data-pf-cv-card-actions={cv.id} className="flex flex-wrap gap-2">
        <button type="button" disabled data-pf-cv-replace={cv.id} aria-describedby={ACTIONS_NOTE_ID} className={ACTION}>
          Reemplazar (no disponible)
        </button>
        <button type="button" disabled data-pf-cv-download={cv.id} aria-describedby={ACTIONS_NOTE_ID} className={ACTION}>
          Descargar (no disponible)
        </button>
        {cv.isPrimary ? null : (
          <button type="button" disabled data-pf-cv-make-primary={cv.id} aria-describedby={ACTIONS_NOTE_ID} className={ACTION}>
            Usar como principal (no disponible)
          </button>
        )}
      </div>
    </li>
  );
}

/** Static local CV inventory over the passed props. */
export function CvWorkspace({ cvs }: CvWorkspaceProps) {
  const { total, primary } = summarizeCvs(cvs);
  const ordered = orderCvs(cvs);
  return (
    <div data-pf-cv-workspace className="flex flex-col gap-5 px-4 py-4 lg:px-6">
      <p role="note" data-pf-cv-disclosure className="max-w-3xl text-sm text-muted-foreground">{DISCLOSURE}</p>
      <div className="flex flex-col gap-1.5">
        <h2 className="font-heading text-xl font-semibold text-foreground">Tus CVs</h2>
        <p data-pf-cv-summary className="max-w-3xl text-sm text-muted-foreground">{summaryText(total, primary)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled data-pf-cv-upload aria-describedby={ACTIONS_NOTE_ID} className={ACTION}>
          Subir CV (no disponible)
        </button>
      </div>
      <p id={ACTIONS_NOTE_ID} data-pf-cv-actions-note className="max-w-3xl text-sm text-muted-foreground">{ACTIONS_NOTE}</p>
      {total === 0 ? null : (
        <ul data-pf-cv-list className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {ordered.map((cv) => (<CvCard key={cv.id} cv={cv} />))}
        </ul>
      )}
    </div>
  );
}
