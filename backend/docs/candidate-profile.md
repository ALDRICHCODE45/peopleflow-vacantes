# Candidate profile API

Authenticated candidate-only `GET/PUT /me/profile/` and
`GET/PUT /me/profile/languages/` retain their subject-to-user resolution,
no-store policy and ownership rules. No user ID is accepted as the owner.
A missing profile returns 404. Unknown request keys return 400 `invalid_request`;
this includes the removed `education_level` and `field_of_study` keys.

## Replace a profile

PUT is a **full replacement** of client-owned fields. Omitted or null nullable
fields become SQL NULL. Omitted `education` becomes `[]`; explicit `education:null`
is invalid. Skills are normalized; omitted/null skills become `[]`;
omitted/null salary currency defaults to `MXN`. Reserved CV storage fields and
server-managed identity/timestamps are not client-writable and are rejected as
unknown request keys. PUT does not replace languages or overwrite reserved CV data.

```json
{"professional_title":"Backend engineer",
 "years_of_experience":"1.5","seniority":"junior",
 "skills":["Go","SQL"],
 "education":[
   {"level":"bachelor","institution":"UNAM","field":"Computación","status":"completed","start_year":2015,"end_year":2020},
   {"level":"master","institution":null,"field":null,"status":"in_progress","start_year":2024,"end_year":null}],
 "location":{"country":"MX","state":"14","municipality":"14039"}}
```

- `phone`: null, `""` (both clear it) or exact E.164, the same rule as
  [manual intake](manual-intake.md): `+`, then 8–15 digits with a nonzero first
  digit; `+52` requires exactly ten national digits (`+525512345678`). Spaces,
  dashes and other separators are invalid, never normalized. Anything else
  produces `phone` / `invalid`.
- `years_of_experience`: decimal string or null, matching
  `^(0|[1-9][0-9]?)(\.[0-9])?$`, value 0–60. Numbers, whitespace, leading zeroes,
  and extra decimal places are invalid. Canonical responses drop a zero fraction:
  `"2.0"` becomes `"2"`; `"1.5"` stays `"1.5"`.
- `seniority`: null or exactly `intern`, `junior`, `semi_senior`, `senior`, `lead`,
  `manager`, `director`. Literals are never trimmed or case-folded.
- `education`: at most ten records, in input order; duplicates are allowed.
  Every record **must contain all six keys**, even when values are null:
  `level`, `institution`, `field`, `status`, `start_year`, `end_year`.
  Missing keys produce `required`; unknown keys produce `invalid_request`.
- `level`: `secondary`, `high_school`, `technical`, `tsu`, `bachelor`,
  `specialty`, `master`, `phd`.
- `status`: `in_progress`, `paused`, `completed`, `incomplete`.
- `institution` and `field`: null or trimmed text of 1–120 Unicode code points.
- Years: null or integers 1950–2100, with `start_year <= end_year` when both are
  known. `end_year:null` is valid for every status. `in_progress` requires it;
  non-null produces `education[i].end_year` / `not_allowed`.

GET and successful PUT always return `years_of_experience`, `seniority`, and an
`education` array; every returned study has exactly the six keys above.
Other profile fields retain their existing types and omission behavior.

`location` replaces the former `city`/`country` text fields. Omit it or send null
to clear it. A present object requires a known country; state and municipality
are optional but consistent. Subdivisions are MX-only today. Any `postal_code`
key (including empty/null) returns 422 `invalid_location` with
`location.postal_code` / `not_allowed`. Unknown nested keys return 400.
Responses use the expanded [G3 location read shape](geo-profiles.md), with
catalog `{id,name}` references and a server-built `label`, or `location:null`.

## Replace languages

```json
{"languages":[{"code":"es","level":"native"},{"code":"en","level":"B2"}]}
```

At most ten entries; codes must be unique and belong to the
[language catalog](language-catalog.md). Codes are exact opaque identifiers,
not names. Levels are exactly `A1`, `A2`, `B1`, `B2`, `C1`, `C2`, `native`.
An empty list clears all languages; an omitted list also clears it for backward
compatibility. Explicit null is invalid. GET/PUT return the same envelope,
sorted by code; the array is never null. Neither reads nor writes access
migration rollback metadata.

## Errors and atomicity

Invalid harmonized fields return the shared HTTP 400 envelope, for example:

```json
{"error":"validation failed","code":"validation_error","fields":[{"field":"education[0].end_year","code":"not_allowed"}]}
```

The catalog owns the human-readable `error` message. Clients should use `code`
and `fields`. Field codes are `required`, `invalid`, `too_long`, `not_allowed`,
and `duplicate`; paths include `phone`, `years_of_experience`, `seniority`,
`education[i].status`, and `languages[i].code`. Validation completes before any
write. Profile and education replacement share a transaction; language replacement
is also transactional. Rejection leaves previously stored data unchanged.

Application/participation compatibility projections remain unchanged until H4;
this API switch does not rewrite previously captured application snapshots.

## Test map

| Contract | Evidence |
| --- | --- |
| Field errors, missing study keys, limits | `TestHarmonizedProfileValidation`, `TestHarmonizedLanguagesValidation`, `TestProfileFieldsRejectBeforePersistence` |
| Phone E.164 rule, clearing with null/omitted/empty | `TestProfilePhoneValidation` |
| Vocabulary, code points, year boundaries, duplicate studies | `TestProfileFieldsVocabulariesAndBoundaries`, `TestLanguagesCatalogLevelsAndBoundaries` |
| Exact response shape, removed/unknown keys | `TestHarmonizedProfileExactShape`, `TestHarmonizedUnknownFields` |
| DB-backed PUT/GET and replacement | `TestProfileHTTPHarmonizationRoundTripAndReplacement` |
| Rejection preserves stored profile | `TestProfileHTTPHarmonizationRejectionPreservesData` |
| Catalog-code languages, native, atomic rejection | `TestProfileHTTPLanguagesCodesAndAtomicRejection` |

Integration tests use the candidates package's `DATABASE_URL` harness and an
already migrated database. Run them separately from packages with destructive
migration-Down tests. See also [G3](geo-profiles.md), [G4](geo-apply.md), and
[candidate identity/onboarding](candidate-identity.md).
