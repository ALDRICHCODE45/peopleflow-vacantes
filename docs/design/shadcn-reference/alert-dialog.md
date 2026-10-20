<!-- Source: https://ui.shadcn.com/docs/components/base/alert-dialog + registry example alert-dialog-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# alert-dialog



## [Installation#](#installation)

## [Usage#](#usage)

```
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
} from "@/components/ui/alert-dialog"
```

```
<AlertDialog>
  <AlertDialogTrigger render={<Button variant="outline" />}>
    Show Dialog
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
      <AlertDialogDescription>
        This action cannot be undone. This will permanently delete your account
        from our servers.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction>Continue</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

## [Composition#](#composition)

Use the following composition to build an `AlertDialog`:

```
AlertDialog
├── AlertDialogTrigger
└── AlertDialogContent
    ├── AlertDialogHeader
    │   ├── AlertDialogMedia
    │   ├── AlertDialogTitle
    │   └── AlertDialogDescription
    └── AlertDialogFooter
        ├── AlertDialogCancel
        └── AlertDialogAction
```

## [Basic#](#basic)

A basic alert dialog with a title, description, and cancel and continue buttons.

## [Small#](#small)

Use the `size="sm"` prop to make the alert dialog smaller.

Use the `AlertDialogMedia` component to add a media element such as an icon or image to the alert dialog.

Use the `size="sm"` prop to make the alert dialog smaller and the `AlertDialogMedia` component to add a media element such as an icon or image to the alert dialog.

## [Destructive#](#destructive)

Use the `AlertDialogAction` component to add a destructive action button to the alert dialog.

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

## [API Reference#](#api-reference)

### [size#](#size)

Use the `size` prop on the `AlertDialogContent` component to control the size of the alert dialog. It accepts the following values:

Prop

Type

Default

`size`

`"default" | "sm"`

`"default"`

For more information about the other components and their props, see the [Base UI documentation](https://base-ui.com/react/components/alert-dialog#api-reference).

## Registry example

# Usage Examples

Found 1 example matching "alert-dialog-demo":
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