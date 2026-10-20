<!-- Source: https://ui.shadcn.com/docs/components/base/progress + registry example progress-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# progress



## [Installation#](#installation)

```
pnpm dlx shadcn@latest add progress
```

## [Usage#](#usage)

```
import { Progress } from "@/components/ui/progress"
```

```
<Progress value={33} />
```

## [Composition#](#composition)

### [With label and value#](#with-label-and-value)

Use `ProgressLabel` and `ProgressValue` to add a label and value display.

```
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
 
;<Progress value={56} className="w-full max-w-sm">
  <ProgressLabel>Upload progress</ProgressLabel>
  <ProgressValue />
</Progress>
```

```
Progress
├── ProgressLabel
├── ProgressValue
└── ProgressTrack
    └── ProgressIndicator
```

## [Label#](#label)

Use `ProgressLabel` and `ProgressValue` to add a label and value display.

Upload progress56%x

```
import {
  Progress,
  ProgressLabel,
```

## [Controlled#](#controlled)

A progress bar that can be controlled by a slider.

x

```
"use client"

import * as React from "react"
```

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

تقدم الرفع٥٦%x

```
"use client"

import * as React from "react"
```

## [API Reference#](#api-reference)

See the [Base UI Progress](https://base-ui.com/react/components/progress#api-reference) documentation.

[Popover](/docs/components/base/popover)[Questionnaire](/docs/components/base/questionnaire)

On This Page

[Installation](#installation)[Usage](#usage)[Composition](#composition)[With label and value](#with-label-and-value)[Label](#label)[Controlled](#controlled)[RTL](#rtl)[API Reference](#api-reference)

Deploy your shadcn/ui app on Vercel

Trusted by OpenAI, Sonos, Adobe, and more.

Vercel provides tools and infrastructure to deploy apps and features at scale.

[Deploy to Vercel](https://vercel.com/new?utm_source=shadcn_site&utm_medium=web&utm_campaign=docs_cta_deploy_now_callout)

## Registry example

# Usage Examples

Found 1 example matching "progress-demo":
## Example: progress-demo
### Code (registry/new-york-v4/examples/progress-demo.tsx):

```tsx
"use client"

import * as React from "react"

import { Progress } from "@/registry/new-york-v4/ui/progress"

export default function ProgressDemo() {
  const [progress, setProgress] = React.useState(13)

  React.useEffect(() => {
    const timer = setTimeout(() => setProgress(66), 500)
    return () => clearTimeout(timer)
  }, [])

  return <Progress value={progress} className="w-[60%]" />
}

```