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

// Approved PeopleFlow isotypes (500x500, transparent corners) copied to
// public/brand: Logo_small_Light for the light theme, Logo_smal_Dark for the dark one.
const BRAND_ISOTYPES = [
  { src: "/brand/peopleflow-mark-light.png", schemeClass: "brand-mark-light" },
  { src: "/brand/peopleflow-mark-dark.png", schemeClass: "brand-mark-dark" },
] as const;

/** Compact identity for the collapsed rail: one accessible image, one isotype per scheme. */
export function PeopleFlowMark({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      role="img"
      aria-label="PeopleFlow"
      data-brand="mark"
      className={cn("flex size-10 shrink-0 items-center justify-center", className)}
      {...props}
    >
      {BRAND_ISOTYPES.map(({ src, schemeClass }) => (
        <Image key={src} src={src} alt="" width={500} height={500} className={cn("size-8", schemeClass)} />
      ))}
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
