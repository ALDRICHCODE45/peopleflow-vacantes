import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shared section surface of the create-vacancy form, rendered by every section.
 * It stays content-height (`h-fit` with `items-start` on the grid) so a short
 * section never stretches into blank space beside a taller neighbour.
 */
export type FormSectionCardProps = {
  icon: LucideIcon;
  title: string;
  /** Stable in-page anchor, taken from the section metadata. */
  id?: string;
  className?: string;
  children: ReactNode;
};

export function FormSectionCard({
  icon: Icon,
  title,
  id,
  className,
  children,
}: FormSectionCardProps) {
  return (
    <Card
      id={id}
      data-pf-section-card=""
      size="sm"
      className={cn("h-fit scroll-mt-24", className)}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary"
          >
            <Icon className="size-4" />
          </span>
          {/* Focus destination of the section navigator, never a tab stop. */}
          <h2 tabIndex={-1} className="font-heading text-base font-medium">
            {title}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
