# Candidate-sheet psychometrics

T9 covers S4–S8 and only the unfinished status/progress line of S9. T8 owns invitation management.

- `InvitationsProvider` belongs to the keyed board session, beside `ChecklistProvider`. It reads endpoint 3 once, shares status across sheet openings, and quietly exposes explicit retry. A changed confirmed board movement key refreshes status (automatic invitations); first board arrival does not double-read. It never reads results.
- `useSheetResult` belongs to the open candidate session. Only activating **Psicometría** on a finished invitation starts endpoint 8. Hover/focus do not activate the tab. A retained promise prevents duplicate audited reads under StrictMode; tab switches reuse it. Closing the sheet drops the cache. A failed result offers explicit retry, not polling.
- Endpoint 1 supplies the current confirmed profile version, lazily alongside the result. Failure preserves the stored comparison without inventing a “newer profile” flag: the agreed Result shape has none.
- **Comparar con el perfil actual** requires explicit confirmation, then endpoint 9 replaces the displayed comparison/guide and appends its history entry. It never triggers another audited GET. An uncertain POST disables replay for that sheet session; close/reopen to inspect the stored history first. Original interpretations/bands remain unchanged.
- **Copiar guía** writes plain text, including stored STAR and evidence checklists. Success is announced only after clipboard confirmation; failure leaves selectable questions in place.
- The backend model enforces at most eight ordered questions and exactly fifteen facets. Interpretation/question/STAR text is rendered from stored snapshots, never a bundled content bank. Only canonical display labels and specified explanatory wording are local.

## Visual mapping

Reference: result/03 (guide first), then the ordinal band matrix from result/02. Existing candidate identity, actions and footer remain unchanged. The heading has no autofocus; the existing candidate title keeps its outline-free initial focus.

| Pattern | Installed primitive / saved official example |
|---|---|
| Sheet identity / body / footer | Existing Sheet, `sheet-demo`; controlled opening, existing custom close |
| Sections | Existing Tabs + TabsList + TabsTrigger + TabsContent, `tabs-demo` |
| Guide evidence and facet disclosure | Accordion → Item → Trigger + Content, official Basic composition, initially collapsed |
| Quality summary | Item → Media + Content → Title + Description, `item-demo`, outline variant |
| Labels | Badge, With Icon; semantic product variants |
| Copy / comparison | Button, With Icon / Outline; shared ConfirmActionDialog follows official AlertDialog composition |
| Failed read | Shared StateCard follows `empty-demo` |
| Loading | Skeleton in matching guide-first section order, native Item/Accordion slots; unknown question/focus counts cannot be predicted before the audited read |
| Ordinal matrix | Minimal presentation-only three-cell grid, not progress, controls or percentages |

User color feedback supersedes the original artboards: Alineado uses **success**; Por explorar and Foco de atención both use **accent**, distinguished by Search vs Flag icons and their text. A flag marks a key two-band difference, not rejection. Quality uses neutral/info. Changed-profile notices use a primary left border and primary 6% surface. No review/amber/brown tone is used.

Five unabridged tabs use a horizontally scrollable rail with focus inset, rather than smaller native targets or clipped labels. Browser measurement at 390px, light/dark screenshots, long-text review and comparison against the artboards still require browser QA; jsdom does not establish visual fit. No browser runner was authorized in this implementation handoff.
