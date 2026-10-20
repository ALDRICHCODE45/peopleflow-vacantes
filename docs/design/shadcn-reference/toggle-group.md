<!-- Source: https://ui.shadcn.com/docs/components/base/toggle-group + registry example toggle-group-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# toggle-group



## [Installation#](#installation)

```
pnpm dlx shadcn@latest add toggle-group
```

## [Usage#](#usage)

```
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
```

```
<ToggleGroup type="single">
  <ToggleGroupItem value="a">A</ToggleGroupItem>
  <ToggleGroupItem value="b">B</ToggleGroupItem>
  <ToggleGroupItem value="c">C</ToggleGroupItem>
</ToggleGroup>
```

## [Composition#](#composition)

Use the following composition to build a `ToggleGroup`:

```
ToggleGroup
├── ToggleGroupItem
└── ToggleGroupItem
```

## [Outline#](#outline)

Use `variant="outline"` for an outline style.

```
import {
  ToggleGroup,
  ToggleGroupItem,
```

## [Size#](#size)

Use the `size` prop to change the size of the toggle group.

```
import {
  ToggleGroup,
  ToggleGroupItem,
```

## [Spacing#](#spacing)

Use `spacing` to add spacing between toggle group items.

```
import {
  ToggleGroup,
  ToggleGroupItem,
```

## [Vertical#](#vertical)

Use `orientation="vertical"` for vertical toggle groups.

```
import { BoldIcon, ItalicIcon, UnderlineIcon } from "lucide-react"

import {
```

## [Disabled#](#disabled)

```
import { Bold, Italic, Underline } from "lucide-react"

import {
```

## [Custom#](#custom)

A custom toggle group example.

Font Weight

Use `font-normal` to set the font weight.

```
"use client"

import * as React from "react"
```

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

```
"use client"

import * as React from "react"
```

## [API Reference#](#api-reference)

See the [Base UI Toggle Group](https://base-ui.com/react/components/toggle-group#api-reference) documentation.

## [Changelog#](#changelog)

### [2026-05-17 Default Spacing#](#2026-05-17-default-spacing)

Changed the default `spacing` from `0` to `2` so toggle groups render with space between items by default. Use `spacing={0}` for connected items.

## Registry example

# Usage Examples

Found 1 example matching "toggle-group-demo":
## Example: toggle-group-demo
### Code (registry/new-york-v4/examples/toggle-group-demo.tsx):

```tsx
import { Bold, Italic, Underline } from "lucide-react"

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/registry/new-york-v4/ui/toggle-group"

export default function ToggleGroupDemo() {
  return (
    <ToggleGroup variant="outline" type="multiple">
      <ToggleGroupItem value="bold" aria-label="Toggle bold">
        <Bold className="h-4 w-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="italic" aria-label="Toggle italic">
        <Italic className="h-4 w-4" />
      </ToggleGroupItem>
      <ToggleGroupItem value="strikethrough" aria-label="Toggle strikethrough">
        <Underline className="h-4 w-4" />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

```