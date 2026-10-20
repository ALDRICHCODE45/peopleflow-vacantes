<!-- Source: https://ui.shadcn.com/docs/components/base/separator + registry example separator-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# separator



## [Installation#](#installation)

```
pnpm dlx shadcn@latest add separator
```

## [Usage#](#usage)

```
import { Separator } from "@/components/ui/separator"
```

```
<Separator />
```

## [Vertical#](#vertical)

Use `orientation="vertical"` for a vertical separator.

Blog

Docs

Source

```
import { Separator } from "@/components/ui/separator"

export function SeparatorVertical() {
```

## [Menu#](#menu)

Vertical separators between menu items with descriptions.

SettingsManage preferences

AccountProfile & security

HelpSupport & docs

```
import { Separator } from "@/components/ui/separator"

export function SeparatorMenu() {
```

## [List#](#list)

Horizontal separators between list items.

Item 1

Value 1

Item 2

Value 2

Item 3

Value 3

```
import { Separator } from "@/components/ui/separator"

export function SeparatorList() {
```

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

shadcn/ui

الأساس لنظام التصميم الخاص بك

مجموعة من المكونات المصممة بشكل جميل يمكنك تخصيصها وتوسيعها والبناء عليها.

```
"use client"

import * as React from "react"
```

## [API Reference#](#api-reference)

See the [Base UI Separator](https://base-ui.com/react/components/separator#api-reference) documentation.

[Select](/docs/components/base/select)[Sheet](/docs/components/base/sheet)

On This Page

[Installation](#installation)[Usage](#usage)[Vertical](#vertical)[Menu](#menu)[List](#list)[RTL](#rtl)[API Reference](#api-reference)

Deploy your shadcn/ui app on Vercel

Trusted by OpenAI, Sonos, Adobe, and more.

Vercel provides tools and infrastructure to deploy apps and features at scale.

[Deploy to Vercel](https://vercel.com/new?utm_source=shadcn_site&utm_medium=web&utm_campaign=docs_cta_deploy_now_callout)

## Registry example

# Usage Examples

Found 1 example matching "separator-demo":
## Example: separator-demo
### Code (registry/new-york-v4/examples/separator-demo.tsx):

```tsx
import { Separator } from "@/registry/new-york-v4/ui/separator"

export default function SeparatorDemo() {
  return (
    <div>
      <div className="space-y-1">
        <h4 className="text-sm leading-none font-medium">Radix Primitives</h4>
        <p className="text-sm text-muted-foreground">
          An open-source UI component library.
        </p>
      </div>
      <Separator className="my-4" />
      <div className="flex h-5 items-center space-x-4 text-sm">
        <div>Blog</div>
        <Separator orientation="vertical" />
        <div>Docs</div>
        <Separator orientation="vertical" />
        <div>Source</div>
      </div>
    </div>
  )
}

```