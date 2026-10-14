# Rich draft description preview
Render approved rich description content in the existing final-step preview, without changing its design or data.
No dependencies, persistence, backend, services, shared styles or public-page changes.

## Specs
- R1. User approved preserving "negritas, cursivas, listas, enlaces y tamaños de texto" with "Completamente, adelante." Render approved paragraphs, text, hard breaks, bullet/ordered lists with start, list items, and all four marks including combinations.
- R2. Validate using the FULL approved draftRichDescriptionSchema from rich/description, not structure-only grammar. Keep existing invalid/null fallback and reject invalid URLs/marks/attrs/limits. React nodes only, no dangerous HTML or arbitrary attribute spreads, no mutation of raw source.
- R3. Preserve project UI per docs/frontend-ui-design-rules.md (read completely), existing preview composition and public/internal/privacy semantics. Font sizes use text-sm/text-base/text-lg for small/normal/large. Links use semantic existing link appearance/focus; validated target/title/rel semantics, add noopener protection for _blank if absent without mutating stored content. Use native text/list semantics; explicit list-disc/list-decimal and padding because CSS reset may remove markers. Remove plain-format limitation copy only when supported.
- R4. Scoped tests first, focused preview/renderer/form/route regressions, typecheck/scoped lint. No full suite or browser; user owns manual visuals. Historical suite timeout and native assessment untracked limitation not resolved by this work.

## Tasks
- R1 [done] R1-R4 | Rich renderer integrated; worker85 focused tests/typecheck/lint PASS; literal newline correction adds regression | no commit authorized.
- R2 [done] R1-R4 | Independent source review supported full-schema safety and found newline collapse; parent observed RED then35 renderer/preview tests PASS + lint and active LSP clean. Manual visual acceptance user-owned | no commit authorized.

## Log
- L1. User: "Completamente, adelante."
- L3. Worker muyoyjp9-i-d2nl reported85focusedPASS/typechecklintPASS. Independent muyp6xeh-j-yc80 source review confirmed fullvalidation/linkescaping/rel/nonmutation, found literal text newlines collapse. Parent added plain and bold-list newline regression; observed1RED missing whitespace-pre-wrap then added paragraph class, observed35renderer/previewtestsPASS + scopedlint exit0, LSP2files0diagnostics. Browser visuals not executed, no fullsuite rerun; native assessment unavailable dueuntracked. Prior85 run preceded final newline fix; do not imply all86 rerun together.
- L2. Explorer muyou6e1-h-rdkg recommended React renderer with no deps/HTMLstrings; parent rejects structure-only parse recommendation because complete marks/URL/size validation is mandatory. UI module home selected to keep accepted data grammar unchanged. Link _blank defense does not rewrite draft.
