# Language catalog and shared profile vocabularies (H1a)

Binding contract: [profile harmonization §1–§2](../../docs/profile-harmonization-design.md).
This unit does not change candidate writes, vacancy fields, storage, or filters.

## Anonymous HTTP contract

`GET /v2/catalogs/languages` returns exactly
`{"items":[{"code":"…","name":"…"}]}` with 197 embedded entries.
Names are Spanish NFC. Items use Spanish collation, ignoring case and accents,
then ascending code. The HTTP adapter uses the existing `golang.org/x/text`
dependency; the shared package itself uses only the standard library.

Responses have `Content-Type: application/json`,
`Cache-Control: public, max-age=86400`, and a strong, quoted SHA-256 ETag of the
exact response bytes. Matching `If-None-Match` returns 304 without a body,
retaining cache headers. Lists, multiple header lines, wildcard, and weak GET
validators are supported. There is no authentication, database access, or runtime
catalog editing. The representation is built once; no collator is shared across
requests. Query parameters do not change this representation.

## Identifiers and Mexican Indigenous entries

Codes are opaque: prefer ISO 639-1, otherwise ISO 639-3, otherwise an ISO
639-2/639-5 collective; use documented local-use identifiers only when no ISO
code covers the requested grouping. Never assign a variety's code to a grouping.
`nah` is collective, `zap` is a macrolanguage. Local codes below are allocated
within `qaa`–`qtz`; their grouping and rationale live in `catalog.go`'s `localUse`
map, exposed through `LocalUseReason`. Do not reassign these identifiers.

| Language | Code | Local use |
| --- | --- | --- |
| Náhuatl | nah | No |
| Maya yucateco | yua | No |
| Tseltal | tzh | No |
| Tsotsil | tzo | No |
| Mixteco | qaa | Yes |
| Zapoteco | zap | No |
| Otomí | qab | Yes |
| Totonaco | qac | Yes |
| Ch'ol | ctu | No |
| Mazateco | qad | Yes |
| Huasteco | hus | No |
| Mazahua | qae | Yes |
| Tlapaneco | qaf | Yes |
| Chinanteco | qag | Yes |
| Purépecha | qah | Yes |
| Mixe | qai | Yes |
| Tarahumara | qaj | Yes |
| Zoque | qak | Yes |
| Tojolabal | toj | No |
| Chontal de Tabasco | chf | No |
| Huichol | hch | No |
| Amuzgo | qal | Yes |
| Chatino | qam | Yes |
| Tepehuano | qan | Yes |
| Triqui | qao | Yes |
| Popoluca | qap | Yes |
| Cora | qaq | Yes |
| Yaqui | yaq | No |
| Mayo | mfy | No |
| Seri | sei | No |

Tepehuano and Popoluca retain the contract's umbrella labels rather than silently
narrowing them to one INALI grouping or ISO variety. Local codes cover those
requested umbrellas. Otomí does not reuse `oto` (the broader Otomian collective).
Mixteco does not reuse `mix` (Mixtepec Mixtec).

## Shared Go API

`internal/shared/languages` provides defensive-copy catalog/vocabulary accessors
and exact membership validation. `Lookup(code)` returns `(name, found)`;
unknown, padded, or uppercase codes are not normalized.

- `LanguageLevels`: `A1 A2 B1 B2 C1 C2 native`, in ascending proficiency order.
- `Seniorities`: `intern junior semi_senior senior lead manager director`.
- `EducationLevels`: `secondary high_school technical tsu bachelor specialty master phd`.
- `EducationStatuses`: `in_progress paused completed incomplete`.
- `ValidLanguageLevel`, `ValidSeniority`, `ValidEducationLevel`, and
  `ValidEducationStatus` accept only the exact literals.
- `CompareLanguageLevels` and `CompareEducationLevels` return a negative, zero,
  or positive order and a validity boolean. An invalid operand returns `(0,false)`.
  Education ordering alone does not establish completion: consumers must consider
  only `completed` records when calculating the highest completed qualification.

`ValidYears` and `NormalizeYears` accept exactly
`^(0|[1-9][0-9]?)(\.[0-9])?$` with numeric value 0–60, using integer/string logic.
Canonical form removes a zero fractional digit: `2` and `2.0` both become `2`;
nonzero fractions retain one digit (`1.5`). Normalization is idempotent and
returns `("",false)` for invalid input. It does not trim, round, or accept
alternate numeric syntax. This is also the intended H5 filter normalizer.

## Test map

| Contract | Test |
| --- | --- |
| Unique/valid codes, NFC, all 30 Mexican entries, local-use bounds and rationale, exact lookup, defensive catalog copy | `internal/shared/languages/catalog_test.go`: `TestCatalogInvariants` |
| Exact vocabularies, all ordered pairs, invalid operands, defensive vocabulary copy | `TestVocabularies` |
| Years boundaries, invalid syntax, canonical equivalence and idempotence | `TestYears` |
| Exact body keys, Spanish ordering, strong body ETag, cache headers, conditional GET variants | `internal/features/catalogs/infrastructure/http/languages_test.go`: `TestLanguagesAnonymousCacheContract` |
| Real router bypasses rejecting authentication gates; 200 and 304 remain public-cacheable | `cmd/api/languages_routes_test.go`: `TestLanguagesRouteAnonymous` |
| Pinned route topology | `cmd/api/main_test.go`: `TestRouteTopology_ExactRegistrations` |

Validation from `backend`: `go run ./cmd/archguard`, `go test ./... -count=1`
(including `scripts/closure`), `go vet ./...`, and `go vet -tags=integration ./...`.
Integration vet is compile/static analysis, not a database-backed integration run.
