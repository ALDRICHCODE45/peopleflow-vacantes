"use client";
import { useState } from "react";
import { Check, Download, Info, ListChecks, Minus, Printer, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { initials, stageClass } from "@/features/pipeline-movement/pipeline-presentation";
import type { Board } from "@/features/pipeline-movement/model";
import { plural } from "@/features/employer-vacancies/plural";
import { ChecklistFitSummary } from "../board/ui";
import type { FitSummary } from "../evaluate";
import { downloadComparisonCsv } from "./csv";
import type { Comparison, StageNames } from "./model";
import "./print.css";

const total = (counts: FitSummary["required"]) => counts.met + counts.not_met + counts.unknown;
const labels = { met: "Cumple", not_met: "No cumple", unknown: "Sin evaluar" } as const;
const tones = { met: "bg-status-success/10 text-status-success", not_met: "bg-status-review/10 text-status-review", unknown: "text-muted-foreground" } as const;
function ResultSymbol({ result }: { result: keyof typeof labels }) {
  const Icon = result === "met" ? Check : result === "not_met" ? X : Minus;
  return <span className={`inline-flex size-7 items-center justify-center rounded-md ${tones[result]}`} aria-hidden="true">{result === "unknown" ? <span className="text-xl">·</span> : <Icon className="size-4" />}</span>;
}

/** Mirrors the identity cards and section anatomy, without inventing criterion counts while loading. */
export function ComparisonSkeleton({ count }: { count: number }) {
  const columns = Array.from({ length: Math.max(2, Math.min(5, count)) }, (_, i) => i);
  return <section aria-busy="true" aria-label="Cargando comparación" className="flex min-w-0 flex-col gap-6">
    <div aria-hidden="true" className="flex flex-col gap-3"><Skeleton className="h-7 w-60" /><Skeleton className="h-4 w-72" /><Skeleton className="h-10 w-52" /></div>
    <div className="comparison-summaries grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">{columns.map(i => <Card size="sm" key={i}><CardHeader><CardTitle><Skeleton className="h-10 w-40" /></CardTitle><CardDescription><Skeleton className="h-5 w-20" /></CardDescription></CardHeader><CardContent className="flex flex-col gap-3"><Skeleton className="h-4 w-full" /><Skeleton className="h-1.5 w-full" /></CardContent><CardFooter className="border-t"><Skeleton className="h-4 w-full" /></CardFooter></Card>)}</div>
    <Card aria-hidden="true"><CardHeader className="border-b"><CardTitle><Skeleton className="h-6 w-48" /></CardTitle><CardDescription><Skeleton className="h-4 w-40" /></CardDescription><CardAction><Skeleton className="h-10 w-36" /></CardAction></CardHeader><CardContent><Skeleton className="h-52 w-full" /></CardContent><CardFooter className="border-t"><Skeleton className="h-4 w-64" /></CardFooter></Card>
  </section>;
}

function EvidenceCell({ cell }: { cell: Comparison["groups"][number]["rows"][number]["cells"][number] }) {
  const name = `${labels[cell.result]}${cell.source ? ` · fuente: ${cell.source}` : ""}`;
  return <TableCell className="text-center">
    {/* A focusable read-only result, not an action. Tooltip supports pointer and keyboard. */}
    <Tooltip><TooltipTrigger render={<span tabIndex={0} aria-label={name} className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" />}><ResultSymbol result={cell.result} /></TooltipTrigger>
      <TooltipContent className="flex-col items-start"><span>{name}</span>{cell.note && <span className="whitespace-pre-wrap break-words">{cell.note}</span>}</TooltipContent>
    </Tooltip>
    <div className="comparison-print-evidence hidden text-xs"><p>{name}</p>{cell.note && <p className="whitespace-pre-wrap break-words">{cell.note}</p>}</div>
  </TableCell>;
}
function CriteriaSection({ group, candidates }: { group: Comparison["groups"][number]; candidates: Comparison["candidates"] }) {
  const [expanded, setExpanded] = useState(false);
  const sectionId = `comparison-${group.label}`;
  return <Card size="sm" role="region" aria-labelledby={`${sectionId}-title`} className="min-w-0">
    <CardHeader className="border-b">
      <CardTitle><h3 id={`${sectionId}-title`} className="flex items-center gap-3 font-semibold"><span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-foreground ring-1 ring-primary/40"><ListChecks className="size-4" aria-hidden="true" /></span>{group.label}</h3></CardTitle>
      <CardDescription className="text-xs">{plural(group.rows.length, "requisito para revisar", "requisitos para revisar")}</CardDescription>
      <CardAction data-comparison-controls><Button type="button" variant="outline" className="min-h-10" aria-expanded={expanded} aria-controls={sectionId} onClick={() => setExpanded(value => !value)}>{expanded ? "Contraer textos" : "Expandir textos"}</Button></CardAction>
    </CardHeader>
    <CardContent>
      <ScrollArea className="w-full min-w-0 pb-3 [&_[data-slot=table-container]]:overflow-visible" aria-label={`Comparación de ${group.label.toLowerCase()}`}>
        <Table id={sectionId} className="comparison-table min-w-full table-fixed" style={{ width: 320 + candidates.length * 176 }}>
          <TableCaption className="sr-only">Comparación de candidatos por criterio · {group.label}</TableCaption>
          <TableHeader><TableRow><TableHead scope="col" className="criterion-column sticky left-0 z-10 w-44 bg-card sm:w-80">Criterio</TableHead>{candidates.map(candidate => <TableHead scope="col" key={candidate.id} className="w-44 whitespace-normal text-center text-xs">{candidate.name}</TableHead>)}</TableRow></TableHeader>
          <TableBody>{group.rows.map(row => <TableRow key={row.id}>
            <TableHead scope="row" className="criterion-column sticky left-0 z-10 bg-card"><span title={row.label} className={`comparison-criterion whitespace-normal break-words text-xs font-normal ${expanded ? "" : "line-clamp-2"}`}>{row.label}</span></TableHead>
            {row.cells.map((cell, index) => <EvidenceCell key={candidates[index].id} cell={cell} />)}
          </TableRow>)}</TableBody>
        </Table><ScrollBar orientation="horizontal" />
      </ScrollArea>
    </CardContent>
    <CardFooter className="border-t text-xs text-muted-foreground print:hidden">Enfoca un resultado o pasa el puntero para ver la fuente y las notas.</CardFooter>
  </Card>;
}

export function ComparisonReport({ model, title, company = "", date, stages, stageKinds = {} }: { model: Comparison; title: string; company?: string; date: string; stages: StageNames; stageKinds?: Readonly<Record<string, string>> }) {
  return <section data-comparison-report aria-label="Reporte de terna" className="flex min-w-0 flex-col gap-6">
    <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
      <div className="flex flex-col gap-1"><h1 className="text-xl font-semibold">Comparar candidatos</h1><p className="text-sm text-muted-foreground">{title}{company && <> · {company}</>}</p></div>
      <div className="flex flex-col gap-2 sm:flex-row" data-comparison-controls>
        <Button type="button" className="min-h-10" onClick={() => window.print()}><Printer aria-hidden="true" data-icon="inline-start" />Imprimir / Guardar PDF</Button>
        <Button type="button" variant="outline" className="min-h-10" onClick={() => downloadComparisonCsv(model, title, company, date, stages)}><Download aria-hidden="true" data-icon="inline-start" />Descargar CSV</Button>
      </div>
    </div>
    <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="size-4 shrink-0 text-status-info" aria-hidden="true" />El checklist informa; no descarta ni mueve candidatos.</p>
    <div className="flex flex-col justify-between gap-2 text-xs text-muted-foreground sm:flex-row"><p>Ordenados por mejor ajuste del checklist · No incluye psicometría</p><p>{date} · {plural(model.candidates.length, "candidato", "candidatos")}</p></div>
    <section aria-label="Resumen por candidato" className={`comparison-summaries grid gap-4 sm:grid-cols-2 ${model.candidates.length > 4 ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
      {model.candidates.map(candidate => <Card size="sm" role="article" key={candidate.id} className="min-w-0">
        <CardHeader>
          <CardTitle><h2 className="flex items-start gap-3 text-sm font-medium"><Avatar className="size-8 shrink-0" aria-hidden="true"><AvatarFallback>{initials(candidate.name)}</AvatarFallback></Avatar><span className="min-h-10 break-words">{candidate.name}</span></h2></CardTitle>
          <CardDescription><Badge variant="neutral" dot className={`stage-badge ${stageClass((stageKinds[candidate.stageId] ?? "custom") as Board["stages"][number]["kind"] | "discarded")}`}>{stages[candidate.stageId] ?? "Etapa no disponible"}</Badge></CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3"><ChecklistFitSummary fit={candidate.summary} /><p className="text-xs text-muted-foreground tabular-nums">Obligatorios {candidate.summary.required.met}/{total(candidate.summary.required)} · Deseables {candidate.summary.desirable.met}/{total(candidate.summary.desirable)}</p></CardContent>
        <CardFooter className="border-t text-xs text-muted-foreground">{candidate.summary.required.unknown + candidate.summary.desirable.unknown} sin evaluar · No equivale a no cumplir</CardFooter>
      </Card>)}
    </section>
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><h2 className="text-base font-semibold">Evidencia, criterio por criterio</h2><div role="group" aria-label="Leyenda" className="flex flex-wrap gap-4 text-xs">{(["met", "not_met", "unknown"] as const).map(result => <span key={result} className="inline-flex items-center gap-1"><ResultSymbol result={result} />{labels[result]}</span>)}</div></div>
    {model.groups.map(group => <CriteriaSection key={group.label} group={group} candidates={model.candidates} />)}
    <p className="text-xs text-muted-foreground">Generado con PeopleFlow</p>
  </section>;
}
