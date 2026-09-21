"use client";

import Link from "next/link";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
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
 * stays on semantic `popover`/`accent` tokens with 40px touch targets.
 */
export function IngresarMenu({ className }: IngresarMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" className={cn("min-h-10 gap-1.5 px-3", className)} />}
      >
        Ingresar
        <ChevronDownIcon aria-hidden="true" className="size-4 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="bottom" className="min-w-44">
        <DropdownMenuLabel>Ingresar como</DropdownMenuLabel>
        <DropdownMenuItem className="min-h-10" render={<Link href="/candidato/login" />}>
          Candidato
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-10" render={<Link href="/empresa/login" />}>
          Empresa
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
