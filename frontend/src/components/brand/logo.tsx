import * as React from "react";
import Image from "next/image";
import { cn } from "../../lib/utils";

// Approved PeopleFlow wordmarks (1584x396) copied to public/brand.
const BRAND_MARKS = [
  {
    src: "/brand/peopleflow-light.webp",
    schemeClass: "brand-mark-light",
    priority: true,
  },
  {
    src: "/brand/peopleflow-dark.webp",
    schemeClass: "brand-mark-dark",
    priority: false,
  },
] as const;

/** Provisional compact identity; replace this tile with the approved isotype later. */
export function PeopleFlowMark({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      role="img"
      aria-label="PeopleFlow"
      data-brand="mark"
      className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary font-sans text-lg font-semibold text-primary-foreground", className)}
      {...props}
    >
      P
    </span>
  );
}

/** Fixed-size layers crossfade without ever scaling the wordmark into the rail. */
export function PeopleFlowSidebarLogo({ collapsed }: { collapsed: boolean }) {
  const transition = "transition-[opacity,visibility] duration-200 ease-linear motion-reduce:transition-none";
  return (
    <span className="relative flex size-full items-center">
      <span
        data-brand="wordmark"
        aria-hidden={collapsed}
        className={cn("flex shrink-0 items-center", transition, collapsed && "invisible opacity-0")}
      >
        <PeopleFlowLogo className="h-5 w-auto max-w-none" />
      </span>
      <PeopleFlowMark
        aria-hidden={!collapsed}
        className={cn("absolute inset-0 m-auto", transition, !collapsed && "invisible opacity-0")}
      />
    </span>
  );
}

export function PeopleFlowLogo({ className }: { className?: string }) {
  return (
    <>
      {BRAND_MARKS.map(({ src, schemeClass, priority }) => (
        <Image
          key={src}
          src={src}
          alt="PeopleFlow"
          width={1584}
          height={396}
          priority={priority}
          className={cn("h-8 w-auto", schemeClass, className)}
        />
      ))}
    </>
  );
}
