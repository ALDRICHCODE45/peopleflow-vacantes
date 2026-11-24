"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import { ArrowUpRight, BellRing, ClipboardList, Globe2, Info, Palette, ShieldCheck, UsersRound } from "lucide-react";

import { DashboardPageContent } from "@/components/dashboard-page-content";
import { buttonVariants } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { applyThemeMode, readStoredThemeMode } from "@/components/theme/theme-preferences";
import type { ThemeMode } from "@/components/theme/theme-preferences";
import { CompanySection } from "@/features/employer-company/company-section";
import { TalentBaseVisibilityRow } from "@/features/talent-base-visibility/talent-base-visibility-section";
import { SettingsGroup, SettingsRow } from "./settings-row";

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: "system", label: "Sistema" }, { value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" },
];
/** Not persisted by any backend yet: one text row each, with the reason visible and nothing to switch. */
const COMING_SOON = [
  { id: "recruitment", icon: ClipboardList, title: "Reclutamiento", description: "Incluir preguntas de filtro al preparar una vacante." },
  { id: "notifications", icon: BellRing, title: "Notificaciones", description: "Nuevas postulaciones, cambios en entrevistas, actividad del equipo y resumen semanal." },
  { id: "security", icon: ShieldCheck, title: "Seguridad", description: "Autenticación en dos pasos y cambio de contraseña." },
] as const;
const linkAction = cn(buttonVariants({ variant: "outline", className: "min-h-10" }));

function ThemeRow() {
  const [theme, setTheme] = React.useState<ThemeMode>("system");
  React.useEffect(() => { setTheme(readStoredThemeMode(window.localStorage)); }, []);
  return (
    <SettingsRow id="pf-employer-settings-theme" icon={Palette} title="Apariencia" description="Tema de la interfaz en este dispositivo. Se aplica al instante.">
      <ToggleGroup variant="segmented" aria-label="Tema de la interfaz" className="h-11! max-md:w-full" value={[theme]} onValueChange={values => {
        const next = values[0];
        if (next !== "system" && next !== "light" && next !== "dark") return;
        applyThemeMode(next);
        setTheme(next);
      }}>
        {THEME_OPTIONS.map(option => <ToggleGroupItem key={option.value} value={option.value} className="max-md:flex-1">{option.label}</ToggleGroupItem>)}
      </ToggleGroup>
    </SettingsRow>
  );
}

/**
 * Configuración de empresa (artboard `settings-redesign/02`): the identity strip, then rows grouped as Organización, Preferencias and
 * Próximamente. Editing happens in a sheet (Base de talento) or a dialog (location); the owner-only rows disappear for everyone else.
 */
export function EmployerSettingsWorkspace() {
  return (
    <DashboardPageContent data-pf-employer-settings-workspace width="full" className="mx-auto flex w-full max-w-[65rem] flex-col gap-6">
      <CompanySection>{({ role }) => {
        const owner = role === "owner";
        return (
          <>
            <SettingsGroup id="pf-employer-settings-organization" title="Organización">
              {owner && <TalentBaseVisibilityRow />}
              <SettingsRow id="pf-employer-settings-team" icon={UsersRound} title="Equipo y permisos" description="Consulta las personas y los roles de tu equipo de reclutamiento.">
                <Link href="/empresa/equipo" data-slot="button" aria-describedby="pf-employer-settings-team" className={linkAction}>Administrar equipo<ArrowUpRight aria-hidden="true" /></Link>
              </SettingsRow>
              <SettingsRow id="pf-employer-settings-site" icon={Globe2} title="Sitio de empleo" description="Edita la información que ven los candidatos sobre tu empresa.">
                <Link href="/empresa/sitio" data-slot="button" aria-describedby="pf-employer-settings-site" className={linkAction}>Editar sitio<ArrowUpRight aria-hidden="true" /></Link>
              </SettingsRow>
            </SettingsGroup>
            <SettingsGroup id="pf-employer-settings-preferences" title="Preferencias"><ThemeRow /></SettingsGroup>
            <SettingsGroup id="pf-employer-settings-soon" title="Próximamente">
              {COMING_SOON.map(item => <SettingsRow key={item.id} id={`pf-employer-settings-${item.id}`} icon={item.icon} title={item.title} description={item.description} soon />)}
            </SettingsGroup>
            {!owner && <p className="flex items-start gap-2.5 rounded-2xl bg-muted p-3 text-xs leading-4 text-foreground"><Info aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /><span>Solo el dueño puede editar la ubicación de la empresa y elegir quién ve la Base de talento.</span></p>}
          </>
        );
      }}</CompanySection>
    </DashboardPageContent>
  );
}
