"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert, Lock } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CareersSiteEditor, CareersSiteEditorLoading, CareersSiteEditorError } from "@/features/company-site/editor";
import { loadCareersEditor, type CareersEditorResult } from "./actions";

export function CareersSiteLoader() {
  const [result, setResult] = useState<CareersEditorResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const request = useRef<Promise<CareersEditorResult> | null>(null);
  useEffect(() => {
    let active = true;
    // Reuse the in-flight read during StrictMode's effect replay. Each effect
    // subscribes separately so cleanup cannot strand the replay in loading.
    request.current ??= loadCareersEditor().catch((): CareersEditorResult => ({ ok: false, code: "unavailable" }));
    void request.current.then(next => { if (active) setResult(next); });
    return () => { active = false; };
  }, [attempt]);
  function retry() {
    request.current = null;
    setResult(null);
    setAttempt(value => value + 1);
  }
  if (!result) return <CareersSiteEditorLoading />;
  if (result.ok) return <CareersSiteEditor initialSite={result.site} role={result.role} preview={result.preview} />;
  if (result.code === "unavailable") return <CareersSiteEditorError onRetry={retry} />;
  if (result.code === "unauthenticated") return <StateCard icon={Lock} tone="forbidden" title="Tu sesión expiró" description="Inicia sesión en otra pestaña y vuelve a consultar el sitio." primaryAction={{ label: "Reintentar", onClick: retry }}>
    <Link href="/empresa/login" target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline" }), "min-h-10")}>Iniciar sesión</Link>
  </StateCard>;
  return <StateCard icon={CircleAlert} tone="forbidden"
    title={result.code === "forbidden" ? "No tienes acceso al sitio de empleo" : "La empresa está inactiva"}
    description={result.code === "forbidden" ? "Necesitas pertenecer al equipo de la empresa para editar su sitio de empleo." : "El sitio de empleo no se puede editar mientras la empresa esté inactiva. Contacta con la persona responsable de tu empresa."}
    primaryAction={{ label: "Volver al dashboard", href: "/empresa/dashboard" }} />;
}
