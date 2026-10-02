# Company careers site and local editor

## Approved direction
Editorial, human startup-style careers site. Centered image-backed hero with main/secondary text and two real in-page anchors. Use existing typography/tokens/shadcn primitives, not a new visual framework. Section-based local editor with preview; no drag/drop, upload, persistence or publication.

Identity is deliberately separate: public Acme fixture remains Acme; employer editor is Nexo Labs and uses only existing Nexo facts. Never copy Acme claims/photos as if they depict Nexo. Missing Nexo story is empty editable content with honest preview placeholders. No invented company statistics, testimonials, benefits or verification claims.

## Design structure
- Photo-backed hero within existing public shell (no global full-bleed changes); foreground legibility over image with semantic-token surface.
- Two anchors: Ver vacantes and Conoce la empresa, targeting actual sections.
- Editorial company story and mission; varied composition for existing facts/capabilities, not repeated generic three-card grids.
- Wire-backed editorial job list, canonical public links, truthful empty state; no enriched applicant/response/promotional claims.
- Editor: identity/cover text, story and capabilities, section navigation and local preview. Nexo does not become a public published page.
- Shared renderer supports public H1 and embedded preview H2 without duplicate IDs or conflicting landmarks.

## Research
- Dribbble indexed reference: https://dribbble.com/shots/24233062-Company-Career-Pages-Design . Search results describe mission/work/team/openings sequencing; direct readable extraction failed, so no visual inspection claimed.
- Linear careers: https://linear.app/careers . Reference for concise employer narrative and connection to open roles, not copied brand content.
- Existing licensed local image: frontend/public/company/acme-cover.webp with provenance sidecar. Suitable only where its illustrative provenance is preserved, not evidence of an actual team.

## Work units
- [x] Explore current routes, content, assets, contracts and identity mismatch.
- [x] Confirm editorial direction and Nexo/Acme separation with user.
- [x] SITE-01: Redesign public/shared renderer, preserve metadata/notFound/empty contracts and add tests.
- [x] EDITOR-01: Add /empresa/sitio local section editor, navigation, preview and tests.
- [x] VERIFY-01: Independent source checks and bounded browser visual/accessibility checks.
- [x] HERO-02: Replace opaque panel with photo scrim and directly overlaid copy/CTAs, preserving other sections.
- [x] WIDTH-02: Match candidate screen-2xl measure on employer dashboard, vacancies, team and site; retain new-vacancy 7xl and pipeline full-width exceptions.

## Verification evidence
SITE-01 writer: 33 tests across four files, non-incremental TypeScript and ESLint passed. Public/shared renderer and E2E source changed; browser not run.
EDITOR-01 writer: 87 tests across seven files, additional 92 employer regression tests, TypeScript, ESLint and diff check passed. Independent source/unit verification passed: 9 Vitest files / 98 tests, TypeScript, ESLint and diff check. Reviewer identified a removed escaping regression assertion after descriptions stopped rendering. Added a replacement component test with script/image/iframe/bold markup in the displayed wire title: asserts literal accessible link text and no injected elements. Post-correction: 16 renderer tests, TypeScript, targeted ESLint and diff check passed. Active LSP was unavailable. Browser appearance, responsive behavior and real interaction remain pending because the user requested the development server stay off.

## Follow-up verification
User authorized restarting the development server, then approved the hero and width correction. Writer: 172 tests, TypeScript, lint and diff check passed. Independent verifier: 129 focused tests across five files and TypeScript passed; Recharts emitted jsdom size warnings. An earlier incorrectly scoped test invocation selected unrelated files and timed out at 180 seconds; it is not a passing run.
Browser evidence in `/tmp/pf-hero-width-verify/`: 1440/375 light/dark hero screenshots, working anchors, no overflow and no Axe violations in the recorded checks; no-cover preview visually legible. Employer and candidate content measure both 1536px on a 1920px viewport, centered within the available canvas (not the whole viewport including sidebar). Independent read-only browser inspection confirmed CTA hover paint. Keyboard focus ring contrast was not quantified; the reviewer noted a potentially subtle translucent focus ring, without establishing a WCAG failure. Full configured E2E and production build were not run. Unrelated pre-existing changes were not reviewed.

## Constraints
Preserve all existing uncommitted work. Dev server 3000 was restarted at the user's explicit request and stays running for review. Fixture 4110 remains untouched. No dependency installs, protected service access, commits or real publishing. Product copy is neutral Mexican Spanish. No unbounded subagent retry chains.
