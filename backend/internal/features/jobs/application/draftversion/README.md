# Draft version ETag / If-Match

`draftversion` owns the strong draft entity tag and the `If-Match` precondition
for private vacancy draft saves. It is pure: no HTTP, database, auth, network or
persistence. It does not decode request bodies and does not know the route.

## API

```go
func FormatETag(id string, version int64) (string, error)
func ParseIfMatch(value string, present bool) (Tag, error)
func Compare(issued, presented Tag) error

type Tag struct {
    ID      string // canonical lowercase UUID36
    Version int64
}
```

- `FormatETag` builds the exact quoted tag from a draft id and a positive
  `int64` version. Invalid input returns an empty string and an error; it never
  panics and never returns a partial tag.
- `ParseIfMatch` parses one `If-Match` header value into a `Tag`. `present` must
  report whether the request actually carried the header (for example
  `values, ok := r.Header["If-Match"]`); it is authoritative.
- `Compare` checks a parsed tag against the tag issued for the addressed draft.
  It is separate from parsing on purpose: run it **after** authentication and
  authorization.

## Exact format

```text
"jd-r1-<lowercaseUUID36>-v<positiveDecimalVersion>"
```

The surrounding double quotes are part of the value. The UUID must be exactly
36 bytes of **lowercase** hex in `8-4-4-2-12` form. The version is a decimal
number with no sign, no decimal point, no whitespace and no leading zeros.

- `jd-r1` is a fixed representation marker. Changing it must invalidate every
  outstanding tag.
- `requester.name` is an immutable catalog value in this slice; future catalog
  changes also invalidate this representation.

## OWS choice

RFC 9110 permits optional whitespace around a header field value, so
`ParseIfMatch` trims only leading and trailing HTTP OWS (SP and HTAB) from the
header value. Everything inside the quotes is exact: a space or tab inside the
tag is malformed and is rejected, never trimmed. Weak tags (`W/"…"`), a list of
two or more tags, `*`, an unquoted tag and any extra character around the single
quoted tag are all `ErrInvalidRequest`. This does **not** relax the
single-issued-tag rule, and Go's `net/http` already trims header values, so the
trim only keeps the pure function correct for raw callers.

## Version boundary

The version is DB-compatible `int64`. It is parsed with `strconv.ParseInt`
(`bitSize 64`), never through `float64`, so no precision is lost and overflow
(`v9223372036854775808` and larger) is rejected. `0`, negative and signed forms
are rejected. Leading zeros are rejected (`v01` is invalid) so the decimal form
is canonical and one version has exactly one tag.

## Error mapping

| Sentinel | HTTP | When |
| --- | --- | --- |
| `ErrPreconditionRequired` | `428 precondition_required` | header missing (`present == false`) |
| `ErrInvalidRequest` | `400 invalid_request` | present but weak, list, `*`, or malformed |
| `ErrVersionConflict` | `412 version_conflict` | parsed id or version differs from the issued tag |
| `ErrInvalidID` | server fault | `FormatETag` received a non-lowercase-UUID36 id |
| `ErrInvalidVersion` | server fault | `FormatETag` received a non-positive version |

`ErrInvalidID` and `ErrInvalidVersion` are server-side formatting failures — a
bad draft row, not a bad client precondition.

## Authorization ordering

`ParseIfMatch` never compares against a draft id, so it cannot disclose
existence. `Compare` must run only after the auth gates: an unauthorized,
cross-organization or missing draft must already have produced its own
`404`/`403` before any `412` is possible. Any difference — other id, stale
version, newer version or another id at the same version — returns
`ErrVersionConflict`; the server-issued version is authoritative and the
precondition is exact equality. A `412` carries no editor data.

## Example

```go
etag, err := draftversion.FormatETag(draft.ID, draft.Version) // -> `"jd-r1-…-v1"`

values, present := r.Header["If-Match"]
value := ""
if len(values) > 0 {
    value = values[0]
}
presented, err := draftversion.ParseIfMatch(value, present)
// after auth/authorization of the addressed draft:
if err := draftversion.Compare(draftversion.Tag{ID: draft.ID, Version: draft.Version}, presented); err != nil {
    // 412 version_conflict
}
```

## Out of scope

No HTTP handler, error projection, persistence, transaction, idempotency or
audit lives here. This package does not decide `Idempotency-Key` behavior and
does not implement the requester catalog.

## Tests

Run the focused tests from `backend/`:

```sh
go test ./internal/features/jobs/application/draftversion -count=1
```
