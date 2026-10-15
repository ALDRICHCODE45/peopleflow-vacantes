"use client";

import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export type ActionErrorReference = { status?: number; code?: string; at?: string };

export function ActionErrorAlert({ title, description, action, reference, id }: {
  title: string;
  description: string;
  action?: ReactNode;
  reference?: ActionErrorReference;
  id?: string;
}) {
  const date = reference?.at ? new Date(reference.at) : null;
  const time = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date)
    : undefined;
  const details = [reference?.status === undefined ? undefined : `HTTP ${reference.status}`, reference?.code, time].filter(Boolean).join(" · ");
  return (
    <Alert variant="destructive" id={id}>
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="col-start-2 flex min-w-0 flex-col items-start gap-3">
        <p>{description}</p>
        {action}
        {reference && <Accordion multiple={false}>
          <AccordionItem value="reference">
            <AccordionTrigger className="min-h-10">Detalles técnicos</AccordionTrigger>
            <AccordionContent><p className="break-words">{details}</p></AccordionContent>
          </AccordionItem>
        </Accordion>}
      </AlertDescription>
    </Alert>
  );
}
