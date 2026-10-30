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

R2 / S1 reference: `design/psychometric-report/03-ficha-expandible.html`, with preparation-panel and uniform-section refinements from L5–L6 in `odd/tasks/redesign-psychometrics-ux.md`.

- The normal 560px sheet keeps its existing candidate identity/actions/tabs/footer. The compact finished tab presents status, **Prepara tu entrevista**, then **Ver informe completo** before invitation and competency rows, so the primary entry stays above the fold at 1440×900. No relevante rows share one initially collapsed disclosure; focus links expand into the matching stored guide question.
- **Ver informe completo** widens the same Sheet to at most 1280px and the viewport gutter. No new modal, route, result reader or invitation store is created. **Reducir ficha** restores compact mode. Focus moves to the workspace heading on expansion and back to the primary entry on reduction; Escape remains the Sheet close action.
- Desktop preparation and report columns scroll independently. Small screens stack the preparation panel and report in a single scrolling workspace rather than squeezing two columns. Report sub-navigation uses section anchors and an active-location marker; it never reads data.
- Every report section uses `Card → CardHeader[CardTitle, CardDescription, optional CardAction] → CardContent → optional CardFooter`, with a heading icon and muted metadata. The same installed Accordion composition handles all disclosures: interpretation label/text pairs, evidence checklists, excluded competencies, invitation metadata and facets. Question cards retain stored question/STAR text and evidence verbatim; no follow-up text is synthesized.
- The aside uses the same comparison/guide/copy logic and fit semantics as the report. The comparison button remains visible but disabled with its reason when the current profile is unconfirmed, unavailable, unchanged, or writes are blocked. A changed profile still requires confirmation; uncertainty still blocks replay. Guide copy is placed in the preparation panel as the single copy entry point.
- Invitation actions are an installed DropdownMenu in ItemActions. **Copiar enlace**, **Recordar**, **Revocar** retain their existing shared confirmations, consequences and uncertainty handling. Closed invitations keep the menu with disabled actions and an explanation; metadata remains accessible in **Detalles de la invitación**. The creation empty state is unchanged.
- Intentional adaptations from the static artboard: native component spacing/radii/targets and Badge number chips; actual stored data/counts, not example values; one guide copy action in the aside, not duplicated in the report header; stored STAR remains part of the stored question, never generated as an extra line.

| Pattern | Installed primitive / saved official example |
|---|---|
| Sheet identity / body / footer | Existing Sheet, `sheet-demo`; controlled opening, existing custom close |
| Sections | Existing Tabs + TabsList + TabsTrigger + TabsContent, `tabs-demo` |
| Guide evidence and facet disclosure | Accordion → Item → Trigger + Content, official Basic composition, initially collapsed |
| Uniform report sections / question cards | Card Basic composition (`card.md`), question cards use `size="sm"`; report sections carry real headings, header icons and metadata |
| Quality summary | Uniform report Card, tier Badge in CardAction; signal rows retain exact `signalReason` wording and counts |
| Labels | Badge, With Icon; semantic product variants |
| Copy / comparison | Button, With Icon / Outline; shared ConfirmActionDialog follows official AlertDialog composition |
| Failed read | Shared StateCard follows `empty-demo` |
| Loading | Skeleton follows the compact status/intro/CTA/invitation/row layout; unknown question/focus counts cannot be predicted before the audited read |
| Ordinal matrix | Minimal presentation-only three-cell grid, not progress, controls or percentages |
| Invitation empty state | Empty → Header[Media, Title, Description] + Content, `empty-demo`; same sheet surface, no nested Card |
| Invitation progress | Progress, official Basic example; numeric value/max are the server's answered/total counts |
| Invitation actions | Item → Content[Title, Description] + Actions[DropdownMenu]; `dropdown-menu.md` Basic/Icons with Trigger rendered as Button, Content → Group → Items. Shared controlled ConfirmActionDialog, official Basic AlertDialog with details; no trigger because actions are controlled |
| Invitation status | Badge semantic accent/info/neutral with dot; compact card status is a plain data row, matching the draggable-card exception |

User color feedback supersedes the original artboards: Alineado uses **success**; Por explorar and Foco de atención both use **accent**, distinguished by Search vs Flag icons and their text. A flag marks a key two-band difference, not rejection. Quality uses neutral/info. Changed-profile notices use a primary left border and primary 6% surface. No review/amber/brown tone is used.

Five unabridged tabs use a horizontally scrollable rail with focus inset, rather than smaller native targets or clipped labels. R2 browser QA uses the authorized read-only employer session and existing server; no invitation or comparison writes are executed. Screenshots and viewport/scroll measurements are reported in the implementation handoff. jsdom replaces only menu portal/positioning behavior in invitation-flow tests; the actual installed menu is checked in Chrome. Broader long-text/error/confirmation visual QA remains parent-owned.
