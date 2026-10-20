<!-- Source: https://ui.shadcn.com/docs/components/base/skeleton + registry example skeleton-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# skeleton



## [Installation#](#installation)

```
pnpm dlx shadcn@latest add skeleton
```

## [Usage#](#usage)

```
import { Skeleton } from "@/components/ui/skeleton"
```

```
<Skeleton className="h-[20px] w-[100px] rounded-full" />
```

## [Avatar#](#avatar)

```
import { Skeleton } from "@/components/ui/skeleton"

export function SkeletonAvatar() {
```

## [Card#](#card)

```
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
```

## [Text#](#text)

```
import { Skeleton } from "@/components/ui/skeleton"

export function SkeletonText() {
```

## [Form#](#form)

```
import { Skeleton } from "@/components/ui/skeleton"

export function SkeletonForm() {
```

## [Table#](#table)

```
import { Skeleton } from "@/components/ui/skeleton"

export function SkeletonTable() {
```

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

```
"use client"

import * as React from "react"
```

[Sidebar](/docs/components/base/sidebar)[Slider](/docs/components/base/slider)

On This Page

[Installation](#installation)[Usage](#usage)[Avatar](#avatar)[Card](#card)[Text](#text)[Form](#form)[Table](#table)[RTL](#rtl)

Deploy your shadcn/ui app on Vercel

Trusted by OpenAI, Sonos, Adobe, and more.

Vercel provides tools and infrastructure to deploy apps and features at scale.

[Deploy to Vercel](https://vercel.com/new?utm_source=shadcn_site&utm_medium=web&utm_campaign=docs_cta_deploy_now_callout)

## Registry example

# Usage Examples

Found 1 example matching "skeleton-demo":
## Example: skeleton-demo
### Code (registry/new-york-v4/examples/skeleton-demo.tsx):

```tsx
import { Skeleton } from "@/registry/new-york-v4/ui/skeleton"

export default function SkeletonDemo() {
  return (
    <div className="flex items-center space-x-4">
      <Skeleton className="h-12 w-12 rounded-full" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-[250px]" />
        <Skeleton className="h-4 w-[200px]" />
      </div>
    </div>
  )
}

```