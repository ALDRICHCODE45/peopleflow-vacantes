# Candidate-sheet psychometrics

T9 covers S4–S8. T8 extends the same board provider and candidate session for S9–S10; no second invitation store or result reader is mounted.

- `InvitationsProvider` belongs to the keyed board session, beside `ChecklistProvider`. It reads endpoint 3 once, shares status across sheet openings, and quietly exposes explicit retry. A changed confirmed board movement key refreshes status (automatic invitations); first board arrival does not double-read. It never reads results.
- `useSheetResult` belongs to the open candidate session. Only activating **Psicometría** on a finished invitation starts endpoint 8. Hover/focus do not activate the tab. A retained promise prevents duplicate audited reads under StrictMode; tab switches reuse it. Closing the sheet drops the cache. A failed result offers explicit retry, not polling.
- T8 adds a compact `card/status.tsx` data row beside ChecklistFit: sent with expiry, in-progress with native Progress, finished, expired and revoked. Expiry always comes from server status; browser time never overrides it. Cards without invitations stay uncluttered.
- In a sheet without an invitation, endpoint 1 supplies only the enabled gate. An enabled profile exposes **Psicometría → Enviar evaluación**, even without an automatic stage. Disabled profiles do not offer creation. The existing result path still loads its profile lazily, never on card hover or tab focus.
- **Enviar evaluación**, **Copiar enlace**, **Recordar** and **Revocar** use the shared ConfirmActionDialog. Send adopts either 201-created or 200-existing data through the provider's single latest-per-participation update; it never mints automatically or claims email delivery. The sheet shows origin, stage/creator, creation date, validity and last reminder.
- Copy confirms that the previous link stops working, calls endpoint 5, composes the frontend URL with `candidateUrl`, then writes the clipboard. The bearer lives only in the action stack, never in state, DOM, storage or notifications. Clipboard failure discards it; a new explicitly confirmed copy mints another link.
- Reminder confirms the same warning, records endpoint 6, adopts its metadata, then follows the mint/copy flow. A failure after recording says the reminder was preserved. Revocation calls endpoint 7 and adopts the returned closed state. Closed invitations have no link/reminder/revoke controls; finished processes disable writes.
- All write outcomes use notifyActionResult and reserved ActionStatus beside their action. A profile_disabled conflict links to the vacancy's real configuration module. Finished/inactive/process-finished conflicts explain the preserved state; uncertain responses block replay until **Comprobar invitación** performs only endpoint 3. The open-sheet hook survives tab switches. An older pending read cannot overwrite an adopted write.
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
| Invitation empty state | Empty → Header[Media, Title, Description] + Content, `empty-demo`; same sheet surface, no nested Card |
| Invitation progress | Progress, official Basic example; numeric value/max are the server's answered/total counts |
| Invitation actions | Button With Icon, Outline alternatives; ActionBar reserves the result on the left. Shared controlled ConfirmActionDialog, official Basic AlertDialog with details; no trigger because actions are controlled |
| Invitation status | Badge semantic accent/info/neutral with dot; compact card status is a plain data row, matching the draggable-card exception |

User color feedback supersedes the original artboards: Alineado uses **success**; Por explorar and Foco de atención both use **accent**, distinguished by Search vs Flag icons and their text. A flag marks a key two-band difference, not rejection. Quality uses neutral/info. Changed-profile notices use a primary left border and primary 6% surface. No review/amber/brown tone is used.

Five unabridged tabs use a horizontally scrollable rail with focus inset, rather than smaller native targets or clipped labels. Browser measurement at 390px, light/dark screenshots, long-text review and comparison against the artboards still require browser QA; jsdom does not establish visual fit. No browser runner was authorized in this implementation handoff.
