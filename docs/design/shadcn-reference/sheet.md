<!-- Source: https://ui.shadcn.com/docs/components/base/sheet + registry example sheet-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# sheet



## [Installation#](#installation)

```
pnpm dlx shadcn@latest add sheet
```

## [Usage#](#usage)

```
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
```

```
<Sheet>
  <SheetTrigger>Open</SheetTrigger>
  <SheetContent>
    <SheetHeader>
      <SheetTitle>Are you absolutely sure?</SheetTitle>
      <SheetDescription>This action cannot be undone.</SheetDescription>
    </SheetHeader>
  </SheetContent>
</Sheet>
```

## [Composition#](#composition)

Use the following composition to build a `Sheet`:

```
Sheet
├── SheetTrigger
└── SheetContent
    ├── SheetHeader
    │   ├── SheetTitle
    │   └── SheetDescription
    └── SheetFooter
```

## [Side#](#side)

Use the `side` prop on `SheetContent` to set the edge of the screen where the sheet appears. Values are `top`, `right`, `bottom`, or `left`.

```
import { Button } from "@/components/ui/button"
import {
  Sheet,
```

## [No Close Button#](#no-close-button)

Use `showCloseButton={false}` on `SheetContent` to hide the close button.

```
import { Button } from "@/components/ui/button"
import {
  Sheet,
```

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

```
"use client"

import {
```

## [API Reference#](#api-reference)

See the [Base UI Dialog](https://base-ui.com/react/components/dialog#api-reference) documentation.

## Registry example

# Usage Examples

Found 1 example matching "sheet-demo":
## Example: sheet-demo
### Code (registry/new-york-v4/examples/sheet-demo.tsx):

```tsx
import { Button } from "@/registry/new-york-v4/ui/button"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/registry/new-york-v4/ui/sheet"

export default function SheetDemo() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Open</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit profile</SheetTitle>
          <SheetDescription>
            Make changes to your profile here. Click save when you&apos;re done.
          </SheetDescription>
        </SheetHeader>
        <div className="grid flex-1 auto-rows-min gap-6 px-4">
          <div className="grid gap-3">
            <Label htmlFor="sheet-demo-name">Name</Label>
            <Input id="sheet-demo-name" defaultValue="Pedro Duarte" />
          </div>
          <div className="grid gap-3">
            <Label htmlFor="sheet-demo-username">Username</Label>
            <Input id="sheet-demo-username" defaultValue="@peduarte" />
          </div>
        </div>
        <SheetFooter>
          <Button type="submit">Save changes</Button>
          <SheetClose asChild>
            <Button variant="outline">Close</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

```