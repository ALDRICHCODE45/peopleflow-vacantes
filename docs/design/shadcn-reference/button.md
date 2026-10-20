<!-- Source: https://ui.shadcn.com/docs/components/base/button + registry example button-demo (fetched 2026-10-20). Official usage, composition and API for §19. -->

# button



## [Installation#](#installation)

## [Usage#](#usage)

```
import { Button } from "@/components/ui/button"
```

```
<Button variant="outline">Button</Button>
```

## [Cursor#](#cursor)

Tailwind v4 [switched](https://tailwindcss.com/docs/upgrade-guide#buttons-use-the-default-cursor) from `cursor: pointer` to `cursor: default` for the button component.

If you want to keep the `cursor: pointer` behavior, add the following code to your CSS file:

You can also enable this during project setup with `npx shadcn@latest init --pointer`.

globals.css

```
@layer base {
  button:not(:disabled),
  [role="button"]:not(:disabled) {
    cursor: pointer;
  }
}
```

## [Size#](#size)

Use the `size` prop to change the size of the button.

## [Default#](#default)

## [Outline#](#outline)

## [Secondary#](#secondary)

## [Ghost#](#ghost)

## [Destructive#](#destructive)

## [Link#](#link)

## [Icon#](#icon)

## [With Icon#](#with-icon)

Remember to add the `data-icon="inline-start"` or `data-icon="inline-end"` attribute to the icon for the correct spacing.

## [Rounded#](#rounded)

Use the `rounded-full` class to make the button rounded.

## [Spinner#](#spinner)

Render a `<Spinner />` component inside the button to show a loading state. Remember to add the `data-icon="inline-start"` or `data-icon="inline-end"` attribute to the spinner for the correct spacing.

## [Button Group#](#button-group)

To create a button group, use the `ButtonGroup` component. See the [Button Group](/docs/components/base/button-group) documentation for more details.

## [As Link#](#as-link)

You can use the `buttonVariants` helper to make a link look like a button.

**Do not use `<Button render={<a />} nativeButton={false} />` for links.** The Base UI `Button` component always applies `role="button"`, which overrides the semantic link role on `<a>` elements. Use `buttonVariants` with a plain `<a>` tag instead.

## [RTL#](#rtl)

To enable RTL support in shadcn/ui, see the [RTL configuration guide](/docs/rtl).

## [API Reference#](#api-reference)

### [Button#](#button)

The `Button` component is a wrapper around the `button` element that adds a variety of styles and functionality.

Prop

Type

Default

`variant`

`"default" | "outline" | "ghost" | "destructive" | "secondary" | "link"`

`"default"`

`size`

`"default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"`

`"default"`

## Registry example

# Usage Examples

Found 2 examples matching "button-demo":
## Example: button-demo
### Code (registry/new-york-v4/examples/button-demo.tsx):

```tsx
import { ArrowUpIcon } from "lucide-react"

import { Button } from "@/registry/new-york-v4/ui/button"

export default function ButtonDemo() {
  return (
    <div className="flex flex-wrap items-center gap-2 md:flex-row">
      <Button variant="outline">Button</Button>
      <Button variant="outline" size="icon" aria-label="Submit">
        <ArrowUpIcon />
      </Button>
    </div>
  )
}

```

---

## Example: button-group-demo
### Code (registry/new-york-v4/examples/button-group-demo.tsx):

```tsx
"use client"

import * as React from "react"
import {
  ArchiveIcon,
  ArrowLeftIcon,
  CalendarPlusIcon,
  ClockIcon,
  ListFilterIcon,
  MailCheckIcon,
  MoreHorizontalIcon,
  TagIcon,
  Trash2Icon,
} from "lucide-react"

import { Button } from "@/registry/new-york-v4/ui/button"
import { ButtonGroup } from "@/registry/new-york-v4/ui/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/registry/new-york-v4/ui/dropdown-menu"

export default function ButtonGroupDemo() {
  const [label, setLabel] = React.useState("personal")

  return (
    <ButtonGroup>
      <ButtonGroup className="hidden sm:flex">
        <Button variant="outline" size="icon" aria-label="Go Back">
          <ArrowLeftIcon />
        </Button>
      </ButtonGroup>
      <ButtonGroup>
        <Button variant="outline">Archive</Button>
        <Button variant="outline">Report</Button>
      </ButtonGroup>
      <ButtonGroup>
        <Button variant="outline">Snooze</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More Options">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <MailCheckIcon />
                Mark as Read
              </DropdownMenuItem>
              <DropdownMenuItem>
                <ArchiveIcon />
                Archive
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <ClockIcon />
                Snooze
              </DropdownMenuItem>
              <DropdownMenuItem>
                <CalendarPlusIcon />
                Add to Calendar
              </DropdownMenuItem>
              <DropdownMenuItem>
                <ListFilterIcon />
                Add to List
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <TagIcon />
                  Label As...
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={label}
                    onValueChange={setLabel}
                  >
                    <DropdownMenuRadioItem value="personal">
                      Personal
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="work">
                      Work
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="other">
                      Other
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive">
                <Trash2Icon />
                Trash
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>
    </ButtonGroup>
  )
}

```