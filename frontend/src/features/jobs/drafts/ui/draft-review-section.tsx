"use client";

import { Fragment, useContext, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Banknote, Check, Eye, LockKeyhole, MessageSquare, Settings2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemGroup, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { DraftPreviewContext } from "./draft-editor-shell";
import { groupMissing, type editorReadiness } from "../pipeline/publication-model";
import type { DraftFormState } from "./draft-form-state";
import { internalCompensationView } from "./draft-preview";

/** Presentation of the same readiness projection used by the navigation, not a publication gate. */
export function DraftReviewSection({ state, readiness, draftId, published, questionCount, questionnaireAction, onComplete }: {
  state: DraftFormState;
  readiness: ReturnType<typeof editorReadiness>;
  draftId?: string;
  published: boolean | null;
  questionCount: number;
  questionnaireAction: ReactNode;
  onComplete: (code: string) => void;
}) {
  const openPreview = useContext(DraftPreviewContext);
  const groups = groupMissing(readiness.missing);
  const salary = internalCompensationView(state.compensation);
  const title = published ? "Tu vacante está activa" : readiness.pending ? "Cada detalle cuenta" : readiness.serverKnown ? "Todo listo para publicar" : "Revisa tu vacante";
  return <div className="flex flex-col gap-5">
    <Card>
      <CardHeader><CardTitle><h3>{title}</h3></CardTitle><CardDescription>{published ? "Puedes editarla, manteniendo completos los datos necesarios." : "Completa estos detalles para activar la vacante. Puedes guardar el borrador en cualquier momento."}</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-5">
        {([ ["editor", "Editor de la vacante"], ["solicitud", "Configuración de solicitud"], ["entrega", "Configuración de entrega"] ] as const).map(([key, label]) => {
          const items = groups.find(group => group.group === key)?.items ?? [];
          const known = key === "editor" || readiness.serverKnown;
          return <section key={key} aria-labelledby={`draft-review-${key}`} className="flex flex-col gap-2">
            <h4 id={`draft-review-${key}`} className="text-sm font-medium">{label}</h4>
            {!known ? <p className="text-sm text-muted-foreground">Pendiente de comprobar</p> : items.length === 0 ? <Badge variant="success"><Check aria-hidden="true" />Completa</Badge> :
              <ItemGroup className="gap-0">{items.map((item, index) => <Fragment key={item.code}>
                {index > 0 && <ItemSeparator className="my-0" />}
                <Item size="sm" role="listitem" className="px-0 py-1.5">
                  <ItemContent className="min-w-0"><ItemTitle className="line-clamp-none">{item.label}</ItemTitle></ItemContent>
                  <ItemActions>{key === "editor" ?
                    <Button type="button" variant="link" className="min-h-10" onClick={() => onComplete(item.code)}>Completar<span className="sr-only"> {item.label}</span><ArrowUpRight aria-hidden="true" data-icon="inline-end" /></Button> :
                    draftId && <Link className={cn(buttonVariants({ variant: "link" }), "min-h-10")} href={item.href(draftId)}>Completar<span className="sr-only"> {item.label}</span><ArrowUpRight aria-hidden="true" data-icon="inline-end" /></Link>}
                  </ItemActions>
                </Item>
              </Fragment>)}</ItemGroup>}
          </section>;
        })}
        {!readiness.serverKnown && <p id="draft-review-unknown" className="text-sm text-muted-foreground">{draftId ? "Aún no pudimos comprobar solicitud y entrega. Revisa la configuración o vuelve a preparar la publicación." : "La lista de solicitud y entrega aparece después del primer guardado."}</p>}
      </CardContent>
      <CardFooter>{draftId ?
        <Link className={cn(buttonVariants({ variant: "outline" }), "min-h-10 whitespace-normal")} href={`/empresa/vacantes/${draftId}/configuracion/solicitud`}><Settings2 aria-hidden="true" data-icon="inline-start" />Configurar solicitud y entrega</Link> :
        <Button type="button" variant="outline" className="min-h-10 whitespace-normal" disabled aria-describedby="draft-review-unknown"><Settings2 aria-hidden="true" data-icon="inline-start" />Configurar solicitud y entrega</Button>}
      </CardFooter>
    </Card>
    <Card role="region" aria-labelledby="draft-review-internal">
      <CardHeader><CardTitle><h3 id="draft-review-internal" className="flex items-center gap-2"><LockKeyhole aria-hidden="true" className="size-4" />Revisión interna</h3></CardTitle><CardDescription>Esta información no aparece en la vista pública.</CardDescription></CardHeader>
      <CardContent><dl className="grid gap-5 sm:grid-cols-2 [&>*]:min-w-0">
        <div><dt className="flex items-center gap-2 text-sm text-muted-foreground"><UserRound aria-hidden="true" className="size-4" />Solicitante</dt><dd className="mt-1 break-words text-sm">{state.requester.name || (state.requester.id ? "Nombre no disponible" : "Sin seleccionar")}</dd></div>
        <div><dt className="flex items-center gap-2 text-sm text-muted-foreground"><MessageSquare aria-hidden="true" className="size-4" />Cuestionario</dt><dd className="mt-1 flex flex-col items-start text-sm">{questionCount} {questionCount === 1 ? "pregunta" : "preguntas"}{questionnaireAction}</dd></div>
        <div><dt className="flex items-center gap-2 text-sm text-muted-foreground"><Eye aria-hidden="true" className="size-4" />Compensación</dt><dd className="mt-1 text-sm">{state.compensation.public_visible ? "Visible públicamente" : "No se mostrará en la vista pública"}</dd></div>
        <div><dt className="flex items-center gap-2 text-sm text-muted-foreground"><Banknote aria-hidden="true" className="size-4" />Monto interno</dt><dd className="mt-1 break-words text-sm">{salary ? <>{salary.amount}<p className="text-xs text-muted-foreground">{salary.meta}</p></> : "Compensación por revisar"}</dd></div>
      </dl></CardContent>
    </Card>
    <Button type="button" variant="outline" className="min-h-10 w-full" onClick={openPreview} aria-haspopup="dialog"><Eye aria-hidden="true" data-icon="inline-start" />Revisar vista previa pública</Button>
  </div>;
}
