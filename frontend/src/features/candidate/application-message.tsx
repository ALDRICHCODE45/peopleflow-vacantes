"use client"

import * as React from "react"
import { Mail } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

/** Real message display contract; no dependency on prototype fixtures. */
export type CandidateApplicationMessage = Readonly<{ applicationId: string; sender: string; subject: string; body: readonly string[]; sentAt: string }>

/** Deterministic Mexico Spanish date, matching the overview's UTC convention. */
const DATE_FORMAT = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

/**
 * Candidate-only message island for one recent application row. It owns local
 * unread state by default: opening clears the notice for this mount. A real-data
 * caller can own read acknowledgment via onOpen and showUnread. This component
 * itself reaches no transport, router, storage or backend.
 */
/** Defaults preserve local unread dismissal. With onOpen, the caller owns the
 * persisted read state: the badge stays until showUnread changes after confirmation. */
export function ApplicationMessage({ message, showUnread = true, triggerLabel = "Ver mensaje", onOpen }: Readonly<{
  // The applications list has no message timestamp. Omit it rather than
  // presenting the application date as the time a company sent its message.
  message: Omit<CandidateApplicationMessage, "sentAt"> & { sentAt?: string }
  showUnread?: boolean
  triggerLabel?: string
  onOpen?: () => void
}>) {
  const [opened, setOpened] = React.useState(false)

  return (
    <div data-pf-application-message={message.applicationId} className="flex flex-wrap items-center gap-2 pt-1">
      {!showUnread || (!onOpen && opened) ? null : <Badge variant="accent" dot>Nuevo mensaje</Badge>}
      <Dialog onOpenChange={(open) => { if (open) { setOpened(true); onOpen?.(); } }}>
        <DialogTrigger render={<Button variant="outline" size="sm" className="min-h-10" />}>
          <Mail aria-hidden="true" data-icon="inline-start" />
          {triggerLabel}
        </DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{message.subject}</DialogTitle>
            <DialogDescription>
              {message.sender}{message.sentAt && <> · <time dateTime={message.sentAt}>{DATE_FORMAT.format(new Date(message.sentAt))}</time></>}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-sm text-pretty text-foreground">
            {message.body.map((paragraph) => (<p key={paragraph}>{paragraph}</p>))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
