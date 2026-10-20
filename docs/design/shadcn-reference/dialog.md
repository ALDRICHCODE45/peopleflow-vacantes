<!-- Source: https://ui.shadcn.com/docs/components/base/dialog and registry example `dialog-demo` (fetched 2026-10-20). Official usage, composition and API for §19. -->

# dialog

A window overlaid on either the primary window or another dialog window, rendering the content underneath inert.

```
import { Button } from "@/components/ui/button"
import {
  Dialog,
```

## [Installation#](#installation)

```
pnpm dlx shadcn@latest add dialog
```

## [Usage#](#usage)

```
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
```

```
<Dialog>
  <DialogTrigger>Open</DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Are you absolutely sure?</DialogTitle>
      <DialogDescription>
        This action cannot be undone. This will permanently delete your account
        and remove your data from our servers.
      </DialogDescription>
    </DialogHeader>
  </DialogContent>
</Dialog>
```

## [Composition#](#composition)

Use the following composition to build a `Dialog`:

```
Dialog
├── DialogTrigger
└── DialogContent
    ├── DialogHeader
    │   ├── DialogTitle
    │   └── DialogDescription
    └── DialogFooter
```

## [Custom Close Button#](#custom-close-button)

Replace the default close control with your own button.

```
import { Button } from "@/components/ui/button"
import {
  Dialog,
```

## [No Close Button#](#no-close-button)

Use `showCloseButton={false}` to hide the close button.

```
import { Button } from "@/components/ui/button"
import {
  Dialog,
```

## [Sticky Footer#](#sticky-footer)

Keep actions visible while the content scrolls.

```
import { Button } from "@/components/ui/button"
import {
  Dialog,
```

## [Scrollable Content#](#scrollable-content)

Long content can scroll while the header stays in view.

```
import { Button } from "@/components/ui/button"
import {
  Dialog,
```

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

```
"use client"

import {
```

## [API Reference#](#api-reference)

See the [Base UI](https://base-ui.com/react/components/dialog#api-reference) documentation for more information.

## Registry example: dialog-demo

# Usage Examples

Found 2 examples matching "dialog-demo":
## Example: dialog-demo
### Code (registry/new-york-v4/examples/dialog-demo.tsx):

```tsx
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/registry/new-york-v4/ui/dialog"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"

export default function DialogDemo() {
  return (
    <Dialog>
      <form>
        <DialogTrigger asChild>
          <Button variant="outline">Open Dialog</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
            <DialogDescription>
              Make changes to your profile here. Click save when you&apos;re
              done.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-3">
              <Label htmlFor="name-1">Name</Label>
              <Input id="name-1" name="name" defaultValue="Pedro Duarte" />
            </div>
            <div className="grid gap-3">
              <Label htmlFor="username-1">Username</Label>
              <Input id="username-1" name="username" defaultValue="@peduarte" />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit">Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </form>
    </Dialog>
  )
}

```

---

## Example: alert-dialog-demo
### Code (registry/new-york-v4/examples/alert-dialog-demo.tsx):

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/registry/new-york-v4/ui/alert-dialog"
import { Button } from "@/registry/new-york-v4/ui/button"

export default function AlertDialogDemo() {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">Show Dialog</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete your
            account and remove your data from our servers.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

```