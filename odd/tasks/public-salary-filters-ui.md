# Public salary filters (UI)

Frontend side of SAL-5..SAL-8: turn the visual-only salary inputs on `/vacantes` into a real,
URL-owned filter backed by `GET /v2/jobs`. Branch `feat/public-salary-filters-ui` from main 1f740af.
Backend counterpart: session 01a15cf9-39e8 (contract proposed in L2).

## Specs

- **S1** (SAL-5). «Public salary filters must never compare against hidden internal compensation. Vacancies with hidden salary remain eligible for searches **without** salary criteria but are excluded whenever a public amount/range filter is active.»
- **S2** (SAL-6). «Public salary filters let users select currency, pay period and gross/net basis. Compare published salaries only when all three match, without implicit conversions.»
- **S3** (SAL-7). «Match ranges when the published offer overlaps the requested range at least partially. A fixed amount matches when it falls within the requested range. Example: a `30–40k` search matches a `35–45k` offer and a fixed `38k` offer, provided currency, pay period and gross/net basis match.»
- **S4** (SAL-8, user decision L1b). Bounds are inclusive: «busco 30–40k y la oferta es fija de 40k, o un rango de 40–50k» → both match.
- **S5** (SAL-8, user decision L1b). One-sided input allowed: «"Desde 30k" trae las ofertas cuyo máximo o monto fijo es de 30k o más; "hasta 40k", las que arrancan en 40k o menos.»
- **S6** (user decision L1b). Filter units default «MXN · mensual · bruto», all editable, required only when an amount is entered.

## Tasks

- [x] T1 — S1–S6: agree the `GET /v2/jobs` salary query contract with the backend — route: intercom — commit: (L3)
- [x] T2 — S2, S4–S6: URL model (`url.ts`) parses/serializes the salary keys; sample mode applies the same matching — route: inline — commit: 033e78c
- [x] T3 — S2, S5, S6: functional salary controls (desktop + mobile Sheet) replacing the visual-only inputs; selected-filter chips; invalid-filter handling — route: inline — commit: de6d32c
- [x] T4 — S1–S6: docs (integration map, guide/review queue), verification against the backend branch — route: inline — commit: —

## Log

- **L1.** User: «Hola hermano, continuemos donde nos quedamos por favor.» → chose next cut «Filtros de salario públicos» (SAL-3..SAL-8).
- **L1b.** SAL-8 answers: bounds «Sí, inclusivos»; one end «Sí, ambos casos»; units «MXN · mensual · bruto (Recomendado)» — defaults per SAL-1, editable, required only with an amount.
- **L2.** SAL-3/SAL-4 already exist in `compensation` (contract §4.6: mode fixed|range, amount/min/max decimal strings, currency MXN|USD, pay_period hourly|weekly|semimonthly|monthly|yearly, basis gross|net, public_visible). `SearchPublicJobs` has no salary filter; unknown query keys are 400 `invalid_request`, so the backend must ship the keys first. Legacy jobs have no pay_period/basis → excluded while a salary filter is active (S2).
- **L3.** Backend (feat/public-salary-filters) accepted the contract: keys `salary_min`, `salary_max`, `salary_currency`, `salary_period`, `salary_basis`, single-value; 400 `invalid_filter` for empty/repeated/off-grammar amounts, bad enums, min > max, missing units with an amount, units without an amount; min == max valid. Matching runs only on the public projection's `compensation` (null when hidden or incomplete, never an open-ended range), so SAL-5 holds by construction; legacy excluded while active. Amounts normalized to 2 decimals before the cursor hash; hash unchanged without salary filter. No response change, no echo of filters.
- **L4.** T2: RED 7/7 url tests (unknown keys) and salary-filter/sample tests, then GREEN. `url.ts` reuses the compensation catalogs and money grammar; the canonical URL fills MXN/monthly/gross for an amount without units, drops units without an amount and drops the group when min > max, so the app never sends a 400. `salary-filter.ts` holds the pure matching rule used by sample mode (samples are legacy → excluded while active). Three older tests used `salary_min=1` as an obsolete key; now `1e3` (invalid amount). jobs suite 3132/3132, tsc, eslint clean; `draft-editor-shell` flaked once in the full run and passed 16/16 alone.
- **L5.** Backend ready: feat/public-salary-filters @ acd89d8 (from main 1f740af), docs backend/docs/public-jobs-v2.md «Salary filter (SAL-5..SAL-8)»; integration TestPublicSalarySearchFilters plus -race suites green. Browser test needs this backend branch alongside the frontend branch; merge on the user's word.
- **L6.** T3 (worker mvhp90r4-1-o09k): new `JobsSalaryFilter.tsx` («Salario desde», «Salario hasta», Moneda, Periodo de pago, Base salarial; labels reused from `drafts/ui/draft-labels`), shared desktop/Sheet draft, validation before commit (money grammar, «El salario hasta debe ser mayor o igual al salario desde.»), one removable salary chip, active count counts the salary filter once; visual-only salary inputs removed from `JobsVisualPreferences` (language/benefits unchanged). Worker RED 18 failed | 7 passed, GREEN 25/25. Parent: updated two `public-v2.test.tsx` assertions (Moneda now present; 10 comboboxes) and added RED→GREEN test so the legacy-exclusion note also shows for the salary filter. jobs suite 3152/3152, `tsc --noEmit --incremental false` and eslint clean.
- **L7.** T4 docs: guide step 83 (`docs/employer-manual-test.md`), review queue item 1 (`docs/pending-user-review.md`), SAL-8 marked decided (`docs/recruitment-business-rules.md`), integration map row updated. Not run: browser test against the backend branch (user's review item); no live API call from this session. Delivery: two code slices (033e78c 207 lines, de6d32c ~309 lines) plus this docs commit; nothing merged or pushed.
