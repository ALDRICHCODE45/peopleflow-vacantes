<!-- Source: https://ui.shadcn.com/docs/components/base/spinner + registry example spinner-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# spinner



## [Installation#](#installation)

```
pnpm dlx shadcn@latest add spinner
```

## [Usage#](#usage)

```
import { Spinner } from "@/components/ui/spinner"
```

```
<Spinner />
```

## [Customization#](#customization)

You can replace the default spinner icon with any other icon by editing the `Spinner` component.

```
import { cn } from "cn"
import { LoaderIcon } from "lucide-react"
```

components/ui/spinner.tsx

```
import { cn } from "cn"
import { LoaderIcon } from "lucide-react"
 
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <LoaderIcon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}
 
export { Spinner }
```

## [Size#](#size)

Use the `size-*` utility class to change the size of the spinner.

```
import { Spinner } from "@/components/ui/spinner"

export function SpinnerSize() {
```

## [Button#](#button)

Add a spinner to a button to indicate a loading state. Place the `<Spinner />` before the label with `data-icon="inline-start"` for a start position, or after the label with `data-icon="inline-end"` for an end position.

```
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
```

## [Badge#](#badge)

Add a spinner to a badge to indicate a loading state. Place the `<Spinner />` before the label with `data-icon="inline-start"` for a start position, or after the label with `data-icon="inline-end"` for an end position.

SyncingUpdatingProcessing

```
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
```

## [Input Group#](#input-group)

Validating...

```
import { ArrowUpIcon } from "lucide-react"

import {
```

## [Empty#](#empty)

Processing your request

Please wait while we process your request. Do not refresh the page.

```
import { Button } from "@/components/ui/button"
import {
  Empty,
```

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

جاري معالجة الدفع...

١٠٠.٠٠ دولار

```
"use client"

import * as React from "react"
```

[Slider](/docs/components/base/slider)[Switch](/docs/components/base/switch)

On This Page

[Installation](#installation)[Usage](#usage)[Customization](#customization)[Size](#size)[Button](#button)[Badge](#badge)[Input Group](#input-group)[Empty](#empty)[RTL](#rtl)

Deploy your shadcn/ui app on Vercel

Trusted by OpenAI, Sonos, Adobe, and more.

Vercel provides tools and infrastructure to deploy apps and features at scale.

[Deploy to Vercel](https://vercel.com/new?utm_source=shadcn_site&utm_medium=web&utm_campaign=docs_cta_deploy_now_callout)

## Registry example

# Usage Examples

Found 1 example matching "spinner-demo":
## Example: spinner-demo
### Code (registry/new-york-v4/examples/spinner-demo.tsx):

```tsx
import {
  Item,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@/registry/new-york-v4/ui/item"
import { Spinner } from "@/registry/new-york-v4/ui/spinner"

export default function SpinnerDemo() {
  return (
    <div className="flex w-full max-w-xs flex-col gap-4 [--radius:1rem]">
      <Item variant="muted">
        <ItemMedia>
          <Spinner />
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="line-clamp-1">Processing payment...</ItemTitle>
        </ItemContent>
        <ItemContent className="flex-none justify-end">
          <span className="text-sm tabular-nums">$100.00</span>
        </ItemContent>
      </Item>
    </div>
  )
}

```