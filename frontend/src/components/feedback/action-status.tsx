import type { ReactNode } from "react";
import { CircleCheck, CircleAlert, TriangleAlert, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const tones = {
  success: { icon: CircleCheck, color: "text-status-success" },
  error: { icon: CircleAlert, color: "text-status-danger" },
  warning: { icon: TriangleAlert, color: "text-status-review" },
  info: { icon: Info, color: "text-status-info" },
};

export function ActionStatus({ id, tone, text, action }: {
  id: string;
  tone: keyof typeof tones;
  text: string;
  action?: ReactNode;
}) {
  const Icon = tones[tone].icon;
  return (
    <div id={id} role="status" className={cn("flex flex-wrap items-center gap-2 text-sm", tones[tone].color)}>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span>{text}</span>
      {action}
    </div>
  );
}
