# Candidate marketing landing

## Approved scope

Candidate-focused public landing using the **same layout, hero, animation and
five section compositions as the employer landing at `/`**, with candidate copy
and candidate journey diagrams. Preserve the existing violet brand, buttons and
surfaces. Only the hero animation adopts the candidate login's cyan/purple pair;
minor existing accents may remain cyan. No full cyan section or alternate theme.

The user rejected the initial independent cyan design and explicitly owns visual
acceptance. Preserve employer content, auth, dashboards and unrelated changes.

Canonical route: `/candidatos`, under the marketing group rather than candidate
shell. User requested a cleaner URL after the initial delivery. The former
`/para-candidatos` now permanently redirects to `/candidatos`; navbar, footer and
metadata point directly to the canonical route.

## Current adaptation

- Reuse employer section geometry instead of keeping a separate candidate design.
- Reuse the reference wrapper, ambient layers and reveal-motion island.
- Share the floating marketing navbar between audiences; keep reciprocal links.
- Keep HeroAurora shader/timing/geometry unchanged; opt into the candidate login's
  two accent colors in dark/light mode, including the reduced-motion fallback.
- Adapt the hero journey, copy, trust strip and previews to candidate needs.
- Keep canonical vacancy links and label illustration/demo data honestly.
- Remove the rejected alternate primary tokens and full cyan section wash.
- Visual acceptance remains user-owned, not claimed by automated checks.

## Initial implementation evidence (superseded design)

The explorer established five employer sections, route noncollision, local assets
and candidate auth tokens. Delegated writer was cancelled after no source output;
cleanup was reported unconfirmed/quarantined. Parent confirmed no candidate files
or navbar changes existed before writing directly. No worker output was treated
as implementation evidence.

- RED: new `CandidateLanding.test.tsx` could not resolve its absent component.
- GREEN: candidate landing 3 tests + shared navbar 32 tests = **35 passed**.
- Tests check five named sections, one h1, canonical vacancy links/data, valid
  candidate/auth destinations, employer crosslink and unchanged navbar modes.
- `pnpm exec tsc --noEmit --incremental false`: passed.
- Scoped ESLint for new component/tests/route and navbar/tests: passed.
- `GET /para-candidatos` on isolated temporary preview: **HTTP 200**.
- Existing root E2E expected-link array updated for the new crosslink; this
  changed contract was not browser-executed. Before the navbar change, root
  baseline had 18 passes and one navigation timeout; the isolated failed test
  passed on rerun. Those runs do not prove the new landing's visual acceptance.
- User instructed that he performs visual tests. Candidate screenshot/axe audit
  was therefore not run. CV flow was separately browser-verified before that
  reminder (four cases plus keyboard file chooser).

## Redesign verification

- Candidate layout contract: RED **4 failed** with the old composition, then
  GREEN **4 passed** with the shared employer layout and adapted content.
- Aurora palette contract: RED **3 failed / 10 passed**, then **13 passed**.
  Employer colors and animation uniforms remain unchanged; candidate dark/light
  colors match the candidate login accent pair.
- Combined landing, Aurora, motion, navbar and route suites: **58 passed**.
- TypeScript and scoped ESLint: passed.
- The standalone candidate CSS module was removed: no alternate primary tokens
  or full cyan section backgrounds remain.
- No build against the user's active production server and no visual tests.
  The user must rebuild/restart `pnpm start` to view the updated source.

## Final technical review

- Combined landing, navigation, candidate sidebar and employer sidebar/shell
  regression run: **128 tests passed**; TypeScript and scoped ESLint passed.
- Independent read-only review: **PASS**, no actionable source-level findings.
  The reviewer did not independently execute tests or browser checks.
- Native assessment could not produce a risk tier because the repository has
  pre-existing undeclared untracked files; independent technical review was run
  as the conservative fallback. No native approval or visual acceptance claimed.

## Delivery boundary

Shared section markup now takes an optional candidate variant, defaulting to the
original employer content. CandidateLanding/Footers are thin wrappers. Navbar,
Aurora and route composition reuse the original reference design. No installs,
commits, deployment, backend changes or user-server interruption.
