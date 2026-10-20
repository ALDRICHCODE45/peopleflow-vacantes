import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
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
  icon: LucideIcon;
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
          <EmptyMedia variant="icon" className={cn(
            (tone === "error" || tone === "forbidden") && "bg-destructive/10 text-destructive",
            tone === "empty" && "bg-muted",
            tone === "info" && "bg-primary/10",
          )}><Icon aria-hidden="true" /></EmptyMedia>
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
