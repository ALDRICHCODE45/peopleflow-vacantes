<!-- Source: https://ui.shadcn.com/docs/components/base/popover and registry https://ui.shadcn.com/r/styles/base-rhea/popover.json (fetched 2026-10-27). Official usage, composition and API. -->

# Popover

Displays rich content in a portal, triggered by a button. Built on
[Base UI Popover](https://base-ui.com/react/components/popover#api-reference). Already installed at
`frontend/src/components/ui/popover.tsx` (style `base-rhea`).

## Installation

```sh
pnpm dlx shadcn@latest add popover
```

## Usage

```tsx
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"

<Popover>
  <PopoverTrigger render={<Button variant="outline" />}>Open Popover</PopoverTrigger>
  <PopoverContent>
    <PopoverHeader>
      <PopoverTitle>Title</PopoverTitle>
      <PopoverDescription>Description text here.</PopoverDescription>
    </PopoverHeader>
  </PopoverContent>
</Popover>
```

## Composition

```text
Popover
├── PopoverTrigger
└── PopoverContent
    └── PopoverHeader (PopoverTitle, PopoverDescription) — optional
```

- The trigger uses Base UI's `render` prop (`render={<Button variant="outline" />}`), not `asChild`.
- `PopoverContent` props: `align` (`"start" | "center" | "end"`, default `center`), `alignOffset` (0),
  `side` (`"bottom"` default; also `top`, `left`, `right`, `inline-start`, `inline-end`), `sideOffset` (4),
  plus every `Popover.Popup` prop. Default popup: `w-72 rounded-3xl bg-popover p-4 shadow-lg ring-1`, portalled, `z-50`.
- **Align example:** `<PopoverContent align="start">` aligns to the trigger's leading edge.
- **With form example:** compose `Field`, `FieldGroup`, `FieldLabel` and `Input` inside `PopoverContent`
  (see field.md) — focus moves into the popup; Escape and outside click close it and return focus to the trigger.

## API reference

Root: `open`, `defaultOpen`, `onOpenChange(open, eventDetails)`, `modal`. Popup: `initialFocus`, `finalFocus`.
Full API: [Base UI Popover](https://base-ui.com/react/components/popover#api-reference).
