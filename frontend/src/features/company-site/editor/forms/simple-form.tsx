"use client";

import { useId, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DraftDescriptionEditor } from "@/features/jobs/drafts/ui/draft-description-editor";
import { deriveDraftDescriptionPlain } from "@/features/jobs/drafts/rich/plain";
import { cn } from "@/lib/utils";
import { parseVideoUrl, type SiteVideo } from "../../video";
import type { SiteBlock } from "../../model";
import { mediaUrl } from "../../public/media";
import { ImageField } from "../media";
import { Counter, fieldMessage, TextField } from "./fields";
import type { FormProps } from "./section-form";

function VideoField({ value, onChange, error }: { value: SiteVideo | null; onChange: (value: SiteVideo | null) => void; error?: string }) {
  const id = useId();
  const canonical = (video: SiteVideo | null) => !video ? "" : video.provider === "youtube" ? `https://www.youtube.com/watch?v=${video.video_id}` : `https://vimeo.com/${video.video_id}`;
  const [url, setUrl] = useState(() => canonical(value));
  const [accepted, setAccepted] = useState(value);
  // Keep invalid/in-progress text local, but synchronize external draft loads.
  if (JSON.stringify(value) !== JSON.stringify(accepted)) { setAccepted(value); setUrl(canonical(value)); }
  const invalid = !!url.trim() && !parseVideoUrl(url);
  const message = invalid ? "Pega un enlace de YouTube o Vimeo." : error;
  return <Field data-invalid={!!message}><FieldLabel htmlFor={id}>Enlace del video</FieldLabel><Input id={id} className="min-h-10" inputMode="url" value={url} aria-invalid={!!message} aria-describedby={`${id}-help${message ? ` ${id}-error` : ""}`} onChange={event => {
    const next = event.target.value; setUrl(next);
    const parsed = parseVideoUrl(next);
    // Invalid text is never serialized as a video. Clear the old reference so
    // preview/publication cannot silently keep a different, stale video.
    setAccepted(parsed); onChange(parsed);
  }} /><FieldDescription id={`${id}-help`}>Usa un enlace de YouTube o Vimeo. Es necesario para publicar esta sección.</FieldDescription>
    {!invalid && value && <FieldDescription role="status">{value.provider === "youtube" ? "YouTube" : "Vimeo"} · {value.video_id}</FieldDescription>}
    {message && <FieldError id={`${id}-error`}>{message}</FieldError>}
  </Field>;
}
export function SimpleForm({ block, dispatch, fieldErrors }: FormProps) {
  const error = (path: string) => fieldMessage(fieldErrors, block.id, `content.${path}`);
  const change = (patch: Partial<typeof block.content>) => dispatch({ type: "content", id: block.id, content: { ...block.content, ...patch } as SiteBlock["content"] });
  const titleHelp = "Dale un título breve a esta sección. Es opcional.";
  switch (block.type) {
    case "hero": return <>
      <TextField label="Título principal" value={block.content.title} onChange={title => change({ title })} max={80} description="Presenta tu empresa. Es necesario para publicar." error={error("title")} multiline />
      <TextField label="Subtítulo" value={block.content.subtitle} onChange={subtitle => change({ subtitle })} max={200} description="Invita a las personas a conocer tu equipo. Es opcional." error={error("subtitle")} multiline />
      <ImageField kind="cover" label="Imagen de portada" description="Una imagen que represente a tu empresa. Es opcional." value={block.content.cover} onChange={cover => change({ cover })} previewUrl={mediaUrl} error={error("cover")} />
      <FieldDescription>El botón «Ver vacantes» lleva a las vacantes de este sitio. «Conoce la empresa» aparece si hay una Historia visible. La identidad de tu empresa se toma de tu perfil.</FieldDescription>
    </>;
    case "story": {
      const count = [...(deriveDraftDescriptionPlain(block.content.body) ?? "")].length;
      return <>
        <TextField label="Título" value={block.content.title} onChange={title => change({ title })} max={80} description={titleHelp} error={error("title")} />
        <DraftDescriptionEditor value={block.content.body} onChange={body => change({ body })} ariaLabel="Historia de la empresa" label="Historia de la empresa" toolbarLabel="Formato de la historia" compactToolbar error={error("body") ?? (count > 5000 ? "Usa hasta 5000 caracteres." : undefined)} publicationRequired />
        <div className="flex flex-wrap items-start justify-between gap-2"><FieldDescription className="min-w-0 flex-1">Cuenta tu historia con texto, listas y enlaces. Agrega contenido para publicar.</FieldDescription><Counter count={count} max={5000} /></div>
        <ImageField kind="story" label="Imagen de la historia" description="Acompaña tu historia con una imagen. Es opcional." value={block.content.image} onChange={image => change({ image })} previewUrl={mediaUrl} error={error("image")} />
      </>;
    }
    case "video": return <>
      <TextField label="Título" value={block.content.title} onChange={title => change({ title })} max={80} description={titleHelp} error={error("title")} />
      <TextField label="Descripción" value={block.content.description} onChange={description => change({ description })} max={200} description="Explica qué van a conocer en el video. Es opcional." error={error("description")} multiline />
      <VideoField value={block.content.video} onChange={video => change({ video })} error={error("video")} />
    </>;
    case "jobs": return <>
      <TextField label="Título" value={block.content.title} onChange={title => change({ title })} max={80} description="Si lo dejas vacío, mostramos «Vacantes abiertas»." error={error("title")} />
      <TextField label="Subtítulo" value={block.content.intro} onChange={intro => change({ intro })} max={200} description="Agrega una invitación a postularse. Es opcional." error={error("intro")} multiline />
      <FieldDescription>Se muestran automáticamente las vacantes publicadas de tu empresa.</FieldDescription>
      <a className={cn(buttonVariants({ variant: "outline" }), "min-h-10 self-start")} href="/empresa/vacantes">Administrar vacantes</a>
    </>;
    case "closing": return <>
      <TextField label="Título" value={block.content.title} onChange={title => change({ title })} max={80} description="Cierra con una invitación. Es necesario para publicar." error={error("title")} />
      <TextField label="Texto" value={block.content.text} onChange={text => change({ text })} max={240} description="Anima a las personas a sumarse a tu equipo. Es opcional." error={error("text")} multiline />
      <FieldDescription>El botón «Ver vacantes» lleva a las vacantes de este sitio. Los enlaces sociales se toman del perfil de tu empresa.</FieldDescription>
    </>;
    default: return null;
  }
}
