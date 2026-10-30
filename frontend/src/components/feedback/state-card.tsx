import type { ComponentType, ReactNode, SVGProps } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export type StateCardAction = {
  label: ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  "aria-describedby"?: string;
};

type StateCardProps = {
  /** Any icon component (lucide, or Tabler inside the company dashboard block). */
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone: "error" | "forbidden" | "empty" | "info";
  title: ReactNode;
  description: ReactNode;
  primaryAction?: StateCardAction;
  secondaryAction?: StateCardAction;
  alternativeLink?: StateCardAction;
  header?: ReactNode;
  /** Existing composite actions/statuses retain their own feedback and pending behavior. */
  children?: ReactNode;
  role?: "status" | "alert";
  /** 2 inside a page; 1 when the card IS the page (route error/not-found boundaries). */
  headingLevel?: 1 | 2;
  className?: string;
};

function Action({ action, variant = "default" }: { action: StateCardAction; variant?: "default" | "outline" | "link" }) {
  const { label, href, ...props } = action;
  return <Button {...props} type={href ? undefined : "button"} variant={variant}
    nativeButton={href ? false : undefined} role={href ? "link" : undefined}
    render={href ? <Link href={href} /> : undefined}
    className="h-auto min-h-10 w-full whitespace-normal sm:w-auto">{label}</Button>;
}

const iconTone = (tone: StateCardProps["tone"]) => cn(
  (tone === "error" || tone === "forbidden") && "bg-destructive/10 text-destructive",
  tone === "empty" && "bg-muted",
  tone === "info" && "bg-primary/10",
);

type SectionEmptyProps = Pick<StateCardProps, "icon" | "title" | "description" | "primaryAction" | "secondaryAction" | "role" | "className"> & {
  tone: "empty" | "info";
  /** 3 inside a card section by default; 2 when the section heading is the page's own. */
  headingLevel?: 2 | 3 | 4;
};

/**
 * The same empty-demo anatomy for a card, tab, sheet section or detail panel that already sits
 * inside a Card (design/system.md «Empty states», variants «In a card», «No results», «Nothing selected»).
 * No nested Card; smaller title; no live region unless the caller opts in.
 */
export function SectionEmpty({ icon: Icon, tone, title, description, primaryAction, secondaryAction, role, headingLevel = 3, className }: SectionEmptyProps) {
  return <Empty role={role} className={cn("gap-4 p-0 py-8", className)}>
    <EmptyHeader className="max-w-md">
      <EmptyMedia variant="icon" className={iconTone(tone)}><Icon aria-hidden="true" /></EmptyMedia>
      <EmptyTitle role="heading" aria-level={headingLevel} className="text-base font-semibold">{title}</EmptyTitle>
      <EmptyDescription>{description}</EmptyDescription>
    </EmptyHeader>
    {(primaryAction || secondaryAction) && <EmptyContent className="max-w-md">
      <div className="flex w-full flex-col justify-center gap-2 sm:flex-row">
        {primaryAction && <Action action={primaryAction} />}
        {secondaryAction && <Action action={secondaryAction} variant="outline" />}
      </div>
    </EmptyContent>}
  </Empty>;
}

/**
 * empty-demo inside the draft pipeline's CardContent, with its max-w-md reading width.
 * Empty owns the title and actions (rather than duplicating them in CardHeader/Footer).
 * Optional CardHeader is reserved for a state badge. No live region is added implicitly.
 */
export function StateCard({ icon: Icon, tone, title, description, primaryAction, secondaryAction, alternativeLink, header, children, role, headingLevel = 2, className, ...props }: StateCardProps) {
  return <Card {...props} role={role} className={cn("mx-auto w-full", className)}>
    {header && <CardHeader className="border-b"><CardTitle>{header}</CardTitle></CardHeader>}
    <CardContent>
      <Empty className="py-10">
        <EmptyHeader className="max-w-md">
          <EmptyMedia variant="icon" className={iconTone(tone)}><Icon aria-hidden="true" /></EmptyMedia>
          <EmptyTitle role="heading" aria-level={headingLevel} className="text-xl font-semibold">{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        {(primaryAction || secondaryAction || children) && <EmptyContent className="max-w-md">
          {(primaryAction || secondaryAction) && <div className="flex w-full flex-col justify-center gap-2 sm:flex-row">
            {primaryAction && <Action action={primaryAction} />}
            {secondaryAction && <Action action={secondaryAction} variant="outline" />}
          </div>}
          {children}
        </EmptyContent>}
        {alternativeLink && <Action action={alternativeLink} variant="link" />}
      </Empty>
    </CardContent>
  </Card>;
}
