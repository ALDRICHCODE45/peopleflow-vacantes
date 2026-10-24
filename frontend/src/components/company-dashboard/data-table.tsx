"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { vacancyPipelineHref } from "@/features/employer-vacancies/model";
import type { Dashboard } from "@/features/employer-dashboard/model";
const dateFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" });
export function formatReceivedDate(value: string) { return dateFormat.format(new Date(value)).replaceAll(" de ", " ").replaceAll(".", ""); }
export function DataTable({ data }: { data: Dashboard["recent"] }) {
  const router = useRouter();
  return <Card><CardHeader><CardTitle><h2>Últimas incorporaciones</h2></CardTitle><CardDescription>Candidatos incorporados recientemente a tus vacantes.</CardDescription></CardHeader><CardContent>
    {data.length === 0 ? <StateCard icon={Users} tone="empty" title="Aún no hay candidatos en tus vacantes" description="Aquí verás las próximas incorporaciones a tus procesos." /> :
      <Table><TableHeader><TableRow>{["Candidato", "Vacante", "Etapa", "Origen", "Fecha", "Agregado por"].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{data.map(row => <TableRow key={row.participation_id} className="cursor-pointer" onClick={() => router.push(vacancyPipelineHref(row.vacancy.id))}>
          <TableCell><Link className="inline-flex min-h-10 items-center underline underline-offset-4" href={vacancyPipelineHref(row.vacancy.id)} onClick={event => event.stopPropagation()}>{row.candidate.name}</Link></TableCell>
          <TableCell>{row.vacancy.title}</TableCell><TableCell>{row.stage.name}</TableCell><TableCell>{row.source === "organic" ? "Orgánico" : "Manual"}</TableCell>
          <TableCell><time dateTime={row.applied_at}>{formatReceivedDate(row.applied_at)}</time></TableCell><TableCell>{row.source === "organic" ? "—" : row.added_by?.name ?? "—"}</TableCell>
        </TableRow>)}</TableBody></Table>}
  </CardContent></Card>;
}
