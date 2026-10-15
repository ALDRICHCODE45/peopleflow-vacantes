"use client";

import { createElement } from "react";
import { CircleCheck, CircleAlert, TriangleAlert, Info } from "lucide-react";
import { sileo } from "sileo";

export type ActionResultOptions = {
  key: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  description?: string;
  reference?: { status?: number; code?: string; at?: string };
  action?: { title: string; onClick: () => void };
};

const toasts = new Map<string, string>();
const icons = { success: CircleCheck, error: CircleAlert, warning: TriangleAlert, info: Info };
const timeFormat = new Intl.DateTimeFormat("es-MX", {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export function dismissActionResult(key: string) {
  const previous = toasts.get(key);
  if (previous !== undefined) sileo.dismiss(previous);
  toasts.delete(key);
}

export function notifyActionResult({ key, type, title, description, reference, action }: ActionResultOptions) {
  dismissActionResult(key);
  const date = reference?.at ? new Date(reference.at) : null;
  const time = date && !Number.isNaN(date.getTime()) ? timeFormat.format(date) : undefined;
  const details = type === "error" ? [
    reference?.status === undefined ? undefined : `HTTP ${reference.status}`,
    reference?.code,
    time,
  ].filter(Boolean).join(" · ") : "";
  const content = details ? createElement("div", { className: "flex flex-col gap-2" },
    description ? createElement("p", null, description) : null,
    createElement("p", { className: "text-xs text-muted-foreground" }, details),
  ) : description;
  const id = sileo[type]({
    title,
    description: content,
    icon: createElement(icons[type], { "aria-hidden": true }),
    ...(action ? { button: action } : {}),
    ...(type === "error" ? { duration: null } : {}),
  });
  toasts.set(key, id);
}
