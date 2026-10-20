<!-- Source: https://ui.shadcn.com/docs/components/base/textarea + registry example textarea-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# textarea



## [Installation#](#installation)

```
pnpm dlx shadcn@latest add textarea
```

## [Usage#](#usage)

```
import { Textarea } from "@/components/ui/textarea"
```

```
<Textarea />
```

## [Field#](#field)

Use `Field`, `FieldLabel`, and `FieldDescription` to create a textarea with a label and description.

Message

Enter your message below.

```
import {
  Field,
  FieldDescription,
```

## [Disabled#](#disabled)

Use the `disabled` prop to disable the textarea. To style the disabled state, add the `data-disabled` attribute to the `Field` component.

```
import { Field, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
```

## [Invalid#](#invalid)

Use the `aria-invalid` prop to mark the textarea as invalid. To style the invalid state, add the `data-invalid` attribute to the `Field` component.

Message

Please enter a valid message.

```
import {
  Field,
  FieldDescription,
```

## [Button#](#button)

Pair with `Button` to create a textarea with a submit button.

```
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
```

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

التعليقات

شاركنا أفكارك حول خدمتنا.

```
"use client"

import * as React from "react"
```

## Registry example

# Usage Examples

Found 1 example matching "textarea-demo":
## Example: textarea-demo
### Code (registry/new-york-v4/examples/textarea-demo.tsx):

```tsx
import { Textarea } from "@/registry/new-york-v4/ui/textarea"

export default function TextareaDemo() {
  return <Textarea placeholder="Type your message here." />
}

```