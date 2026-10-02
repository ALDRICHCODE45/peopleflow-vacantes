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
