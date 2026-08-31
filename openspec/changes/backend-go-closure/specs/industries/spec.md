# Industries Specification

## Purpose

The `industries` capability owns the industries reference catalog: the `industries` table, the active-catalog semantics, the public read endpoint, and the active-only read contract consumed by the company-create form and (by contract reference) the atomic active-industry gate owned by `companies`. Industries is a reference catalog with no domain lifecycle of its own: no create/update/delete surface, no auth, no audit. The catalog rows are seeded by migration and maintained out-of-band.

## Requirements

### Requirement: Public Active-Catalog Endpoint

The system MUST expose `GET /industries` as a public, unauthenticated endpoint. If an `Authorization` header is present it MUST be ignored. On success the response MUST be `200` with Content-Type `application/json` and a JSON array (never `null`) where each element carries exactly the fields `id` (string), `label_es` (string), `label_en` (string), and `sort_order` (number). The response MUST NOT expose the internal `active` flag or timestamps. On a catalog read failure the endpoint MUST return `500` with the shared stable error envelope (code `internal_error`), never a raw database error.

#### Scenario: GET /industries is public and returns the active array

- GIVEN industries rows exist with at least one active row
- WHEN `GET /industries` is sent with no `Authorization` header
- THEN the response is `200` with a JSON array whose elements carry exactly `id`, `label_es`, `label_en`, and `sort_order`

#### Scenario: response omits internal fields

- GIVEN any `GET /industries` response
- WHEN the body is inspected
- THEN no element carries `active`, `created_at`, or `updated_at` (internal fields are not exposed)

#### Scenario: catalog read failure returns the shared envelope

- GIVEN the industries query fails (e.g., database unreachable)
- WHEN `GET /industries` is sent
- THEN the response is `500` with the shared stable error envelope body (human English `error` message plus `code` `internal_error`) and the raw driver error is logged server-side only

### Requirement: Active-Only Catalog Semantics

The industries catalog MUST expose ONLY rows with `active = true` on every public read. The read query MUST filter `active = true` and MUST order results by `sort_order`, then `id`. Inactive rows MUST never appear on the public endpoint and MUST NOT be selectable as a valid industry by any write path (the enforcement of that invariant at company-creation time is owned by the `companies` capability's atomic active-industry gate; this capability owns the catalog semantics themselves).

#### Scenario: inactive rows are never returned

- GIVEN one active row and one inactive (`active = false`) row in `industries`
- WHEN `GET /industries` is sent
- THEN the response contains only the active row and never the inactive row

#### Scenario: ordering is sort_order then id

- GIVEN active rows with distinct and tied `sort_order` values
- WHEN `GET /industries` is sent
- THEN the returned array is ordered by `sort_order` ascending, ties broken by `id`

### Requirement: Single Canonical Route Registration

The industries handler MUST be registered exactly once in the composition root. A duplicate registration of the same industries path (e.g., both a `Mount` and a `Get` on `/industries`) MUST be removed so that exactly one canonical registration serves the endpoint; a static scan of the composition root MUST find exactly one industries route registration.

#### Scenario: exactly one industries registration exists

- GIVEN the composition root in `backend/cmd/api/main.go`
- WHEN a static scan collects industries route registrations
- THEN exactly one registration for `GET /industries` is found (the duplicate `Mount`/`Get` pair is gone)

#### Scenario: the endpoint serves through the single registration

- GIVEN the deduplicated composition root
- WHEN `GET /industries` is sent
- THEN the response is served by the canonical registration with the behavior pinned by `Public Active-Catalog Endpoint`
