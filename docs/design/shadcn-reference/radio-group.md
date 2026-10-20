<!-- Source: https://ui.shadcn.com/docs/components/base/radio-group + registry example radio-group-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# radio-group



## [Installation#](#installation)

```
pnpm dlx shadcn@latest add radio-group
```

## [Usage#](#usage)

```
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
```

```
<RadioGroup defaultValue="option-one">
  <div className="flex items-center gap-3">
    <RadioGroupItem value="option-one" id="option-one" />
    <Label htmlFor="option-one">Option One</Label>
  </div>
  <div className="flex items-center gap-3">
    <RadioGroupItem value="option-two" id="option-two" />
    <Label htmlFor="option-two">Option Two</Label>
  </div>
</RadioGroup>
```

## [Composition#](#composition)

Use the following composition to build a `RadioGroup`:

```
RadioGroup
├── RadioGroupItem
└── RadioGroupItem
```

## [Description#](#description)

Radio group items with a description using the `Field` component.

Default

Standard spacing for most use cases.

Comfortable

More space between elements.

Compact

Minimal spacing for dense layouts.

```
import {
  Field,
  FieldContent,
```

## [Choice Card#](#choice-card)

Use `FieldLabel` to wrap the entire `Field` for a clickable card-style selection.

For individuals and small teams.

For growing businesses.

For large teams and enterprises.

```
import {
  Field,
  FieldContent,
```

## [Fieldset#](#fieldset)

Use `FieldSet` and `FieldLegend` to group radio items with a label and description.

```
import {
  Field,
  FieldDescription,
```

## [Disabled#](#disabled)

Use the `disabled` prop on `RadioGroup` to disable all items.

```
import { Field, FieldLabel } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
```

## [Invalid#](#invalid)

Use `aria-invalid` on `RadioGroupItem` and `data-invalid` on `Field` to show validation errors.

```
import {
  Field,
  FieldDescription,
```

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

افتراضي

تباعد قياسي لمعظم حالات الاستخدام.

مريح

مساحة أكبر بين العناصر.

مضغوط

تباعد أدنى للتخطيطات الكثيفة.

```
"use client"

import * as React from "react"
```

## [API Reference#](#api-reference)

See the [Base UI Radio Group](https://base-ui.com/react/components/radio-group#api-reference) documentation.

## Registry example

# Usage Examples

Found 1 example matching "radio-group-demo":
## Example: radio-group-demo
### Code (registry/new-york-v4/examples/radio-group-demo.tsx):

```tsx
import { Label } from "@/registry/new-york-v4/ui/label"
import {
  RadioGroup,
  RadioGroupItem,
} from "@/registry/new-york-v4/ui/radio-group"

export default function RadioGroupDemo() {
  return (
    <RadioGroup defaultValue="comfortable">
      <div className="flex items-center gap-3">
        <RadioGroupItem value="default" id="r1" />
        <Label htmlFor="r1">Default</Label>
      </div>
      <div className="flex items-center gap-3">
        <RadioGroupItem value="comfortable" id="r2" />
        <Label htmlFor="r2">Comfortable</Label>
      </div>
      <div className="flex items-center gap-3">
        <RadioGroupItem value="compact" id="r3" />
        <Label htmlFor="r3">Compact</Label>
      </div>
    </RadioGroup>
  )
}

```