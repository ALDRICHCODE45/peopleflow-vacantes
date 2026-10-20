<!-- Source: https://ui.shadcn.com/docs/components/base/select + registry example select-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# select



## [Installation#](#installation)

```
pnpm dlx shadcn@latest add select
```

## [Usage#](#usage)

```
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
```

```
const items = [
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
  { label: "System", value: "system" },
]
 
<Select items={items}>
  <SelectTrigger className="w-[180px]">
    <SelectValue placeholder="Theme" />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      {items.map((item) => (
        <SelectItem key={item.value} value={item.value}>
          {item.label}
        </SelectItem>
      ))}
    </SelectGroup>
  </SelectContent>
</Select>
```

## [Composition#](#composition)

Use the following composition to build a `Select`:

```
Select
├── SelectTrigger
│   └── SelectValue
└── SelectContent
    ├── SelectGroup
    │   ├── SelectLabel
    │   ├── SelectItem
    │   └── SelectItem
    ├── SelectSeparator
    └── SelectGroup
        ├── SelectLabel
        ├── SelectItem
        └── SelectItem
```

## [Align Item With Trigger#](#align-item-with-trigger)

Use `alignItemWithTrigger` on `SelectContent` to control whether the selected item aligns with the trigger. When `true` (default), the popup positions so the selected item appears over the trigger. When `false`, the popup aligns to the trigger edge.

Align Item

Toggle to align the item with the trigger.

```
"use client"

import * as React from "react"
```

## [Groups#](#groups)

Use `SelectGroup`, `SelectLabel`, and `SelectSeparator` to organize items.

```
import {
  Select,
  SelectContent,
```

## [Scrollable#](#scrollable)

A select with many items that scrolls.

```
import {
  Select,
  SelectContent,
```

## [Disabled#](#disabled)

```
import {
  Select,
  SelectContent,
```

## [Invalid#](#invalid)

Add the `data-invalid` attribute to the `Field` component and the `aria-invalid` attribute to the `SelectTrigger` component to show an error state.

```
<Field data-invalid>
  <FieldLabel>Fruit</FieldLabel>
  <SelectTrigger aria-invalid>
    <SelectValue />
  </SelectTrigger>
</Field>
```

```
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import {
  Select,
```

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

```
"use client"

import * as React from "react"
```

## [API Reference#](#api-reference)

See the [Base UI Select](https://base-ui.com/react/components/select#api-reference) documentation.

## Registry example

# Usage Examples

Found 2 examples matching "select-demo":
## Example: select-demo
### Code (registry/new-york-v4/examples/select-demo.tsx):

```tsx
import * as React from "react"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/registry/new-york-v4/ui/select"

export default function SelectDemo() {
  return (
    <Select>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Select a fruit" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Fruits</SelectLabel>
          <SelectItem value="apple">Apple</SelectItem>
          <SelectItem value="banana">Banana</SelectItem>
          <SelectItem value="blueberry">Blueberry</SelectItem>
          <SelectItem value="grapes">Grapes</SelectItem>
          <SelectItem value="pineapple">Pineapple</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

```

---

## Example: native-select-demo
### Code (registry/new-york-v4/examples/native-select-demo.tsx):

```tsx
import {
  NativeSelect,
  NativeSelectOption,
} from "@/registry/new-york-v4/ui/native-select"

export default function NativeSelectDemo() {
  return (
    <NativeSelect>
      <NativeSelectOption value="">Select status</NativeSelectOption>
      <NativeSelectOption value="todo">Todo</NativeSelectOption>
      <NativeSelectOption value="in-progress">In Progress</NativeSelectOption>
      <NativeSelectOption value="done">Done</NativeSelectOption>
      <NativeSelectOption value="cancelled">Cancelled</NativeSelectOption>
    </NativeSelect>
  )
}

```