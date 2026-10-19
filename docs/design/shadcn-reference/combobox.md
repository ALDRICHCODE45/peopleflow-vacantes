<!-- Source: https://ui.shadcn.com/docs/components/base/combobox (fetched 2026-10-19). Official usage, composition and API for §19. -->

# combobox

Autocomplete input with a list of suggestions.

```
"use client"

import {
```

## [Installation#](#installation)

```
pnpm dlx shadcn@latest add combobox
```

## [Usage#](#usage)

```
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
```

```
const frameworks = ["Next.js", "SvelteKit", "Nuxt.js", "Remix", "Astro"]
 
export function ExampleCombobox() {
  return (
    <Combobox items={frameworks}>
      <ComboboxInput placeholder="Select a framework" />
      <ComboboxContent>
        <ComboboxEmpty>No items found.</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
```

## [Composition#](#composition)

### [Simple#](#simple)

A single-line input and a flat list (see [Basic](#basic)).

```
Combobox
├── ComboboxInput
└── ComboboxContent
    ├── ComboboxEmpty
    └── ComboboxList
        ├── ComboboxItem
        └── ComboboxItem
```

### [With chips#](#with-chips)

Multi-select with `multiple`, chips, and a chips input (see [Multiple](#multiple)).

```
Combobox
├── ComboboxChips
│   ├── ComboboxValue
│   │   └── ComboboxChip
│   └── ComboboxChipsInput
└── ComboboxContent
    ├── ComboboxEmpty
    └── ComboboxList
        ├── ComboboxItem
        └── ComboboxItem
```

### [With groups and collection#](#with-groups-and-collection)

Nested items per group using `ComboboxCollection` inside each `ComboboxGroup`, with a separator between groups (see [Groups](#groups)).

```
Combobox
├── ComboboxInput
└── ComboboxContent
    ├── ComboboxEmpty
    └── ComboboxList
        ├── ComboboxGroup
        │   ├── ComboboxLabel
        │   └── ComboboxCollection
        │       ├── ComboboxItem
        │       └── ComboboxItem
        ├── ComboboxSeparator
        └── ComboboxGroup
            ├── ComboboxLabel
            └── ComboboxCollection
                ├── ComboboxItem
                └── ComboboxItem
```

## [Custom Items#](#custom-items)

Use `itemToStringValue` when your items are objects.

```
import * as React from "react"
 
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
 
type Framework = {
  label: string
  value: string
}
 
const frameworks: Framework[] = [
  { label: "Next.js", value: "next" },
  { label: "SvelteKit", value: "sveltekit" },
  { label: "Nuxt", value: "nuxt" },
]
 
export function ExampleComboboxCustomItems() {
  return (
    <Combobox
      items={frameworks}
      itemToStringValue={(framework) => framework.label}
    >
      <ComboboxInput placeholder="Select a framework" />
      <ComboboxContent>
        <ComboboxEmpty>No items found.</ComboboxEmpty>
        <ComboboxList>
          {(framework) => (
            <ComboboxItem key={framework.value} value={framework}>
              {framework.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
```

## [Multiple Selection#](#multiple-selection)

Use `multiple` with chips for multi-select behavior.

```
import * as React from "react"
 
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
} from "@/components/ui/combobox"
 
const frameworks = ["Next.js", "SvelteKit", "Nuxt.js", "Remix", "Astro"]
 
export function ExampleComboboxMultiple() {
  const [value, setValue] = React.useState<string[]>([])
 
  return (
    <Combobox
      items={frameworks}
      multiple
      value={value}
      onValueChange={setValue}
    >
      <ComboboxChips>
        <ComboboxValue>
          {value.map((item) => (
            <ComboboxChip key={item}>{item}</ComboboxChip>
          ))}
        </ComboboxValue>
        <ComboboxChipsInput placeholder="Add framework" />
      </ComboboxChips>
      <ComboboxContent>
        <ComboboxEmpty>No items found.</ComboboxEmpty>
        <ComboboxList>
          {(item) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
```

## [Basic#](#basic)

A simple combobox with a list of frameworks.

```
"use client"

import {
```

## [Multiple#](#multiple)

A combobox with multiple selection using `multiple` and `ComboboxChips`.

```
"use client"

import * as React from "react"
```

## [Clear Button#](#clear-button)

Use the `showClear` prop to show a clear button.

```
"use client"

import {
```

## [Groups#](#groups)

Use `ComboboxGroup` and `ComboboxSeparator` to group items.

```
"use client"

import {
```

## [Custom Items#](#custom-items-1)

You can render a custom component inside `ComboboxItem`.

```
"use client"

import {
```

## [Invalid#](#invalid)

Use the `aria-invalid` prop to make the combobox invalid.

```
"use client"

import {
```

## [Disabled#](#disabled)

Use the `disabled` prop to disable the combobox.

```
"use client"

import {
```

## [Auto Highlight#](#auto-highlight)

Use the `autoHighlight` prop to automatically highlight the first item on filter.

```
"use client"

import {
```

## [Popup#](#popup)

You can trigger the combobox from a button or any other component by using the `render` prop. Move the `ComboboxInput` inside the `ComboboxContent`.

```
"use client"

import { Button } from "@/components/ui/button"
```

## [Input Group#](#input-group)

You can add an addon to the combobox by using the `InputGroupAddon` component inside the `ComboboxInput`.

```
"use client"

import { GlobeIcon } from "lucide-react"
```

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

```
"use client"

import * as React from "react"
```

## [API Reference#](#api-reference)

See the [Base UI](https://base-ui.com/react/components/combobox#api-reference) documentation for more information.