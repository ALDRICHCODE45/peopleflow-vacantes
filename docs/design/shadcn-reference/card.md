<!-- Source: https://ui.shadcn.com/docs/components/base/card + registry example card-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# card



## [Installation#](#installation)

## [Usage#](#usage)

```
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
```

```
<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
    <CardDescription>Card Description</CardDescription>
    <CardAction>Card Action</CardAction>
  </CardHeader>
  <CardContent>
    <p>Card Content</p>
  </CardContent>
  <CardFooter>
    <p>Card Footer</p>
  </CardFooter>
</Card>
```

## [Composition#](#composition)

Use the following composition to build a `Card`:

```
Card
├── CardHeader
│   ├── CardTitle
│   ├── CardDescription
│   └── CardAction
├── CardContent
└── CardFooter
```

## [Size#](#size)

Use the `size="sm"` prop to set the size of the card to small. The small size variant uses smaller spacing.

## [Spacing#](#spacing)

In addition to the `size` prop, you can use the `--card-spacing` CSS variable to control the spacing between sections and the inset of card parts.

Use negative margins with `-mx-(--card-spacing)` to make content go edge to edge while keeping it aligned with the card inset. When the edge-to-edge content sits above a footer, use `-mb-(--card-spacing)` on `CardContent` to remove the section gap.

## [Image#](#image)

Add an image before the card header to create a card with an image.

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

## [API Reference#](#api-reference)

### [Card#](#card)

The `Card` component is the root container for card content.

Prop

Type

Default

`size`

`"default" | "sm"`

`"default"`

`className`

`string`

\-

### [CardHeader#](#cardheader)

The `CardHeader` component is used for a title, description, and optional action.

Prop

Type

Default

`className`

`string`

\-

### [CardTitle#](#cardtitle)

The `CardTitle` component is used for the card title.

Prop

Type

Default

`className`

`string`

\-

### [CardDescription#](#carddescription)

The `CardDescription` component is used for helper text under the title.

Prop

Type

Default

`className`

`string`

\-

### [CardAction#](#cardaction)

The `CardAction` component places content in the top-right of the header (for example, a button or a badge).

Prop

Type

Default

`className`

`string`

\-

### [CardContent#](#cardcontent)

The `CardContent` component is used for the main card body.

Prop

Type

Default

`className`

`string`

\-

### [CardFooter#](#cardfooter)

The `CardFooter` component is used for actions and secondary content at the bottom of the card.

Prop

Type

Default

`className`

`string`

\-

## [Changelog#](#changelog)

### [Spacing Variable#](#spacing-variable)

If you're upgrading from a previous version of the `Card` component, you'll need to apply the following updates to use the `--card-spacing` variable:

### Update the Card root spacing classes.

Replace the hard-coded gap and vertical padding with `--card-spacing`, and set the default and small size values on the root:

```
  className={cn(
-   "group/card flex flex-col gap-4 overflow-hidden rounded-xl bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10 has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
+   "group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
    className
  )}
```

### Update CardHeader spacing classes.

Replace the horizontal padding and border spacing with the shared variable:

```
  className={cn(
-   "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-4 group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
+   "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)",
    className
  )}
```

### Update CardContent and CardFooter spacing classes.

Use `--card-spacing` for the content inset and footer padding:

```
  function CardContent({ className, ...props }: React.ComponentProps<"div">) {
    return (
      <div
        data-slot="card-content"
-       className={cn("px-4 group-data-[size=sm]/card:px-3", className)}
+       className={cn("px-(--card-spacing)", className)}
        {...props}
      />
    )
  }
```

```
  className={cn(
-   "flex items-center rounded-b-xl border-t bg-muted/50 p-4 group-data-[size=sm]/card:p-3",
+   "flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)",
    className
  )}
```

After applying these changes, you can customize card spacing by setting `--card-spacing` on the `Card` with an arbitrary property class:

```
function Example() {
  return <Card className="[--card-spacing:--spacing(6)]">...</Card>
}
```

## Registry example

# Usage Examples

Found 2 examples matching "card-demo":
## Example: card-demo
### Code (registry/new-york-v4/examples/card-demo.tsx):

```tsx
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"

export default function CardDemo() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Login to your account</CardTitle>
        <CardDescription>
          Enter your email below to login to your account
        </CardDescription>
        <CardAction>
          <Button variant="link">Sign Up</Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <form>
          <div className="flex flex-col gap-6">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="m@example.com"
                required
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center">
                <Label htmlFor="password">Password</Label>
                <a
                  href="#"
                  className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                >
                  Forgot your password?
                </a>
              </div>
              <Input id="password" type="password" required />
            </div>
          </div>
        </form>
      </CardContent>
      <CardFooter className="flex-col gap-2">
        <Button type="submit" className="w-full">
          Login
        </Button>
        <Button variant="outline" className="w-full">
          Login with Google
        </Button>
      </CardFooter>
    </Card>
  )
}

```

---

## Example: hover-card-demo
### Code (registry/new-york-v4/examples/hover-card-demo.tsx):

```tsx
import { CalendarIcon } from "lucide-react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/registry/new-york-v4/ui/avatar"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/registry/new-york-v4/ui/hover-card"

export default function HoverCardDemo() {
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Button variant="link">@nextjs</Button>
      </HoverCardTrigger>
      <HoverCardContent className="w-80">
        <div className="flex justify-between gap-4">
          <Avatar>
            <AvatarImage src="https://github.com/vercel.png" />
            <AvatarFallback>VC</AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">@nextjs</h4>
            <p className="text-sm">
              The React Framework – created and maintained by @vercel.
            </p>
            <div className="text-xs text-muted-foreground">
              Joined December 2021
            </div>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}

```