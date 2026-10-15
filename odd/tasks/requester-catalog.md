# Requester catalog (backend)

Implement the accepted requester catalog contract (`odd/tasks/private-vacancy-drafts-save.md` §7, identical in frontend `docs/contracts/private-vacancy-drafts-v1.md` §7): `GET`/`POST /me/company/requesters` over the existing `job_draft_requesters` table and `RequesterName` value object.
Branch `feat/requester-catalog` from main `8abdb65`; local commits only, no push, no main writes until real browser approval. Frontend UI is owned by the frontend peer.

## Specs

- S1 — Authorization (user, verbatim): parent asked «Necesito tu autorización para implementarlo test-first ... en commits locales en `feat/requester-catalog`, sin push, y sin tocar `main` hasta que lo pruebes y apruebes en el navegador ... Postgres temporal aislado en Docker solo para los tests de integración ... ¿Lo autorizás?»; user: «si, adelante, aprovado.»
- S2 — Routes (contract §7, verbatim): «| `GET` | `/me/company/requesters?kind=internal_area\|client&q=&limit=&cursor=` | `[accepted]` |» and «| `POST` | `/me/company/requesters` `{kind, name}` | `[accepted]` |».
- S3 — GET (verbatim): «`GET` response: `{ "items": [{ "id", "kind", "name" }], "next_cursor": null | string }`. `kind` is required; `q` defaults empty; `limit` defaults 20, range 1..50.»
- S4 — POST (verbatim): «`POST` → `201` canonical entry, atomic with audit. Owner/recruiter in the active org (not the draft principal); no cross-org access, no actor in the body; no edit/delete/merge.» and «An inline entry persists even if the draft is later cancelled, with a UI warning.»
- S5 — Name (verbatim): «`name`: 160 codepoints. Normalization order: UTF-8 validate → NFC → trim/collapse Unicode `White_Space` to ASCII space. `name_key` = full-Unicode casefold → NFC, preserving accents; **no NFKC, no fuzzy**. Reject non-whitespace controls; do not silently remove zero-width characters.» and «Version the Unicode algorithm + fixtures; pin `UNIQUE(org, kind, key)` in PostgreSQL for deterministic behavior with no DB-lower divergence.»
- S6 — Duplicates (verbatim): «Duplicates → `409 requester_already_exists` with `data: { "existing": { "id", "kind", "name" } }`, only for currently authorized entries. Explicit selection — never auto-merge.» and «**Dedicated typed-error projection is required** (accepted design, not implemented): the existing `WriteCatalogErrorData` strips data except for conflict; the new path must not rely on generic error-payload expansion. `[accepted]`»
- S7 — Vectors (verbatim): «`name` normalized to empty → `400 validation_error`. Exact vectors: `'Área'` and `'A\u0301REA'` are **equal** (NFC + full casefold); `'Area'` is **distinct**. The NBSP-as-space and `Straße`/`STRASSE` vectors are unchanged, and org/type separation is enforced.»
- S8 — Query bound (verbatim): «`q` is limited to **160 codepoints after normalization** (input body/token bounds are separate). `last_name_key` validates the canonical full-casefold output, accounting for Unicode expansion: do **not** impose 160 on the expanded key, and do not invent an unproven lexical key limit.»
- S9 — Cursor (verbatim): «**Cursor (`[accepted]`):** opaque base64url JSON v1 with `version`, `company_id`, `kind`, `q_normalized`, `last_name_key`, `last_id`; encoded token **≤4096 bytes**. Validate version/keys/types/UUID/lengths/normalized query/scope, else `400 invalid_request`. Not a credential, not encrypted, not a snapshot; the session-org SQL predicate always applies. No signed cursor is required for access security. Keyset on `(name_key COLLATE "C", id)`, prefix escaped literally, same normalization, no total count. Backend normalization fixtures remain an acceptance item.»

## Tasks

- T1 | S3,S5,S8,S9 | inline | pure application package: query normalization + cursor codec (encode/decode/validate scope) | commit: pending
- T2 | S4,S5,S6,S7,S9 | inline | PostgreSQL store: tx gates (live user, live active company, membership FOR SHARE), Create (ON CONFLICT → existing), List keyset, audit event; isolated-PostgreSQL integration tests | commit: pending
- T3 | S2,S3,S4,S6 | inline | HTTP handler + `requester_already_exists` catalog code + dedicated typed 409 projection + NoStore/auth/recruiter router wiring + topology test + real-router integration test | commit: pending
- T4 | S1-S9 | inline | docs (`backend/docs/requester-catalog.md`), contract status note, frontend handoff, final checks | commit: pending

## Log

L1 — User request verbatim: «Si hermano, las dos cosas por favor.» (cleanup of merged branches + requester catalog design). Design found already accepted in §7; user then authorized implementation verbatim: «si, adelante, aprovado.» (see S1).
L2 — Context: browser test of employer flow approved 2026-10-14; backend ff-merged to main 44d8468, frontend merged main 8abdb65 (local, no push). Today a draft can only be saved with requester `null` or `{kind, id:null}` because no production code inserts into `job_draft_requesters`.
