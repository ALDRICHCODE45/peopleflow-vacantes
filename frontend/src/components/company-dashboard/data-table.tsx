"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  columnFilteringFeature, columnVisibilityFeature, createColumnHelper,
  createFilteredRowModel, createPaginatedRowModel, createSortedRowModel,
  FlexRender, rowPaginationFeature, rowSelectionFeature, rowSortingFeature,
  tableFeatures, useTable, type ColumnVisibilityState, type SortingState,
} from "@tanstack/react-table"
import { useIsMobile } from "@/hooks/use-mobile"
import { Badge, type BadgeVariant } from "@/components/ui/badge"
import { Button, buttonVariants } from "./ui/button"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { StateCard } from "@/components/feedback/state-card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronsLeft, IconChevronsRight, IconLayoutColumns, IconUsers } from "@tabler/icons-react"
import type { Dashboard } from "@/features/employer-dashboard/model"
import { vacancyPipelineHref } from "@/features/employer-vacancies/model"

type Applicant = Dashboard["recent"][number]
const STAGE_VARIANTS: Record<Applicant["stage"]["kind"], BadgeVariant> = {
  new: "info", screening: "review", screening_ok: "review", in_process: "review", custom: "review", placement: "success", discarded: "neutral",
}
const SOURCE_LABELS = { organic: "Orgánico", manual: "Manual" }
const dateFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" })
export function formatReceivedDate(value: string) {
  return dateFormat.format(new Date(value)).replaceAll(" de ", " ").replaceAll(".", "")
}
const features = tableFeatures({
  columnFilteringFeature, columnVisibilityFeature, rowPaginationFeature,
  rowSelectionFeature, rowSortingFeature,
  filteredRowModel: createFilteredRowModel(), paginatedRowModel: createPaginatedRowModel(), sortedRowModel: createSortedRowModel(),
})
const columnHelper = createColumnHelper<typeof features, Applicant>()
const PIPELINE_TABS = [
  { value: "all", label: "Todos" },
  { value: "organic", label: "Orgánicos" },
  { value: "manual", label: "Manuales" },
] as const
 type PipelineTab = (typeof PIPELINE_TABS)[number]["value"]
const COLUMN_LABELS: Record<string, string> = { vacancy: "Vacante", stage: "Etapa", source: "Origen", applied_at: "Recibida", added_by: "Agregado por" }
const PAGE_SIZES = [10, 20, 30, 40, 50]
const columns = columnHelper.columns([
  columnHelper.display({
    id: "select",
    header: ({ table }) => <div className="flex items-center justify-center">
      <Checkbox checked={table.getIsAllPageRowsSelected()} indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()} onCheckedChange={(value: boolean) => table.toggleAllPageRowsSelected(!!value)} aria-label="Seleccionar todas las filas" />
    </div>,
    cell: ({ row }) => <div className="flex items-center justify-center" onClick={event => event.stopPropagation()}>
      <Checkbox checked={row.getIsSelected()} onCheckedChange={(value: boolean) => row.toggleSelected(!!value)} aria-label={`Seleccionar a ${row.original.candidate.name}`} />
    </div>,
    enableSorting: false, enableHiding: false,
  }),
  columnHelper.accessor(row => row.candidate.name, { id: "candidate", header: "Candidato", cell: ({ row }) => <CandidateCell applicant={row.original} />, enableHiding: false }),
  columnHelper.accessor(row => row.vacancy.title, { id: "vacancy", header: "Vacante", cell: ({ row }) => <span className="text-muted-foreground">{row.original.vacancy.title}</span> }),
  columnHelper.accessor(row => row.stage.name, { id: "stage", header: "Etapa", cell: ({ row }) => <Badge variant={STAGE_VARIANTS[row.original.stage.kind]} dot>{row.original.stage.name}</Badge> }),
  columnHelper.accessor("source", { header: "Origen", cell: ({ row }) => <Badge variant="outline" className="text-muted-foreground">{SOURCE_LABELS[row.original.source]}</Badge> }),
  columnHelper.accessor("applied_at", { header: "Recibida", cell: ({ row }) => <span className="text-muted-foreground">{formatReceivedDate(row.original.applied_at)}</span> }),
  columnHelper.accessor(row => row.added_by?.name ?? "—", { id: "added_by", header: "Agregado por", cell: ({ row }) => <span className="text-muted-foreground">{row.original.added_by?.name ?? "—"}</span> }),
])

function CandidateCell({ applicant }: { applicant: Applicant }) {
  const isMobile = useIsMobile()
  return (
    <div className="flex flex-col gap-0.5" onClick={event => event.stopPropagation()}>
      <Link href={vacancyPipelineHref(applicant.vacancy.id)} className={cn(buttonVariants({ variant: "link", className: "w-fit justify-start px-0 text-left text-foreground" }))}>{applicant.candidate.name}</Link>
      {/* Keep the approved read-only drawer on the subline; the name now opens the board. */}
      <Drawer swipeDirection={isMobile ? "down" : "right"}>
        <DrawerTrigger render={<Button variant="link" className="h-auto w-fit justify-start border-0 px-0 text-left text-xs text-muted-foreground" />} aria-label={`Ver detalle de ${applicant.candidate.name}`}>
          {applicant.candidate.professional_title ?? "Ver detalle"}
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader className="gap-1">
            <DrawerTitle>{applicant.candidate.name}</DrawerTitle>
            <DrawerDescription>{applicant.candidate.professional_title ?? "—"}</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-4 overflow-y-auto px-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">Vacante</dt><dd className="font-medium">{applicant.vacancy.title}</dd>
              <dt className="text-muted-foreground">Etapa</dt><dd><Badge variant={STAGE_VARIANTS[applicant.stage.kind]} dot>{applicant.stage.name}</Badge></dd>
              <dt className="text-muted-foreground">Origen</dt><dd className="font-medium">{SOURCE_LABELS[applicant.source]}</dd>
              <dt className="text-muted-foreground">Recibida</dt><dd className="font-medium">{formatReceivedDate(applicant.applied_at)}</dd>
              <dt className="text-muted-foreground">Agregado por</dt><dd className="font-medium">{applicant.added_by?.name ?? "—"}</dd>
            </dl>
          </div>
          <DrawerFooter><DrawerClose render={<Button variant="outline" />}>Cerrar</DrawerClose></DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

export function DataTable({ data: applicants }: { data: Dashboard["recent"] }) {
  const router = useRouter()
  const [statusTab, setStatusTab] = React.useState<PipelineTab>("all")
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility, setColumnVisibility] = React.useState<ColumnVisibilityState>({})
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 10 })
  const visibleApplicants = React.useMemo(() => statusTab === "all" ? applicants : applicants.filter(applicant => applicant.source === statusTab), [applicants, statusTab])
  const table = useTable({
    features, data: visibleApplicants, columns,
    state: { sorting, columnVisibility, rowSelection, pagination },
    getRowId: row => row.participation_id,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection, onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility, onPaginationChange: setPagination,
  })
  const statusCount = (value: PipelineTab) => value === "all" ? applicants.length : applicants.filter(applicant => applicant.source === value).length
  function selectStatus(value: string) {
    setStatusTab(value as PipelineTab)
    setPagination(current => ({ ...current, pageIndex: 0 }))
  }
  const selectedRows = table.getFilteredSelectedRowModel().rows.length
  const totalRows = table.getFilteredRowModel().rows.length
  const rowsPerPage = table.state.pagination.pageSize
  return (
    <Tabs value={statusTab} onValueChange={(value: unknown) => selectStatus(String(value))} data-pf-data-table="" className="w-full flex-col justify-start gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h3 className="text-base font-medium">Candidatos recientes</h3>
        <TabsList className="hidden **:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:bg-muted-foreground/30 **:data-[slot=badge]:px-1 @4xl/main:flex">
          {PIPELINE_TABS.map(tab => <TabsTrigger key={tab.value} value={tab.value}>{tab.label} <Badge variant="secondary">{statusCount(tab.value)}</Badge></TabsTrigger>)}
        </TabsList>
        <div className="flex items-center gap-2">
          <Select value={statusTab} onValueChange={(value: string | null) => { if (value !== null) selectStatus(String(value)) }} items={PIPELINE_TABS.map(tab => ({ label: tab.label, value: tab.value }))}>
            <SelectTrigger className="flex w-fit @4xl/main:hidden" size="sm" aria-label="Filtrar por origen"><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent><SelectGroup>{PIPELINE_TABS.map(tab => <SelectItem key={tab.value} value={tab.value}>{`${tab.label} (${statusCount(tab.value)})`}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" aria-label="Personalizar columnas" />}>
              <IconLayoutColumns data-icon="inline-start" />
              <span className="hidden sm:inline lg:hidden">Columnas</span>
              <span className="hidden lg:inline">Personalizar columnas</span>
              <IconChevronDown data-icon="inline-end" className="hidden sm:inline" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40"><DropdownMenuGroup>
              {table.getAllColumns().filter(column => typeof column.accessorFn !== "undefined" && column.getCanHide()).map(column => <DropdownMenuCheckboxItem key={column.id} checked={column.getIsVisible()} onCheckedChange={(value: boolean) => column.toggleVisibility(!!value)}>{COLUMN_LABELS[column.id] ?? column.id}</DropdownMenuCheckboxItem>)}
            </DropdownMenuGroup></DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <TabsContent value={statusTab} className="relative flex flex-col gap-4 overflow-auto">
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              {table.getHeaderGroups().map(headerGroup => <TableRow key={headerGroup.id}>{headerGroup.headers.map(header => <TableHead key={header.id} colSpan={header.colSpan}>{header.isPlaceholder ? null : <FlexRender header={header} />}</TableHead>)}</TableRow>)}
            </TableHeader>
            <TableBody className="**:data-[slot=table-cell]:first:w-8">
              {table.getRowModel().rows.length ? table.getRowModel().rows.map(row => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"} className="cursor-pointer" onClick={() => router.push(vacancyPipelineHref(row.original.vacancy.id))}>
                  {row.getVisibleCells().map(cell => <TableCell key={cell.id}><FlexRender cell={cell} /></TableCell>)}
                </TableRow>
              )) : <TableRow><TableCell colSpan={table.getAllColumns().length} className="p-0">
                <StateCard icon={IconUsers} tone="empty" title="Sin candidatos"
                  description={applicants.length === 0 ? "Aquí puedes revisar las postulaciones y su etapa. Mientras tanto, consulta tus vacantes." : "No hay postulantes de este origen. Limpia el filtro para ver los demás candidatos."}
                  primaryAction={statusTab !== "all" && applicants.length > 0 ? { label: "Limpiar filtros", onClick: () => selectStatus("all") } : { href: "/empresa/vacantes", label: "Ver vacantes" }} />
              </TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between px-4">
          <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">{`${selectedRows} de ${totalRows} candidatos seleccionados.`}</div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">Filas por página</Label>
              <Select value={`${rowsPerPage}`} onValueChange={(value: string | null) => { if (value !== null) table.setPageSize(Number(value)) }} items={PAGE_SIZES.map(pageSize => ({ label: `${pageSize}`, value: `${pageSize}` }))}>
                <SelectTrigger size="sm" className="w-20" id="rows-per-page"><SelectValue placeholder={rowsPerPage} /></SelectTrigger>
                <SelectContent side="top"><SelectGroup>{PAGE_SIZES.map(pageSize => <SelectItem key={pageSize} value={`${pageSize}`}>{pageSize}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </div>
            <div className="flex w-fit items-center justify-center text-sm font-medium">{`Página ${table.state.pagination.pageIndex + 1} de ${Math.max(1, table.getPageCount())}`}</div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button variant="outline" className="hidden h-8 w-8 p-0 lg:flex" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}><span className="sr-only">Ir a la primera página</span><IconChevronsLeft /></Button>
              <Button variant="outline" className="size-8" size="icon" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}><span className="sr-only">Ir a la página anterior</span><IconChevronLeft /></Button>
              <Button variant="outline" className="size-8" size="icon" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}><span className="sr-only">Ir a la página siguiente</span><IconChevronRight /></Button>
              <Button variant="outline" className="hidden size-8 lg:flex" size="icon" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}><span className="sr-only">Ir a la última página</span><IconChevronsRight /></Button>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  )
}
