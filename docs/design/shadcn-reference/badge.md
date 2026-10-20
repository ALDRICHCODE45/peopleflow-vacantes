<!-- Source: https://ui.shadcn.com/docs/components/base/badge + registry example badge-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# badge



## [Installation#](#installation)

## [Usage#](#usage)

```
import { Badge } from "@/components/ui/badge"
```

```
<Badge variant="default | outline | secondary | destructive">Badge</Badge>
```

## [Variants#](#variants)

Use the `variant` prop to change the variant of the badge.

## [With Icon#](#with-icon)

You can render an icon inside the badge. Use `data-icon="inline-start"` to render the icon on the left and `data-icon="inline-end"` to render the icon on the right.

## [With Spinner#](#with-spinner)

You can render a spinner inside the badge. Remember to add the `data-icon="inline-start"` or `data-icon="inline-end"` prop to the spinner.

## [Link#](#link)

Use the `render` prop to render a link as a badge.

## [Custom Colors#](#custom-colors)

You can customize the colors of a badge by adding custom classes such as `bg-green-50 dark:bg-green-800` to the `Badge` component.

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

## [API Reference#](#api-reference)

### [Badge#](#badge)

The `Badge` component displays a badge or a component that looks like a badge.

Prop

Type

Default

`variant`

`"default" | "secondary" | "destructive" | "outline" | "ghost" | "link"`

`"default"`

`className`

`string`

\-

## Registry example

# Usage Examples

Found 1 example matching "badge-demo":
## Example: badge-demo
### Code (registry/new-york-v4/examples/badge-demo.tsx):

```tsx
import { AlertCircleIcon, BadgeCheckIcon, CheckIcon } from "lucide-react"

import { Badge } from "@/registry/new-york-v4/ui/badge"

export default function BadgeDemo() {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex w-full flex-wrap gap-2">
        <Badge>Badge</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="outline">Outline</Badge>
      </div>
      <div className="flex w-full flex-wrap gap-2">
        <Badge
          variant="secondary"
          className="bg-blue-500 text-white dark:bg-blue-600"
        >
          <BadgeCheckIcon />
          Verified
        </Badge>
        <Badge className="h-5 min-w-5 rounded-full px-1 font-mono tabular-nums">
          8
        </Badge>
        <Badge
          className="h-5 min-w-5 rounded-full px-1 font-mono tabular-nums"
          variant="destructive"
        >
          99
        </Badge>
        <Badge
          className="h-5 min-w-5 rounded-full px-1 font-mono tabular-nums"
          variant="outline"
        >
          20+
        </Badge>
      </div>
    </div>
  )
}

```