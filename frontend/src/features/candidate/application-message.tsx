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

import type { CandidateApplicationMessage } from "./prototype-messages"

/** The dashboard overview consumes the message contract through this island. */
export type { CandidateApplicationMessage } from "./prototype-messages"

/** Deterministic Mexico Spanish date, matching the overview's UTC convention. */
const DATE_FORMAT = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

/**
 * Candidate-only message island for one recent application row. It owns local
 * unread state for this mount only: opening the dialog clears the `Nuevo mensaje`
 * notice, and `Ver mensaje` stays to reread. It reaches no transport, router,
 * storage, backend or persistence, so nothing outside this component changes.
 */
export function ApplicationMessage({ message }: Readonly<{ message: CandidateApplicationMessage }>) {
  const [opened, setOpened] = React.useState(false)

  return (
    <div data-pf-application-message={message.applicationId} className="flex flex-wrap items-center gap-2 pt-1">
      {opened ? null : <Badge variant="accent" dot>Nuevo mensaje</Badge>}
      <Dialog onOpenChange={(open) => { if (open) setOpened(true) }}>
        <DialogTrigger render={<Button variant="outline" size="sm" className="min-h-10" />}>
          <Mail aria-hidden="true" data-icon="inline-start" />
          Ver mensaje
        </DialogTrigger>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{message.subject}</DialogTitle>
            <DialogDescription>
              {message.sender} · <time dateTime={message.sentAt}>{DATE_FORMAT.format(new Date(message.sentAt))}</time>
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
