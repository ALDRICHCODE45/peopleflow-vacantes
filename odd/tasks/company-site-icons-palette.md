# Company site: icon-or-emoji items and brand palette (backend)

Backend half of frontend `odd/tasks/careers-builder-polish.md` S3/T4 and S4/T5 (frontend branch feat/careers-builder-polish).
Branch feat/company-site-icons-emoji from main a7413176. Additive, backward-compatible contract change; no merge/push.

## Specs

- **S1** (L1). Items of `values.items[]` and `benefits.items[]` carry `icon: string|null` and `emoji: string|null`, exactly
  one non-null; «Si ambos son null o ambos están seteados → validation_error en ese ítem. Usá el vocabulario de field
  path/code que ya tenés».
- **S2** (L1). «Los documentos guardados sin la clave `emoji` (borradores y snapshots publicados que ya existen, incluido
  el del usuario en su DB local) se leen como `emoji: null`. GET draft, GET public y la publicación deben devolver siempre
  la forma canónica con las dos claves.»
- **S3** (L1). «`emoji` es exactamente un grapheme cluster extendido que sea emoji (Extended_Pictographic / emoji
  presentation, se permiten secuencias ZWJ, modificadores de tono y banderas), con un máximo de 32 bytes UTF-8 y sin
  espacios ni texto. Si necesitás una dependencia nueva para segmentar graphemes, justificala y pasala por el
  verificador como la vez anterior.»
- **S4** (L1). The `icon` enum grows from 24 to 111, order kept: the 24 current ones as they are, then the 87 of L1.
- **S5** (L2). `theme` gains `accent_color: string|null` and `background_color: string|null`, `#RRGGBB` normalized to
  uppercase like `brand_color`; `brand_color` stays required («principal»); missing keys read as null; canonical shape
  always returned; «El backend no calcula contraste ni presets».
- **S6** (L1, L2). Update `docs/contracts/company-careers-site-v1.md`.

## Tasks

- [x] T1 — S1–S6: document grammar, legacy normalization, emoji validation, icon list, palette, contract doc, tests —
  route: worker; parent checks (no new dependency, so no verifier) — commit: see git log (feat(company-sites): icon or emoji items)

## Log

- **L1.** Frontend (2026-10-28, verbatim): «nueva tarea de contrato para company sites. Decisión del usuario, textual:
  «Ícono o emoji (Recomendado)». […] Contrato propuesto. Es aditivo y compatible hacia atrás: 1. Ítems con ícono:
  values.items[] y benefits.items[]. Hoy tienen `icon` (enum obligatorio). Pasan a tener `icon: string|null` y `emoji:
  string|null`, con exactamente uno de los dos no nulo. Si ambos son null o ambos están seteados → validation_error en
  ese ítem. Usá el vocabulario de field path/code que ya tenés y decime qué code elegís. 2. Los documentos guardados sin
  la clave `emoji` […] se leen como `emoji: null`. […] No hace falta migración de datos si normalizás al leer; si
  preferís migrar, avisame. 3. `emoji` es exactamente un grapheme cluster extendido que sea emoji […] máximo de 32 bytes
  UTF-8 y sin espacios ni texto. […] 4. La lista permitida de `icon` se amplía de 24 a 111. Mantené el orden; primero van
  las 24 actuales tal cual (`document.go:65`) y después estas 87, todas verificadas en lucide-react 1.39: star award
  medal crown flag compass map-pin mountain sun moon zap flame gem puzzle brain book-open pencil palette music camera code
  terminal cpu database cloud wifi smartphone monitor headphones message-circle mail phone megaphone bell trending-up
  chart-bar chart-pie dollar-sign wallet credit-card banknote shopping-bag car bike bus train-front baby dog cat utensils
  pizza apple salad heart-handshake hand-heart hand-helping thumbs-up party-popper cake gamepad-2 tree-pine recycle sprout
  flower-2 umbrella shield-check lock key scale building-2 factory store wrench hammer hard-hat truck package infinity
  accessibility languages calendar-check timer bot microscope paintbrush film mic 5. Actualizá
  docs/contracts/company-careers-site-v1.md con estos cambios. […] Fuera de alcance por ahora: la paleta (S4)».
- **L2.** Frontend (verbatim): «segundo brief, la paleta (S4/T5). Puede ir en la misma rama que íconos y emoji.
  Decisiones del usuario, textuales: «Paletas + 3 colores (Recomendado)», «Derivar versión oscura (Recomendado)» y «Sí,
  adelante». Contrato, aditivo: 1. `theme` gana `accent_color: string|null` y `background_color: string|null`, en
  formato `#RRGGBB` y normalizados a mayúsculas, igual que `brand_color`. `brand_color` sigue obligatorio y pasa a
  significar «principal». 2. Los documentos guardados sin esas claves se leen como null. GET draft, GET public y la
  publicación devuelven siempre la forma canónica. 3. El backend no calcula contraste ni presets. Eso es del frontend,
  que deriva los tokens y la versión oscura. Solo valida el formato hex. 4. Agregalo a
  docs/contracts/company-careers-site-v1.md.»
- **L3.** Backend decisions. Finding: today `icon` is optional on save (`document.go:190`, `enum(..., optional=true)`),
  so stored drafts and snapshots can hold items with `icon: null` and no `emoji`. Rules:
  - PUT draft enforces exactly one: both null → `required` at `blocks[i].content.items[j].icon`; both set →
    `not_allowed` at `blocks[i].content.items[j].emoji`; a malformed or non-emoji `emoji` → `invalid`, over 32 bytes →
    `too_long`.
  - Reading stored documents (GET draft, publish, GET public) normalizes missing keys to null and stays tolerant: a
    legacy item with neither icon nor emoji must not turn GET into a 500. No data migration.
  - Emoji validation without a new dependency: a strict UTS #51 emoji-sequence grammar (single emoji ± FE0F, keycap,
    flag of two regional indicators, tag sequence, ZWJ chain, skin-tone modifiers) over an Extended_Pictographic table
    generated from Unicode emoji data, with attribution. Matching exactly one sequence implies one grapheme cluster. A
    new dependency is used only if this proves infeasible, and it then goes through the verifier.
- **L4.** Implementation handoff (independent verification pending): S1–S6 implemented with strict PUT and explicit
  stored-document validation. GET draft, publish and GET public normalize new keys to null; legacy icon-less items
  still publish when existing title/list requirements are met. Publish requirements and exact snapshot copying stay
  unchanged. The 111-icon order/uniqueness is tested. Unicode 15.0.0 Extended_Pictographic ranges were extracted from
  cached uniseg v0.4.7, coalesced and attributed (MIT); no dependency added. `♡` is accepted because U+2661 belongs to
  that property, as documented in the contract. Unit, route and SQL-seeded legacy integration cases added.
  Validation: `cd backend && gofmt -l . ; go vet ./... && go test ./...` passed with no formatting output, including
  archguard and scripts/closure (an initial missing blank line failed closure's formatting gate; fixed and rerun).
  `cd backend && DRAFT_TEST_DATABASE_URL='postgres://draft_test:draft_test@127.0.0.1:32778/draft_test?sslmode=disable' go test -p 1 -tags=integration ./cmd/api -count=1`
  passed; a separate verbose run confirmed `TestCompanySiteLegacyIconsPaletteRoundTrip` executed, not skipped.
  Strict TDD was not activated. No frontend changes, migration, branch switch or terminal git mutations.
- **L5.** Parent verification: gofmt/vet clean, full unit suite (incl. closure/archguard) green, full `-tags=integration
  ./cmd/api` green on a fresh DB (:32778); `backend/go.mod`/`go.sum` unchanged (no new dependency, so the dependency
  verifier gate does not apply). Scope note for the frontend: the table follows Extended_Pictographic, so text-default
  pictographs such as ♡ and unassigned Extended_Pictographic code points are accepted.
