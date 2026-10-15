# Additive v2 draft transport client (`api/client-v2.ts`)

Status: additive frontend transport adapter for the private vacancy draft v2 routes
(`docs/contracts/private-vacancy-drafts-v2-screening.md` §1, §3, §4). It is **not**
editor integration, publication, migration, session handling or UI saving, and it does
not claim the v2 endpoints exist. The v1 client (`api/client.ts`) and its routes stay
untouched and there is no v1 fallback.

## Surface

| Function | Request | Success |
| --- | --- | --- |
| `createDraftV2` | `POST /v2/me/company/job-drafts` | `201` + non-blank `ETag` + `Idempotency-Replayed: "true" \| "false"` |
| `getDraftV2` | `GET /v2/me/company/job-drafts/{id}` | `200` + non-blank `ETag` |
| `saveDraftV2` | `PATCH /v2/me/company/job-drafts/{id}` | `200` + non-blank `ETag`, request carries `If-Match` |

Every entry point takes an explicit `token`; `createDraftV2` takes an explicit
`idempotencyKey` and `saveDraftV2` an explicit `ifMatch`. The adapter never generates,
parses or reconstructs a key or tag, and never reads cookies, headers, a session store or
`process.env` for identity. It also never consults the sample-jobs switch.

Result types are narrowly named per operation: `CreateDraftV2Result`, `GetDraftV2Result`,
`SaveDraftV2Result`, built from `DraftV2ClientError` / `DraftV2ErrorEnvelope` /
`DraftV2Failure` and the v2 success shapes.

## Validation order

1. **Local guards first**, before the environment module or the network:
   - absent/blank token → `missing_token`;
   - malformed draft id or idempotency key, blank/absent `If-Match`, or a body that fails
     the approved v2 write schema → `invalid_request`.
2. **Lazy environment import**, so guarded calls never validate server env.
3. **Transport** through the guarded `lib/api/server` façade (`requestJson`) with an
   explicit `authorization` header and `expectedStatus` (`201` for create, `200` for
   read/save).

Write bodies are validated with `draftV2PostBodySchema` (POST) and
`draftV2PatchBodySchema` (PATCH); read bodies with `draftReadEnvelopeV2Schema`. A v1 write
shape or a v1 read envelope is rejected, never projected or downgraded. The caller's input
objects are never mutated.

## Response handling

- The `ETag` is opaque: it is returned verbatim as a header value and never parsed,
  reconstructed or folded into the envelope.
- `POST` success additionally requires the raw `Idempotency-Replayed` flag to be exactly
  `"true"` or `"false"` (kept as a string, never coerced to boolean).
- `GET`/`PATCH` success requires the decoded v2 envelope id to match the addressed id
  (UUID case-insensitive).
- A missing/malformed required header, a wrong success status, a mismatched identity or an
  undecodable body is `invalid_response` and never a success.
- Private screening data is preserved verbatim: `correct_option_id`, UUID hex case and
  question/option order survive decoding unchanged.

## Failures

- Non-2xx responses keep only the backend `{ error, code }` envelope; v2 has no error
  `data`, so any extra key is dropped.
- `404`, `409`, `412`, `428` and 5xx propagate their exact status and envelope.
- There are **no automatic retries** and no v1 fallback. Every mutation failure
  (`createDraftV2`, `saveDraftV2`) is `retryable: false`, including transport network,
  timeout and 5xx flags; an uncertain write must be reconciled with an explicit
  `getDraftV2`. Reads keep the transport retry classification.
- The credential never appears in a result.

## Boundaries and limitations

- Decoded-value validation only: not raw-byte validation, duplicate-key rejection,
  authentication, authorization or proof the v2 endpoint exists. The backend remains
  authoritative and must revalidate.
- The adapter itself adds no editor, session or UI behavior; the editor saves through
  `features/jobs/drafts/actions.ts`. No publication, migration or database behavior.
- The underlying server `fetch` has no ambient cookie jar. Every call sets
  `redirect: "error"`: the API never redirects, so a 3xx is a network failure
  (mutations: uncertain, never followed or retried) and the credential is never
  forwarded to another location.

## Tests

`api/client-v2.test.ts` drives every entry point through the public adapter over the real
`requestJson` transport with a deterministic `fetch` boundary, asserting exact URLs,
methods, bodies, headers, request counts, input immutability, response/error handling and
v1/v2 isolation.
