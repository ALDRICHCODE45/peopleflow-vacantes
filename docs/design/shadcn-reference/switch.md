<!-- Source: https://ui.shadcn.com/docs/components/base/switch + registry example switch-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# switch



## [Installation#](#installation)

```
pnpm dlx shadcn@latest add switch
```

## [Usage#](#usage)

```
import { Switch } from "@/components/ui/switch"
```

```
<Switch />
```

## [Description#](#description)

Share across devices

Focus is shared across devices, and turns off when you leave the app.

```
import {
  Field,
  FieldContent,
```

## [Choice Card#](#choice-card)

Card-style selection where `FieldLabel` wraps the entire `Field` for a clickable card pattern.

Focus is shared across devices, and turns off when you leave the app.

Receive notifications when focus mode is enabled or disabled.

```
import {
  Field,
  FieldContent,
```

## [Disabled#](#disabled)

Add the `disabled` prop to the `Switch` component to disable the switch. Add the `data-disabled` prop to the `Field` component for styling.

```
import { Field, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
```

## [Invalid#](#invalid)

Add the `aria-invalid` prop to the `Switch` component to indicate an invalid state. Add the `data-invalid` prop to the `Field` component for styling.

Accept terms and conditions

You must accept the terms and conditions to continue.

```
import {
  Field,
  FieldContent,
```

## [Size#](#size)

Use the `size` prop to change the size of the switch.

```
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
```

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

المشاركة عبر الأجهزة

يتم مشاركة التركيز عبر الأجهزة، ويتم إيقاف تشغيله عند مغادرة التطبيق.

```
"use client"

import * as React from "react"
```

## [API Reference#](#api-reference)

See the [Base UI Switch](https://base-ui.com/react/components/switch#api-reference) documentation.

## Registry example

# Usage Examples

Found 1 example matching "switch-demo":
## Example: switch-demo
### Code (registry/new-york-v4/examples/switch-demo.tsx):

```tsx
import { Label } from "@/registry/new-york-v4/ui/label"
import { Switch } from "@/registry/new-york-v4/ui/switch"

export default function SwitchDemo() {
  return (
    <div className="flex items-center space-x-2">
      <Switch id="airplane-mode" />
      <Label htmlFor="airplane-mode">Airplane Mode</Label>
    </div>
  )
}

```