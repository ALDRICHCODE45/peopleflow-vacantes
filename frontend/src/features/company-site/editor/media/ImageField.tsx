"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { MEDIA_MAX_BYTES, MEDIA_TYPES, MEDIA_UNCERTAIN } from "../../media";
import { uploadMedia } from "../../upload";
import { cropAspects, type ImageFieldProps } from "./contract";
import { cropImage, type CropArea } from "./crop-image";

const recommendations = {
  cover: "Recomendado: 1920 × 1080 px",
  gallery: "Recomendado: 1200 × 900 px",
  portrait: "Recomendado: 800 × 800 px",
  story: "Recomendado: al menos 1200 px de ancho",
};
type Source = { url: string; image: HTMLImageElement; file: File };

function readImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => { image.onload = null; image.onerror = null; resolve(image); };
    image.onerror = () => { image.onload = null; image.onerror = null; reject(new Error("No pudimos leer la imagen. Elige otro archivo.")); };
    image.src = url;
  });
}

/** Reset local work if the slot changes kind; late results never mutate another kind. */
export function ImageField(props: ImageFieldProps) {
  return <ImageFieldSlot key={props.kind} {...props} />;
}

function ImageFieldSlot({ kind, label, description, value, onChange, previewUrl, error, disabled = false }: ImageFieldProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const alive = useRef(false);
  const objectUrl = useRef<string | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [cropperReady, setCropperReady] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<CropArea | null>(null);
  const [busy, setBusy] = useState<"reading" | "cropping" | "uploading" | null>(null);
  const working = useRef(false);
  const [pending, setPending] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const blocked = disabled || busy !== null;
  const message = localError || error;
  const releaseUrl = useCallback(() => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; releaseUrl(); };
  }, [releaseUrl]);
  const onCropComplete = useCallback((_percentage: CropArea, pixels: CropArea) => setArea(pixels), []);

  async function choose(file?: File) {
    if (!file || disabled || working.current || source) return;
    setLocalError(null);
    setAnnouncement("");
    setPending(null);
    if (!(MEDIA_TYPES as readonly string[]).includes(file.type)) {
      setLocalError("Usa una imagen JPG, PNG o WebP."); return;
    }
    if (file.size > MEDIA_MAX_BYTES) {
      setLocalError("La imagen pesa más de 5 MB."); return;
    }
    working.current = true;
    setBusy("reading");
    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    try {
      const image = await readImage(url);
      if (!alive.current) return;
      if (image.naturalWidth < 200 || image.naturalHeight < 200) {
        throw new Error("La imagen debe medir al menos 200 px por lado.");
      }
      if (image.naturalWidth > 6000 || image.naturalHeight > 6000) {
        throw new Error("La imagen debe medir como máximo 6000 px por lado.");
      }
      setCropperReady(false);
      setCrop({ x: 0, y: 0 }); setZoom(1); setArea(null);
      setSource({ url, image, file });
    } catch (cause) {
      if (alive.current) setLocalError(cause instanceof Error ? cause.message : "No pudimos leer la imagen. Elige otro archivo.");
      releaseUrl();
    } finally {
      working.current = false;
      if (alive.current) setBusy(null);
    }
  }

  function cancel() {
    if (working.current) return;
    setSource(null); setLocalError(null); releaseUrl();
  }

  async function upload(file: File) {
    working.current = true;
    setBusy("uploading"); setLocalError(null);
    try {
      const result = await uploadMedia(kind, file);
      if (!alive.current) return;
      if (result.ok) {
        setPending(null);
        onChange({ media_id: result.data.id }, result.data);
        setAnnouncement("Imagen actualizada");
      } else setLocalError(result.message);
    } catch {
      if (alive.current) setLocalError(MEDIA_UNCERTAIN);
    } finally {
      working.current = false;
      if (alive.current) setBusy(null);
    }
  }

  async function confirmCrop() {
    if (!source || !area || blocked || working.current) return;
    working.current = true; setBusy("cropping"); setLocalError(null);
    try {
      const blob = await cropImage(source.image, area, source.file.type);
      if (!alive.current) return;
      if (blob.size > MEDIA_MAX_BYTES) throw new Error("La imagen pesa más de 5 MB. Reduce el recorte o elige otra imagen.");
      const file = new File([blob], source.file.name, { type: blob.type });
      setPending(file); setSource(null); releaseUrl();
      await upload(file);
    } catch (cause) {
      if (alive.current) setLocalError(cause instanceof Error ? cause.message : "No pudimos recortar la imagen. Inténtalo de nuevo.");
    } finally {
      working.current = false;
      if (alive.current) setBusy(null);
    }
  }

  const thumbnail = value ? previewUrl?.(value.media_id) : null;
  const aspect = cropAspects[kind] ?? (source ? source.image.naturalWidth / source.image.naturalHeight : undefined);
  const slotAspect = cropAspects[kind] ?? undefined;

  return (
    <Field data-disabled={blocked || undefined} data-invalid={!!message || undefined} aria-labelledby={`${id}-label`}>
      <FieldLabel id={`${id}-label`} htmlFor={id}>{label}</FieldLabel>
      {description && <FieldDescription>{description}</FieldDescription>}
      <Input ref={inputRef} id={id} type="file" accept={MEDIA_TYPES.join(",")} className="sr-only" tabIndex={-1}
        aria-label={`Archivo de ${label}`} aria-invalid={!!message} aria-describedby={`${id}-help${message ? ` ${id}-error` : ""}`}
        disabled={blocked} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void choose(file); }} />
      {value ? (
        <>
          {thumbnail ? (
            // User-selected media is an object/proxy URL; Next image optimization does not apply here.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnail} alt={label} className="w-full rounded-xl object-cover" style={{ aspectRatio: slotAspect }} />
          ) : <Empty className="border p-4" style={{ aspectRatio: slotAspect }}><EmptyDescription>Vista previa no disponible</EmptyDescription></Empty>}
          <div className="flex flex-wrap gap-2">
            <Button ref={triggerRef} type="button" variant="outline" className="min-h-10" disabled={blocked} onClick={() => inputRef.current?.click()}>Cambiar</Button>
            <Button type="button" variant="ghost" className="min-h-10" disabled={blocked} onClick={() => {
              setPending(null); setLocalError(null); onChange(null); setAnnouncement("Imagen quitada");
            }}>Quitar</Button>
          </div>
        </>
      ) : (
        <Empty className="relative border p-4" style={{ aspectRatio: slotAspect }}>
          <Button ref={triggerRef} type="button" variant="ghost" className="absolute inset-0 h-full w-full border border-dashed"
            aria-label={`Subir ${label}`} aria-describedby={`${id}-help${message ? ` ${id}-error` : ""}`} aria-invalid={!!message} disabled={blocked}
            onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); if (!blocked) void choose(event.dataTransfer.files[0]); }}>
            <span className="sr-only">Subir {label}</span>
          </Button>
          {/* Content stays above the hit target's native hover surface, without intercepting drops. */}
          <EmptyHeader className="pointer-events-none relative">
            <EmptyMedia variant="icon"><ImagePlus aria-hidden="true" /></EmptyMedia>
            <EmptyDescription>Arrastra una imagen o elige un archivo</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <FieldDescription id={`${id}-help`}>JPG, PNG o WebP · hasta 5 MB<br />{recommendations[kind]}</FieldDescription>
      <div role="status" aria-live="polite" className="flex min-h-5 items-center gap-2 text-sm text-muted-foreground">
        {busy && <Spinner aria-hidden="true" />}
        {busy === "uploading" ? "Subiendo imagen…" : busy === "reading" ? "Leyendo imagen…" : busy === "cropping" ? "Preparando imagen…" : announcement}
      </div>
      {message && !source && <FieldError id={`${id}-error`}>{message}</FieldError>}
      {pending && localError && !source && <Button type="button" variant="outline" className="min-h-10" disabled={blocked}
        onClick={() => { if (!working.current) void upload(pending); }}>Reintentar subida</Button>}
      {/* No DialogTrigger: opening follows asynchronous file validation or a drop. */}
      <Dialog open={!!source} onOpenChange={(open) => { if (!open) cancel(); }} onOpenChangeComplete={setCropperReady}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl" initialFocus={cancelRef} finalFocus={triggerRef} showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Recortar imagen</DialogTitle>
            <DialogDescription>Arrastra para encuadrar. Usa las flechas del teclado para mover la imagen y ajusta el zoom.</DialogDescription>
          </DialogHeader>
          <div className="relative h-[min(45dvh,320px)] overflow-hidden rounded-xl bg-muted">
            {/* Measure only after the dialog's scale animation; otherwise crop coordinates drift. */}
            {source && cropperReady && <Cropper image={source.url} crop={crop} zoom={zoom} aspect={aspect} keyboardStep={10}
              onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />}
          </div>
          <Field>
            <FieldLabel id={`${id}-zoom-label`}>Zoom</FieldLabel>
            <Slider aria-labelledby={`${id}-zoom-label`} value={[zoom]} min={1} max={3} step={0.05} className="py-3" disabled={blocked}
              onValueChange={(next) => setZoom(Array.isArray(next) ? next[0] : next)} />
          </Field>
          {source && message && <FieldError>{message}</FieldError>}
          <DialogFooter>
            <Button ref={cancelRef} type="button" variant="outline" className="min-h-10" disabled={busy !== null} onClick={cancel}>Cancelar</Button>
            <Button type="button" className="min-h-10" disabled={blocked || !area} onClick={() => void confirmCrop()}>Usar imagen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Field>
  );
}
