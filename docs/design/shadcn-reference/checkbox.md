<!-- Source: https://ui.shadcn.com/docs/components/base/checkbox + registry example checkbox-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# checkbox



## [Installation#](#installation)

## [Usage#](#usage)

```
import { Checkbox } from "@/components/ui/checkbox"
```

```
<Checkbox />
```

## [Checked State#](#checked-state)

Use `defaultChecked` for uncontrolled checkboxes, or `checked` and `onCheckedChange` to control the state.

```
import * as React from "react"
 
export function Example() {
  const [checked, setChecked] = React.useState(false)
 
  return <Checkbox checked={checked} onCheckedChange={setChecked} />
}
```

## [Invalid State#](#invalid-state)

Set `aria-invalid` on the checkbox and `data-invalid` on the field wrapper to show the invalid styles.

## [Basic#](#basic)

Pair the checkbox with `Field` and `FieldLabel` for proper layout and labeling.

## [Description#](#description)

Use `FieldContent` and `FieldDescription` for helper text.

## [Disabled#](#disabled)

Use the `disabled` prop to prevent interaction and add the `data-disabled` attribute to the `<Field>` component for disabled styles.

## [Group#](#group)

Use multiple fields to create a checkbox list.

## [Table#](#table)

Name

Email

Role

Sarah Chen

sarah.chen@example.com

Admin

Marcus Rodriguez

marcus.rodriguez@example.com

User

Priya Patel

priya.patel@example.com

User

David Kim

david.kim@example.com

Editor

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

## [API Reference#](#api-reference)

See the [Base UI](https://base-ui.com/react/components/checkbox#api-reference) documentation for more information.

## Registry example

# Usage Examples

Found 1 example matching "checkbox-demo":
## Example: checkbox-demo
### Code (registry/new-york-v4/examples/checkbox-demo.tsx):

```tsx
"use client"

import { Checkbox } from "@/registry/new-york-v4/ui/checkbox"
import { Label } from "@/registry/new-york-v4/ui/label"

export default function CheckboxDemo() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Checkbox id="terms" />
        <Label htmlFor="terms">Accept terms and conditions</Label>
      </div>
      <div className="flex items-start gap-3">
        <Checkbox id="terms-2" defaultChecked />
        <div className="grid gap-2">
          <Label htmlFor="terms-2">Accept terms and conditions</Label>
          <p className="text-sm text-muted-foreground">
            By clicking this checkbox, you agree to the terms and conditions.
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3">
        <Checkbox id="toggle" disabled />
        <Label htmlFor="toggle">Enable notifications</Label>
      </div>
      <Label className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 has-[[aria-checked=true]]:border-blue-600 has-[[aria-checked=true]]:bg-blue-50 dark:has-[[aria-checked=true]]:border-blue-900 dark:has-[[aria-checked=true]]:bg-blue-950">
        <Checkbox
          id="toggle-2"
          defaultChecked
          className="data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white dark:data-[state=checked]:border-blue-700 dark:data-[state=checked]:bg-blue-700"
        />
        <div className="grid gap-1.5 font-normal">
          <p className="text-sm leading-none font-medium">
            Enable notifications
          </p>
          <p className="text-sm text-muted-foreground">
            You can enable or disable notifications at any time.
          </p>
        </div>
      </Label>
    </div>
  )
}

```