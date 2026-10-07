# Draft input composer

`draftinput` is the pure request composer for the private vacancy draft
create (`POST`) and explicit save (`PATCH`) input. It owns the exact
`{"fields": {...}}` envelope, the request body budget, the writable key
vocabulary, create defaults and the canonical fingerprint. It performs no
database, HTTP, network, catalog or organization access, and no persistence.

Value rules are delegated to the approved helpers, which are reused unmodified:

- `draftjson` — strict raw decoder and canonical `go-json-v1` encoder.
- `draftfields` — scalars, collections, requester, languages, compensation.
- `draftrich` — the restricted ProseMirror description and derived plain text.

## Exported API

```go
const MaxBodyBytes = 1048576 // inclusive, enforced before decode

var (
    ErrPayloadTooLarge // body longer than MaxBodyBytes
    ErrInvalidRequest  // malformed JSON, wrong envelope shape,
                       // unknown/read-only key, unsupported rich version
    ErrValidation      // a recognized field violated its value contract
    ErrEmptyPatch      // PATCH fields object has no keys
)

func DecodeCreate(body []byte) (Create, error)
func DecodePatch(body []byte) (Patch, error)

func (c Create) Fingerprint() []byte
func (p Patch) Fingerprint() []byte
func (f Fields) DescriptionPlain() (string, bool)
```

`Create` and `Patch` embed `Fields` and carry unexported canonical bytes.
`Fields` is the owned normalized writable set; every field is tri-state through
`shared.Optional`:

- absent: `Set == false`
- present null: `Set == true`, `Valid == false`
- present value: `Set == true`, `Valid == true`

Every returned slice and pointer is freshly allocated and never aliases the
request bytes. `Fingerprint` also returns a fresh copy.

## Envelope and errors

The body must be exactly `{"fields": {...}}` and nothing else. The size check
runs before decode; the strict `draftjson` decoder then rejects duplicate keys,
invalid UTF-8, lone surrogate escapes, non-integer numbers and trailing data.

| Condition | Error |
| --- | --- |
| `len(body) > MaxBodyBytes` | `ErrPayloadTooLarge` |
| malformed JSON; root not exactly `fields`; `fields` not an object | `ErrInvalidRequest` |
| unknown or read-only key at any delegated level | `ErrInvalidRequest` |
| PATCH with an empty `fields` object | `ErrEmptyPatch` |
| a recognized field violates its contract | `ErrValidation` |
| rich `description.schema_version` is not numeric `1` | `ErrInvalidRequest` |

`ErrValidation` always wraps the underlying group validator error, so a caller
can match a specific sentinel with `errors.Is`. Unknown/read-only keys are
rejected at any level of a delegated object — including the derived nested
`requester.name` and the keys of known rich nodes, marks and attribute objects —
and are always request errors, never value errors.

## Rich description key shape

The composer checks the key sets of the known rich types without reimplementing
the rich grammar:

| Object | Allowed keys |
| --- | --- |
| `doc`, `paragraph`, `bulletList`, `listItem` | `type`, `content` |
| `orderedList` | `type`, `attrs`, `content`; `attrs` is `start`, `type` |
| `text` | `type`, `text`, `marks` |
| `hardBreak` | `type`, `marks` |
| mark `bold`, `italic` | `type` |
| mark `fontSizePreset` | `type`, `attrs`; `attrs` is `preset` |
| mark `link` | `type`, `attrs`; `attrs` are `href`, `target`, `rel`, `class`, `title` |

A key outside a known type's set is `ErrInvalidRequest`. Everything the key
check deliberately does not own stays `ErrValidation`: an unknown node or mark
type, a missing or wrongly typed member, and every attribute value rule (for
example an empty `doc` or an out-of-range `start`). The walk recurses only
through `content` arrays and is bounded by the strict decoder depth and value
limits.

## Create defaults and patch presence

`DecodeCreate` returns a complete field set: after a create every field has
`Set == true`.

| Omitted input | Resulting value |
| --- | --- |
| Scalar | `nil` (present null) |
| Nullable object (`requester`, `description`) | `nil` (present null) |
| List | present, valid, non-nil empty slice |
| `compensation` | `draftfields.DefaultCompensation()` |

`DecodePatch` returns a presence-only delta: an omitted field stays absent
(unchanged for a later persistence step) and a present field is **fully
replaced**. No nested merge is performed, and a list or object group set to
`null` is invalid, except the nullable scalars, `requester` and `description`
where `null` explicitly clears the value.

## Canonical fingerprint

`Fingerprint` returns the canonical `go-json-v1` bytes of:

```json
{"schema_version": 1, "fields": { ... }}
```

Object property order is irrelevant, array order is meaningful and preserved,
create defaults and normalized money decimals are included, and the explicit
`schema_version: 1` makes the representation self-describing. Create bodies
differing only by omitted defaults (or by decimal spelling such as `"0"`,
`"0.0"`, `"0.00"`) produce identical fingerprints. The embedded rich
`description` values are the exact canonical rich bytes produced by
`draftrich`, so the fingerprint reuses them verbatim.

## Derived plain text

`Fields.DescriptionPlain` returns the server-side derived plain text and a
boolean that is `false` exactly when the description is null. A non-null
description with an empty paragraph returns `("", true)`, which is distinct
from null. The derived value is never writable: a `description_plain` key in
the request body is rejected as an unknown key.

## Out of scope

Requester `kind`/`id` are only checked lexically. The **organization and kind
ownership lookup explicitly remains persistence work**: this package performs
no catalog query and accepts any lexical UUID with any allowed kind.

Also out of scope here: persistence, ETag/`If-Match`, `Idempotency-Key`
handling, HTTP routes and error projection, autosave, publication and legacy
migration.

## Tests

Run the focused tests from `backend/`:

```sh
go test ./internal/features/jobs/application/draftinput -count=1
```
