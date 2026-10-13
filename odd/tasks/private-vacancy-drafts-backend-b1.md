# Backend B1 — requester name
Bounded prerequisite of parent T4, not completion of the requester catalog.
Contract accepted in conversation: private-vacancy-drafts-v1, declared SHA256 17c83c206cf11b6fd95b197aeef03b238ca0de220389e5f0ae67de1c54d48fa3. Full transferred documents remain read-only conversational references, not locally materialized.

## Specs
- S2. "Preserve the accepted design". B1 implements only contract section 7 name normalization: UTF-8 validate → NFC → trim/collapse Unicode White_Space to ASCII space; nonempty display name <=160 Unicode codepoints; key full-Unicode casefold → NFC, preserving accents. No NFKC, fuzzy matching, truncation or silently removing zero-width characters. Reject non-whitespace controls. Expanded keys are not limited to160.
- S4. "Implement the contract's explicit authentication, tenant/identity isolation, concurrency, idempotency, error, and rich-content boundaries." Only pure domain normalization is in B1; none of those API/persistence boundaries is claimed implemented here.
- S5. "Preserve unrelated work." No DB, routes, migrations, service, secrets, dependency edits, commits or pushes. Allowed source: backend/internal/features/jobs/domain/valueobjects/requesterName.go and requesterName_test.go only.

## Tasks
- B1 [in_progress] S2,S4,S5 | Implementation and independent focused/package checks PASS; full-suite closure failures and exact-candidate native review remain blocked | commit: forbidden

## Log
- L1. Parent authorization: "AUTORIZACION B1 acotada"; "Go approved normalizer UTF8/NFC/UnicodeWhiteSpace/nonempty160/fullfoldkey no truncation/accentloss; rejectnonwhitespacecontrols no silentzerowidthstrip. Existingx/textv0.38.0 no go.mod/sum edit/install. FunctionalREDcompilableskeleton thenGREEN/package+unitdatabasefree suite; reportUnicode normalization/foldversion evidence rather thaninventing. No DB/route/migration/service/secret/commit/push. Tests requiringambientDB notauthorized."
- L2. Parent reference T4 prerequisite B1 / S2,S4-S5, L8 read in complete transfer. Source writes in frontend paused. Created feat/private-drafts-requester-name from current main, preserving three dirty OpenSpec closure files. Shared task/contract absent locally; not overwritten or reconstructed.
- L3. Worker muvim4x5-4-aqb1 observed compilable functional RED then GREEN (11 tests/62 subtests); package PASS. Database-free full suite reports 49 packages PASS and failures in internal/tools/closurereport and scripts/closure. Requirement-set mismatch 133 vs122 supports unrelated closure drift but has not been reproduced on isolated base. No full-suite clearance claimed.
- L4. Independent muvjcsz5-5-lf1n PASS S2/S4 bounded/S5; reran focused and package tests with DATABASE_URL unset, GOPROXY off, local toolchain and readonly modules. Go1.26.1; norm/cases/std Unicode15.0.0. Source hashes: requesterName.go 27f0ee33de12d3e79126d6c7254f950373a657928a78c5e3041277c0c9dde769; requesterName_test.go 47800e954c7ab68862be728eea41b9bc23c58eb73bd76ab6d83bff7c66bb8237. No race/integration tests or base-isolated closure reproduction.
- L5. Native assess unassessable due to undeclared untracked paths; independent check fulfilled. Native inspect before START shows workspace projection includes three unrelated dirty OpenSpec documents. No START/lineage or consent occurred. Requested coordinator authorization for exact-candidate isolation; staging, stash/reset, and extra worktrees not authorized. Do not review unrelated human changes or mark B1 complete. Catalog/API/frontend T4 remains pending.
