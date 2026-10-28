<!-- Source: https://ui.shadcn.com/docs/components/base/resizable, registry https://ui.shadcn.com/r/styles/base-rhea/resizable.json and react-resizable-panels v4 README (fetched 2026-10-27). Official usage, composition and API. -->

# Resizable

Accessible resizable panel groups and layouts with keyboard support. Built on
[react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) **v4**.

## Installation

```sh
pnpm dlx shadcn@latest add resizable   # style base-rhea → src/components/ui/resizable.tsx
```

Registry file for `base-rhea` (install verbatim; do not hand-edit beyond project conventions):

```tsx
"use client"

import { cn } from "@/lib/utils"
import * as ResizablePrimitive from "react-resizable-panels"

function ResizablePanelGroup({ className, ...props }: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full aria-[orientation=vertical]:flex-col", className)}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({ withHandle, className, ...props }: ResizablePrimitive.SeparatorProps & { withHandle?: boolean }) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        "relative flex w-px items-center justify-center bg-border ring-offset-background after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:after:left-0 aria-[orientation=horizontal]:after:h-1 aria-[orientation=horizontal]:after:w-full aria-[orientation=horizontal]:after:translate-x-0 aria-[orientation=horizontal]:after:-translate-y-1/2 [&[aria-orientation=horizontal]>div]:rotate-90",
        className
      )}
      {...props}
    >
      {withHandle && <div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />}
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
```

## Usage

```tsx
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

<ResizablePanelGroup orientation="horizontal">
  <ResizablePanel>One</ResizablePanel>
  <ResizableHandle />
  <ResizablePanel>Two</ResizablePanel>
</ResizablePanelGroup>
```

## Composition

```text
ResizablePanelGroup
├── ResizablePanel
├── ResizableHandle
└── ResizablePanel
```

- `orientation="vertical"` for vertical resizing.
- `withHandle` on `ResizableHandle` shows a visible grip.
- Panels and handles must be **direct DOM children** of the group.

## v4 API notes (react-resizable-panels)

v3 → v4 renames: `PanelGroup`→`Group`, `PanelResizeHandle`→`Separator`, `direction`→`orientation`,
`defaultSize={50}`→`defaultSize="50%"`, `onLayout`→`onLayoutChange`, `ImperativePanelHandle`→`PanelImperativeHandle`,
`ref` on Panel → `panelRef`, `data-panel-group-direction` → `aria-orientation`. The shadcn wrappers are unchanged.

**Size units:** numbers are **pixels**; unit-less strings are **percent**; explicit units allowed
(`"33%"`, `"280px"`, `"20rem"`, `"30vw"`).

**Group props:** `orientation`, `defaultLayout` (remember layouts between reloads), `onLayoutChanged(layout, { isUserInteraction, requestedLayout })`
(fires after pointer release — use it to persist; prefer `requestedLayout`), `onLayoutChange` (every pointer move),
`groupRef` (`getLayout()`, `setLayout()`), `disabled`, `resizeTargetMinimumSize`, `id`.

**Panel props:** `id` (associates persisted layouts), `defaultSize`, `minSize`, `maxSize`, `collapsible`,
`collapsedSize` (default 0%), `collapsedThreshold`, `groupResizeBehavior` (`preserve-relative-size` | `preserve-pixel-size`;
at least one panel must keep relative size), `onResize(size, id, prev)`, `disabled`, `panelRef`
(`collapse()`, `expand()`, `getSize()`, `isCollapsed()`, `resize(size)`; hook `usePanelRef`). `className` applies to a nested div.

**Separator props:** `disabled`, `disableDoubleClick` (double-click resets the panel to its default size), `id`.
Renders `role="separator"` with the required WAI-ARIA properties; keyboard-resizable.

## Collapsible side panel (pattern)

```tsx
const left = usePanelRef()
<ResizablePanelGroup orientation="horizontal" id="editor" defaultLayout={saved} onLayoutChanged={(_, meta) => persist(meta.requestedLayout)}>
  <ResizablePanel id="sections" panelRef={left} defaultSize="20%" minSize="14rem" maxSize="30%" collapsible collapsedSize={0}>…</ResizablePanel>
  <ResizableHandle withHandle />
  <ResizablePanel id="preview" minSize="30%">…</ResizablePanel>
</ResizablePanelGroup>
<Button onClick={() => (left.current?.isCollapsed() ? left.current.expand() : left.current?.collapse())}>…</Button>
```

⚠️ Percentage default sizes may shift slightly during SSR hydration; render the editor layout on the client
or seed `defaultLayout` from the persisted value.
