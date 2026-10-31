"use client";
import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Label, Pie, PieChart, XAxis, YAxis } from "recharts";
import { BarChart3, BriefcaseBusiness, Clock } from "lucide-react";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, type ChartConfig } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { SectionEmpty } from "@/components/feedback/state-card";
import type { ApplicationsPage } from "@/features/candidate-applications/model";
import { dashboardInsights, type Period } from "./insights";
import { SourceError, SourceLoading, type Source } from "./source";
export const statusConfig = { in_process: { label: "En proceso", color: "var(--primary)" }, submitted: { label: "Enviada", color: "var(--status-info)" }, closed: { label: "Cerrada", color: "var(--muted-foreground)" } } satisfies ChartConfig;
const responseConfig = { responses: { label: "Primeras respuestas", color: "var(--primary)" } } satisfies ChartConfig;
const tick = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
const amount = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
function ChartData({ caption, headers, rows }: { caption: string; headers: string[]; rows: (string | number)[][] }) {
  return <div className="sr-only"><Table><TableCaption>{caption}</TableCaption><TableHeader><TableRow>{headers.map(header => <TableHead scope="col" key={header}>{header}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={index}>{row.map((cell, column) => <TableCell key={column}>{cell}</TableCell>)}</TableRow>)}</TableBody></Table></div>;
}
function Frame({ title, description, action, children, footer, source }: { title: string; description: string; action?: ReactNode; children: ReactNode; footer?: string; source: Source<ApplicationsPage> }) {
  return <Card size="sm" role="region" aria-label={title} className="@container/insight min-w-0">
    <CardHeader className="min-h-32 content-start @[330px]/insight:min-h-20"><CardTitle><h2 className="text-sm">{title}</h2></CardTitle><CardDescription className="text-xs">{description}</CardDescription>{action && <CardAction className="col-start-1 row-start-3 justify-self-start @[330px]/insight:col-start-2 @[330px]/insight:row-start-1 @[330px]/insight:justify-self-end">{action}</CardAction>}</CardHeader>
    <CardContent className="flex min-h-80 flex-1 flex-col gap-3">{!source.result ? <SourceLoading label="Cargando gráficas" /> : !source.result.ok ? <SourceError failure={source.result} retry={source.retry} label="las postulaciones" /> : children}</CardContent>
    {source.result?.ok && footer && <CardFooter className="min-h-12 border-t text-xs text-muted-foreground">{footer}</CardFooter>}
  </Card>;
}
/** Company chart Card/header-action pattern; shadcn Donut with Text center label.
 * Empty uses SectionEmpty instead of mounting misleading empty axes. */
export function DashboardCharts({ source }: { source: Source<ApplicationsPage> }) {
  const [period, setPeriod] = useState<Period>("3m");
  const data = dashboardInsights(source.result?.ok ? source.result.data.items : [], period);
  const response = data.responses;
  const range = <ToggleGroup aria-label="Período de constancia" multiple={false} variant="segmented" size="sm" value={[period]} onValueChange={(values: string[]) => { if (values[0] === "3m" || values[0] === "30d") setPeriod(values[0]); }}><ToggleGroupItem value="3m" aria-label="Últimos 3 meses">3 meses</ToggleGroupItem><ToggleGroupItem value="30d" aria-label="Últimos 30 días">30 días</ToggleGroupItem></ToggleGroup>;
  const distribution = Object.entries(statusConfig).map(([status]) => ({ status, count: data.statuses[status as keyof typeof data.statuses], fill: `var(--color-${status})` })).filter(slice => slice.count > 0);
  return <section aria-label="Tu búsqueda en tres preguntas" className="grid min-w-0 gap-4 min-[850px]:grid-cols-3">
    <Frame source={source} title="¿Estoy siendo constante?" description="Tu ritmo de búsqueda" action={range} footer={data.total ? "Estado actual · la semana actual está en curso." : undefined}>
      {!data.total ? <SectionEmpty icon={BarChart3} tone="info" title="Aquí empieza tu ritmo" description="Verás tus postulaciones por semana y su estado actual después de enviar la primera." primaryAction={{ href: "/vacantes", label: "Explorar vacantes" }} /> : <>
        <div className="min-h-16"><p className="text-xs text-muted-foreground"><strong className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">{data.month.current}</strong> {data.month.current === 1 ? "postulación este mes" : "postulaciones este mes"}</p><p className="text-xs text-muted-foreground">{data.month.difference === 0 ? "Igual que el mes anterior" : `${Math.abs(data.month.difference)} ${data.month.difference > 0 ? "más" : "menos"} que el mes anterior`}</p></div>
        <ChartContainer config={statusConfig} className="aspect-auto h-60 w-full" aria-label="Postulaciones por semana y estado actual">
          <BarChart accessibilityLayer data={data.weeks} margin={{ left: -24, right: 4 }}><CartesianGrid vertical={false} strokeDasharray="3 4" /><XAxis dataKey="week" tickFormatter={tick} tickLine={false} axisLine={false} minTickGap={24} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} /><ChartTooltip content={<ChartTooltipContent labelFormatter={value => tick(String(value))} />} /><ChartLegend content={<ChartLegendContent className="flex-wrap gap-2 text-xs" />} />{Object.keys(statusConfig).map(status => <Bar key={status} dataKey={status} stackId="applications" fill={`var(--color-${status})`} radius={[4, 4, 0, 0]} />)}</BarChart>
        </ChartContainer><ChartData caption="Postulaciones por semana" headers={["Semana", "En proceso", "Enviada", "Cerrada"]} rows={data.weeks.map(week => [week.week, week.in_process, week.submitted, week.closed])} /><p className="text-xs text-muted-foreground">{period === "3m" ? "Últimos 3 meses" : "Últimos 30 días"} · estado actual</p>
      </>}
    </Frame>
    <Frame source={source} title="¿Está funcionando?" description="Tus resultados · estado actual" footer={data.total ? "En proceso hoy / total; no predice contratación." : undefined}>
      {!data.total ? <SectionEmpty icon={BriefcaseBusiness} tone="info" title="Cada avance cuenta" description="Aquí verás cuántas postulaciones están en proceso, enviadas o cerradas." primaryAction={{ href: "/vacantes", label: "Explorar vacantes" }} /> : <>
        <div className="min-h-16"><p className="text-xs text-muted-foreground"><strong className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">{data.advanceRate}%</strong> avanzó a proceso</p><p className="text-xs text-muted-foreground">{data.statuses.in_process} de tus {data.total} postulaciones</p></div>
        <ChartContainer config={statusConfig} className="aspect-auto h-60 w-full" aria-label="Distribución actual de postulaciones">
          <PieChart accessibilityLayer><ChartTooltip content={<ChartTooltipContent nameKey="status" hideLabel />} /><Pie data={distribution} dataKey="count" nameKey="status" innerRadius={64} outerRadius={86} paddingAngle={distribution.length > 1 ? 2 : 0} strokeWidth={distribution.length > 1 ? 3 : 0}><Label content={({ viewBox }) => viewBox && "cx" in viewBox && "cy" in viewBox ? <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle"><tspan x={viewBox.cx} y={(viewBox.cy ?? 0) - 8} className="fill-foreground text-3xl font-semibold tabular-nums">{data.total}</tspan><tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 18} className="fill-muted-foreground text-xs">{data.total === 1 ? "postulación" : "postulaciones"}</tspan></text> : null} /></Pie></PieChart>
        </ChartContainer>
        {/* Own legend: Recharts sorts legend items by value, and every chart lists the statuses in this shared order. */}
        <ul aria-label="Leyenda de estados" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">{Object.entries(statusConfig).map(([status, config]) => <li key={status} className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: config.color }} />{config.label}<span className="text-muted-foreground tabular-nums">{data.statuses[status as keyof typeof data.statuses]}</span></li>)}</ul>
        <ChartData caption="Distribución de postulaciones" headers={["Estado", "Postulaciones"]} rows={Object.entries(statusConfig).map(([status, config]) => [String(config.label), data.statuses[status as keyof typeof data.statuses]])} />
      </>}
    </Frame>
    <Frame source={source} title="¿Cuánto tardan en responder?" description="Primer cambio visible de tus postulaciones" footer={response.answered ? `Días naturales · excluye las ${response.waiting} aún sin cambios.${response.unknown ? ` ${response.unknown} sin dato de respuesta.` : ""}` : undefined}>
      {!data.total ? <SectionEmpty icon={Clock} tone="info" title="Las respuestas toman tiempo" description="Después del primer cambio de una empresa, aquí podrás ver los días que esperaste." /> : !response.available ? <SectionEmpty icon={Clock} tone="info" title="Todavía no hay datos de respuesta" description="Cuando estén disponibles, aquí podrás ver cuánto tardan las empresas en dar su primera respuesta." /> : response.average === null ? <SectionEmpty icon={Clock} tone="info" title="Las respuestas toman tiempo" description={`${amount(response.waiting, "postulación aún espera", "postulaciones aún esperan")} su primer cambio. Aquí verás los días de espera cuando llegue una respuesta.`} /> : <>
        <div className="min-h-16"><p className="text-xs text-muted-foreground"><strong className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">{amount(response.average, "día", "días")}</strong> en promedio</p><p className="text-xs text-muted-foreground">{amount(response.answered, "primera respuesta", "primeras respuestas")} · {response.waiting} aún esperan</p></div>
        <ChartContainer config={responseConfig} className="aspect-auto h-60 w-full" aria-label="Días naturales hasta la primera respuesta">
          <BarChart accessibilityLayer data={response.histogram} margin={{ left: -24, right: 4 }}><CartesianGrid vertical={false} strokeDasharray="3 4" /><XAxis dataKey="days" tickFormatter={value => `${value} días`} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} /><ChartTooltip content={<ChartTooltipContent labelFormatter={value => `${value} días`} />} /><ChartLegend content={<ChartLegendContent />} /><Bar dataKey="responses" fill="var(--color-responses)" radius={[4, 4, 0, 0]} /></BarChart>
        </ChartContainer><ChartData caption="Días hasta la primera respuesta" headers={["Días naturales", "Primeras respuestas"]} rows={response.histogram.map(item => [item.days, item.responses])} />
      </>}
    </Frame>
  </section>;
}
export function ApplicationStatus({ source }: { source: Source<ApplicationsPage> }) {
  const data = source.result?.ok ? dashboardInsights(source.result.data.items) : undefined;
  return <Card size="sm" role="region" aria-label="Estado de tus postulaciones"><CardHeader className="border-b"><CardTitle><h2>Estado de tus postulaciones</h2></CardTitle><CardDescription>Una mirada a tu búsqueda completa.</CardDescription></CardHeader><CardContent className="grid gap-4">
    {!source.result ? <SourceLoading label="Cargando estados" /> : !source.result.ok ? <SourceError failure={source.result} retry={source.retry} label="las postulaciones" /> : !data?.total ? <SectionEmpty tone="empty" icon={BriefcaseBusiness} title="Tu búsqueda, de un vistazo" description="Cuando envíes una postulación verás aquí su estado y cuántas siguen activas." /> : <>{Object.entries(statusConfig).map(([status, config]) => <div key={status}><div className="mb-2 flex justify-between gap-3 text-sm"><span>{config.label}</span><strong className="tabular-nums">{data.statuses[status as keyof typeof data.statuses]}</strong></div><Progress className={status === "submitted" ? "**:data-[slot=progress-indicator]:bg-status-info" : status === "closed" ? "**:data-[slot=progress-indicator]:bg-muted-foreground" : undefined} aria-label={String(config.label)} value={data.statuses[status as keyof typeof data.statuses]} max={data.total} /></div>)}<p className="text-xs text-muted-foreground">{data.statuses.in_process + data.statuses.submitted} activas de {data.total} postulaciones en total.</p></>}
  </CardContent></Card>;
}
