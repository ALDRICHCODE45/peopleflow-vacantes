"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type PreviewFrameProps = {
  title: string; children: ReactNode; viewportWidth?: number;
  selectedBlockId?: string | null;
  onScaleChange?: (scale: number) => void;
};
/** The site always sees the real device viewport. Only the frame is scaled;
 * its measured content height is scaled too, so the parent owns all scrolling. */
export function PreviewFrame({ title, children, viewportWidth, selectedBlockId, onScaleChange }: PreviewFrameProps) {
  const fit = useRef<HTMLDivElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const previousSelection = useRef(selectedBlockId);
  const [document, setDocument] = useState<Document | null>(null);
  const [height, setHeight] = useState(720);
  const [available, setAvailable] = useState(viewportWidth ?? 1280);
  const [mount, setMount] = useState<HTMLDivElement | null>(null);
  const width = viewportWidth ?? available;
  const scale = Math.min(1, available / width);
  useEffect(() => {
    const target = iframe.current?.contentDocument;
    if (target) setDocument(target);
    const measure = () => { const next = fit.current?.getBoundingClientRect().width; if (next && next > 0) setAvailable(next); };
    const resize = new ResizeObserver(measure);
    if (fit.current) resize.observe(fit.current);
    measure(); return () => resize.disconnect();
  }, []);
  useEffect(() => {
    if (!document) return;
    const host = window.document;
    // Dedicated mount survives document teardown until React unmounts the portal.
    const content = document.createElement("div");
    content.dataset.previewContent = "";
    // These resolve OUTSIDE the site's brand scope, preserving the app's editor ink.
    content.className = "[--editor-primary:var(--primary)] [--editor-primary-foreground:var(--primary-foreground)]";
    document.body.append(content); setMount(content);
    let styles: Node[] = [];
    const copyStyles = () => {
      for (const node of styles) node.parentNode?.removeChild(node);
      styles = Array.from(host.head.querySelectorAll('style, link[rel="stylesheet"]'), node => node.cloneNode(true));
      document.head.append(...styles);
      document.documentElement.className = host.documentElement.className;
      document.body.className = host.body.className;
    };
    copyStyles();
    const mutation = new MutationObserver(copyStyles);
    mutation.observe(host.head, { childList: true, subtree: true, characterData: true });
    mutation.observe(host.documentElement, { attributes: true, attributeFilter: ["class"] });
    const measure = () => { const next = Math.ceil(content.getBoundingClientRect().height); if (next > 0) setHeight(next); };
    const resize = new ResizeObserver(measure); resize.observe(content); measure();
    return () => { mutation.disconnect(); resize.disconnect(); for (const node of styles) node.parentNode?.removeChild(node); content.remove(); };
  }, [document]);
  useEffect(() => {
    // Geometry only: the chip and outline counter the iframe transform while
    // the published content keeps its true device layout and typography.
    mount?.style.setProperty("--editor-inverse-scale", String(1 / scale));
    onScaleChange?.(scale);
  }, [mount, scale, onScaleChange]);
  useEffect(() => {
    if (!document || previousSelection.current === selectedBlockId) return;
    previousSelection.current = selectedBlockId;
    const block = selectedBlockId && document.getElementById(`bloque-${selectedBlockId}`);
    // Never scrollIntoView: it walks every ancestor, including the host document.
    // On mobile there is no preview ScrollArea, so selection does not move the page.
    const viewport = fit.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!block || !viewport || !iframe.current) return;
    const bounds = viewport.getBoundingClientRect(); const section = block.getBoundingClientRect();
    const top = iframe.current.getBoundingClientRect().top + section.top * scale;
    const bottom = top + section.height * scale;
    const delta = top < bounds.top ? top - bounds.top : bottom > bounds.bottom ? Math.min(top - bounds.top, bottom - bounds.bottom) : 0;
    if (delta) viewport.scrollTo({ top: Math.max(0, viewport.scrollTop + delta), behavior: "instant" });
  }, [document, selectedBlockId, scale]);
  return <div ref={fit} data-preview-fit="" className="min-w-0 w-full">
    {mount && createPortal(children, mount)}
    <div data-preview-stage="" className="relative mx-auto overflow-hidden" style={{ width: width * scale, height: height * scale }}>
      <iframe ref={iframe} title={title} className="absolute top-0 left-0 block origin-top-left border-0" width={width} height={height}
        style={{ width, height, transform: `scale(${scale})` }} onLoad={() => setDocument(iframe.current?.contentDocument ?? null)} />
    </div>
  </div>;
}
