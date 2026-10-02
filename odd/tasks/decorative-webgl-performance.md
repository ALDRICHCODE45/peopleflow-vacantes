# Bounded decorative WebGL

## Report and scope

After disabling macOS Reduce motion, a 2019 Retina Mac with i9 / 16 GB becomes
very slow with one Firefox tab showing PeopleFlow. Safari shows black tiles.
The login and hero effects are implicated; no actual GPU capture is available.
Keep the accepted layouts, palettes, shader sources and reduced-motion behavior.

## Changes

- Shared decorative budget: at most 400,000 sampled pixels for ordinary visible
  panels, DPR capped at 1, and a 30 FPS draw target instead of every display frame.
- Disable multisampling and depth buffers for the fullscreen procedural triangle.
- Pause animation loops for hidden tabs and offscreen hosts.
- Make cursor damping time-based, equivalent to its previous 60 FPS response.
- Skip drawing when CSS or backing-buffer dimensions are not usable.
- Remove lost-context canvases and reveal the existing static decoration.
- Hero acquisition cleanup, render-error fallback and container ResizeObserver.
- Correct the hero fallback readiness flag: renderer failure also uses static CSS.

The pixel/frequency budget is not an observed speedup or Mac benchmark. Black
Safari tiles are not proven fixed; a real-device check is still required.

## Verification

- Initial RED: login budget/context tests 3 failures; hero tests 4 failures.
- GREEN: 84 focused tests across scheduling, login, shader contracts, hero,
  candidate landing and theme toggling; TypeScript and scoped ESLint pass.
- Independent correction review: 29 focused tests passed; four initial
  robustness findings addressed and no correction blocker identified.
- Existing login browser test updated for the pixel budget, not executed.
- No build or server interruption. Initial fix was committed as `6a59f1b` and
  integrated into local main; the user pushed and confirmed the Mac improved.

## Theme-transition follow-up

The circular 400 ms theme reveal itself is unchanged. Decorative WebGL loops now
yield while ThemeToggle's existing `data-pf-theme-vt="active"` scope is present.
Each background paints the incoming palette once so the captured view is current,
then resumes the same renderer when the scope clears. No context recreation,
new animation library, shorter transition or accessibility override.

- RED: two scheduler tests failed before adding the pause contract.
- GREEN: 57 focused scheduler/login/hero/theme tests passed, including single
  palette redraw, resume, disposal, ownership and reduced-motion regressions.
- TypeScript and scoped ESLint passed. New Mac performance remains unmeasured.

## Reference comparison

Read-only `peopleflow2` uses `FloatingPaths`: two sets of 24 SVG paths animated
with `motion/react`, fixed curve geometry and 20–29 second opacity/path cycles.
There is no per-pixel WebGL shader or pointer interaction in that component, and
it does not explicitly query reduced motion. This is a different rendering cost,
not evidence that the user's Mac should render our shaders smoothly.

An SVG alternative could prioritize lightweight cross-browser presentation, but
would change the exact accepted effect. Do not silently replace the animations
or install `motion`; obtain the user's direction before that visual change.
