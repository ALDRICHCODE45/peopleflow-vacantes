<!-- Source: https://ui.shadcn.com/docs/components/base/item + registry example item-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# item



## [Installation#](#installation)

## [Usage#](#usage)

```
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
```

```
<Item>
  <ItemMedia variant="icon">
    <Icon />
  </ItemMedia>
  <ItemContent>
    <ItemTitle>Title</ItemTitle>
    <ItemDescription>Description</ItemDescription>
  </ItemContent>
  <ItemActions>
    <Button>Action</Button>
  </ItemActions>
</Item>
```

## [Composition#](#composition)

Use the following composition to build an `Item`:

```
ItemGroup
└── Item
    ├── ItemHeader
    ├── ItemMedia
    ├── ItemContent
    │   ├── ItemTitle
    │   └── ItemDescription
    ├── ItemActions
    └── ItemFooter
```

## [Item vs Field#](#item-vs-field)

Use `Field` if you need to display a form input such as a checkbox, input, radio, or select.

If you only need to display content such as a title, description, and actions, use `Item`.

## [Variant#](#variant)

Use the `variant` prop to change the visual style of the item.

## [Size#](#size)

Use the `size` prop to change the size of the item. Available sizes are `default`, `sm`, and `xs`.

## [Icon#](#icon)

Use `ItemMedia` with `variant="icon"` to display an icon.

## [Avatar#](#avatar)

You can use `ItemMedia` with `variant="avatar"` to display an avatar.

## [Image#](#image)

Use `ItemMedia` with `variant="image"` to display an image.

## [Group#](#group)

Use `ItemGroup` to group related items together.

## [Header#](#header)

Use `ItemHeader` to add a header above the item content.

## [Link#](#link)

Use the `render` prop to render the item as a link. The hover and focus states will be applied to the anchor element.

```
<Item render={<a href="/dashboard" />}>
  <ItemMedia variant="icon">
    <HomeIcon />
  </ItemMedia>
  <ItemContent>
    <ItemTitle>Dashboard</ItemTitle>
    <ItemDescription>Overview of your account and activity.</ItemDescription>
  </ItemContent>
</Item>
```

## [Dropdown#](#dropdown)

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

## [API Reference#](#api-reference)

### [Item#](#item)

The main component for displaying content with media, title, description, and actions.

Prop

Type

Default

`variant`

`"default" | "outline" | "muted"`

`"default"`

`size`

`"default" | "sm" | "xs"`

`"default"`

`render`

`React.ReactElement`

### [ItemGroup#](#itemgroup)

A container that groups related items together with consistent styling.

```
<ItemGroup>
  <Item />
  <Item />
</ItemGroup>
```

### [ItemSeparator#](#itemseparator)

A separator between items in a group.

```
<ItemGroup>
  <Item />
  <ItemSeparator />
  <Item />
</ItemGroup>
```

### [ItemMedia#](#itemmedia)

Use `ItemMedia` to display media content such as icons, images, or avatars.

Prop

Type

Default

`variant`

`"default" | "icon" | "image"`

`"default"`

```
<ItemMedia variant="icon">
  <Icon />
</ItemMedia>
```

```
<ItemMedia variant="image">
  <img src="..." alt="..." />
</ItemMedia>
```

### [ItemContent#](#itemcontent)

Wraps the title and description of the item.

```
<ItemContent>
  <ItemTitle>Title</ItemTitle>
  <ItemDescription>Description</ItemDescription>
</ItemContent>
```

### [ItemTitle#](#itemtitle)

Displays the title of the item.

```
<ItemTitle>Item Title</ItemTitle>
```

### [ItemDescription#](#itemdescription)

Displays the description of the item.

```
<ItemDescription>Item description</ItemDescription>
```

### [ItemActions#](#itemactions)

Container for action buttons or other interactive elements.

```
<ItemActions>
  <Button>Action</Button>
</ItemActions>
```

### [ItemHeader#](#itemheader)

Displays a header above the item content.

```
<Item>
  <ItemHeader>Header</ItemHeader>
  <ItemContent>...</ItemContent>
</Item>
```

### [ItemFooter#](#itemfooter)

Displays a footer below the item content.

```
<Item>
  <ItemContent>...</ItemContent>
  <ItemFooter>Footer</ItemFooter>
</Item>
```

## Registry example

# Usage Examples

Found 1 example matching "item-demo":
## Example: item-demo
### Code (registry/new-york-v4/examples/item-demo.tsx):

```tsx
import { BadgeCheckIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/registry/new-york-v4/ui/item"

export default function ItemDemo() {
  return (
    <div className="flex w-full max-w-md flex-col gap-6">
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>Basic Item</ItemTitle>
          <ItemDescription>
            A simple item with title and description.
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button variant="outline" size="sm">
            Action
          </Button>
        </ItemActions>
      </Item>
      <Item variant="outline" size="sm" asChild>
        <a href="#">
          <ItemMedia>
            <BadgeCheckIcon className="size-5" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Your profile has been verified.</ItemTitle>
          </ItemContent>
          <ItemActions>
            <ChevronRightIcon className="size-4" />
          </ItemActions>
        </a>
      </Item>
    </div>
  )
}

```