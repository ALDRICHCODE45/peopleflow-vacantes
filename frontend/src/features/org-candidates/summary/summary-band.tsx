"use client";

import { useId } from "react";
import { BriefcaseBusiness, CircleAlert, RotateCcw, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import type { CandidatesSummary, CandidatesSummaryFailure } from "./summary-model";
import { accentIconTile } from "../accent";

export type SummaryBandProps = {
  data: CandidatesSummary | null;
  pending: boolean;
  failure: CandidatesSummaryFailure | null;
  onRetry: () => void;
};
const metrics = [
  { key: "total", label: "Total de candidatos", helper: "en tu organización", Icon: Users },
  { key: "with_active_process", label: "En procesos activos", helper: "con nuevas oportunidades", Icon: BriefcaseBusiness },
  { key: "added_last_7_days", label: "Agregados esta semana", helper: "tu red sigue creciendo", Icon: Sparkles },
] as const;
const number = new Intl.NumberFormat("es-MX");

export function SummaryBand({ data, pending, failure, onRetry }: SummaryBandProps) {
  const id = useId();
  return (
    <section className="flex min-w-0 flex-col gap-6" aria-label="Resumen de tu red de talento">
      <header className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-xs tracking-widest text-muted-foreground">
          <span className="size-1.5 rounded-xs bg-primary" aria-hidden="true" />
          TU RED DE TALENTO
        </p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-balance">Candidatos de mi organización</h1>
        <p className="max-w-prose text-sm text-muted-foreground">Cada persona, una posibilidad. Todo tu talento, en un solo lugar.</p>
      </header>
      {(data || pending) && (
        // Overview-only Card: the page heading labels the surface, so no redundant card header.
        <Card aria-label="Métricas de candidatos" aria-busy={pending}>
          {pending && <span className="sr-only" role="status">Cargando resumen</span>}
          <CardContent>
            <ItemGroup role="presentation" className="grid gap-0 divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
              {metrics.map(({ key, label, helper, Icon }) => (
                <Item key={key} role="group" aria-labelledby={`${id}-${key}`}>
                  <ItemMedia variant="icon" className={`size-11 rounded-xl ${accentIconTile}`} aria-hidden="true">
                    <Icon />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemDescription id={`${id}-${key}`}>{label}</ItemDescription>
                    <ItemTitle>
                      {data ? <strong className="text-3xl font-semibold tabular-nums">{number.format(data[key])}</strong> : <Skeleton aria-hidden="true" className="h-9 w-12" />}
                      <span className="text-xs font-normal text-muted-foreground">{helper}</span>
                    </ItemTitle>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </CardContent>
        </Card>
      )}
      {failure && !pending && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <p role="status" className="flex items-center gap-2">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            No pudimos cargar el resumen
          </p>
          <Button type="button" variant="ghost" onClick={onRetry}>
            <RotateCcw data-icon="inline-start" aria-hidden="true" />
            Reintentar
          </Button>
        </div>
      )}
    </section>
  );
}
