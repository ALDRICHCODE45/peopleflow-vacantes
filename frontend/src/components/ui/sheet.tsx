"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
    return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
    return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
    return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
    return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

/**
 * Edge presentation: the original full-bleed geometry, kept verbatim for
 * surfaces that own their own frame (the mobile navigation drawer). Height comes
 * from `h-full`, insets from the viewport edges and there is no clamp.
 */
const EDGE_PRESENTATION = cn(
    "shadow-xl",
    "data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t",
    "data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r",
    "data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l",
    "data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b",
    "data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
);

/**
 * Floating presentation (default): the panel keeps an 8px mobile / 16px
 * desktop inset. Opposing insets determine the side height, so `h-full` is gone,
 * and both axes clamp to the inset-adjusted dynamic viewport.
 *
 * Clamp caveat: the `max-w`/`max-h` clamp is a different property from a
 * consumer `w-full`/`h-full`, so it still constrains them. It does NOT beat the
 * `data-[side]:sm:max-w-sm` below: at >=40rem both are `max-width` on the same
 * element and the responsive default is emitted later, so it wins and the width
 * settles at 24rem, which fits any normal viewport. For the same reason a
 * consumer's own `sm:max-w-*` does not win (equal specificity, emitted earlier).
 * Below 40rem the clamp is the only `max-width` that applies.
 */
const FLOATING_PRESENTATION = cn(
    "overflow-hidden [--sheet-inset:0.5rem] md:[--sheet-inset:1rem] shadow-lg",
    "data-[side=bottom]:inset-x-(--sheet-inset) data-[side=bottom]:bottom-(--sheet-inset) data-[side=bottom]:h-auto data-[side=bottom]:rounded-2xl data-[side=bottom]:border data-[side=bottom]:border-border/60",
    "data-[side=left]:inset-y-(--sheet-inset) data-[side=left]:left-(--sheet-inset) data-[side=left]:h-auto data-[side=left]:w-3/4 data-[side=left]:rounded-2xl data-[side=left]:border data-[side=left]:border-border/60",
    "data-[side=right]:inset-y-(--sheet-inset) data-[side=right]:right-(--sheet-inset) data-[side=right]:h-auto data-[side=right]:w-3/4 data-[side=right]:rounded-2xl data-[side=right]:border data-[side=right]:border-border/60",
    "data-[side=top]:inset-x-(--sheet-inset) data-[side=top]:top-(--sheet-inset) data-[side=top]:h-auto data-[side=top]:rounded-2xl data-[side=top]:border data-[side=top]:border-border/60",
    "data-[side=bottom]:max-w-[calc(100dvw-2*var(--sheet-inset))] data-[side=bottom]:max-h-[calc(100dvh-2*var(--sheet-inset))]",
    "data-[side=left]:max-w-[calc(100dvw-2*var(--sheet-inset))] data-[side=left]:max-h-[calc(100dvh-2*var(--sheet-inset))]",
    "data-[side=right]:max-w-[calc(100dvw-2*var(--sheet-inset))] data-[side=right]:max-h-[calc(100dvh-2*var(--sheet-inset))]",
    "data-[side=top]:max-w-[calc(100dvw-2*var(--sheet-inset))] data-[side=top]:max-h-[calc(100dvh-2*var(--sheet-inset))]",
    "data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm",
);

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
    return (
        <SheetPrimitive.Backdrop
            data-slot="sheet-overlay"
            className={cn(
                "fixed inset-0 z-50 bg-black/30 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-backdrop-filter:backdrop-blur-sm",
                className,
            )}
            {...props}
        />
    );
}

function SheetContent({
    className,
    children,
    side = "right",
    presentation = "floating",
    showCloseButton = true,
    ...props
}: SheetPrimitive.Popup.Props & {
    side?: "top" | "right" | "bottom" | "left";
    /**
     * `floating` (default) insets the panel from the viewport edges; `edge`
     * keeps the original full-bleed geometry for surfaces that own the frame,
     * like the mobile navigation drawer.
     */
    presentation?: "floating" | "edge";
    showCloseButton?: boolean;
}) {
    return (
        <SheetPortal>
            <SheetOverlay />
            <SheetPrimitive.Popup
                data-slot="sheet-content"
                data-side={side}
                data-presentation={presentation}
                className={cn(
                    "fixed z-50 flex min-h-0 flex-col bg-popover bg-clip-padding text-sm text-popover-foreground transition duration-200 ease-in-out data-ending-style:opacity-0 data-starting-style:opacity-0",
                    "data-[side=bottom]:data-ending-style:translate-y-[2.5rem] data-[side=bottom]:data-starting-style:translate-y-[2.5rem] data-[side=left]:data-ending-style:translate-x-[-2.5rem] data-[side=left]:data-starting-style:translate-x-[-2.5rem] data-[side=right]:data-ending-style:translate-x-[2.5rem] data-[side=right]:data-starting-style:translate-x-[2.5rem] data-[side=top]:data-ending-style:translate-y-[-2.5rem] data-[side=top]:data-starting-style:translate-y-[-2.5rem]",
                    presentation === "edge"
                        ? EDGE_PRESENTATION
                        : FLOATING_PRESENTATION,
                    className,
                )}
                {...props}
            >
                {children}
                {showCloseButton && (
                    <SheetPrimitive.Close
                        data-slot="sheet-close"
                        render={
                            <Button
                                variant="ghost"
                                className="absolute top-4 right-4 bg-secondary"
                                size="icon-sm"
                            />
                        }
                    >
                        <XIcon />
                        <span className="sr-only">Close</span>
                    </SheetPrimitive.Close>
                )}
            </SheetPrimitive.Popup>
        </SheetPortal>
    );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sheet-header"
            className={cn("flex shrink-0 flex-col gap-1.5 p-6", className)}
            {...props}
        />
    );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sheet-footer"
            className={cn("mt-auto flex shrink-0 flex-col gap-2 p-6", className)}
            {...props}
        />
    );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
    return (
        <SheetPrimitive.Title
            data-slot="sheet-title"
            className={cn(
                "font-heading text-base font-medium text-foreground",
                className,
            )}
            {...props}
        />
    );
}

function SheetDescription({
    className,
    ...props
}: SheetPrimitive.Description.Props) {
    return (
        <SheetPrimitive.Description
            data-slot="sheet-description"
            className={cn("text-sm text-muted-foreground", className)}
            {...props}
        />
    );
}

export {
    Sheet,
    SheetTrigger,
    SheetClose,
    SheetContent,
    SheetHeader,
    SheetFooter,
    SheetTitle,
    SheetDescription,
};
