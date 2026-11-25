"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CloudUpload, Eye, LayoutTemplate, Lock, Monitor, PanelLeft, PanelRight, SlidersHorizontal, Smartphone, Tablet, RefreshCw, Maximize2, Minimize2 } from "lucide-react";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
import { notifyActionResult } from "@/components/feedback/notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useGroupRef, usePanelRef, type Layout } from "react-resizable-panels";
import { arrangeSidePanels, defaultEditorLayout, EDITOR_PANEL_SIZES, previewMinSize, readEditorLayout, saveEditorLayout, sidePanelLayout, type EditorPanelMode, type SidePanel, type SidePanelState } from "./editor-layout";
import { useEditorPanelMode } from "./use-panel-mode";
import { ScrollArea } from "@/components/ui/scroll-area";
import { saveDraftAction } from "../api/actions";
import type { SiteState } from "../api/model";
import { createAutosave, type AutosaveController, type HistoryTarget } from "../autosave";
import { useAutosave } from "../use-autosave";
import { BLOCK_LIBRARY_V2, defaultBlockV2 } from "../defaults";
import type { SiteBlockV2 } from "../model";
import { SECTIONS_V2_ENABLED } from "../sections-v2";
import { cn } from "@/lib/utils";
import { canPublish, RECRUITER_PUBLISH_REASON } from "../permissions";
import { CompanySitePresentation } from "../public/company-site-presentation";
import { fixedSectionAlign } from "../public/section-style";
import type { CompanySitePreviewData } from "../public/presentation-types";
import { CareersSiteEditorLoading, SaveStatus } from "./editor-feedback";
import { PreviewFrame } from "./preview-frame";
import { SectionLibrary, SectionList } from "./section-list";
import { VariantPicker } from "./variant-picker";
import { SectionForm } from "./forms/section-form";
import { SectionStyleControls } from "./forms/section-style";
import { HeroButtons } from "./forms/v2-fields";
import { PropertyGroups } from "./property-groups";
import { SectionLibraryPanel, SectionLibrarySheet, type LibraryPreview } from "./section-library";
import { useWorkspaceHeight } from "./use-workspace-height";
import { BrandSettings, SiteSettings } from "./site-settings";
import { SitePublication, type PublicationTarget } from "./publication";
import { HistoryControls, useHistoryShortcuts } from "./editor-history";
import { SectionDragPreviewProvider, useSectionDragPreview } from "./dnd/section-drag-preview";
import { addBlockAction, type EditorState } from "../editor-state";

const DELETED_TOAST = "company-site-section-deleted";

export type CareersSiteEditorProps = { initialSite: SiteState; role: string; preview: CompanySitePreviewData; notice?: string };
/** Controller lifetime is effect-owned: React StrictMode cleanup creates a fresh
 * session rather than retaining a disposed controller on the second mount. */
export function CareersSiteEditor({ initialSite, ...props }: CareersSiteEditorProps) {
  const [controller, setController] = useState<AutosaveController | null>(null);
  const [replacement, setReplacement] = useState<SiteState | null>(null);
  const source = replacement ?? initialSite;
  useEffect(() => {
    const session = createAutosave(source, `"${source.draft_version}"`, saveDraftAction);
    session.dispatch({ type: "select", id: source.draft.blocks[0]?.id ?? null });
    setController(session);
    return () => session.dispose();
  }, [source]);
  if (!controller) return <CareersSiteEditorLoading />;
  return <EditorSession key={source.updated_at + source.draft_version} controller={controller} onLoadSite={setReplacement} {...props} />;
}
function PreviewScroll({ desktop, children }: { desktop: boolean; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!desktop) return;
    const viewport = root.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) return;
    // The installed ScrollArea exposes only root props. Bridge accessibility to
    // its real scrolling viewport locally, without changing the shared primitive.
    // Base UI may later reset tabIndex while measuring an unloaded iframe.
    const makeFocusable = () => {
      if (viewport.tabIndex !== 0) viewport.tabIndex = 0;
      if (viewport.getAttribute("role") !== "region") viewport.setAttribute("role", "region");
      if (viewport.getAttribute("aria-label") !== "Vista previa en vivo") viewport.setAttribute("aria-label", "Vista previa en vivo");
    };
    makeFocusable();
    const observer = new MutationObserver(makeFocusable);
    observer.observe(viewport, { attributes: true, attributeFilter: ["tabindex", "role", "aria-label"] });
    return () => observer.disconnect();
  }, [desktop]);
  const content = <div className="relative min-w-0 p-3">{children}</div>;
  return desktop ? <ScrollArea ref={root} className="min-h-0 min-w-0 flex-1">{content}</ScrollArea> : content;
}
type PanelControls = { sectionsToggle?: ReactNode; propertiesToggle?: ReactNode };
type PreviewContent = (controls: PanelControls) => ReactNode;
function DesktopPanels({ sections, properties, children, focused: previewFocused, library, mode }: { sections: ReactNode; properties: ReactNode; children: PreviewContent; focused: boolean; library?: ReactNode; mode: EditorPanelMode }) {
  // The docked library (sections v2) borrows the focus mechanics: side panes fold away
  // while it is open and come back exactly as they were, never persisted.
  const focused = previewFocused || Boolean(library);
  // This component mounts only inside the client-owned EditorSession, so the
  // persisted layout is available before its first paint (no hydration swap).
  const [initial] = useState(readEditorLayout);
  const [collapsed, setCollapsed] = useState({ sections: initial?.sections === 0, properties: initial?.properties === 0 });
  const group = useGroupRef();
  const left = usePanelRef();
  const right = usePanelRef();
  const root = useRef<HTMLDivElement>(null);
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  /** The engine allocates the group's inner width minus its two separators (0 when unmeasured). */
  const measure = useCallback(() => {
    const element = root.current?.querySelector<HTMLElement>('[data-group]');
    if (!element) return 0;
    return element.getBoundingClientRect().width - Array.from(element.querySelectorAll<HTMLElement>('[data-separator]')).reduce((sum, handle) => sum + handle.getBoundingClientRect().width, 0);
  }, []);
  const previous = useRef<Layout | null>(null);
  const toggling = useRef(false);
  const focusing = useRef(focused);
  // Which side panel was folded to make room for the other (L3), and each panel's last open width.
  const remembered = useRef<SidePanel | null>(null);
  const lastSizes = useRef<Partial<Record<SidePanel, number>>>({});
  const apply = useCallback((next: SidePanelState, persist: boolean) => {
    remembered.current = next.remembered;
    const width = measure();
    toggling.current = persist;
    if (width > 0) { group.current?.setLayout(sidePanelLayout(width, rem(), next.shown, lastSizes.current)); return; }
    // Unmeasured (no layout engine): plain collapse/expand, folding before expanding.
    for (const [id, panel] of [["sections", left], ["properties", right]] as const) if (!next.shown[id]) panel.current?.collapse();
    for (const [id, panel] of [["sections", left], ["properties", right]] as const) if (next.shown[id] && panel.current?.isCollapsed()) panel.current.expand();
  }, [group, left, right, measure]);
  /** Fold or restore side panels so the current layout fits the space (never persisted). */
  const fit = useCallback(() => {
    const layout = group.current?.getLayout();
    if (!layout) return;
    const shown = { sections: layout.sections > 0, properties: layout.properties > 0 };
    const next = arrangeSidePanels(mode, { shown, remembered: remembered.current }, { type: "fit" });
    if (next.shown.sections !== shown.sections || next.shown.properties !== shown.properties) apply(next, false);
    else remembered.current = next.remembered;
  }, [mode, group, apply]);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (first && !initial) {
      const width = measure();
      if (width > 0) group.current?.setLayout(defaultEditorLayout(width, rem()));
      return;
    }
    if (!focusing.current) fit();
  }, [initial, group, measure, fit]);
  useLayoutEffect(() => {
    focusing.current = focused;
    if (focused) {
      previous.current = group.current?.getLayout() ?? null;
      group.current?.setLayout({ sections: 0, preview: 100, properties: 0 });
    } else if (previous.current) {
      group.current?.setLayout(previous.current);
      previous.current = null;
      fit();
    }
  }, [focused, group]); // eslint-disable-line react-hooks/exhaustive-deps -- `fit` follows the mode; only focus changes restore
  function persistReset() {
    // The registry's native double-click reset uses the imperative API, so it
    // isn't tagged as user interaction by the library's persistence callback.
    const layout = group.current?.getLayout();
    if (layout && !focused) saveEditorLayout(layout);
  }
  function track(layout: Layout) {
    if (focusing.current) return;
    const width = measure();
    if (width > 0) for (const id of ["sections", "properties"] as const) if (layout[id] > 0) lastSizes.current[id] = layout[id] / 100 * width;
    setCollapsed(current => current.sections === (layout.sections === 0) && current.properties === (layout.properties === 0) ? current : { sections: layout.sections === 0, properties: layout.properties === 0 });
  }
  function toggle(id: 'sections' | 'properties') {
    const expanded = !focused && !collapsed[id];
    const action = `${expanded ? 'Ocultar' : 'Mostrar'} ${id === 'sections' ? 'secciones' : 'propiedades'}`;
    const panel = id === 'sections' ? left : right;
    const Icon = id === 'sections' ? PanelLeft : PanelRight;
    return <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon" className="size-10" disabled={focused} aria-label={action} aria-expanded={expanded} aria-controls={`editor-${id}`} onClick={() => {
      const layout = group.current?.getLayout();
      const shown = layout ? { sections: layout.sections > 0, properties: layout.properties > 0 } : { sections: !collapsed.sections, properties: !collapsed.properties };
      apply(arrangeSidePanels(mode, { shown, remembered: remembered.current }, { type: panel.current?.isCollapsed() ? "show" : "hide", panel: id }), true);
    }} />}><Icon aria-hidden="true" /></TooltipTrigger><TooltipContent>{library ? 'Cierra la biblioteca para mostrar los paneles' : focused ? 'Sal de la vista enfocada para mostrar los paneles' : action}</TooltipContent></Tooltip>;
  }
  return <div ref={root} className={cn("flex min-h-0 min-w-0 flex-1", library ? "flex-row gap-3" : "flex-col")}>
    {library && <div data-editor-region="library" className="flex min-h-0 w-[clamp(22rem,46%,44rem)] shrink-0 flex-col">{library}</div>}
    <ResizablePanelGroup id="careers-editor" orientation="horizontal" groupRef={group} defaultLayout={initial} className="min-h-0 min-w-0 flex-1" onLayoutChange={track} onLayoutChanged={(layout, meta) => { if (!focusing.current && (meta.isUserInteraction || toggling.current)) { saveEditorLayout(meta.requestedLayout ?? layout); toggling.current = false; } }}>
      <ResizablePanel id="sections" panelRef={left} defaultSize={EDITOR_PANEL_SIZES.sections.default} minSize={EDITOR_PANEL_SIZES.sections.min} maxSize={EDITOR_PANEL_SIZES.sections.max} collapsible collapsedSize={0} groupResizeBehavior="preserve-pixel-size" className="h-full min-w-0">
        <aside id="editor-sections" hidden={focused || collapsed.sections} data-editor-region="sections" aria-label="Organizar sitio" className="h-full min-h-0 min-w-0"><ScrollArea className="h-full min-w-0"><div className="p-1 pr-3">{sections}</div></ScrollArea></aside>
      </ResizablePanel>
      <ResizableHandle withHandle disabled={focused} aria-label="Ajustar secciones" onDoubleClick={persistReset} />
      <ResizablePanel id="preview" minSize={previewMinSize(mode)} className="flex h-full min-h-0 min-w-0 flex-col">{children({ sectionsToggle: toggle('sections'), propertiesToggle: toggle('properties') })}</ResizablePanel>
      <ResizableHandle withHandle disabled={focused} aria-label="Ajustar propiedades" onDoubleClick={persistReset} />
      <ResizablePanel id="properties" panelRef={right} defaultSize={EDITOR_PANEL_SIZES.properties.default} minSize={EDITOR_PANEL_SIZES.properties.min} maxSize={EDITOR_PANEL_SIZES.properties.max} collapsible collapsedSize={0} groupResizeBehavior="preserve-pixel-size" className="h-full min-w-0">
        <aside id="editor-properties" hidden={focused || collapsed.properties} data-editor-region="properties" aria-label="Propiedades de la sección" className="h-full min-h-0 min-w-0">
          {/* Scrolls on its own, vertically only: nothing may widen the panel past its
              minimum (the viewport's inline overflow:scroll would let it pan sideways). */}
          <ScrollArea className="h-full min-w-0 [&>[data-slot=scroll-area-viewport]]:overflow-x-hidden!"><div data-properties-content="" className="relative min-w-0 p-3">{properties}</div></ScrollArea>
        </aside>
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>;
}
function EditorSurface({ desktop, mode, sections, properties, focused, library, children }: { desktop: boolean; mode: EditorPanelMode; sections: ReactNode; properties: ReactNode; focused: boolean; library?: ReactNode; children: PreviewContent }) {
  return desktop ? <DesktopPanels sections={sections} properties={properties} focused={focused} library={library} mode={mode}>{children}</DesktopPanels> : children({});
}
/** The live preview follows a section drag from the list: an insertion line at
 * the landing gap (scrolled into view) and the dragged section dimmed. Kept
 * apart so each drag step re-renders only the preview, not the whole editor. */
function LivePreview({ editor, preview, viewportWidth, onSelect, onScaleChange, insertion = null }: { editor: EditorState; preview: CompanySitePreviewData; viewportWidth: number; onSelect: (id: string) => void; onScaleChange: (scale: number) => void; insertion?: { block: SiteBlockV2; index: number } | null }) {
  const drag = useSectionDragPreview();
  // Library insertion (S4): the new section drawn at its landing index, selected and
  // framed with the drag mark. It never enters the draft until «Agregar».
  const blocks = editor.draft.blocks;
  const site = insertion ? { ...editor.draft, blocks: [...blocks.slice(0, insertion.index), insertion.block, ...blocks.slice(insertion.index)] } : editor.draft;
  const selected = insertion ? insertion.block.id : editor.selectedId;
  const dragPreview = insertion ? { activeId: insertion.block.id, toIndex: insertion.index, allowed: true } : drag;
  return <PreviewFrame title="Vista previa del sitio" viewportWidth={viewportWidth} selectedBlockId={selected} revealKey={drag?.allowed ? `${drag.activeId}:${drag.toIndex}` : null} onScaleChange={onScaleChange}>
    <CompanySitePresentation site={site} {...preview} selectedBlockId={selected} onSelectBlock={id => { if (id !== insertion?.block.id) onSelect(id); }} dragPreview={dragPreview} />
  </PreviewFrame>;
}
function EditorSession({ controller, role, preview, notice, onLoadSite }: Omit<CareersSiteEditorProps, "initialSite"> & { controller: AutosaveController; onLoadSite: (site: SiteState) => void }) {
  const { editor, status, history } = useAutosave(controller);
  const [tab, setTab] = useState("sections");
  // Publication responses do not replace the autosave draft or newer local
  // edits. Their metadata lasts until the next confirmed autosave snapshot.
  const [publication, setPublication] = useState<{ published: SiteState["published"]; baseline: SiteState } | undefined>(undefined);
  const [publishConflict, setPublishConflict] = useState<SiteState | null>(null);
  const publicationIsCurrent = publication?.baseline === editor.server;
  const published = publicationIsCurrent ? publication!.published : editor.server.published;
  const unpublishedChanges = editor.dirty || (published !== null && editor.draft_version !== published.version) || (!publicationIsCurrent && editor.server.has_unpublished_changes);
  // EditorSession mounts only after the client-owned controller is ready. Pick
  // the default once; resizing must never undo an explicit device choice.
  const [device, setDevice] = useState(() => !window.matchMedia("(min-width: 768px)").matches ? "mobile" : "desktop");
  const [previewFocused, setPreviewFocused] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [library, setLibrary] = useState(false); const [visitor, setVisitor] = useState(false);
  const [libraryPreview, setLibraryPreview] = useState<LibraryPreview>(null);
  const addTrigger = useRef<HTMLElement | null>(null);
  // One stable stand-in per chosen section and layout, so the preview doesn't remount it on every render.
  const ghost = useMemo(() => libraryPreview ? { ...defaultBlockV2(libraryPreview.type), variant: libraryPreview.variant } as SiteBlockV2 : null, [libraryPreview?.type, libraryPreview?.variant]); // eslint-disable-line react-hooks/exhaustive-deps

  const visitorTrigger = useRef<HTMLButtonElement>(null);
  const [sectionsOpen, setSectionsOpen] = useState(false); const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [reload, setReload] = useState(false); const [keepMine, setKeepMine] = useState(false);
  const [wideViewport, setWideViewport] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const panelMode = useEditorPanelMode(workspaceRef, wideViewport);
  // Docked panels need at least one side panel beside the compact preview; otherwise the
  // narrow desktop uses the phone layout's Sheets, so no panel is ever unreachable (L3).
  const desktop = wideViewport && panelMode !== "overlay";
  const workspace = useWorkspaceHeight(desktop, workspaceRef);
  const libraryDocked = SECTIONS_V2_ENABLED && desktop && library;
  const insertion = libraryDocked && ghost && libraryPreview ? { block: ghost, index: libraryPreview.index } : null;
  const closeLibrary = useCallback(() => { setLibrary(false); setLibraryPreview(null); requestAnimationFrame(() => addTrigger.current?.focus()); }, []);
  const addFromLibrary = useCallback((type: SiteBlockV2["type"], variant: string, index: number) => {
    const action = addBlockAction(type, { variant, index });
    if (action.type === "add") controller.dispatch(action);
    setLibrary(false); setLibraryPreview(null); setTab("sections");
  }, [controller]);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setWideViewport(query.matches);
    update(); query.addEventListener("change", update); return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => { if (desktop) { setSectionsOpen(false); setPropertiesOpen(false); } }, [desktop]);
  useEffect(() => {
    if (!editor.dirty && status.kind !== "offline" && status.kind !== "saving") return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [editor.dirty, status.kind]);
  const select = useCallback((id: string) => { controller.dispatch({ type: "select", id }); setTab("sections"); }, [controller]);
  // The controller already selected the changed section; show the tab that owns the change.
  const showHistoryTarget = useCallback((target: HistoryTarget | null) => { if (target) setTab(target.area); }, []);
  const undo = useCallback(() => showHistoryTarget(controller.undo()), [controller, showHistoryTarget]);
  const redo = useCallback(() => showHistoryTarget(controller.redo()), [controller, showHistoryTarget]);
  useHistoryShortcuts(undo, redo);
  const reorder = useCallback((id: string, toIndex: number) => controller.dispatch({ type: "reorder", id, toIndex }), [controller]);
  // A toast that outlives this session is inert: a disposed controller ignores dispatches.
  const removeBlock = useCallback((block: SiteBlockV2) => {
    const exists = () => controller.getSnapshot().editor.draft.blocks.some(item => item.id === block.id);
    const before = controller.getSnapshot().editor.draft.blocks;
    const index = before.findIndex(item => item.id === block.id);
    // Deleting clears a Portada button that led here; «Deshacer» points it back in the same step.
    const heroTarget = before.some(item => item.type === "hero" && item.content.secondary_target === block.id);
    controller.dispatch({ type: "delete", id: block.id });
    if (exists()) return;
    notifyActionResult({ key: DELETED_TOAST, type: "success", title: "Sección eliminada", description: `${BLOCK_LIBRARY_V2[block.type].label} ya no está en tu borrador.`, action: { title: "Deshacer", onClick: () => {
      // Ctrl+Z may already have brought it back; then only show it.
      if (!exists()) controller.dispatch({ type: "insert", block, index, ...(heroTarget ? { heroTarget } : {}) });
      select(block.id);
    } } });
  }, [controller, select]);
  function navigateIssue(target: PublicationTarget) {
    setTab(target.tab); setPreviewFocused(false);
    if (target.blockId) select(target.blockId);
    if (target.library) setLibrary(true);
    if (!desktop && !target.library) { setSectionsOpen(!target.blockId); setPropertiesOpen(Boolean(target.blockId)); }
  }
  const selected = editor.draft.blocks.find(block => block.id === editor.selectedId);
  const deviceWidth = device === "desktop" ? 1280 : device === "tablet" ? 768 : 390;
  const url = editor.draft.slug ? `/empresas/${editor.draft.slug}` : "Elige la dirección de tu sitio";
  const visibility = selected && <Field orientation="horizontal" data-disabled={selected.type === "hero" || selected.type === "jobs"}><FieldContent><FieldLabel htmlFor={`visible-${selected.id}`}>Visible en el sitio</FieldLabel>{(selected.type === "hero" || selected.type === "jobs") && <FieldDescription>Esta sección siempre está visible.</FieldDescription>}</FieldContent><Switch id={`visible-${selected.id}`} checked={!selected.hidden} disabled={selected.type === "hero" || selected.type === "jobs"} onCheckedChange={checked => controller.dispatch({ type: "hidden", id: selected.id, hidden: !checked })} /></Field>;
  const properties = <div className="flex min-w-0 flex-col gap-6">{selected ? <>
    {desktop && <div className="flex flex-col gap-2"><h2 className="text-base font-semibold">Propiedades de {BLOCK_LIBRARY_V2[selected.type].label}</h2><p className="text-sm text-muted-foreground">Cambia la composición sin perder contenido.</p></div>}
    {SECTIONS_V2_ENABLED ? <PropertyGroups groups={[
      { id: "layout", title: "Diseño de sección", content: <><VariantPicker block={selected} labelHidden onChange={variant => controller.dispatch({ type: "variant", id: selected.id, variant })} />{visibility}</> },
      { id: "style", title: "Estilo de sección", content: <SectionStyleControls blockId={selected.id} style={selected.style} fixedAlign={fixedSectionAlign(selected)} theme={editor.draft.theme} fieldErrors={editor.fieldErrors} onChange={style => controller.dispatch({ type: "style", id: selected.id, style })} /> },
      { id: "content", title: "Contenido", content: <SectionForm block={selected} dispatch={controller.dispatch} fieldErrors={editor.fieldErrors} /> },
      ...(selected.type === "hero" ? [{ id: "buttons" as const, title: "Botones", content: <HeroButtons block={selected} blocks={editor.draft.blocks} fieldErrors={editor.fieldErrors} onChange={content => controller.dispatch({ type: "content", id: selected.id, content })} /> }] : []),
    ]} /> : <>
      <VariantPicker block={selected} onChange={variant => controller.dispatch({ type: "variant", id: selected.id, variant })} />
      {visibility}
      <Separator /><SectionForm block={selected} dispatch={controller.dispatch} fieldErrors={editor.fieldErrors} />
    </>}
    {editor.fieldErrors.some(error => error.blockId === selected.id) && <p role="status" className="text-sm text-muted-foreground">Esta sección tiene campos que revisar.</p>}
  </> : <SectionEmpty title="Selecciona una sección para verla aquí" description="Elige una sección de la lista o de la vista previa para cambiar su contenido y diseño." icon={LayoutTemplate} tone="info" />}</div>;
  const sections = <Tabs value={tab} onValueChange={value => setTab(String(value))} className="flex min-w-0 flex-col gap-5">
    <TabsList variant="line" aria-label="Editor del sitio" className="w-full"><TabsTrigger value="sections" className="flex-1 px-1">Secciones</TabsTrigger><TabsTrigger value="brand" className="flex-1 px-1">Marca</TabsTrigger><TabsTrigger value="settings" className="flex-1 px-1">Ajustes</TabsTrigger></TabsList>
    <TabsContent value="sections"><SectionList editor={editor} controller={controller} onSelect={id => { select(id); setSectionsOpen(false); if (!desktop) setPropertiesOpen(true); }} onDelete={removeBlock} onReorder={reorder} onAdd={() => { addTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setSectionsOpen(false); setLibrary(true); }} /></TabsContent>
    <TabsContent value="brand"><BrandSettings theme={editor.draft.theme} onChange={theme => controller.dispatch({ type: "theme", theme })} /></TabsContent>
    <TabsContent value="settings" className="px-1 py-1 pr-3"><SiteSettings draft={editor.draft} savedSlug={editor.lastSaved.slug} slugError={editor.fieldErrors.find(error => error.field === "slug" && !error.blockId)} company={preview.company} onSlug={slug => controller.dispatch({ type: "slug", slug })} onSeo={seo => controller.dispatch({ type: "seo", seo })} /></TabsContent>
  </Tabs>;
  return <TooltipProvider><SectionDragPreviewProvider><div ref={workspace.ref} data-editor-workspace="" onBlur={() => controller.checkpoint()} style={{ height: workspace.height }} className="flex min-h-0 min-w-0 flex-col gap-4 lg:overflow-hidden">
    <header data-editor-region="toolbar" className="flex shrink-0 flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-2"><div className="flex flex-wrap items-center gap-3"><h2 className="text-xl font-semibold">{preview.company.name}</h2><Badge variant={published ? unpublishedChanges ? "review" : "success" : "neutral"} dot>{published ? unpublishedChanges ? "Cambios sin publicar" : "Publicado" : "Sin publicar"}</Badge>{published && <a href={`/empresas/${encodeURIComponent(published.slug)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center text-sm underline underline-offset-4">Ver sitio</a>}</div>{editor.draft.slug ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground underline underline-offset-4">{url}</a> : <p className="text-sm text-muted-foreground">{url}</p>}</div>
      <div className="flex flex-wrap items-center gap-3"><HistoryControls canUndo={history.canUndo} canRedo={history.canRedo} onUndo={undo} onRedo={redo} /><SaveStatus status={status} dirty={editor.dirty} onLoadLatest={() => setReload(true)} onRetry={() => { void controller.retry(); }} />{status.kind === "conflict" && <Button variant="link" className="min-h-10" onClick={() => setKeepMine(true)}>Conservar mis cambios</Button>}<Button variant="outline" className="min-h-10" ref={visitorTrigger} onClick={() => setVisitor(true)}><Eye aria-hidden="true" data-icon="inline-start" />Ver como visitante</Button>
        <SitePublication controller={controller} role={role} company={preview.company} companyKnown={!notice} published={published} onState={state => setPublication({ published: state.published, baseline: controller.getSnapshot().editor.server })} onNavigate={navigateIssue} onConflict={current => { setPublishConflict(current); setReload(true); }} />
      </div>
    </header>
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {!canPublish(role) && <p className="text-sm text-muted-foreground">{RECRUITER_PUBLISH_REASON}</p>}
    {!desktop && <div className="flex flex-wrap items-center gap-2">
      <Sheet open={sectionsOpen} onOpenChange={setSectionsOpen}><SheetTrigger render={<Button variant="outline" className="min-h-10" />}><PanelLeft aria-hidden="true" data-icon="inline-start" />Secciones</SheetTrigger><SheetContent side="left" showCloseButton={false}><SheetHeader className="border-b"><SheetTitle>Tu sitio</SheetTitle><SheetDescription>Organiza las secciones de tu página.</SheetDescription></SheetHeader><div className="min-h-0 flex-1 overflow-y-auto p-4">{sections}</div><SheetFooter className="border-t"><SheetClose render={<Button variant="outline" className="min-h-10" />}>Volver a la vista previa</SheetClose></SheetFooter></SheetContent></Sheet>
      <Sheet open={propertiesOpen} onOpenChange={setPropertiesOpen}><SheetTrigger render={<Button variant="outline" className="min-h-10" />}><SlidersHorizontal aria-hidden="true" data-icon="inline-start" />Propiedades</SheetTrigger><SheetContent showCloseButton={false}><SheetHeader className="border-b"><SheetTitle>{selected ? BLOCK_LIBRARY_V2[selected.type].label : "Selecciona una sección"}</SheetTitle><SheetDescription>Cambia la composición sin perder contenido.</SheetDescription></SheetHeader><div className="min-h-0 flex-1 overflow-y-auto p-5">{properties}</div><SheetFooter className="border-t"><SheetClose render={<Button variant="outline" className="min-h-10" />}>Volver a la vista previa</SheetClose></SheetFooter></SheetContent></Sheet>
    </div>}
    {/* A single editor surface. Sidebars own independent desktop scroll; mobile
        uses the page, with only the currently open Sheet owning a scroll area. */}
    <EditorSurface desktop={desktop} mode={panelMode} sections={sections} properties={properties} focused={previewFocused} library={libraryDocked ? <SectionLibraryPanel editor={editor} onAdd={addFromLibrary} onClose={closeLibrary} onPreview={setLibraryPreview} /> : undefined}>
      {({ sectionsToggle, propertiesToggle }) => <div data-editor-region="preview" className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted">
        <div role="group" aria-label="Herramientas de vista previa" className="flex items-center gap-2 border-b border-border p-2 xl:p-3">{sectionsToggle}<p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">Vista previa en vivo</p>
          <div className="flex flex-wrap items-center gap-2"><span aria-label="Zoom de la vista previa" className="text-xs text-muted-foreground tabular-nums">{Math.round(zoom * 100)} %</span>
          <ToggleGroup variant="segmented" aria-label="Dispositivo de vista previa" value={[device]} onValueChange={values => { if (values[0]) setDevice(values[0]); }}>
            {([["desktop", "Escritorio", Monitor], ["tablet", "Tableta", Tablet], ["mobile", "Móvil", Smartphone]] as const).map(([value, label, Icon]) => <ToggleGroupItem key={value} value={value} aria-label={label}><Icon aria-hidden="true" /></ToggleGroupItem>)}
          </ToggleGroup>
          {desktop && <Button variant="ghost" size="icon" className="size-10" aria-label="Enfocar vista previa" aria-pressed={previewFocused} onClick={() => setPreviewFocused(value => !value)}>{previewFocused ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</Button>}
          </div>
          {propertiesToggle}
        </div>
        <PreviewScroll desktop={desktop}>
          <Card className="mx-auto w-full overflow-hidden [--card-spacing:--spacing(2)]" style={{ maxWidth: deviceWidth }} data-device={device}>
            <CardHeader className="border-b"><CardTitle className="flex items-center gap-2"><Lock className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate text-xs text-muted-foreground">{url}</span></CardTitle><CardDescription className="sr-only">Vista privada del borrador</CardDescription></CardHeader>
            <CardContent className="-mx-(--card-spacing) -mb-(--card-spacing)"><LivePreview editor={editor} preview={preview} viewportWidth={deviceWidth} onSelect={select} onScaleChange={setZoom} insertion={insertion} /></CardContent>
          </Card>
          <p className="mt-4 text-center text-xs text-muted-foreground">Haz clic en una sección para seleccionarla.</p>
        </PreviewScroll>
      </div>}
    </EditorSurface>
    <p className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"><Lock className="size-4 shrink-0" aria-hidden="true" />Tus cambios solo son visibles para tu equipo hasta que publiques.</p>
    {/* Sections v2: the visual library docks beside the preview on desktop and opens in a
        Sheet below lg; with the flag off today's text dialog stays exactly as it was. */}
    {SECTIONS_V2_ENABLED ? !desktop && <SectionLibrarySheet open={library} onOpenChange={open => { if (open) setLibrary(true); else closeLibrary(); }} editor={editor} onAdd={addFromLibrary} />
      : <SectionLibrary open={library} onOpenChange={setLibrary} editor={editor} controller={controller} />}
    <ConfirmActionDialog open={keepMine && status.kind === "conflict"} onOpenChange={setKeepMine} icon={CloudUpload} title="¿Conservar tus cambios?" description="Tu versión se guardará y reemplazará los cambios que hizo la otra persona." confirmLabel="Conservar mis cambios" onConfirm={() => {
      if (status.kind === "conflict") controller.resolveConflict(status.current, `"${status.current.draft_version}"`, "keep-local");
      setKeepMine(false);
    }} />
    <ConfirmActionDialog open={reload} onOpenChange={setReload} icon={RefreshCw} title="¿Cargar la versión más reciente?" description="Tus cambios locales se descartarán y se cargará la versión que guardó la otra persona." confirmLabel="Cargar versión" onConfirm={() => {
      const autosaveConflict = status.kind === "conflict" ? status.current : null;
      const latest = autosaveConflict && (!publishConflict || autosaveConflict.draft_version >= publishConflict.draft_version) ? autosaveConflict : publishConflict;
      if (latest === autosaveConflict && latest) controller.resolveConflict(latest, `"${latest.draft_version}"`, "use-server");
      else if (latest) onLoadSite(latest);
      setPublishConflict(null); setPublication(undefined); setReload(false);
    }} />
    <Dialog open={visitor} onOpenChange={setVisitor}><DialogContent finalFocus={visitorTrigger} className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-6xl"><DialogHeader><DialogTitle>Vista previa pública</DialogTitle><DialogDescription>{!published ? "Solo tu equipo puede ver este borrador. Aún no está publicado." : unpublishedChanges ? "Solo tu equipo puede ver este borrador. Tu sitio publicado todavía no incluye estos cambios." : "Así se ve tu sitio publicado."}</DialogDescription></DialogHeader><div className="min-h-0 overflow-y-auto"><PreviewFrame title="Vista del visitante"><CompanySitePresentation site={editor.draft} {...preview} /></PreviewFrame></div><DialogFooter><DialogClose render={<Button variant="outline" className="min-h-10" />}>Volver al editor</DialogClose></DialogFooter></DialogContent></Dialog>
  </div></SectionDragPreviewProvider></TooltipProvider>;
}
