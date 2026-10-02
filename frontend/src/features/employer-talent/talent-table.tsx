"use client";

import * as React from "react";
import {
  columnOrderingFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  FlexRender,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type Column,
  type ColumnOrderState,
  type ColumnPinningState,
  type ColumnSizingState,
  type ColumnVisibilityState,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import { cn } from "cn";
import {
  IconArrowBarToLeft,
  IconArrowBarToRight,
  IconArrowsSort,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconChevronsLeft,
  IconChevronsRight,
  IconDots,
  IconGripVertical,
  IconLayoutColumns,
  IconMapPin,
  IconPin,
  IconUserSearch,
} from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DEFAULT_TALENT_COLUMN_PINNING,
  TALENT_AVAILABILITY_LABELS,
  TALENT_COLUMN_DEFAULT_VISIBILITY,
  TALENT_COLUMN_IDS,
  TALENT_COLUMN_LABELS,
  TALENT_COLUMN_SIZES,
  TALENT_MODALITY_LABELS,
  applicationsByMostRecent,
  formatTalentApplicationsCount,
  formatTalentDate,
  formatTalentYears,
  moveIdToIndex,
  regionOfTalentColumn,
  talentFullNameInitials,
  talentLastApplicationAt,
  type TalentAvailability,
  type TalentColumnId,
  type TalentPerson,
} from "./model";
import {
  TALENT_AVAILABILITY_VARIANT,
  TALENT_MODALITY_VARIANT,
} from "./talent-detail-sheet";

/**
 * Rich, local table of the talent base. It owns sorting, pagination, column
 * visibility, pinning, ordering and pixel sizing entirely in React state: no
 * transport, storage or persistence. Pinned offsets come from the single
 * `columnSizing` source through `column.getStart`/`column.getAfter`, never from
 * percentages.
 *
 * Every header carries a dedicated drag handle (native pointer drag starts on
 * the handle, never on the whole header), the sortable label and a three-dot
 * menu with the keyboard-accessible move alternatives plus pinning. Visibility
 * is one compact multi-select menu in the toolbar; the table never renders a
 * giant configuration panel.
 */

const features = tableFeatures({
  columnVisibilityFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnSizingFeature,
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
});

const columnHelper = createColumnHelper<typeof features, TalentPerson>();

type Region = "start" | "end" | "center";

const AVAILABILITY_ORDER: Readonly<Record<TalentAvailability, number>> = {
  immediate: 0,
  two_weeks: 1,
  one_month: 2,
  to_confirm: 3,
};

function pinStyle<TValue>(
  column: Column<typeof features, TalentPerson, TValue>,
): React.CSSProperties {
  const pinned = column.getIsPinned();
  const width = column.getSize();
  if (pinned === "start") {
    return { position: "sticky", left: column.getStart("start"), width };
  }
  if (pinned === "end") {
    return { position: "sticky", right: column.getAfter("end"), width };
  }
  return { width };
}

function ariaSortValue<TValue>(
  column: Column<typeof features, TalentPerson, TValue>,
): "ascending" | "descending" | "none" {
  const sorted = column.getIsSorted();
  if (sorted === "asc") return "ascending";
  if (sorted === "desc") return "descending";
  return "none";
}

/**
 * Movement is anchored on the columns the user can actually see. A hidden
 * column never becomes a neighbour, so one click always moves the column past
 * the next visible one, and the first/last visible column of a region keeps its
 * boundary controls disabled. The hidden ids stay in the array untouched, so
 * their visibility and relative order survive the reorder.
 */
function moveIdToVisibleNeighbor(
  ids: readonly string[],
  id: string,
  direction: -1 | 1,
  isVisible: (value: string) => boolean,
): string[] {
  const visible = ids.filter(isVisible);
  const index = visible.indexOf(id);
  if (index < 0) return [...ids];
  const neighbor = visible[index + direction];
  if (neighbor === undefined) return [...ids];
  const rest = ids.filter((item) => item !== id);
  const neighborIndex = rest.indexOf(neighbor);
  if (neighborIndex < 0) return [...ids];
  const insertAt = direction === -1 ? neighborIndex : neighborIndex + 1;
  rest.splice(insertAt, 0, id);
  return rest;
}

/** Moves `id` to the first or last visible position of its region. */
function moveIdToVisibleEdge(
  ids: readonly string[],
  id: string,
  edge: "start" | "end",
  isVisible: (value: string) => boolean,
): string[] {
  const visible = ids.filter(isVisible);
  const anchor = edge === "start" ? visible[0] : visible[visible.length - 1];
  if (anchor === undefined || anchor === id) return [...ids];
  const rest = ids.filter((item) => item !== id);
  const anchorIndex = rest.indexOf(anchor);
  if (anchorIndex < 0) return [...ids];
  const insertAt = edge === "start" ? anchorIndex : anchorIndex + 1;
  rest.splice(insertAt, 0, id);
  return rest;
}

/**
 * Header cell: dedicated drag handle + sortable label + three-dot menu. The
 * drop target stays the whole `th`; only the pointer drag starts on the handle.
 */
function TalentHeaderCell<TValue>({
  column,
  region,
  index,
  regionLength,
  onPin,
  onMove,
  onMoveToEdge,
  onDragStart,
  onDragEnd,
}: {
  column: Column<typeof features, TalentPerson, TValue>;
  region: Region;
  index: number;
  regionLength: number;
  onPin: (id: string, position: "start" | "end") => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onMoveToEdge: (id: string, edge: "start" | "end") => void;
  onDragStart: (event: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
}) {
  const id = column.id;
  const label = TALENT_COLUMN_LABELS[id as TalentColumnId] ?? id;
  const sorted = column.getIsSorted();
  const pinned = column.getIsPinned();
  const canMoveStart = index > 0;
  const canMoveEnd = index < regionLength - 1;

  return (
    <div className="flex items-center gap-0.5">
      <span
        data-pf-talento-column-handle={id}
        draggable
        onDragStart={(event) => onDragStart(event, id)}
        onDragEnd={onDragEnd}
        aria-hidden="true"
        className="shrink-0 cursor-grab text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
      >
        <IconGripVertical className="size-3.5" />
      </span>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-pf-talento-sort={id}
        className="-ml-1 h-7 min-w-0 flex-1 justify-start gap-1 px-1.5"
        disabled={!column.getCanSort()}
        onClick={() => column.toggleSorting()}
      >
        <span className="truncate">{label}</span>
        {sorted === "asc" ? (
          <IconChevronUp data-icon="inline-end" aria-hidden="true" />
        ) : sorted === "desc" ? (
          <IconChevronDown data-icon="inline-end" aria-hidden="true" />
        ) : (
          <IconArrowsSort
            data-icon="inline-end"
            aria-hidden="true"
            className="text-muted-foreground"
          />
        )}
      </Button>

      {pinned ? (
        <span
          data-pf-talento-pinned-indicator={id}
          aria-hidden="true"
          className="shrink-0 text-muted-foreground"
        >
          <IconPin className="size-3.5" />
        </span>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              data-pf-talento-column-menu={id}
              aria-label={`Opciones de ${label}`}
            />
          }
        >
          <IconDots aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          data-pf-talento-column-menu-content={id}
          className="min-w-56"
        >
          <DropdownMenuGroup>
            <DropdownMenuItem
              data-pf-talento-column-move-start={id}
              disabled={!canMoveStart}
              onClick={() => onMoveToEdge(id, "start")}
            >
              <IconChevronsLeft aria-hidden="true" />
              Mover al inicio
            </DropdownMenuItem>
            <DropdownMenuItem
              data-pf-talento-column-move-left={id}
              disabled={!canMoveStart}
              onClick={() => onMove(id, -1)}
            >
              <IconChevronLeft aria-hidden="true" />
              Mover a la izquierda
            </DropdownMenuItem>
            <DropdownMenuItem
              data-pf-talento-column-move-right={id}
              disabled={!canMoveEnd}
              onClick={() => onMove(id, 1)}
            >
              <IconChevronRight aria-hidden="true" />
              Mover a la derecha
            </DropdownMenuItem>
            <DropdownMenuItem
              data-pf-talento-column-move-end={id}
              disabled={!canMoveEnd}
              onClick={() => onMoveToEdge(id, "end")}
            >
              <IconChevronsRight aria-hidden="true" />
              Mover al final
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              data-pf-talento-column-pin-start={id}
              disabled={!column.getCanPin()}
              onClick={() => onPin(id, "start")}
            >
              <IconArrowBarToLeft aria-hidden="true" />
              {region === "start"
                ? `Quitar ${label} del inicio`
                : `Fijar ${label} al inicio`}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-pf-talento-column-pin-end={id}
              disabled={!column.getCanPin()}
              onClick={() => onPin(id, "end")}
            >
              <IconArrowBarToRight aria-hidden="true" />
              {region === "end"
                ? `Quitar ${label} del final`
                : `Fijar ${label} al final`}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SkillsCell({ skills }: { skills: readonly string[] }) {
  const shown = skills.slice(0, 2);
  const rest = skills.length - shown.length;
  return (
    <span className="flex items-center gap-1">
      {shown.map((skill) => (
        <Badge key={skill} variant="outline" className="text-muted-foreground">
          {skill}
        </Badge>
      ))}
      {rest > 0 ? (
        <span className="text-xs text-muted-foreground">{`+${rest}`}</span>
      ) : null}
    </span>
  );
}

export type TalentTableProps = {
  people: readonly TalentPerson[];
  onSelectPerson: (id: string) => void;
  selectedPersonId: string | null;
  /** Page size for the local paginator. */
  pageSize?: number;
  /** Optional recovery action shown in the truthful empty state. */
  onClearFilters?: () => void;
};

export function TalentTable({
  people,
  onSelectPerson,
  selectedPersonId,
  pageSize = 10,
  onClearFilters,
}: TalentTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] =
    React.useState<ColumnVisibilityState>({ ...TALENT_COLUMN_DEFAULT_VISIBILITY });
  const [columnPinning, setColumnPinning] = React.useState<ColumnPinningState>({
    start: [...DEFAULT_TALENT_COLUMN_PINNING.start],
    end: [...DEFAULT_TALENT_COLUMN_PINNING.end],
  });
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>([
    ...TALENT_COLUMN_IDS,
  ]);
  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>({
    ...TALENT_COLUMN_SIZES,
  });
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  });
  const [draggingId, setDraggingId] = React.useState<string | null>(null);

  const data = React.useMemo(() => [...people], [people]);

  React.useEffect(() => {
    setPagination((current) =>
      current.pageIndex === 0 ? current : { ...current, pageIndex: 0 },
    );
  }, [people]);

  const columnRegion = React.useCallback(
    (id: string) => regionOfTalentColumn(columnPinning, id),
    [columnPinning],
  );

  const regionIds = React.useCallback(
    (region: Region): string[] => {
      if (region === "start") return [...columnPinning.start];
      if (region === "end") return [...columnPinning.end];
      return columnOrder.filter(
        (id) => regionOfTalentColumn(columnPinning, id) === "center",
      );
    },
    [columnPinning, columnOrder],
  );

  const isColumnVisible = React.useCallback(
    (id: string) => columnVisibility[id] !== false,
    [columnVisibility],
  );

  const visibleRegionIds = React.useCallback(
    (region: Region): string[] => regionIds(region).filter(isColumnVisible),
    [regionIds, isColumnVisible],
  );

  const applyRegionOrder = React.useCallback(
    (region: Region, next: readonly string[]) => {
      if (region === "center") {
        setColumnOrder([
          ...columnPinning.start,
          ...next,
          ...columnPinning.end,
        ]);
        return;
      }
      setColumnPinning((current) =>
        region === "start"
          ? { ...current, start: [...next] }
          : { ...current, end: [...next] },
      );
    },
    [columnPinning.start, columnPinning.end],
  );

  const reorderColumns = React.useCallback(
    (fromId: string, toId: string) => {
      const fromRegion = columnRegion(fromId);
      if (fromRegion !== columnRegion(toId)) return;
      const list = regionIds(fromRegion);
      applyRegionOrder(
        fromRegion,
        moveIdToIndex(list, fromId, list.indexOf(toId)),
      );
    },
    [columnRegion, regionIds, applyRegionOrder],
  );

  const moveColumn = React.useCallback(
    (id: string, direction: -1 | 1) => {
      const region = columnRegion(id);
      applyRegionOrder(
        region,
        moveIdToVisibleNeighbor(regionIds(region), id, direction, isColumnVisible),
      );
    },
    [columnRegion, regionIds, isColumnVisible, applyRegionOrder],
  );

  const moveColumnToEdge = React.useCallback(
    (id: string, edge: "start" | "end") => {
      const region = columnRegion(id);
      applyRegionOrder(
        region,
        moveIdToVisibleEdge(regionIds(region), id, edge, isColumnVisible),
      );
    },
    [columnRegion, regionIds, isColumnVisible, applyRegionOrder],
  );

  const togglePin = React.useCallback((id: string, position: "start" | "end") => {
    setColumnPinning((current) => {
      const isPinned =
        position === "start"
          ? current.start.includes(id)
          : current.end.includes(id);
      const start = current.start.filter((value) => value !== id);
      const end = current.end.filter((value) => value !== id);
      if (isPinned) return { start, end };
      return position === "start"
        ? { start: [...start, id], end }
        : { start, end: [...end, id] };
    });
  }, []);

  const handleDragStart = React.useCallback(
    (event: React.DragEvent, id: string) => {
      setDraggingId(id);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", id);
      }
    },
    [],
  );

  const handleDragEnd = React.useCallback(() => setDraggingId(null), []);

  const handleDragOver = React.useCallback(
    (event: React.DragEvent, id: string) => {
      if (!draggingId || draggingId === id) return;
      if (columnRegion(draggingId) !== columnRegion(id)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    },
    [draggingId, columnRegion],
  );

  const handleDrop = React.useCallback(
    (event: React.DragEvent, id: string) => {
      event.preventDefault();
      if (draggingId && draggingId !== id) reorderColumns(draggingId, id);
      setDraggingId(null);
    },
    [draggingId, reorderColumns],
  );

  const columns = React.useMemo(() => {
    function renderHeader<TValue>(
      column: Column<typeof features, TalentPerson, TValue>,
    ) {
      const region = columnRegion(column.id);
      const list = visibleRegionIds(region);
      return (
        <TalentHeaderCell
          column={column}
          region={region}
          index={list.indexOf(column.id)}
          regionLength={list.length}
          onPin={togglePin}
          onMove={moveColumn}
          onMoveToEdge={moveColumnToEdge}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        />
      );
    }
    return columnHelper.columns([
        columnHelper.accessor((row) => row.fullName, {
          id: "fullName",
          header: ({ column }) => renderHeader(column),
          cell: ({ row }) => (
            // Identity hierarchy: a decorative avatar, the name as the primary
            // control (its exact accessible name stays the person's name) and
            // the professional title as the secondary line. The avatar is
            // aria-hidden so its initials never reach the accessible name.
            <div className="flex items-center gap-3">
              <Avatar aria-hidden="true" size="sm" className="size-9 shrink-0">
                <AvatarFallback className="bg-muted font-medium text-muted-foreground">
                  {talentFullNameInitials(row.original.fullName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <Button
                  type="button"
                  variant="link"
                  data-pf-talento-open={row.original.id}
                  className="h-auto min-w-0 max-w-[200px] justify-start px-0 text-left font-medium text-foreground"
                  onClick={() => onSelectPerson(row.original.id)}
                >
                  <span className="truncate">{row.original.fullName}</span>
                </Button>
                <span className="truncate text-xs text-muted-foreground">
                  {row.original.professionalTitle}
                </span>
              </div>
            </div>
          ),
          size: TALENT_COLUMN_SIZES.fullName,
          minSize: 180,
          enableHiding: false,
        }),
        columnHelper.accessor((row) => row.professionalTitle, {
          id: "professionalTitle",
          header: ({ column }) => renderHeader(column),
          cell: ({ row }) => (
            <span className="text-muted-foreground">
              {row.original.professionalTitle}
            </span>
          ),
          size: TALENT_COLUMN_SIZES.professionalTitle,
          minSize: 160,
        }),
        columnHelper.accessor((row) => row.currentCompany, {
          id: "currentCompany",
          header: ({ column }) => renderHeader(column),
          cell: ({ row }) => (
            <span className="text-muted-foreground">
              {row.original.currentCompany}
            </span>
          ),
          size: TALENT_COLUMN_SIZES.currentCompany,
          minSize: 160,
        }),
        columnHelper.accessor((row) => row.industry, {
          id: "industry",
          header: ({ column }) => renderHeader(column),
          cell: ({ row }) => (
            <span className="text-muted-foreground">{row.original.industry}</span>
          ),
          size: TALENT_COLUMN_SIZES.industry,
          minSize: 130,
        }),
        columnHelper.accessor((row) => row.location, {
          id: "location",
          header: ({ column }) => renderHeader(column),
          cell: ({ row }) => (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <IconMapPin aria-hidden="true" className="size-3.5" />
              {row.original.location}
            </span>
          ),
          size: TALENT_COLUMN_SIZES.location,
          minSize: 130,
        }),
        columnHelper.accessor((row) => row.yearsOfExperience, {
          id: "yearsOfExperience",
          header: ({ column }) => renderHeader(column),
          cell: ({ row }) => (
            <span className="tabular-nums">
              {formatTalentYears(row.original.yearsOfExperience)}
            </span>
          ),
          size: TALENT_COLUMN_SIZES.yearsOfExperience,
          minSize: 110,
        }),
        columnHelper.accessor((row) => row.skills.join(", "), {
          id: "skills",
          header: ({ column }) => renderHeader(column),
          cell: ({ row }) => <SkillsCell skills={row.original.skills} />,
          size: TALENT_COLUMN_SIZES.skills,
          minSize: 200,
        }),
        columnHelper.accessor((row) => row.preferredModality, {
          id: "preferredModality",
          header: ({ column }) => renderHeader(column),
          cell: ({ row }) => (
            <Badge variant={TALENT_MODALITY_VARIANT[row.original.preferredModality]}>
              {TALENT_MODALITY_LABELS[row.original.preferredModality]}
            </Badge>
          ),
          size: TALENT_COLUMN_SIZES.preferredModality,
          minSize: 130,
        }),
        columnHelper.accessor((row) => row.availability, {
          id: "availability",
          header: ({ column }) => renderHeader(column),
          sortFn: (rowA, rowB) =>
            AVAILABILITY_ORDER[rowA.original.availability] -
            AVAILABILITY_ORDER[rowB.original.availability],
          cell: ({ row }) => (
            <Badge variant={TALENT_AVAILABILITY_VARIANT[row.original.availability]}>
              {TALENT_AVAILABILITY_LABELS[row.original.availability]}
            </Badge>
          ),
          size: TALENT_COLUMN_SIZES.availability,
          minSize: 150,
        }),
        columnHelper.accessor((row) => row.applications.length, {
          id: "applicationsCount",
          header: ({ column }) => renderHeader(column),
          cell: ({ row }) => (
            <Badge variant="secondary">
              {formatTalentApplicationsCount(row.original.applications.length)}
            </Badge>
          ),
          size: TALENT_COLUMN_SIZES.applicationsCount,
          minSize: 130,
        }),
        columnHelper.accessor(
          (row) => applicationsByMostRecent(row)[0]?.appliedAt ?? "",
          {
            id: "lastApplicationAt",
            header: ({ column }) => renderHeader(column),
            cell: ({ row }) => {
              const last = talentLastApplicationAt(row.original);
              return (
                <span className="text-muted-foreground">
                  {last ? formatTalentDate(last) : "Sin postulaciones"}
                </span>
              );
            },
            size: TALENT_COLUMN_SIZES.lastApplicationAt,
            minSize: 150,
          },
        ),
        columnHelper.accessor((row) => row.email, {
          id: "email",
          header: ({ column }) => renderHeader(column),
          cell: ({ row }) => (
            <span className="text-muted-foreground">{row.original.email}</span>
          ),
          size: TALENT_COLUMN_SIZES.email,
          minSize: 200,
        }),
        columnHelper.accessor((row) => row.phone, {
          id: "phone",
          header: ({ column }) => renderHeader(column),
          cell: ({ row }) => (
            <span className="tabular-nums text-muted-foreground">
              {row.original.phone}
            </span>
          ),
          size: TALENT_COLUMN_SIZES.phone,
          minSize: 150,
        }),
        columnHelper.accessor((row) => row.education, {
          id: "education",
          header: ({ column }) => renderHeader(column),
          cell: ({ row }) => (
            <span className="text-muted-foreground">{row.original.education}</span>
          ),
          size: TALENT_COLUMN_SIZES.education,
          minSize: 220,
        }),
        columnHelper.accessor(
          (row) => row.languages.map((language) => language.name).join(", "),
          {
            id: "languages",
            header: ({ column }) => renderHeader(column),
            cell: ({ row }) => (
              <span className="text-muted-foreground">
                {row.original.languages
                  .map((language) => language.name)
                  .join(" · ")}
              </span>
            ),
            size: TALENT_COLUMN_SIZES.languages,
            minSize: 170,
          },
        ),
    ]);
  }, [
    onSelectPerson,
    columnRegion,
    visibleRegionIds,
    togglePin,
    moveColumn,
    moveColumnToEdge,
    handleDragStart,
    handleDragEnd,
  ]);

  const table = useTable({
    features,
    data,
    columns,
    state: {
      sorting,
      columnVisibility,
      columnPinning,
      columnOrder,
      columnSizing,
      pagination,
    },
    getRowId: (row) => row.id,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnPinningChange: setColumnPinning,
    onColumnOrderChange: setColumnOrder,
    onColumnSizingChange: setColumnSizing,
    onPaginationChange: setPagination,
  });

  const pageRows = table.getRowModel().rows;
  const totalRows = table.getFilteredRowModel().rows.length;
  const pageCount = Math.max(table.getPageCount(), 1);
  const hiddenCount = TALENT_COLUMN_IDS.filter((id) => {
    const column = table.getColumn(id);
    return column ? column.getCanHide() && !column.getIsVisible() : false;
  }).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p data-pf-talento-result-count="" className="text-sm text-muted-foreground">
          {totalRows === 0
            ? "Sin personas"
            : `Mostrando ${pageRows.length} de ${totalRows} ${
                totalRows === 1 ? "persona" : "personas"
              }`}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-pf-talento-columns=""
                aria-label="Columnas"
              >
                <IconLayoutColumns data-icon="inline-start" aria-hidden="true" />
                <span className="hidden sm:inline">Columnas</span>
                {hiddenCount > 0 ? (
                  <Badge variant="secondary">{hiddenCount}</Badge>
                ) : null}
              </Button>
            }
          />
          <DropdownMenuContent
            align="end"
            data-pf-talento-columns-menu=""
            className="max-h-80 min-w-56 overflow-y-auto"
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Columnas visibles</DropdownMenuLabel>
              {TALENT_COLUMN_IDS.map((id) => {
                const column = table.getColumn(id);
                if (!column) return null;
                const label = TALENT_COLUMN_LABELS[id];
                const canHide = column.getCanHide();
                return (
                  <DropdownMenuCheckboxItem
                    key={id}
                    data-pf-talento-column-toggle={id}
                    checked={column.getIsVisible()}
                    disabled={!canHide}
                    onCheckedChange={(value) => column.toggleVisibility(!!value)}
                    className="min-h-9"
                  >
                    {label}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-hidden rounded-2xl shadow-sm ring-1 ring-foreground/5">
        <Table
          data-pf-talento-table=""
          className="table-fixed"
          style={{ minWidth: table.getTotalSize() }}
        >
          <TableHeader className="sticky top-0 z-10 bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const pinned = header.column.getIsPinned();
                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      data-pf-talento-th={header.column.id}
                      data-pinned={pinned || undefined}
                      aria-sort={ariaSortValue(header.column)}
                      onDragOver={(event) =>
                        handleDragOver(event, header.column.id)
                      }
                      onDrop={(event) => handleDrop(event, header.column.id)}
                      style={pinStyle(header.column)}
                      className={cn("px-4", pinned && "z-20 bg-muted")}
                    >
                      {header.isPlaceholder ? null : (
                        <FlexRender header={header} />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {pageRows.length ? (
              pageRows.map((row) => (
                <TableRow
                  key={row.id}
                  data-pf-talento-row={row.original.id}
                  data-state={
                    row.original.id === selectedPersonId ? "selected" : undefined
                  }
                  className="h-[70px] border-border/60"
                >
                  {row.getVisibleCells().map((cell) => {
                    const pinned = cell.column.getIsPinned();
                    return (
                      <TableCell
                        key={cell.id}
                        data-pinned={pinned || undefined}
                        style={pinStyle(cell.column)}
                        className={cn("px-4 py-3", pinned && "z-10 bg-background")}
                      >
                        <FlexRender cell={cell} />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length}
                  className="p-0"
                >
                  <Empty data-pf-talento-empty="">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <IconUserSearch aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle>Sin resultados</EmptyTitle>
                      <EmptyDescription>
                        Ajusta la búsqueda o quita filtros para ver más personas.
                      </EmptyDescription>
                    </EmptyHeader>
                    {onClearFilters ? (
                      <EmptyContent>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={onClearFilters}
                        >
                          Limpiar filtros
                        </Button>
                      </EmptyContent>
                    ) : null}
                  </Empty>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {`Página ${pagination.pageIndex + 1} de ${pageCount}`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Ir a la primera página</span>
            <IconChevronsLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <span className="sr-only">Ir a la página anterior</span>
            <IconChevronLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Ir a la página siguiente</span>
            <IconChevronRight aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <span className="sr-only">Ir a la última página</span>
            <IconChevronsRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
