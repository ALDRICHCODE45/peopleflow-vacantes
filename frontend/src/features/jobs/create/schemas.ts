import { z } from "zod";

/**
 * Wire contract for the employer create-vacancy write path.
 *
 * The request schema mirrors `POST /jobs` exactly
 * (`backend/internal/features/jobs/application/dtos/createJobDto.go`), and the
 * editor schema mirrors the `201` body
 * (`jobEditorViewDto.go`). Both are Zod-only: no React, no transport, no
 * server-only import, so the client form can reuse them for validation.
 */

const uuid = z.string().uuid();
const nonEmptyString = z.string().min(1);
/** RFC3339 with an explicit offset: what Go's `time.Time` marshaler emits. */
const offsetAwareIsoDateTime = z.string().datetime({ offset: true });
const integer = z.number().int();

const WORK_MODES = ["onsite", "remote", "hybrid"] as const;
const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contract",
  "internship",
] as const;
const SENIORITIES = ["intern", "junior", "mid", "senior", "lead"] as const;
const SALARY_CURRENCIES = ["MXN", "USD"] as const;
const JOB_STATUSES = ["draft", "published", "closed"] as const;

/** Required text: trimmed first, so a whitespace-only value fails the same way the backend rejects it. */
function requiredText(message: string) {
  return z.string().trim().min(1, message);
}

/**
 * Optional text. Both an explicit JSON `null` (accepted by the backend's
 * pointer fields) and an empty or whitespace-only value collapse to
 * `undefined`, so the key is omitted from the wire payload instead of sending
 * `null` or `""`.
 */
const optionalText = z
  .union([z.string(), z.null()])
  .transform((value) => {
    if (value === null) return undefined;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  })
  .optional();

/**
 * Optional currency. An explicit `null` or an unselected value is omitted so the
 * backend applies its MXN default instead of receiving an invalid empty enum.
 */
const optionalCurrency = z
  .union([z.literal(""), z.enum(SALARY_CURRENCIES), z.null()])
  .transform((value) => (value === "" || value === null ? undefined : value))
  .optional();

/**
 * Optional integer bound. An explicit `null` collapses to `undefined` exactly
 * like an empty input, because create has no tri-state: absent and `null` both
 * mean "no value" (`createJobDto.go` decodes both to a nil pointer).
 */
const optionalInteger = z
  .union([integer, z.null()])
  .transform((value) => (value === null ? undefined : value))
  .optional();

/** Own enumerable string-keyed properties of `value`, the set `JSON.stringify` would send. */
function ownEnumerableProperties(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value));
}

/** Narrows an unparsed input to the JSON-like object shape the projection above accepts. */
function isPropertyBag(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A projection-wrapped object schema keeps the wrapped schema's input and output types. */
type OwnPropertiesSchema<T extends z.ZodObject<z.ZodRawShape>> = z.ZodEffects<
  T,
  z.output<T>,
  z.input<T>
>;

/**
 * Zod v3 object parsing reads every declared shape key with `data[key]`, which
 * walks the prototype chain: a value inherited through the input prototype
 * would satisfy a required field and would be materialized into the parsed
 * output, and an inherited declared key would be marked `alwaysSet`. A create
 * request is a JSON object the client owns, so only its own enumerable
 * properties are part of the wire contract.
 *
 * This wrapper projects the runtime input onto those own enumerable properties
 * before Zod reads the declared shape keys, so inherited required properties
 * cannot satisfy the contract and inherited optional or prototype-only
 * properties can never enter the parsed wire payload. Only the request boundary
 * uses it: response bodies arrive through `JSON.parse`, which can only produce
 * own enumerable properties.
 */
function ownPropertiesOnly<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
): OwnPropertiesSchema<T> {
  const projected = z.preprocess(
    (value) => (isPropertyBag(value) ? ownEnumerableProperties(value) : value),
    schema,
  );
  // SAFETY: `z.preprocess` declares its input as `unknown`, so its result cannot
  // be assigned the wrapped schema's input type; the hook above is a transparent
  // projection that returns every non-object value unchanged, and the wrapped
  // object schema still rejects those values, which keeps `schema`'s declared
  // input and output types exact for callers instead of widening them.
  return projected as unknown as OwnPropertiesSchema<T>;
}

/**
 * `POST /jobs` request body. Unknown keys are stripped, matching the backend
 * decoder (which drops any immutable or foreign key the client might send), and
 * only own enumerable input properties are validated.
 */
const createJobRequestPayload = ownPropertiesOnly(
  z.object({
    title: requiredText("title must not be empty"),
    description: requiredText("description must not be empty"),
    work_mode: z.enum(WORK_MODES),
    employment_type: z.enum(EMPLOYMENT_TYPES),
    seniority: z.enum(SENIORITIES),
    location: optionalText,
    salary_min: optionalInteger,
    salary_max: optionalInteger,
    salary_currency: optionalCurrency,
  }),
);

/** Validated request before the empty optionals are pruned. */
type CreateJobRequestPayload = z.infer<typeof createJobRequestPayload>;

/**
 * Re-adds each optional key only when its normalized value is present, so the
 * schema output *is* the wire payload: an emptied field disappears instead of
 * arriving as a present-but-undefined key.
 */
function pruneEmptyOptionals(
  request: CreateJobRequestPayload,
): CreateJobRequestPayload {
  const { location, salary_min, salary_max, salary_currency, ...required } =
    request;
  const pruned: CreateJobRequestPayload = { ...required };
  if (location !== undefined) pruned.location = location;
  if (salary_min !== undefined) pruned.salary_min = salary_min;
  if (salary_max !== undefined) pruned.salary_max = salary_max;
  if (salary_currency !== undefined) pruned.salary_currency = salary_currency;
  return pruned;
}

/** Normalized, wire-ready request body accepted by `POST /jobs`. */
export const createJobRequestSchema = createJobRequestPayload
  .refine(
    (request) =>
      request.salary_min === undefined ||
      request.salary_max === undefined ||
      request.salary_min <= request.salary_max,
    {
      path: ["salary_max"],
      message: "salary_min must be less than or equal to salary_max",
    },
  )
  .transform(pruneEmptyOptionals);

/**
 * `201` editor response (`JobEditorViewDto`): the editable row plus `status`
 * and `updated_at`, plus the embedded `company{id,name}` block. The nullable
 * columns carry `omitempty` on the backend, so they are declared optional and
 * rejected when explicit `null` arrives — the wire never emits `null` there.
 * `updated_at` is required because it is the next write's CAS token.
 */
export const jobEditorViewSchema = z.object({
  id: uuid,
  title: nonEmptyString,
  description: z.string(),
  work_mode: z.enum(WORK_MODES),
  employment_type: z.enum(EMPLOYMENT_TYPES),
  seniority: z.enum(SENIORITIES),
  status: z.enum(JOB_STATUSES),
  location: z.string().optional(),
  salary_min: integer.optional(),
  salary_max: integer.optional(),
  salary_currency: z.enum(SALARY_CURRENCIES),
  published_at: offsetAwareIsoDateTime.optional(),
  updated_at: offsetAwareIsoDateTime,
  company: z.object({
    id: uuid,
    name: nonEmptyString,
  }),
});

/**
 * `POST /jobs` success body.
 *
 * Every created row is born `draft` with no publish timestamp, so a `201`
 * carrying another status or a present `published_at` is not a create
 * response: it is a malformed success and must fail closed instead of being
 * surfaced as a created draft. The broader `jobEditorViewSchema` stays valid
 * for future editor reads, where every status is legal.
 */
export const createJobSuccessSchema = jobEditorViewSchema.extend({
  status: z.literal("draft"),
  published_at: z.never().optional(),
});

/** Stable V1 error envelope (`httpjson.ErrorEnvelope`): `{error, code, data?}`. */
export const apiErrorEnvelopeSchema = z.object({
  error: nonEmptyString,
  code: nonEmptyString,
  data: z.unknown().optional(),
});

/** Normalized payload ready for `JSON.stringify` and `POST /jobs`. */
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;
/** Validated `201` editor view returned by the create client. */
export type JobEditorView = z.infer<typeof jobEditorViewSchema>;
/** Decoded backend failure envelope, when the backend sent one. */
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
