"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Eye, LayoutTemplate, Lock, Monitor, PanelLeft, PanelRight, SlidersHorizontal, Smartphone, Tablet, Trash2, RefreshCw, Maximize2, Minimize2 } from "lucide-react";
import { ConfirmActionDialog } from "@/components/feedback/confirm-action-dialog";
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
import { defaultEditorLayout, EDITOR_PANEL_SIZES, readEditorLayout, saveEditorLayout } from "./editor-layout";
import { ScrollArea } from "@/components/ui/scroll-area";
import { saveDraftAction } from "../api/actions";
import type { SiteState } from "../api/model";
import { createAutosave, type AutosaveController } from "../autosave";
import { useAutosave } from "../use-autosave";
import { BLOCK_LIBRARY } from "../defaults";
import type { SiteBlock } from "../model";
import { canPublish, RECRUITER_PUBLISH_REASON } from "../permissions";
import { CompanySitePresentation } from "../public/company-site-presentation";
import type { CompanySitePreviewData } from "../public/presentation-types";
import { CareersSiteEditorLoading, SaveStatus } from "./editor-feedback";
import { PreviewFrame } from "./preview-frame";
import { SectionLibrary, SectionList } from "./section-list";
import { VariantPicker } from "./variant-picker";
import { SectionForm } from "./forms/section-form";
import { useWorkspaceHeight } from "./use-workspace-height";
import { BrandSettings, SiteSettings } from "./site-settings";
import { SitePublication, type PublicationTarget } from "./publication";

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
  const content = <div className="min-w-0 p-3">{children}</div>;
  return desktop ? <ScrollArea ref={root} className="min-h-0 min-w-0 flex-1">{content}</ScrollArea> : content;
}
type PanelControls = { sectionsToggle?: ReactNode; propertiesToggle?: ReactNode };
type PreviewContent = (controls: PanelControls) => ReactNode;
function DesktopPanels({ sections, properties, children, focused }: { sections: ReactNode; properties: ReactNode; children: PreviewContent; focused: boolean }) {
  // This component mounts only inside the client-owned EditorSession, so the
  // persisted layout is available before its first paint (no hydration swap).
  const [initial] = useState(readEditorLayout);
  const [collapsed, setCollapsed] = useState({ sections: initial?.sections === 0, properties: initial?.properties === 0 });
  const group = useGroupRef();
  const left = usePanelRef();
  const right = usePanelRef();
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (initial) return;
    const element = root.current?.querySelector<HTMLElement>('[data-group]');
    if (!element) return;
    // The engine allocates the group's inner width minus its two separators.
    const width = element.getBoundingClientRect().width - Array.from(element.querySelectorAll<HTMLElement>('[data-separator]')).reduce((sum, handle) => sum + handle.getBoundingClientRect().width, 0);
    if (width > 0) group.current?.setLayout(defaultEditorLayout(width, parseFloat(getComputedStyle(document.documentElement).fontSize) || 16));
  }, [initial, group]);
  const previous = useRef<Layout | null>(null);
  const toggling = useRef(false);
  const focusing = useRef(focused);
  useLayoutEffect(() => {
    focusing.current = focused;
    if (focused) {
      previous.current = group.current?.getLayout() ?? null;
      group.current?.setLayout({ sections: 0, preview: 100, properties: 0 });
    } else if (previous.current) {
      group.current?.setLayout(previous.current);
      previous.current = null;
    }
  }, [focused, group]);
  function persistReset() {
    // The registry's native double-click reset uses the imperative API, so it
    // isn't tagged as user interaction by the library's persistence callback.
    const layout = group.current?.getLayout();
    if (layout && !focused) saveEditorLayout(layout);
  }
  function track(layout: Layout) {
    if (focusing.current) return;
    setCollapsed(current => current.sections === (layout.sections === 0) && current.properties === (layout.properties === 0) ? current : { sections: layout.sections === 0, properties: layout.properties === 0 });
  }
  function toggle(id: 'sections' | 'properties') {
    const expanded = !focused && !collapsed[id];
    const action = `${expanded ? 'Ocultar' : 'Mostrar'} ${id === 'sections' ? 'secciones' : 'propiedades'}`;
    const panel = id === 'sections' ? left : right;
    const Icon = id === 'sections' ? PanelLeft : PanelRight;
    return <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon" className="size-10" disabled={focused} aria-label={action} aria-expanded={expanded} aria-controls={`editor-${id}`} onClick={() => { toggling.current = true; if (panel.current?.isCollapsed()) panel.current.expand(); else panel.current?.collapse(); }} />}><Icon aria-hidden="true" /></TooltipTrigger><TooltipContent>{focused ? 'Sal de la vista enfocada para mostrar los paneles' : action}</TooltipContent></Tooltip>;
  }
  return <div ref={root} className="flex min-h-0 min-w-0 flex-1 flex-col">
    <ResizablePanelGroup id="careers-editor" orientation="horizontal" groupRef={group} defaultLayout={initial} className="min-h-0 flex-1" onLayoutChange={track} onLayoutChanged={(layout, meta) => { if (!focusing.current && (meta.isUserInteraction || toggling.current)) { saveEditorLayout(meta.requestedLayout ?? layout); toggling.current = false; } }}>
      <ResizablePanel id="sections" panelRef={left} defaultSize={EDITOR_PANEL_SIZES.sections.default} minSize={EDITOR_PANEL_SIZES.sections.min} maxSize={EDITOR_PANEL_SIZES.sections.max} collapsible collapsedSize={0} groupResizeBehavior="preserve-pixel-size" className="h-full min-w-0">
        <aside id="editor-sections" hidden={focused || collapsed.sections} data-editor-region="sections" aria-label="Organizar sitio" className="h-full min-h-0 min-w-0"><ScrollArea className="h-full min-w-0"><div className="p-1 pr-3">{sections}</div></ScrollArea></aside>
      </ResizablePanel>
      <ResizableHandle withHandle disabled={focused} aria-label="Ajustar secciones" onDoubleClick={persistReset} />
      <ResizablePanel id="preview" minSize={EDITOR_PANEL_SIZES.preview.min} className="flex h-full min-h-0 min-w-0 flex-col">{children({ sectionsToggle: toggle('sections'), propertiesToggle: toggle('properties') })}</ResizablePanel>
      <ResizableHandle withHandle disabled={focused} aria-label="Ajustar propiedades" onDoubleClick={persistReset} />
      <ResizablePanel id="properties" panelRef={right} defaultSize={EDITOR_PANEL_SIZES.properties.default} minSize={EDITOR_PANEL_SIZES.properties.min} maxSize={EDITOR_PANEL_SIZES.properties.max} collapsible collapsedSize={0} groupResizeBehavior="preserve-pixel-size" className="h-full min-w-0">
        <aside id="editor-properties" hidden={focused || collapsed.properties} data-editor-region="properties" aria-label="Propiedades de la sección" className="h-full min-h-0 min-w-0"><ScrollArea className="h-full min-w-0"><div className="p-3">{properties}</div></ScrollArea></aside>
      </ResizablePanel>
    </ResizablePanelGroup>
  </div>;
}
function EditorSurface({ desktop, sections, properties, focused, children }: { desktop: boolean; sections: ReactNode; properties: ReactNode; focused: boolean; children: PreviewContent }) {
  return desktop ? <DesktopPanels sections={sections} properties={properties} focused={focused}>{children}</DesktopPanels> : children({});
}
function EditorSession({ controller, role, preview, notice, onLoadSite }: Omit<CareersSiteEditorProps, "initialSite"> & { controller: AutosaveController; onLoadSite: (site: SiteState) => void }) {
  const { editor, status } = useAutosave(controller);
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
  const visitorTrigger = useRef<HTMLButtonElement>(null);
  const [sectionsOpen, setSectionsOpen] = useState(false); const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [deleting, setDeleting] = useState<SiteBlock | null>(null); const [reload, setReload] = useState(false);
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const workspace = useWorkspaceHeight(desktop);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => { setDesktop(query.matches); if (query.matches) { setSectionsOpen(false); setPropertiesOpen(false); } };
    update(); query.addEventListener("change", update); return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!editor.dirty && status.kind !== "offline" && status.kind !== "saving") return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload); return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [editor.dirty, status.kind]);
  const select = useCallback((id: string) => { controller.dispatch({ type: "select", id }); setTab("sections"); }, [controller]);
  function navigateIssue(target: PublicationTarget) {
    setTab(target.tab); setPreviewFocused(false);
    if (target.blockId) select(target.blockId);
    if (target.library) setLibrary(true);
    if (!desktop && !target.library) { setSectionsOpen(!target.blockId); setPropertiesOpen(Boolean(target.blockId)); }
  }
  const selected = editor.draft.blocks.find(block => block.id === editor.selectedId);
  const deviceWidth = device === "desktop" ? 1280 : device === "tablet" ? 768 : 390;
  const url = editor.draft.slug ? `/empresas/${editor.draft.slug}` : "Elige la dirección de tu sitio";
  const properties = <div className="flex flex-col gap-6">{selected ? <>
    {desktop && <div className="flex flex-col gap-2"><h2 className="text-base font-semibold">Propiedades de {BLOCK_LIBRARY[selected.type].label}</h2><p className="text-sm text-muted-foreground">Cambia la composición sin perder contenido.</p></div>}
    <VariantPicker block={selected} onChange={variant => controller.dispatch({ type: "variant", id: selected.id, variant })} />
    <Field orientation="horizontal" data-disabled={selected.type === "hero" || selected.type === "jobs"}><FieldContent><FieldLabel htmlFor={`visible-${selected.id}`}>Visible en el sitio</FieldLabel>{(selected.type === "hero" || selected.type === "jobs") && <FieldDescription>Esta sección siempre está visible.</FieldDescription>}</FieldContent><Switch id={`visible-${selected.id}`} checked={!selected.hidden} disabled={selected.type === "hero" || selected.type === "jobs"} onCheckedChange={checked => controller.dispatch({ type: "hidden", id: selected.id, hidden: !checked })} /></Field>
    <Separator /><SectionForm block={selected} dispatch={controller.dispatch} fieldErrors={editor.fieldErrors} />
    {editor.fieldErrors.some(error => error.blockId === selected.id) && <p role="status" className="text-sm text-muted-foreground">Esta sección tiene campos que revisar.</p>}
  </> : <SectionEmpty title="Selecciona una sección para verla aquí" description="Elige una sección de la lista o de la vista previa para cambiar su contenido y diseño." icon={LayoutTemplate} tone="info" />}</div>;
  const sections = <Tabs value={tab} onValueChange={value => setTab(String(value))} className="flex min-w-0 flex-col gap-5">
    <TabsList variant="line" aria-label="Editor del sitio" className="w-full"><TabsTrigger value="sections" className="flex-1 px-1">Secciones</TabsTrigger><TabsTrigger value="brand" className="flex-1 px-1">Marca</TabsTrigger><TabsTrigger value="settings" className="flex-1 px-1">Ajustes</TabsTrigger></TabsList>
    <TabsContent value="sections"><SectionList editor={editor} controller={controller} onSelect={id => { select(id); setSectionsOpen(false); if (!desktop) setPropertiesOpen(true); }} onDelete={setDeleting} onAdd={() => { setSectionsOpen(false); setLibrary(true); }} /></TabsContent>
    <TabsContent value="brand"><BrandSettings theme={editor.draft.theme} onChange={theme => controller.dispatch({ type: "theme", theme })} /></TabsContent>
    <TabsContent value="settings" className="px-1 py-1 pr-3"><SiteSettings draft={editor.draft} savedSlug={editor.lastSaved.slug} slugError={editor.fieldErrors.find(error => error.field === "slug" && !error.blockId)} company={preview.company} onSlug={slug => controller.dispatch({ type: "slug", slug })} onSeo={seo => controller.dispatch({ type: "seo", seo })} /></TabsContent>
  </Tabs>;
  return <TooltipProvider><div ref={workspace.ref} data-editor-workspace="" style={{ height: workspace.height }} className="flex min-h-0 min-w-0 flex-col gap-4 lg:overflow-hidden">
    <header data-editor-region="toolbar" className="flex shrink-0 flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-2"><div className="flex flex-wrap items-center gap-3"><h2 className="text-xl font-semibold">{preview.company.name}</h2><Badge variant={published ? unpublishedChanges ? "review" : "success" : "neutral"} dot>{published ? unpublishedChanges ? "Cambios sin publicar" : "Publicado" : "Sin publicar"}</Badge>{published && <a href={`/empresas/${encodeURIComponent(published.slug)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center text-sm underline underline-offset-4">Ver sitio</a>}</div>{editor.draft.slug ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground underline underline-offset-4">{url}</a> : <p className="text-sm text-muted-foreground">{url}</p>}</div>
      <div className="flex flex-wrap items-center gap-3"><SaveStatus status={status} dirty={editor.dirty} onLoadLatest={() => setReload(true)} onRetry={() => { void controller.retry(); }} /><Button variant="outline" className="min-h-10" ref={visitorTrigger} onClick={() => setVisitor(true)}><Eye aria-hidden="true" data-icon="inline-start" />Ver como visitante</Button>
        <SitePublication controller={controller} role={role} company={preview.company} companyKnown={!notice} published={published} onState={state => setPublication({ published: state.published, baseline: controller.getSnapshot().editor.server })} onNavigate={navigateIssue} onConflict={current => { setPublishConflict(current); setReload(true); }} />
      </div>
    </header>
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {!canPublish(role) && <p className="text-sm text-muted-foreground">{RECRUITER_PUBLISH_REASON}</p>}
    {!desktop && <div className="flex flex-wrap items-center gap-2">
      <Sheet open={sectionsOpen} onOpenChange={setSectionsOpen}><SheetTrigger render={<Button variant="outline" className="min-h-10" />}><PanelLeft aria-hidden="true" data-icon="inline-start" />Secciones</SheetTrigger><SheetContent side="left" showCloseButton={false}><SheetHeader className="border-b"><SheetTitle>Tu sitio</SheetTitle><SheetDescription>Organiza las secciones de tu página.</SheetDescription></SheetHeader><div className="min-h-0 flex-1 overflow-y-auto p-4">{sections}</div><SheetFooter className="border-t"><SheetClose render={<Button variant="outline" className="min-h-10" />}>Volver a la vista previa</SheetClose></SheetFooter></SheetContent></Sheet>
      <Sheet open={propertiesOpen} onOpenChange={setPropertiesOpen}><SheetTrigger render={<Button variant="outline" className="min-h-10" />}><SlidersHorizontal aria-hidden="true" data-icon="inline-start" />Propiedades</SheetTrigger><SheetContent showCloseButton={false}><SheetHeader className="border-b"><SheetTitle>{selected ? BLOCK_LIBRARY[selected.type].label : "Selecciona una sección"}</SheetTitle><SheetDescription>Cambia la composición sin perder contenido.</SheetDescription></SheetHeader><div className="min-h-0 flex-1 overflow-y-auto p-5">{properties}</div><SheetFooter className="border-t"><SheetClose render={<Button variant="outline" className="min-h-10" />}>Volver a la vista previa</SheetClose></SheetFooter></SheetContent></Sheet>
    </div>}
    {/* A single editor surface. Sidebars own independent desktop scroll; mobile
        uses the page, with only the currently open Sheet owning a scroll area. */}
    <EditorSurface desktop={desktop} sections={sections} properties={properties} focused={previewFocused}>
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
            <CardContent className="-mx-(--card-spacing) -mb-(--card-spacing)"><PreviewFrame title="Vista previa del sitio" viewportWidth={deviceWidth} selectedBlockId={editor.selectedId} onScaleChange={setZoom}><CompanySitePresentation site={editor.draft} {...preview} selectedBlockId={editor.selectedId} onSelectBlock={select} /></PreviewFrame></CardContent>
          </Card>
          <p className="mt-4 text-center text-xs text-muted-foreground">Haz clic en una sección para seleccionarla.</p>
        </PreviewScroll>
      </div>}
    </EditorSurface>
    <p className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"><Lock className="size-4 shrink-0" aria-hidden="true" />Tus cambios solo son visibles para tu equipo hasta que publiques.</p>
    <SectionLibrary open={library} onOpenChange={setLibrary} editor={editor} controller={controller} />
    <ConfirmActionDialog open={deleting !== null} onOpenChange={open => { if (!open) setDeleting(null); }} icon={Trash2} tone="destructive" title={`¿Eliminar ${deleting ? BLOCK_LIBRARY[deleting.type].label : "esta sección"}?`} description="Su contenido se eliminará del borrador. Esta acción no se puede deshacer." confirmLabel="Eliminar sección" onConfirm={() => { if (deleting) controller.dispatch({ type: "delete", id: deleting.id }); setDeleting(null); }} />
    <ConfirmActionDialog open={reload} onOpenChange={setReload} icon={RefreshCw} title="¿Cargar la versión más reciente?" description="Tus cambios locales se descartarán y se cargará la versión que guardó la otra persona." confirmLabel="Cargar versión" onConfirm={() => {
      const autosaveConflict = status.kind === "conflict" ? status.current : null;
      const latest = autosaveConflict && (!publishConflict || autosaveConflict.draft_version >= publishConflict.draft_version) ? autosaveConflict : publishConflict;
      if (latest === autosaveConflict && latest) controller.resolveConflict(latest, `"${latest.draft_version}"`, "use-server");
      else if (latest) onLoadSite(latest);
      setPublishConflict(null); setPublication(undefined); setReload(false);
    }} />
    <Dialog open={visitor} onOpenChange={setVisitor}><DialogContent finalFocus={visitorTrigger} className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-6xl"><DialogHeader><DialogTitle>Vista previa pública</DialogTitle><DialogDescription>Solo tu equipo puede ver este borrador. Aún no está publicado.</DialogDescription></DialogHeader><div className="min-h-0 overflow-y-auto"><PreviewFrame title="Vista del visitante"><CompanySitePresentation site={editor.draft} {...preview} /></PreviewFrame></div><DialogFooter><DialogClose render={<Button variant="outline" className="min-h-10" />}>Volver al editor</DialogClose></DialogFooter></DialogContent></Dialog>
  </div></TooltipProvider>;
}
