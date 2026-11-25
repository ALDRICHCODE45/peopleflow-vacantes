"use client";

import { useState, type ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export const PROPERTY_GROUPS_KEY = "peopleflow.careers-editor.property-groups.v1";
export type PropertyGroupId = "layout" | "style" | "content" | "buttons";
export type PropertyGroup = { id: PropertyGroupId; title: string; content: ReactNode };
const GROUP_IDS: readonly PropertyGroupId[] = ["layout", "style", "content", "buttons"];

/** Only which groups are closed is stored, never site content. Every group starts open. */
export function readClosedGroups(): PropertyGroupId[] {
  try {
    const value = JSON.parse(localStorage.getItem(PROPERTY_GROUPS_KEY) ?? "null");
    return value?.v === 1 && Array.isArray(value.closed) ? GROUP_IDS.filter(id => value.closed.includes(id)) : [];
  } catch { return []; }
}
function saveClosedGroups(closed: PropertyGroupId[]) {
  try { localStorage.setItem(PROPERTY_GROUPS_KEY, JSON.stringify({ v: 1, closed })); } catch { /* Storage may be disabled; groups still toggle. */ }
}

/**
 * The properties panel as collapsible groups (L3): a narrow panel stays usable by
 * folding what isn't being edited. The open/closed choice is the person's, shared
 * by every section and remembered across sessions; a group a section lacks (Botones
 * outside Portada) keeps its remembered state.
 */
export function PropertyGroups({ groups }: { groups: PropertyGroup[] }) {
  const [closed, setClosed] = useState(readClosedGroups);
  const open = groups.map(group => group.id).filter(id => !closed.includes(id));
  return <Accordion multiple value={open} data-property-groups="" className="min-w-0" onValueChange={values => {
    const shown = groups.map(group => group.id);
    const next = GROUP_IDS.filter(id => shown.includes(id) ? !(values as string[]).includes(id) : closed.includes(id));
    setClosed(next); saveClosedGroups(next);
  }}>
    {groups.map(group => <AccordionItem key={group.id} value={group.id} data-property-group={group.id} className="min-w-0">
      <AccordionTrigger>{group.title}</AccordionTrigger>
      <AccordionContent className="flex min-w-0 flex-col gap-6 [&_p:not(:last-child)]:mb-0">{group.content}</AccordionContent>
    </AccordionItem>)}
  </Accordion>;
}
