import { candidateIdentitySchema, candidateProfileSchema } from "@/features/candidate/model";

/**
 * Pure, React-free adapter between the frozen prototype candidate and the flat
 * string draft the public `postular` step 1 edits. It owns the six contactable
 * fields the candidate may correct for one application — name, email, phone,
 * professional title, city, and country — and nothing else: no CV upload, no
 * salary, no availability, and no capability the backend does not model.
 *
 * `candidateIdentitySchema` and `candidateProfileSchema` stay the single source
 * of truth for the bounds: this module reuses their exact field schemas, so the
 * accepted/rejected boundary can never drift from the candidate model. It
 * reaches no network, storage, router, clock, or randomness, and never mutates
 * its arguments.
 */

/** Canonical field order: the schema order the form and the review both follow. */
export const APPLICATION_CANDIDATE_FIELDS = [
  "fullName",
  "email",
  "phone",
  "professionalTitle",
  "city",
  "country",
] as const;
export type ApplicationCandidateField = (typeof APPLICATION_CANDIDATE_FIELDS)[number];

/** Every editable candidate field as a form-safe string; `""` means "unset". */
export type ApplicationCandidateDraft = Readonly<Record<ApplicationCandidateField, string>>;

/** Spanish labels the form and the review share. */
export const APPLICATION_CANDIDATE_FIELD_LABELS: Readonly<Record<ApplicationCandidateField, string>> =
  Object.freeze({
    fullName: "Nombre completo",
    email: "Correo electrónico",
    phone: "Teléfono",
    professionalTitle: "Título profesional",
    city: "Ciudad",
    country: "País",
  });

/** Stable DOM ids, so every label, error, and browser test agrees on one hook. */
export const APPLICATION_CANDIDATE_FIELD_IDS: Readonly<Record<ApplicationCandidateField, string>> =
  Object.freeze({
    fullName: "application-full-name",
    email: "application-email",
    phone: "application-phone",
    professionalTitle: "application-professional-title",
    city: "application-city",
    country: "application-country",
  });

/** One failing draft field, addressed by its stable field path. */
export interface ApplicationCandidateDraftIssue {
  readonly path: string;
  readonly message: string;
}

/** Discriminated outcome: the normalized draft, or every field issue found. */
export type ApplicationCandidateDraftParseResult =
  | { ok: true; draft: ApplicationCandidateDraft }
  | { ok: false; issues: readonly ApplicationCandidateDraftIssue[] };

/** The two fields `candidateIdentitySchema` already declares mandatory. */
const REQUIRED_FIELDS: ReadonlySet<ApplicationCandidateField> = new Set(["fullName", "email"]);

/** The four profile fields the model declares nullable; a blank value means "unset". */
const OPTIONAL_FIELDS: ReadonlySet<ApplicationCandidateField> = new Set([
  "phone",
  "professionalTitle",
  "city",
  "country",
]);

/** Spanish noun phrase per field, composed into every aria-ready message. */
const NOUNS: Readonly<Record<ApplicationCandidateField, string>> = {
  fullName: "El nombre completo",
  email: "El correo electrónico",
  phone: "El teléfono",
  professionalTitle: "El título profesional",
  city: "La ciudad",
  country: "El país",
};

/**
 * The exact field schemas of the candidate model. Reusing them (instead of
 * re-declaring lengths) is what keeps this draft's boundary identical to the
 * profile the rest of the prototype validates.
 */
const FIELD_SCHEMAS = {
  fullName: candidateIdentitySchema.shape.fullName,
  email: candidateIdentitySchema.shape.email,
  phone: candidateProfileSchema.shape.phone,
  professionalTitle: candidateProfileSchema.shape.professionalTitle,
  city: candidateProfileSchema.shape.city,
  country: candidateProfileSchema.shape.country,
};

/** The frozen identity fields this draft seeds from. */
type CandidateIdentitySource = {
  readonly fullName: string;
  readonly email: string;
};

/** The frozen nullable profile fields this draft seeds from. */
type CandidateProfileSource = {
  readonly phone: string | null;
  readonly professionalTitle: string | null;
  readonly city: string | null;
  readonly country: string | null;
};

/** Deterministically maps the frozen candidate onto the editable local draft. */
export function applicationCandidateDraftFromFixture(
  identity: CandidateIdentitySource,
  profile: CandidateProfileSource,
): ApplicationCandidateDraft {
  const text = (value: string | null): string => (value ?? "").trim();
  return {
    fullName: identity.fullName.trim(),
    email: identity.email.trim(),
    phone: text(profile.phone),
    professionalTitle: text(profile.professionalTitle),
    city: text(profile.city),
    country: text(profile.country),
  };
}

/**
 * Deterministic first+last initials for the avatar fallback, so the frame never
 * depends on a random or remote value. A blank name has no initials and falls
 * back to a neutral mark instead of an empty circle.
 */
export function applicationCandidateInitials(fullName: string): string {
  const letters = fullName
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== "")
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase());
  return letters.length === 0 ? "?" : letters.join("");
}

/** Minimal structural view of a schema issue, mirroring the profile draft adapter. */
interface SchemaIssue {
  readonly code: string;
  readonly validation?: unknown;
  readonly minimum?: unknown;
  readonly maximum?: unknown;
}

/** Translates one schema issue into its Spanish, aria-ready counterpart. */
function messageFor(field: ApplicationCandidateField, issue: SchemaIssue): string {
  const noun = NOUNS[field];
  if (issue.validation === "email" || issue.code === "invalid_string") {
    return `${noun} no es válido.`;
  }
  if (issue.code === "too_small") {
    return `${noun} debe tener al menos ${String(issue.minimum)} caracteres.`;
  }
  if (issue.code === "too_big") {
    return `${noun} debe tener como máximo ${String(issue.maximum)} caracteres.`;
  }
  return `${noun} no es válido.`;
}

/** Outcome of reading one raw draft entry: a string, an explicit unset, or a type error. */
type RawFieldValue =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "unset" }
  | { readonly kind: "invalid" };

/**
 * Reads one raw draft entry. Only a string is a draft value; `null` and
 * `undefined` mean "unset" (the candidate model declares its profile fields
 * nullable, and a missing key has no value to edit), while every other type —
 * a number, boolean, array, function or object — is a type error instead of
 * being silently coerced to `""` and accepted as an unset field.
 */
function readFieldValue(
  record: Record<string, unknown>,
  field: ApplicationCandidateField,
): RawFieldValue {
  const value = record[field];
  if (typeof value === "string") return { kind: "text", value };
  if (value === null || value === undefined) return { kind: "unset" };
  return { kind: "invalid" };
}

/** Parses an edited candidate draft into a normalized draft; it never throws. */
export function parseApplicationCandidateDraft(raw: unknown): ApplicationCandidateDraftParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, issues: [{ path: "draft", message: "Los datos de tu postulación no son válidos." }] };
  }
  const record = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter(
    (key) => !(APPLICATION_CANDIDATE_FIELDS as readonly string[]).includes(key),
  );
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      issues: unknownKeys.map((key) => ({
        path: key,
        message: "Este campo no forma parte de tus datos de postulación.",
      })),
    };
  }

  const issues: ApplicationCandidateDraftIssue[] = [];
  const normalized: Partial<Record<ApplicationCandidateField, string>> = {};

  for (const field of APPLICATION_CANDIDATE_FIELDS) {
    const read = readFieldValue(record, field);
    if (read.kind === "invalid") {
      issues.push({ path: field, message: `${NOUNS[field]} debe ser texto.` });
      continue;
    }
    const value = read.kind === "text" ? read.value : "";
    if (REQUIRED_FIELDS.has(field) && value.trim() === "") {
      issues.push({ path: field, message: `${NOUNS[field]} es obligatorio.` });
      continue;
    }
    const candidateValue = OPTIONAL_FIELDS.has(field) && value.trim() === "" ? null : value;
    const parsed = FIELD_SCHEMAS[field].safeParse(candidateValue);
    if (parsed.success) {
      normalized[field] = parsed.data ?? "";
      continue;
    }
    const [issue] = parsed.error.issues;
    issues.push({ path: field, message: messageFor(field, issue) });
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    draft: {
      fullName: normalized.fullName ?? "",
      email: normalized.email ?? "",
      phone: normalized.phone ?? "",
      professionalTitle: normalized.professionalTitle ?? "",
      city: normalized.city ?? "",
      country: normalized.country ?? "",
    },
  };
}
