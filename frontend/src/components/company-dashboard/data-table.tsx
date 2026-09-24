"use client"

import * as React from "react"
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  FlexRender,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type ColumnVisibilityState,
  type SortingState,
} from "@tanstack/react-table"
import { z } from "zod"

import { useIsMobile } from "@/hooks/use-mobile"
import { Badge } from "@/components/ui/badge"
import { Button } from "./ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
  IconLayoutColumns,
} from "@tabler/icons-react"

/**
 * Closed pipeline vocabularies.
 *
 * These mirror the backend's application contract: the UI must never invent a
 * stage the API cannot return, so both lists double as the validation source and
 * the display dictionary.
 */
export const APPLICANT_STATUSES = [
  "submitted",
  "in_review",
  "hired",
  "rejected",
] as const

export const APPLICANT_SOURCES = [
  "direct",
  "referral",
  "linkedin",
  "job_board",
  "other",
] as const

export type ApplicantStatus = (typeof APPLICANT_STATUSES)[number]
export type ApplicantSource = (typeof APPLICANT_SOURCES)[number]

/** Display dictionary: wire value -> recruiter-facing Spanish label. */
export const STATUS_LABELS: Record<ApplicantStatus, string> = {
  submitted: "Nuevo",
  in_review: "En revisión",
  hired: "Contratado",
  rejected: "Descartado",
}

export const SOURCE_LABELS: Record<ApplicantSource, string> = {
  direct: "Directa",
  referral: "Referido",
  linkedin: "LinkedIn",
  job_board: "Portal de empleo",
  other: "Otra",
}

const STATUS_BADGE_VARIANTS: Record<
  ApplicantStatus,
  "secondary" | "outline" | "default" | "destructive"
> = {
  submitted: "secondary",
  in_review: "outline",
  hired: "default",
  rejected: "destructive",
}

/** One application as the recruiter API returns it. */
export const schema = z.object({
  id: z.number(),
  fullName: z.string(),
  professionalTitle: z.string(),
  yearsOfExperience: z.number(),
  vacancy: z.string(),
  status: z.enum(APPLICANT_STATUSES),
  source: z.enum(APPLICANT_SOURCES),
  receivedAt: z.string().datetime(),
  owner: z.string(),
})

export type Applicant = z.infer<typeof schema>

/**
 * Raw fixture row: `status` and `source` arrive as plain strings from the JSON
 * payload, so the component accepts the wire shape and validates it with
 * `schema` before anything reaches the table.
 */
export type ApplicantRow = {
  id: number
  fullName: string
  professionalTitle: string
  yearsOfExperience: number
  vacancy: string
  status: string
  source: string
  receivedAt: string
  owner: string
}

/**
 * Formats an application timestamp for display.
 *
 * The fixture timestamps are UTC instants. Formatting them in the host time zone
 * shifts applications received shortly after UTC midnight onto the previous day
 * — on America/Mexico_City (UTC-6) `2024-06-24T02:25:00Z` renders as 23 June — so
 * the time zone is pinned to UTC and the label stays identical everywhere.
 */
export function formatReceivedDate(value: string): string {
  return new Date(value).toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Formats the candidate's experience snapshot with Spanish pluralization. */
export function formatYearsOfExperience(years: number): string {
  return years === 1 ? "1 año" : `${years} años`
}

// New in v9: declare the features this table uses — anything you don't
// register is tree-shaken out of the bundle.
const features = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
})

const columnHelper = createColumnHelper<typeof features, Applicant>()

/** Pipeline tabs and the mobile select share this single filter vocabulary. */
const PIPELINE_TABS = [
  { value: "all", label: "Todos" },
  { value: "submitted", label: "Nuevos" },
  { value: "in_review", label: "En revisión" },
  { value: "hired", label: "Contratados" },
] as const

type PipelineTab = (typeof PIPELINE_TABS)[number]["value"]

const COLUMN_LABELS: Record<string, string> = {
  vacancy: "Vacante",
  status: "Estado",
  source: "Fuente",
  receivedAt: "Recibida",
  owner: "Responsable",
}

const PAGE_SIZES = [10, 20, 30, 40, 50]

const columns = columnHelper.columns([
  columnHelper.display({
    id: "select",
    header: ({ table }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={
            table.getIsSomePageRowsSelected() &&
            !table.getIsAllPageRowsSelected()
          }
          onCheckedChange={(value: boolean) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Seleccionar todas las filas"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value: boolean) => row.toggleSelected(!!value)}
          aria-label={`Seleccionar a ${row.original.fullName}`}
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  }),
  columnHelper.accessor("fullName", {
    header: "Candidato",
    cell: ({ row }) => <CandidateCell applicant={row.original} />,
    // The identity column owns the detail drawer, so it stays pinned.
    enableHiding: false,
  }),
  columnHelper.accessor("vacancy", {
    header: "Vacante",
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.vacancy}</span>,
  }),
  columnHelper.accessor("status", {
    header: "Estado",
    cell: ({ row }) => (
      <Badge
        variant={STATUS_BADGE_VARIANTS[row.original.status]}
        className="px-1.5"
      >
        {STATUS_LABELS[row.original.status]}
      </Badge>
    ),
  }),
  columnHelper.accessor("source", {
    header: "Fuente",
    cell: ({ row }) => (
      <Badge variant="outline" className="px-1.5 text-muted-foreground">
        {SOURCE_LABELS[row.original.source]}
      </Badge>
    ),
  }),
  columnHelper.accessor("receivedAt", {
    header: "Recibida",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {formatReceivedDate(row.original.receivedAt)}
      </span>
    ),
  }),
  columnHelper.accessor("owner", {
    header: "Responsable",
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.owner}</span>,
  }),
])

/**
 * Candidate identity cell: the name opens the read-only detail drawer, the
 * professional title sits under it as secondary context.
 */
function CandidateCell({ applicant }: { applicant: Applicant }) {
  const isMobile = useIsMobile()

  return (
    <div className="flex flex-col gap-0.5">
      <Drawer swipeDirection={isMobile ? "down" : "right"}>
        <DrawerTrigger
          render={
            <Button
              variant="link"
              className="w-fit justify-start px-0 text-left text-foreground"
            />
          }
        >
          {applicant.fullName}
        </DrawerTrigger>
        <DrawerContent>
          <DrawerHeader className="gap-1">
            <DrawerTitle>{applicant.fullName}</DrawerTitle>
            <DrawerDescription>{applicant.professionalTitle}</DrawerDescription>
          </DrawerHeader>
          {/* Read-only snapshot: the dashboard reads, it never mutates. */}
          <div className="flex flex-col gap-4 overflow-y-auto px-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <dt className="text-muted-foreground">Experiencia</dt>
              <dd className="font-medium">
                {formatYearsOfExperience(applicant.yearsOfExperience)}
              </dd>
              <dt className="text-muted-foreground">Vacante</dt>
              <dd className="font-medium">{applicant.vacancy}</dd>
              <dt className="text-muted-foreground">Estado</dt>
              <dd>
                <Badge
                  variant={STATUS_BADGE_VARIANTS[applicant.status]}
                  className="px-1.5"
                >
                  {STATUS_LABELS[applicant.status]}
                </Badge>
              </dd>
              <dt className="text-muted-foreground">Fuente</dt>
              <dd className="font-medium">{SOURCE_LABELS[applicant.source]}</dd>
              <dt className="text-muted-foreground">Recibida</dt>
              <dd className="font-medium">
                {formatReceivedDate(applicant.receivedAt)}
              </dd>
              <dt className="text-muted-foreground">Responsable</dt>
              <dd className="font-medium">{applicant.owner}</dd>
            </dl>
          </div>
          <DrawerFooter>
            <DrawerClose render={<Button variant="outline" />}>
              Cerrar
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      <span className="text-xs text-muted-foreground">
        {applicant.professionalTitle}
      </span>
    </div>
  )
}

export function DataTable({ data: initialData }: { data: ApplicantRow[] }) {
  // Boundary validation: an unsupported stage can never reach the table even if
  // the fixture drifts, because the whole payload is parsed before render.
  const applicants = React.useMemo(
    () => schema.array().parse(initialData),
    [initialData]
  )
  const [statusTab, setStatusTab] = React.useState<PipelineTab>("all")
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility, setColumnVisibility] =
    React.useState<ColumnVisibilityState>({})
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: 10,
  })

  const visibleApplicants = React.useMemo(
    () =>
      statusTab === "all"
        ? applicants
        : applicants.filter((applicant) => applicant.status === statusTab),
    [applicants, statusTab]
  )

  const table = useTable({
    features,
    data: visibleApplicants,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      pagination,
    },
    getRowId: (row) => row.id.toString(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
  })

  const statusCount = (value: PipelineTab) =>
    value === "all"
      ? applicants.length
      : applicants.filter((applicant) => applicant.status === value).length

  /** Tabs and the mobile select share one handler so both really filter rows. */
  function selectStatus(value: string) {
    setStatusTab(value as PipelineTab)
    // A narrower pipeline may not hold the page the recruiter was reading.
    setPagination((current) => ({ ...current, pageIndex: 0 }))
  }

  const selectedRows = table.getFilteredSelectedRowModel().rows.length
  const totalRows = table.getFilteredRowModel().rows.length
  const rowsPerPage = table.state.pagination.pageSize

  return (
    <Tabs
      value={statusTab}
      onValueChange={(value: unknown) => selectStatus(String(value))}
      data-pf-data-table=""
      className="w-full flex-col justify-start gap-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 lg:px-6">
        <h3 className="text-base font-medium">Candidatos recientes</h3>
        <TabsList className="hidden **:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:bg-muted-foreground/30 **:data-[slot=badge]:px-1 @4xl/main:flex">
          {PIPELINE_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label} <Badge variant="secondary">{statusCount(tab.value)}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex items-center gap-2">
          <Select
            value={statusTab}
            onValueChange={(value: string | null) => {
              if (value !== null) {
                selectStatus(String(value))
              }
            }}
            items={PIPELINE_TABS.map((tab) => ({
              label: tab.label,
              value: tab.value,
            }))}
          >
            <SelectTrigger
              className="flex w-fit @4xl/main:hidden"
              size="sm"
              aria-label="Filtrar por estado"
            >
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PIPELINE_TABS.map((tab) => (
                  <SelectItem key={tab.value} value={tab.value}>
                    {`${tab.label} (${statusCount(tab.value)})`}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Personalizar columnas"
                />
              }
            >
              <IconLayoutColumns data-icon="inline-start" />
              {/* Below `sm` the control is icon-only, so neither label can wrap
                  the toolbar onto a second row and push the table down. */}
              <span className="hidden sm:inline lg:hidden">Columnas</span>
              <span className="hidden lg:inline">Personalizar columnas</span>
              <IconChevronDown
                data-icon="inline-end"
                className="hidden sm:inline"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {table
                .getAllColumns()
                .filter(
                  (column) =>
                    typeof column.accessorFn !== "undefined" &&
                    column.getCanHide()
                )
                .map((column) => {
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(value: boolean) =>
                        column.toggleVisibility(!!value)
                      }
                    >
                      {COLUMN_LABELS[column.id] ?? column.id}
                    </DropdownMenuCheckboxItem>
                  )
                })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {/*
        A single panel bound to the active tab: the tabs filter the row set while
        exactly one table stays in the DOM, so no empty placeholder panel renders.
      */}
      <TabsContent
        value={statusTab}
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6"
      >
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead key={header.id} colSpan={header.colSpan}>
                        {header.isPlaceholder ? null : (
                          <FlexRender header={header} />
                        )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className="**:data-[slot=table-cell]:first:w-8">
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        <FlexRender cell={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={table.getAllColumns().length}
                    className="p-0"
                  >
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>Sin candidatos</EmptyTitle>
                        <EmptyDescription>
                          No hay postulantes en este estado de la vacante.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between px-4">
          <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
            {`${selectedRows} de ${totalRows} candidatos seleccionados.`}
          </div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">
                Filas por página
              </Label>
              <Select
                value={`${rowsPerPage}`}
                onValueChange={(value: string | null) => {
                  if (value !== null) {
                    table.setPageSize(Number(value))
                  }
                }}
                items={PAGE_SIZES.map((pageSize) => ({
                  label: `${pageSize}`,
                  value: `${pageSize}`,
                }))}
              >
                <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                  <SelectValue placeholder={rowsPerPage} />
                </SelectTrigger>
                <SelectContent side="top">
                  <SelectGroup>
                    {PAGE_SIZES.map((pageSize) => (
                      <SelectItem key={pageSize} value={`${pageSize}`}>
                        {pageSize}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-fit items-center justify-center text-sm font-medium">
              {`Página ${table.state.pagination.pageIndex + 1} de ${table.getPageCount()}`}
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Ir a la primera página</span>
                <IconChevronsLeft />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Ir a la página anterior</span>
                <IconChevronLeft />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Ir a la página siguiente</span>
                <IconChevronRight />
              </Button>
              <Button
                variant="outline"
                className="hidden size-8 lg:flex"
                size="icon"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Ir a la última página</span>
                <IconChevronsRight />
              </Button>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  )
}
