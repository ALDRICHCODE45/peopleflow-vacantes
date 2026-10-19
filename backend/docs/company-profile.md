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
The membership summary `GET /me/company` is unchanged (it never exposed city/country).

## Owner editing

Owner-only `PATCH /me/company` keeps its existing RFC3339 `If-Unmodified-Since`
token and audit co-write. Location has three states:

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

Review create/reload, absent/null/object PATCH, postal mismatch after changing
municipality, and two-tab conflicts. See [G3 test map and migration risks](geo-profiles.md).
