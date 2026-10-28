"use client";
import { Fragment } from "react";
import { Check, CircleHelp, Download, Printer, X } from "lucide-react";
import { TruncatedText } from "@/components/data-table/truncated-text";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fitLine } from "../board/fit";
import { resultLabel } from "../evaluate";
import { downloadComparisonCsv } from "./csv";
import type { Comparison, StageNames } from "./model";
import "./print.css";

/** Same Card/Table/ScrollArea anatomy while the criteria and identities are being read. */
export function ComparisonSkeleton({ count }: { count: number }) {
  const columns = Array.from({ length: Math.max(2, Math.min(5, count)) }, (_, i) => i);
  return <section aria-busy="true" aria-label="Cargando comparación" className="flex min-w-0 flex-col gap-4">
    <div className="flex gap-2" aria-hidden="true"><Skeleton className="h-10 w-52" /><Skeleton className="h-10 w-36" /></div>
    <Card aria-hidden="true" className="min-w-0">
      <CardHeader className="border-b"><CardTitle><Skeleton className="h-7 w-64" /></CardTitle><CardDescription><Skeleton className="h-10 w-72" /></CardDescription></CardHeader>
      <CardContent><ScrollArea className="w-full pb-3 [&_[data-slot=table-container]]:overflow-visible">
        <Table className="min-w-full table-fixed" style={{ width: 208 + columns.length * 288 }}><TableCaption><Skeleton className="h-4 w-64" /></TableCaption>
          <TableHeader><TableRow><TableHead className="w-52"><Skeleton className="h-5 w-28" /></TableHead>{columns.map(i => <TableHead key={i} className="w-72"><Skeleton className="h-10 w-64" /></TableHead>)}</TableRow></TableHeader>
          <TableBody>{[0, 1, 2].map(row => <TableRow key={row}><TableHead><Skeleton className="h-5 w-36" /></TableHead>{columns.map(i => <TableCell key={i}><Skeleton className="h-10 w-64" /></TableCell>)}</TableRow>)}</TableBody>
        </Table><ScrollBar orientation="horizontal" />
      </ScrollArea></CardContent>
      <CardFooter className="border-t"><Skeleton className="h-4 w-40" /></CardFooter>
    </Card>
  </section>;
}

export function ComparisonReport({ model, title, company = "", date, stages }: { model: Comparison; title: string; company?: string; date: string; stages: StageNames }) {
  return <>
    <div className="flex flex-col gap-2 sm:flex-row" data-comparison-controls>
      <Button type="button" className="min-h-10" onClick={() => window.print()}><Printer aria-hidden="true" data-icon="inline-start" />Imprimir / Guardar PDF</Button>
      <Button type="button" variant="outline" className="min-h-10" onClick={() => downloadComparisonCsv(model, title, company, date, stages)}><Download aria-hidden="true" data-icon="inline-start" />Descargar CSV</Button>
    </div>
    <Card data-comparison-report aria-label="Reporte de terna" className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle><h2 className="text-xl font-semibold">Comparación · {title}</h2></CardTitle>
        <CardDescription>{company && <>{company} · </>}{date}<br />Ordenados por mejor ajuste. El checklist informa; no descarta ni mueve candidatos.</CardDescription>
      </CardHeader>
      <CardContent>
      {/* Basic Table composition; ScrollArea owns scrolling, so the native Table wrapper is unscrolled. */}
      <ScrollArea className="w-full min-w-0 pb-3 [&_[data-slot=table-container]]:overflow-visible" aria-label="Comparación de candidatos">
        <Table className="comparison-table min-w-full table-fixed" style={{ width: 208 + model.candidates.length * 288 }}>
          <TableCaption>Comparación de candidatos por criterio · {title}</TableCaption>
          <TableHeader><TableRow>
            <TableHead scope="col" className="criterion-column sticky left-0 z-10 w-52 bg-background">Criterio</TableHead>
            {model.candidates.map(candidate => <TableHead scope="col" key={candidate.id} className="w-72 py-3">
              <TruncatedText text={candidate.name} className="text-sm font-semibold" />
              <TruncatedText text={`${stages[candidate.stageId] ?? "Etapa no disponible"} · ${fitLine(candidate.summary)}`} className="text-xs font-normal text-muted-foreground" />
            </TableHead>)}
          </TableRow></TableHeader>
          {model.groups.map(group => <TableBody key={group.label}>
            <TableRow><TableHead scope="rowgroup" colSpan={model.candidates.length + 1} className="bg-muted">{group.label}</TableHead></TableRow>
            {group.rows.map(row => <TableRow key={row.id}>
              <TableHead scope="row" className="criterion-column sticky left-0 z-10 bg-background"><TruncatedText text={row.label} /></TableHead>
              {row.cells.map((cell, index) => {
                const Icon = cell.result === "met" ? Check : cell.result === "not_met" ? X : CircleHelp;
                const tone = cell.result === "met" ? "text-status-success" : cell.result === "not_met" ? "text-status-review" : "text-muted-foreground";
                return <TableCell key={model.candidates[index].id} className="align-top">
                  <p className="flex items-center gap-1 text-sm font-medium"><Icon className={`size-4 shrink-0 ${tone}`} aria-hidden="true" />{resultLabel(cell.result)}<span className="text-xs font-normal text-muted-foreground"> · {cell.source ?? "Sin fuente"}</span></p>
                  {cell.note && <TruncatedText text={cell.note} className="comparison-note text-xs text-muted-foreground" />}
                </TableCell>;
              })}
            </TableRow>)}
          </TableBody>)}
        </Table>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      <div className="comparison-print-summary hidden">
        <h3>Resumen por candidato</h3>
        {model.candidates.map(candidate => <Fragment key={candidate.id}><p>{candidate.name} · {stages[candidate.stageId] ?? "Etapa no disponible"}</p><p>{fitLine(candidate.summary)}</p></Fragment>)}
      </div>
      </CardContent>
      <CardFooter className="border-t text-xs text-muted-foreground">Generado con PeopleFlow</CardFooter>
    </Card>
  </>;
}
