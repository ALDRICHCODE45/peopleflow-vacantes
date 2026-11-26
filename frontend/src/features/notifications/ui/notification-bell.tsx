"use client";
import { useRef, useState } from "react";
import { Bell, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";
import { bellBadge, bellLabel } from "../copy";
import type { NotificationScope } from "../model";
import { useUnreadCount } from "../use-unread-count";
import { NotificationInbox } from "./notification-inbox";
import { NotificationScopeContext } from "./scope";

/**
 * Header bell (T3.2; candidate header T3.6): unread groups as a «9+»-capped badge, polled by `useUnreadCount`. Opens
 * the inbox sheet (T3.3), which is mounted only while open, so every opening reads the inbox fresh and hands its
 * `unread_count` back to the bell. Closing returns focus to the bell. `scope` picks the company (default) or the
 * candidate inbox for everything below it.
 */
export function NotificationBell({ scope = "company" }: { scope?: NotificationScope }) {
  const { unread, set } = useUnreadCount(scope);
  const [open, setOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  const badge = bellBadge(unread);

  return <Sheet open={open} onOpenChange={setOpen}>
    {/* Same 40x40 outline icon target as the header's theme control. */}
    <Button ref={bellRef} type="button" variant="outline" size="icon" className="relative size-10"
      aria-label={bellLabel(unread)} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <Bell aria-hidden="true" />
      {badge && <span aria-hidden="true" data-notification-count=""
        className="absolute -top-1.5 -right-1.5 h-[18px] min-w-[18px] rounded-full bg-primary px-[5px] text-center text-[11px] leading-[18px] font-semibold text-primary-foreground tabular-nums ring-2 ring-background">{badge}</span>}
    </Button>
    <SheetContent side="right" showCloseButton={false} finalFocus={bellRef}
      className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[448px] max-sm:[--sheet-inset:0px] max-sm:data-[side=right]:rounded-none max-sm:data-[side=right]:border-0">
      <NotificationScopeContext.Provider value={scope}>
        <NotificationInbox knownUnread={unread} onUnreadCount={set} onNavigate={() => setOpen(false)} />
      </NotificationScopeContext.Provider>
      <SheetClose render={<Button type="button" variant="ghost" size="icon" className="absolute top-4 right-4 size-10 rounded-full bg-secondary max-sm:top-2.5 max-sm:right-2.5" aria-label="Cerrar" />}>
        <XIcon aria-hidden="true" />
      </SheetClose>
    </SheetContent>
  </Sheet>;
}
