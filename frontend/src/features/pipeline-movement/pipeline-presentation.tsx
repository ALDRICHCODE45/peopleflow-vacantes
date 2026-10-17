import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Board } from "./model";

export function Hint({ text, children }: { text: string; children: ReactElement<{ id?: string }> }) {
  return <Tooltip><TooltipTrigger id={children.props.id} render={children} /><TooltipContent>{text}</TooltipContent></Tooltip>;
}
export function initials(name: string) {
  return name.trim().split(/\s+/u).slice(0, 2).map(part => Array.from(part)[0]).join("");
}
export function stageClass(kind: Board["stages"][number]["kind"] | "discarded") {
  return { new: "stage-neutral", custom: "stage-neutral", screening: "stage-info", screening_ok: "stage-review", in_process: "stage-process", placement: "stage-success", discarded: "stage-danger" }[kind];
}
export function filePresentation(name: string) {
  return name.toLowerCase().endsWith(".pdf") ? "pdf" : "word";
}
