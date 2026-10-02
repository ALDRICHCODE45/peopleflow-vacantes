# Candidate sidebar discovery action

## Scope

After the candidate landing adaptation, add a primary action at the beginning
of the candidate dashboard sidebar. It must match the employer's **Nueva
vacante** button but open the public vacancy list, not a creation form.

## Implementation

- **Explorar vacantes**, with the search icon, is first in **Mi búsqueda**.
- Reuses the installed shared `SidebarMenuButton`, including the exact employer
  primary-action classes and native default/collapsed geometry.
- A native GET form targets `/vacantes`; no click handler, router wrapper,
  application submission, persistence or fabricated success.
- Existing six navigation destinations, active states and account menu remain.

## Verification

- RED: 3 failures / 25 passes (desktop, collapsed and mobile action absent).
- GREEN: 28 candidate-shell tests pass.
- Checks first position, native GET target, primary classes, tooltip, keyboard
  tab stop, click submission and presence in the mobile drawer.
- TypeScript and scoped ESLint pass.
- No visual/browser acceptance claimed; the user owns that review.
