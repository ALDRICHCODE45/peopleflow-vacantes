<!-- Source: https://ui.shadcn.com/docs/components/base/empty and the shadcn registry example `empty-demo` (fetched 2026-10-19). Official usage, composition and API for §19. -->

# empty

Use the Empty component to display an empty state.

## [Installation#](#installation)

## [Usage#](#usage)

```
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
```

```
<Empty>
  <EmptyHeader>
    <EmptyMedia variant="icon">
      <Icon />
    </EmptyMedia>
    <EmptyTitle>No data</EmptyTitle>
    <EmptyDescription>No data found</EmptyDescription>
  </EmptyHeader>
  <EmptyContent>
    <Button>Add data</Button>
  </EmptyContent>
</Empty>
```

## [Composition#](#composition)

Use the following composition to build an `Empty` state:

```
Empty
├── EmptyHeader
│   ├── EmptyMedia
│   ├── EmptyTitle
│   └── EmptyDescription
└── EmptyContent
```

## [Outline#](#outline)

Use the `border` utility class to create an outline empty state.

## [Background#](#background)

Use the `bg-*` and `bg-gradient-*` utilities to add a background to the empty state.

## [Avatar#](#avatar)

Use the `EmptyMedia` component to display an avatar in the empty state.

## [Avatar Group#](#avatar-group)

Use the `EmptyMedia` component to display an avatar group in the empty state.

## [InputGroup#](#inputgroup)

You can add an `InputGroup` component to the `EmptyContent` component.

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

## [API Reference#](#api-reference)

### [Empty#](#empty)

The main component of the empty state. Wraps the `EmptyHeader` and `EmptyContent` components.

Prop

Type

Default

`className`

`string`

```
<Empty>
  <EmptyHeader />
  <EmptyContent />
</Empty>
```

### [EmptyHeader#](#emptyheader)

The `EmptyHeader` component wraps the empty media, title, and description.

Prop

Type

Default

`className`

`string`

```
<EmptyHeader>
  <EmptyMedia />
  <EmptyTitle />
  <EmptyDescription />
</EmptyHeader>
```

### [EmptyMedia#](#emptymedia)

Use the `EmptyMedia` component to display the media of the empty state such as an icon or an image. You can also use it to display other components such as an avatar.

Prop

Type

Default

`variant`

`"default" | "icon"`

`default`

`className`

`string`

```
<EmptyMedia variant="icon">
  <Icon />
</EmptyMedia>
```

```
<EmptyMedia>
  <Avatar>
    <AvatarImage src="..." />
    <AvatarFallback>CN</AvatarFallback>
  </Avatar>
</EmptyMedia>
```

### [EmptyTitle#](#emptytitle)

Use the `EmptyTitle` component to display the title of the empty state.

Prop

Type

Default

`className`

`string`

```
<EmptyTitle>No data</EmptyTitle>
```

### [EmptyDescription#](#emptydescription)

Use the `EmptyDescription` component to display the description of the empty state.

Prop

Type

Default

`className`

`string`

```
<EmptyDescription>You do not have any notifications.</EmptyDescription>
```

### [EmptyContent#](#emptycontent)

Use the `EmptyContent` component to display the content of the empty state such as a button, input or a link.

Prop

Type

Default

`className`

`string`

```
<EmptyContent>
  <Button>Add Project</Button>
</EmptyContent>
```

## Chosen example: empty-demo (registry)

# Usage Examples

Found 1 example matching "empty-demo":
## Example: empty-demo
### Code (registry/new-york-v4/examples/empty-demo.tsx):

```tsx
import { IconFolderCode } from "@tabler/icons-react"
import { ArrowUpRightIcon } from "lucide-react"

import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/registry/new-york-v4/ui/empty"

export default function EmptyDemo() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconFolderCode />
        </EmptyMedia>
        <EmptyTitle>No Projects Yet</EmptyTitle>
        <EmptyDescription>
          You haven&apos;t created any projects yet. Get started by creating
          your first project.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex gap-2">
          <Button>Create Project</Button>
          <Button variant="outline">Import Project</Button>
        </div>
      </EmptyContent>
      <Button
        variant="link"
        asChild
        className="text-muted-foreground"
        size="sm"
      >
        <a href="#">
          Learn More <ArrowUpRightIcon />
        </a>
      </Button>
    </Empty>
  )
}

```