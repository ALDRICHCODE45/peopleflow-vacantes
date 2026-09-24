import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/** Shared semantic tone: the token paints the label and the border, and a
    low-opacity layer of the same token paints the soft fill. The `--status-*`
    values already flip per theme, so no manual `dark:` recipe is needed.
    `accent` labels with `text-foreground` instead of `text-primary` because
    `--primary` is not tuned to foreground strength in the dark theme, while
    `--status-*` is. */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "border-status-danger/40 bg-status-danger/10 text-status-danger focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-status-danger/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        accent:
          "border-primary/40 bg-primary/12 text-foreground [a]:hover:bg-primary/20",
        info: "border-status-info/40 bg-status-info/10 text-status-info [a]:hover:bg-status-info/20",
        review:
          "border-status-review/40 bg-status-review/10 text-status-review [a]:hover:bg-status-review/20",
        success:
          "border-status-success/40 bg-status-success/10 text-status-success [a]:hover:bg-status-success/20",
        danger:
          "border-status-danger/40 bg-status-danger/10 text-status-danger [a]:hover:bg-status-danger/20",
        neutral:
          "border-border bg-muted text-muted-foreground [a]:hover:bg-muted/80 [a]:hover:text-foreground",
      },
      /** Opt-in decorative leading dot: one `::before` flex item painted with
          `currentColor`, so composition through `render` and the child
          structure stay untouched and the dot follows the variant text token. */
      dot: {
        true: "before:size-1.5 before:shrink-0 before:rounded-full before:bg-current before:content-['']",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export type BadgeVariant = NonNullable<
  VariantProps<typeof badgeVariants>["variant"]
>

function Badge({
  className,
  variant = "default",
  dot = false,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, dot }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
      /* Boolean state becomes `data-dot=""` only when the dot is opted in. */
      dot,
    },
  })
}

export { Badge, badgeVariants }
