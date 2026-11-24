import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

import { Separator } from "@/components/ui/separator"

/** True only for the direct children of an `ItemGroup` that is a real list (role=list): its rows are list items and its separators are presentational (axe aria-required-children). Every `Item` resets it to false for its descendants, and `ItemGroup` only sets it for non-host children, so nested Items, Items inside native `<ul><li>` wrappers and portaled content never claim a list role. */
const ItemListContext = React.createContext(false)

/** Marks each direct child of the group: components (Item, ItemSeparator, row wrappers) are list children; host elements such as `<ul>` are not. Fragments are transparent. */
function markDirectChildren(children: React.ReactNode, inList: boolean): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return child
    if (child.type === React.Fragment) {
      return React.cloneElement(child, undefined, markDirectChildren(child.props.children, inList))
    }
    return (
      <ItemListContext.Provider value={inList && typeof child.type !== "string"}>
        {child}
      </ItemListContext.Provider>
    )
  })
}

function ItemGroup({
  className,
  children,
  role = "list",
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      role={role}
      data-slot="item-group"
      className={cn(
        "group/item-group flex w-full flex-col gap-4 has-data-[size=sm]:gap-2.5 has-data-[size=xs]:gap-2",
        className
      )}
      {...props}
    >
      {markDirectChildren(children, role === "list")}
    </div>
  )
}

function ItemSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  const inList = React.useContext(ItemListContext)
  return (
    <Separator
      // A presentational separator carries no separator semantics, so it must not keep aria-orientation either (axe aria-allowed-attr).
      {...(inList ? { role: "presentation", "aria-orientation": undefined } : null)}
      data-slot="item-separator"
      orientation="horizontal"
      className={cn("my-2", className)}
      {...props}
    />
  )
}

const itemVariants = cva(
  "group/item flex w-full flex-wrap items-center rounded-2xl border text-sm transition-colors duration-100 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [a]:transition-colors [a]:hover:bg-muted",
  {
    variants: {
      variant: {
        default: "border-transparent",
        outline: "border-border",
        muted: "border-transparent bg-muted/50",
      },
      size: {
        default: "gap-3.5 px-4 py-3.5",
        sm: "gap-3.5 px-3.5 py-3",
        xs: "gap-2 px-2.5 py-2 in-data-[slot=dropdown-menu-content]:p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Item({
  className,
  variant = "default",
  size = "default",
  render,
  ...props
}: useRender.ComponentProps<"div"> & VariantProps<typeof itemVariants>) {
  const inList = React.useContext(ItemListContext)
  // An Item rendered as a link, button or any other element keeps its native role; only plain/div rows are list items.
  const plainRow =
    render === undefined ||
    (React.isValidElement(render) && render.type === "div")
  const element = useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(itemVariants({ variant, size, className })),
        ...(inList && plainRow ? { role: "listitem" } : null),
      },
      props
    ),
    render,
    state: {
      slot: "item",
      variant,
      size,
    },
  })
  return <ItemListContext.Provider value={false}>{element}</ItemListContext.Provider>
}

const itemMediaVariants = cva(
  "flex shrink-0 items-center justify-center gap-2 group-has-data-[slot=item-description]/item:translate-y-0.5 group-has-data-[slot=item-description]/item:self-start [&_svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "[&_svg:not([class*='size-'])]:size-4",
        image:
          "size-10 overflow-hidden rounded-xl group-data-[size=sm]/item:size-8 group-data-[size=xs]/item:size-6 group-data-[size=xs]/item:rounded-lg [&_img]:size-full [&_img]:object-cover",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function ItemMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof itemMediaVariants>) {
  return (
    <div
      data-slot="item-media"
      data-variant={variant}
      className={cn(itemMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn(
        "flex flex-1 flex-col gap-1 group-data-[size=xs]/item:gap-0.5 [&+[data-slot=item-content]]:flex-none",
        className
      )}
      {...props}
    />
  )
}

function ItemTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-title"
      className={cn(
        "line-clamp-1 flex w-fit items-center gap-2 text-sm leading-snug font-medium underline-offset-4",
        className
      )}
      {...props}
    />
  )
}

function ItemDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="item-description"
      className={cn(
        "line-clamp-2 text-left text-sm font-normal text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function ItemActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-actions"
      className={cn("flex items-center gap-2", className)}
      {...props}
    />
  )
}

function ItemHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-header"
      className={cn(
        "flex basis-full items-center justify-between gap-2",
        className
      )}
      {...props}
    />
  )
}

function ItemFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-footer"
      className={cn(
        "flex basis-full items-center justify-between gap-2",
        className
      )}
      {...props}
    />
  )
}

export {
  Item,
  ItemMedia,
  ItemContent,
  ItemActions,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
  ItemDescription,
  ItemHeader,
  ItemFooter,
}
