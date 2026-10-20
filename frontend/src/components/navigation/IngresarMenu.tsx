"use client";

import Link from "next/link";
import { ChevronDownIcon, UserRoundIcon } from "lucide-react";
import { IdentitySessionProvider, useIdentity } from "@/features/identity/identity-session";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "cn";

export type IngresarMenuProps = {
  /** Trigger-only styling hook so PublicShell and marketing fit their tokens. */
  className?: string;
};

/**
 * Shared dual-login entry point.
 *
 * The trigger is a real Button, and Base UI owns `aria-haspopup`, the expanded
 * state, keyboard/typeahead, Escape and focus return, so this component adds no
 * menu behavior of its own. Both destinations are Next Links rendered through
 * the shared menu item primitive, keeping navigation declarative. The popup
 * stays on semantic `popover`/`accent` tokens with 40px touch targets, and its
 * label plus both items share one `DropdownMenuGroup`, because Base UI group
 * parts throw outside a group.
 */
export function IngresarMenu({ className }: IngresarMenuProps) {
  return (
    <IdentitySessionProvider>
      <IdentityMenu className={className} />
    </IdentitySessionProvider>
  );
}

function IdentityMenu({ className }: IngresarMenuProps) {
  const { status, result } = useIdentity();
  const role = status === "ready" && result?.ok ? result.data.role : null;
  const href = role === "candidate" ? "/candidato/dashboard"
    : role === "recruiter" ? "/empresa/dashboard" : null;

  if (href) {
    // Match CandidateAuthControls: explicitly retain link semantics on Base UI's Button.
    return (
      <Button
        nativeButton={false}
        role="link"
        variant="ghost"
        render={<Link href={href} />}
        className={cn("min-h-10 gap-1.5 px-3 max-sm:min-w-10 max-sm:px-0", className)}
      >
        <span className="max-sm:sr-only">Mi cuenta</span>
        <UserRoundIcon aria-hidden="true" className="opacity-60" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" className={cn("min-h-10 gap-1.5 px-3 max-sm:min-w-10 max-sm:px-0", className)} />}
      >
        {/* Below sm the trigger collapses to its 40px icon target so the public
            header keeps brand, theme control, and the unchanged publish CTA
            inside 375px; the label still carries the accessible name. */}
        <span className="max-sm:sr-only">Ingresar</span>
        <ChevronDownIcon aria-hidden="true" className="size-4 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="min-w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Ingresar como</DropdownMenuLabel>
          <DropdownMenuItem className="min-h-10" render={<Link href="/candidato/login" />}>
            Candidato
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-10" render={<Link href="/empresa/login" />}>
            Empresa
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
