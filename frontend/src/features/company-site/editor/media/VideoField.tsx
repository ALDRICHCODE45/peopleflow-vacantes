"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { HERO_VIDEO_MAX_BYTES, HERO_VIDEO_MAX_MS, HERO_VIDEO_TYPE, MEDIA_UNCERTAIN, type UploadedMedia } from "../../media";
import { usePrefersReducedMotion } from "../../public/use-reduced-motion";
import type { MediaRef } from "./contract";
import { checkHeroVideo, uploadHeroVideo } from "./video-upload";

export type VideoFieldProps = {
  /** Visible field label, e.g. «Video de fondo». */
  label: string;
  value: MediaRef;
  onChange: (value: MediaRef, uploaded?: UploadedMedia) => void;
  /** Resolves a stored media id to a same-origin URL. */
  previewUrl?: (mediaId: string) => string | null;
  error?: string;
  disabled?: boolean;
};
const LIMITS = `MP4 · hasta ${HERO_VIDEO_MAX_BYTES / 1024 / 1024} MB · hasta ${HERO_VIDEO_MAX_MS / 1000} segundos`;

/** Background video slot (hero «Fondo en movimiento»): pre-check, upload with real progress, preview. */
export function VideoField({ label, value, onChange, previewUrl, error, disabled = false }: VideoFieldProps) {
  const id = useId();
  const reduced = usePrefersReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const alive = useRef(false);
  const working = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [busy, setBusy] = useState<"checking" | "uploading" | null>(null);
  const [progress, setProgress] = useState(0);
  const [pending, setPending] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; abort.current?.abort(); };
  }, []);
  const blocked = disabled || busy !== null;
  const message = localError || error;
  const describedBy = `${id}-help ${id}-poster${message ? ` ${id}-error` : ""}`;

  async function upload(file: File) {
    working.current = true;
    const controller = new AbortController();
    abort.current = controller;
    setBusy("uploading"); setProgress(0); setLocalError(null); setAnnouncement("");
    try {
      const result = await uploadHeroVideo(file, { signal: controller.signal, onProgress: fraction => { if (alive.current) setProgress(Math.round(fraction * 100)); } });
      if (!alive.current) return;
      if (result.ok) {
        setPending(null);
        onChangeRef.current({ media_id: result.data.id }, result.data);
        setAnnouncement("Video actualizado");
      } else if (result.message) setLocalError(result.message);
      else { setPending(null); setAnnouncement("Subida cancelada"); }
    } catch {
      if (alive.current) setLocalError(MEDIA_UNCERTAIN);
    } finally {
      working.current = false;
      abort.current = null;
      if (alive.current) setBusy(null);
    }
  }

  async function choose(file?: File) {
    if (!file || disabled || working.current) return;
    working.current = true;
    setLocalError(null); setAnnouncement(""); setPending(null); setBusy("checking");
    let problem: string | null;
    try { problem = await checkHeroVideo(file); } finally { working.current = false; }
    if (!alive.current) return;
    if (problem) { setBusy(null); setLocalError(problem); return; }
    setPending(file);
    await upload(file);
  }

  const source = value ? previewUrl?.(value.media_id) : null;
  return (
    <Field data-disabled={blocked || undefined} data-invalid={!!message || undefined} aria-labelledby={`${id}-label`}>
      <FieldLabel id={`${id}-label`} htmlFor={id}>{label}</FieldLabel>
      {/* Same positioned box as ImageField: a direct sr-only child of Field would overflow the panel. */}
      <span className="relative block h-0 overflow-hidden">
        <input ref={inputRef} id={id} type="file" accept={`${HERO_VIDEO_TYPE},.mp4`} className="sr-only" tabIndex={-1}
          aria-label={`Archivo de ${label}`} aria-invalid={!!message} aria-describedby={describedBy}
          disabled={blocked} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void choose(file); }} />
      </span>
      {value ? <>
        {source
          // Muted, looped and inline like the public hero; a still preview under reduced motion (controls to play it).
          ? <video key={`${source}-${reduced}`} src={source} muted loop playsInline autoPlay={!reduced} controls={reduced} preload="metadata" aria-label={`Vista previa de ${label}`} className="aspect-video w-full rounded-xl bg-muted object-cover" />
          : <Empty className="aspect-video border p-4"><EmptyDescription>Vista previa no disponible</EmptyDescription></Empty>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="min-h-10" disabled={blocked} onClick={() => inputRef.current?.click()}>Cambiar video</Button>
          <Button type="button" variant="ghost" className="min-h-10" disabled={blocked} onClick={() => {
            setPending(null); setLocalError(null); onChange(null); setAnnouncement("Video quitado");
          }}>Quitar video</Button>
        </div>
      </> : (
        <Empty className="relative aspect-video border p-4">
          <Button type="button" variant="ghost" className="absolute inset-0 h-full w-full border border-dashed"
            aria-label={`Subir ${label}`} aria-describedby={describedBy} aria-invalid={!!message} disabled={blocked}
            onClick={() => inputRef.current?.click()} onDragOver={event => event.preventDefault()}
            onDrop={event => { event.preventDefault(); if (!blocked) void choose(event.dataTransfer.files[0]); }}>
            <span className="sr-only">Subir {label}</span>
          </Button>
          <EmptyHeader className="pointer-events-none relative">
            <EmptyMedia variant="icon"><Film aria-hidden="true" /></EmptyMedia>
            <EmptyDescription>Arrastra un video o elige un archivo</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <FieldDescription id={`${id}-help`}>{LIMITS}<br />Se reproduce sin sonido y en bucle.<br />Para que empiece más rápido, expórtalo con &quot;inicio rápido&quot; (faststart).</FieldDescription>
      <FieldDescription id={`${id}-poster`}>La «Imagen de portada» es el póster: se ve mientras el video carga y cuando la persona prefiere menos movimiento.</FieldDescription>
      <div role="status" aria-live="polite" className="flex min-h-5 items-center gap-2 text-sm text-muted-foreground">
        {busy && <Spinner aria-hidden="true" />}
        {busy === "uploading" ? `Subiendo… ${progress} %` : busy === "checking" ? "Revisando video…" : announcement}
      </div>
      {busy === "uploading" && <div className="flex flex-wrap items-center gap-2">
        <Progress value={progress} aria-label={`Progreso de la subida de ${label}`} className="min-w-0 flex-1" />
        <Button type="button" variant="ghost" className="min-h-10" onClick={() => abort.current?.abort()}>Cancelar subida</Button>
      </div>}
      {message && <FieldError id={`${id}-error`}>{message}</FieldError>}
      {pending && localError && !busy && <Button type="button" variant="outline" className="min-h-10 self-start"
        onClick={() => { if (!working.current) void upload(pending); }}>Reintentar subida</Button>}
    </Field>
  );
}
