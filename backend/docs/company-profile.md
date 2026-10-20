# Company profile API

Company locations use catalog codes instead of free-text `city`/`country`.
Migration 00032 and an imported geo catalog are required; see [G3](geo-profiles.md).

## Create and read

Authenticated recruiter `POST /companies` still creates the company and founding
owner atomically. Existing name, RFC, industry and optional profile rules remain.
Location is optional; omitted/null starts without a location.

```json
{"name":"Acme SA de CV","rfc":"AAA010101AAA","industry_id":"tech",
 "location":{"country":"MX","state":"14","municipality":"14039","postal_code":"44100"}}
```

Public `GET /companies/{id}` retains its tombstone visibility and RFC/status
redaction. Both create and public read return location as the expanded
[catalog read shape](geo-profiles.md), with a label, or null. A country-only
international location is valid. Only MX currently supports subdivisions/postal.
Public `GET /companies/{id}` does **not** expose `updated_at`.

## Member company summary

Authenticated `GET /me/company` adds `company.location` (the same five-key read
shape or null) and `company.updated_at`. These fields are visible to **every
member**, owner or recruiter; owner-only PATCH authorization is unchanged.
All existing summary fields remain present.

`company.updated_at` is UTC RFC3339Nano, preserving fractional seconds. Send the
**exact string** as `If-Unmodified-Since` when PATCHing; it represents the same
value as the PATCH editor view's `updated_at`. A successful save advances the
token; reusing the previous one returns 409 with current editor data. Do not
truncate it to seconds or convert it through a millisecond-only timestamp.

## Owner editing

Owner-only `PATCH /me/company` keeps its existing RFC3339 `If-Unmodified-Since`
parser (including RFC3339Nano fractional seconds) and audit co-write. Location has three states:

| PATCH body | Effect |
| --- | --- |
| `{}` | Keep the complete current location |
| `{"location":null}` | Clear every stored location code |
| `{"location":{"country":"US"}}` | Replace the whole object; remove previous state, municipality and postal |

Success returns the editor DTO with the new `updated_at` token and expanded
location. Missing, malformed or stale CAS → 409 `conflict`, with the same editor
shape in `data`; the submitted location is not applied. Immutable fields and
redaction are unchanged. Post-read lost races retain existing conflict behavior.

Country is required within an object; child levels require valid matching
parents. Postal code is optional, five digits and must map to the municipality.
Autocomplete is editable, not a lock. Unknown nested keys → 400 `invalid_request`;
consistency errors → 422 `invalid_location` with `location.*` field/reason details.

Precedence: JSON decoding happens first (unknown nested keys/wrong types → 400,
including with a stale token). For a well-formed body, CAS precedes location
consistency validation: stale token + unknown country → **409**, not 422. With a
current token that same invalid location returns 422. Neither rejection writes.

Catalog validation and all name expansion for success/conflict responses happen
**before persistence**. A catalog reader error or missing reference row fails
closed with a generic 500 and no company write; no success response performs a
post-write catalog lookup.

Review create/reload, absent/null/object PATCH, postal mismatch after changing
municipality, and two-tab conflicts. See [G3 test map and migration risks](geo-profiles.md).
