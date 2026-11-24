"use client";
import { useState } from "react";
import { CircleAlert, Download, Info } from "lucide-react";
import { ActionStatus } from "@/components/feedback/action-status";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { describeRange, mxToday, PRESETS, presetRange, rangeKeyOf, type RangeKey } from "./date-range";
import { downloadFilename, saveBlob } from "./download";
import { activeChips } from "./filter-model";
import { DateInputs } from "./filter-panels";
import { EXPORT_RANGE_MESSAGES, exportErrorMessage, exportRangeError, type AuditOptions, type ExportError } from "./model";
import { toExportBody, type AuditFilters } from "./url-state";

const ROUTE = "/api/company/audit-events/export";
type Message = { tone: "error" | "success"; text: string };

async function errorOf(response: Response): Promise<ExportError> {
  try {
    const body: unknown = await response.json();
    const { code, row_count, limit } = (body ?? {}) as Record<string, unknown>;
    return {
      status: response.status,
      ...(typeof code === "string" ? { code } : {}),
      ...(typeof row_count === "number" && typeof limit === "number" ? { row_count, limit } : {}),
    };
  } catch { return { status: response.status }; }
}

/** The panel starts from the list's range; with none it starts from the last 30 days so the export is valid right away. */
function initialRange(filters: AuditFilters, today: string): { key: RangeKey; from: string; to: string } {
  if (!filters.from && !filters.to) return { key: "30", ...presetRange("30", today) };
  return { key: rangeKeyOf(filters, today) ?? "custom", from: filters.from ?? "", to: filters.to ?? "" };
}

function ExportPanel({ filters, options, onClose, phone }: { filters: AuditFilters; options: AuditOptions | null; onClose: () => void; phone: boolean }) {
  const Title = phone ? DrawerTitle : PopoverTitle;
  const Description = phone ? DrawerDescription : PopoverDescription;
  const action = phone ? "min-h-11 flex-1" : "min-h-10";
  const today = mxToday();
  const [range, setRange] = useState(() => initialRange(filters, today));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const issue = exportRangeError(range.from || undefined, range.to || undefined);
  const applied = activeChips({ ...filters, from: undefined, to: undefined }, options, today);

  async function run() {
    if (pending || issue) return;
    setPending(true); setMessage(null);
    try {
      const response = await fetch(ROUTE, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(toExportBody({ ...filters, from: range.from, to: range.to })) });
      if (!response.ok) { setMessage({ tone: "error", text: exportErrorMessage(await errorOf(response)) }); return; }
      saveBlob(await response.blob(), downloadFilename(response.headers.get("content-disposition")));
      setMessage({ tone: "success", text: "Exportación descargada · queda registrada en la auditoría" });
    } catch { setMessage({ tone: "error", text: exportErrorMessage({}) }); }
    finally { setPending(false); }
  }
  const done = message?.tone === "success";
  const choose = (key: RangeKey | undefined) => {
    if (!key) return;
    setMessage(null);
    setRange(key === "custom" ? { key, from: range.from, to: range.to } : { key, ...presetRange(key, today) });
  };

  return <div className="flex flex-col gap-4">
    <div className="flex flex-col gap-1"><Title>Exportar a CSV</Title>
      <Description>Descarga los eventos con los filtros activos. La exportación queda registrada en la auditoría.</Description></div>
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Rango de fechas <span className="font-normal text-muted-foreground">· obligatorio, máximo 366 días</span></span>
      <ToggleGroup aria-label="Rango de la exportación" variant="segmented" className="h-11! w-full" value={[range.key]} onValueChange={(values: string[]) => choose(values[0] as RangeKey | undefined)}>
        {PRESETS.map(preset => <ToggleGroupItem key={preset.key} value={preset.key} className="min-h-9 flex-1">{preset.label}</ToggleGroupItem>)}
        <ToggleGroupItem value="custom" className="min-h-9 flex-1">Personalizado</ToggleGroupItem>
      </ToggleGroup>
    </div>
    {range.key === "custom" && <DateInputs idPrefix="audit-export" from={range.from} to={range.to} onChange={next => { setMessage(null); setRange({ key: "custom", ...next }); }} />}
    {issue ? <p role="alert" className="flex items-start gap-2 text-sm text-status-danger"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{EXPORT_RANGE_MESSAGES[issue]}</p>
      : message?.tone === "error" ? <p role="alert" className="flex items-start gap-2 text-sm text-status-danger"><CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{message.text}</p>
        : done ? <ActionStatus id="audit-export-status" tone="success" text={message.text} />
          : <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground"><Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{describeRange(range, today)}</p>}
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium" id="audit-export-applied">Filtros que se aplican</span>
      {applied.length ? <ul aria-labelledby="audit-export-applied" className="flex flex-col gap-1 text-sm [overflow-wrap:anywhere]">{applied.map(chip => <li key={chip.key}><span className="text-muted-foreground">{`${chip.name}:`}</span> {chip.value}</li>)}</ul>
        : <p className="text-sm text-muted-foreground">Ningún otro filtro: se exportan todas las personas, acciones y vacantes del rango.</p>}
    </div>
    <div className="flex flex-wrap justify-end gap-2">
      {done ? <Button type="button" className={action} onClick={onClose}>Listo</Button> : <>
        <Button type="button" variant="outline" className={action} onClick={onClose}>Cancelar</Button>
        <Button type="button" className={action} disabled={pending || issue !== undefined} aria-busy={pending} onClick={() => void run()}>
          {pending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <Download data-icon="inline-start" aria-hidden="true" />}
          {pending ? "Descargando…" : "Descargar CSV"}
        </Button></>}
    </div>
  </div>;
}

/**
 * Owner-only export, always available: the button opens a panel that requires a valid range (both days, ≤ 366) before it downloads.
 * Nothing is downloaded unless the route answers 200. The hint under the button keeps its line, so the toolbar never shifts.
 */
export function ExportAuditButton({ filters, options, phone = false }: { filters: AuditFilters; options: AuditOptions | null; phone?: boolean }) {
  const [open, setOpen] = useState(false);
  const range = filters.from || filters.to ? describeRange(filters, mxToday()) : null;
  const trigger = <Button type="button" variant="outline" className={phone ? "min-h-11 max-sm:w-full" : "min-h-10 max-sm:w-full"} aria-haspopup="dialog"><Download data-icon="inline-start" aria-hidden="true" />Exportar CSV</Button>;
  return <div className="flex min-w-0 flex-col items-start gap-1 sm:items-end max-sm:w-full">
    {phone
      // On a phone the panel is a bottom drawer (artboard `audit-log-redesign/01`, 390 px); its content scrolls so the buttons stay reachable.
      ? <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger render={trigger} />
        <DrawerContent><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"><ExportPanel filters={filters} options={options} onClose={() => setOpen(false)} phone /></div></DrawerContent>
      </Drawer>
      : <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={trigger} />
        <PopoverContent align="end" aria-label="Exportar a CSV" className="w-[min(420px,calc(100vw-2rem))] p-4">
          <ExportPanel filters={filters} options={options} onClose={() => setOpen(false)} phone={false} />
        </PopoverContent>
      </Popover>}
    <div data-pf-audit-export-slot="" className="flex min-h-4 max-w-md items-start sm:justify-end">
      <p className="flex items-start gap-1 text-xs leading-4 text-muted-foreground sm:text-right"><Info aria-hidden="true" className="mt-0.5 size-3 shrink-0" />{range ? `Exportación: ${range}` : "Requiere un rango de fechas · máx. 366 días"}</p>
    </div>
  </div>;
}
