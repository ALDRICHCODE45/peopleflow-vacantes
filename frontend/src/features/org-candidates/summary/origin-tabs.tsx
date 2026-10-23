"use client";

import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type OriginTabsProps = {
  value: "all" | "manual";
  onValueChange: (value: "all" | "manual") => void;
  counts?: { all: number; manual: number };
};
const number = new Intl.NumberFormat("es-MX");

/** Filter tabs only: the existing list owns its content outside this controlled tab rail. */
export function OriginTabs({ value, onValueChange, counts }: OriginTabsProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
      <Tabs value={value} onValueChange={next => {
        if (next === "all" || next === "manual") onValueChange(next);
      }} className="min-w-0 max-w-full overflow-x-auto px-1 pb-2">
        <TabsList variant="line" aria-label="Origen de los candidatos">
          <TabsTrigger value="all">
            Todos los candidatos
            {counts && <Badge variant="secondary" className="tabular-nums">{number.format(counts.all)}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="manual">
            Agregados por mi equipo
            {counts && <Badge variant="secondary" className="tabular-nums">{number.format(counts.manual)}</Badge>}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" aria-hidden="true" />
        Solo tu organización
      </p>
    </div>
  );
}
