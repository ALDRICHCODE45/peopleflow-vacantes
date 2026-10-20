"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Banknote, BriefcaseBusiness, Check, ClipboardCheck, Eye, FileText, Info, LockKeyhole, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { editorReadiness } from "../pipeline/publication-model";
import type { DraftFormState } from "./draft-form-state";
import { DraftPreview } from "./draft-preview";

export const EDITOR_SECTIONS = ["Información básica", "Descripción y perfil", "Compensación y beneficios", "Preguntas de filtro", "Revisión y publicación"] as const;
export const EDITOR_DESCRIPTIONS = ["Los detalles que dan forma a tu próxima contratación.", "Presenta la oportunidad y el perfil que buscas.", "Una oferta transparente, con todos sus beneficios.", "Haz las preguntas que realmente importan.", "Todo en su lugar antes de dar el siguiente paso."] as const;
const icons = [BriefcaseBusiness, FileText, Banknote, MessageSquare, ClipboardCheck];
function pendingCopy(count: number) { return count === 1 ? "1 detalle pendiente. Puedes completarlo a tu ritmo." : `${count} detalles pendientes. Puedes completarlos a tu ritmo.`; }

const desktopQuery = "(min-width: 1024px)";
function subscribeDesktop(onChange: () => void) {
  const media = window.matchMedia?.(desktopQuery);
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}
const desktopSnapshot = () => window.matchMedia?.(desktopQuery).matches ?? false;
const serverSnapshot = () => false;

export function DraftEditorShell({ state, published, step, onStep, readiness, children }: {
  state: DraftFormState; published: boolean | null; step: number; onStep: (step: number) => void;
  readiness: ReturnType<typeof editorReadiness>; children: ReactNode;
}) {
  const [preview, setPreview] = useState(false);
  const desktop = useSyncExternalStore(subscribeDesktop, desktopSnapshot, serverSnapshot);
  return <Sheet open={preview} onOpenChange={setPreview}>
    <header className="flex flex-wrap items-start justify-between gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-xl font-semibold">Construye tu próxima oportunidad</h1>
          <Badge variant={published === null ? "neutral" : published ? "success" : "info"} dot={published !== null}>{published === null ? "Estado por confirmar" : published ? "Activa" : "Borrador"}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">Una buena contratación empieza con una vacante clara. Dale forma a la tuya.</p>
      </div>
      <SheetTrigger render={<Button type="button" variant="outline" className="min-h-10" />}><Eye aria-hidden="true" data-icon="inline-start" />Vista previa</SheetTrigger>
    </header>
    <Tabs value={step} onValueChange={value => { if (typeof value === "number") onStep(value); }} orientation={desktop ? "vertical" : "horizontal"} className="grid min-w-0 grid-cols-1 items-start gap-7 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_300px]">
      <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6">
        <div className="overflow-x-auto p-1 lg:overflow-visible">
        <TabsList activateOnFocus aria-label="Secciones de la vacante" className="h-auto gap-1 bg-transparent p-0 lg:w-full lg:items-stretch">
          {EDITOR_SECTIONS.map((title, index) => {
            const Icon = icons[index]; const complete = readiness.sectionComplete[index];
            return <TabsTrigger key={title} value={index} aria-label={title} data-complete={complete === true} className="min-h-11 justify-start gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm font-normal text-muted-foreground hover:bg-muted hover:text-foreground data-active:bg-primary/10 data-active:font-medium data-active:text-primary data-active:shadow-none">
              <Icon aria-hidden="true" /><span className="flex-1 whitespace-nowrap text-left">{title}</span>
              {complete && <Check aria-label="Requisitos completos" data-icon="inline-end" />}
              {index === 4 && readiness.pending > 0 && <Badge variant="secondary">{readiness.pending}</Badge>}
            </TabsTrigger>;
          })}
        </TabsList>
        </div>
        <Separator />
        <div className="flex flex-col gap-3">
          <Progress value={readiness.percent} aria-label="Lista para publicar"><ProgressLabel>Lista para publicar</ProgressLabel><ProgressValue /></Progress>
          <p className="text-sm leading-6 text-muted-foreground">{readiness.pending ? pendingCopy(readiness.pending) : readiness.serverKnown ? "Todo listo. Tu próxima contratación está a un paso." : "Los datos del editor están completos."}</p>
          {!readiness.serverKnown && <p className="text-xs text-muted-foreground">Solicitud y entrega aún no comprobadas: no se incluyen en el progreso.</p>}
          <Button type="button" variant="link" className="min-h-10 self-start" onClick={() => onStep(4)}>Ver qué falta<ArrowRight aria-hidden="true" data-icon="inline-end" /></Button>
        </div>
        <Card size="sm" className="hidden lg:flex"><CardHeader><CardTitle><h2 className="flex items-center gap-2"><Info aria-hidden="true" className="size-4" />A tu ritmo</h2></CardTitle><CardDescription>{published === null ? "El estado de publicación está por confirmar. Recuerda guardar tus cambios." : published ? "Esta vacante está activa. Los cambios se publican al guardar." : "Guarda tu progreso, incluso si aún faltan detalles. Solo será pública cuando la publiques."}</CardDescription></CardHeader></Card>
      </aside>
      <div className="min-w-0">{children}</div>
      <aside data-pf-live-preview="" className="hidden min-w-0 xl:block xl:sticky xl:top-6">
        <div className="mb-5 flex flex-col gap-1"><h2 className="flex items-center gap-2 text-sm font-semibold"><Eye aria-hidden="true" className="size-4" />Así la verán</h2><p className="text-sm text-muted-foreground">Vista previa en tiempo real</p></div>
        <DraftPreview state={state} publicOnly />
        <Button type="button" variant="link" className="min-h-10 w-full" onClick={() => setPreview(true)}>Ver vacante completa<ArrowUpRight aria-hidden="true" data-icon="inline-end" /></Button>
        <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground"><LockKeyhole aria-hidden="true" className="mt-1 size-4 shrink-0" />{published === null ? "El estado de publicación está por confirmar." : published ? "Esta vacante está activa. Los cambios se publican al guardar." : "Solo tú puedes ver esta vista previa. Aún no está publicada."}</p>
      </aside>
    </Tabs>
    <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
      <SheetHeader className="border-b"><SheetTitle>Vista previa pública</SheetTitle><SheetDescription>Así verán esta oportunidad las personas candidatas.</SheetDescription></SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4"><DraftPreview state={state} publicOnly /></div>
      <SheetFooter className="border-t"><SheetClose render={<Button type="button" variant="outline" className="min-h-10" />}>Cerrar vista previa</SheetClose></SheetFooter>
    </SheetContent>
  </Sheet>;
}
