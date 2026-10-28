"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SitePortalContext } from "../public/site-portal";

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
  const [portalViewport, setPortalViewport] = useState<HTMLDivElement | null>(null);
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
    // Kept outside the measured content: opening an overlay cannot change the
    // page's document height. Its transform contains fixed panels/backdrops.
    const overlayViewport = document.createElement("div");
    overlayViewport.dataset.previewPortalViewport = "";
    Object.assign(overlayViewport.style, { position: "absolute", left: "0px", transform: "translateZ(0)", pointerEvents: "none" });
    document.body.append(overlayViewport); setPortalViewport(overlayViewport);
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
    return () => { mutation.disconnect(); resize.disconnect(); for (const node of styles) node.parentNode?.removeChild(node); content.remove(); overlayViewport.remove(); };
  }, [document]);
  useEffect(() => {
    if (!portalViewport || !iframe.current || !fit.current) return;
    const frame = iframe.current;
    const host = frame.ownerDocument.defaultView!;
    // Intersect every clipping ancestor, including Dialog's scroll body and the
    // editor ScrollArea. The window is the viewport on the mobile editor page.
    const ancestors: HTMLElement[] = [];
    for (let node = fit.current.parentElement; node; node = node.parentElement) ancestors.push(node);
    const clipping = ancestors.filter(node => /auto|scroll|hidden|clip/.test(host.getComputedStyle(node).overflowY) || node.dataset.slot === "scroll-area-viewport");
    const measure = () => {
      const bounds = frame.getBoundingClientRect();
      let top = Math.max(0, bounds.top);
      let bottom = Math.min(host.innerHeight, bounds.bottom);
      for (const node of clipping) {
        const clip = node.getBoundingClientRect();
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
      // Parent coordinates are CSS pixels after scaling; the portal uses the
      // iframe's natural coordinates and is always full device width.
      portalViewport.style.top = `${Math.max(0, top - bounds.top) / scale}px`;
      portalViewport.style.height = `${Math.max(0, bottom - top) / scale}px`;
      portalViewport.style.width = `${width}px`;
    };
    const resize = new ResizeObserver(measure);
    for (const node of [fit.current, ...ancestors]) resize.observe(node);
    host.addEventListener("scroll", measure, { capture: true, passive: true });
    host.addEventListener("resize", measure);
    measure();
    return () => {
      resize.disconnect();
      host.removeEventListener("scroll", measure, true);
      host.removeEventListener("resize", measure);
    };
  }, [portalViewport, scale, width, height]);
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
    {mount && createPortal(<SitePortalContext value={portalViewport}>{children}</SitePortalContext>, mount)}
    <div data-preview-stage="" className="relative mx-auto overflow-hidden" style={{ width: width * scale, height: height * scale }}>
      <iframe ref={iframe} title={title} className="absolute top-0 left-0 block origin-top-left border-0" width={width} height={height}
        style={{ width, height, transform: `scale(${scale})` }} onLoad={() => setDocument(iframe.current?.contentDocument ?? null)} />
    </div>
  </div>;
}
