"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import { BellRing, BriefcaseBusiness, Building2, CalendarClock, ClipboardList, FileText, Globe2, KeyRound, Palette, ShieldCheck, UsersRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { DashboardPageContent } from "@/components/dashboard-page-content";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { applyThemeMode, readStoredThemeMode } from "@/components/theme/theme-preferences";
import type { ThemeMode } from "@/components/theme/theme-preferences";

const SECTIONS = [
  { id: "empresa-organizacion", title: "Organización", description: "Administra el equipo y la presencia pública de tu empresa.", icon: Building2 },
  { id: "empresa-reclutamiento", title: "Reclutamiento", description: "Define las preferencias para recibir postulaciones.", icon: BriefcaseBusiness },
  { id: "empresa-notificaciones", title: "Notificaciones", description: "Elige los avisos que quieres tener presentes.", icon: BellRing },
  { id: "empresa-apariencia", title: "Apariencia", description: "Elige el tema de la interfaz para este dispositivo.", icon: Palette },
  { id: "empresa-seguridad", title: "Seguridad", description: "Controles de acceso de tu cuenta.", icon: ShieldCheck },
] as const;

type Section = (typeof SECTIONS)[number];
const RECRUITMENT = [
  { key: "optional_cv", title: "Permitir postulaciones sin CV", description: "Recibe perfiles sin un CV adjunto.", icon: FileText },
  { key: "screening_questions", title: "Incluir preguntas de filtro", description: "Considera preguntas iniciales al preparar una vacante.", icon: ClipboardList },
] as const;
const NOTIFICATIONS = [
  { key: "new_applications", title: "Nuevas postulaciones", description: "Avisos cuando una persona se postule a tus vacantes.", icon: BriefcaseBusiness },
  { key: "interviews", title: "Cambios en entrevistas", description: "Actualizaciones de horarios y etapas del proceso.", icon: CalendarClock },
  { key: "team_activity", title: "Actividad del equipo", description: "Novedades sobre las asignaciones de reclutamiento.", icon: UsersRound },
  { key: "weekly_summary", title: "Resumen semanal", description: "Un repaso de las vacantes y postulaciones de la semana.", icon: BellRing },
] as const;
type PreferenceKey = (typeof RECRUITMENT)[number]["key"] | (typeof NOTIFICATIONS)[number]["key"];
type Preference = Readonly<{ key: PreferenceKey; title: string; description: string; icon: LucideIcon }>;
const DEFAULT_PREFERENCES: Readonly<Record<PreferenceKey, boolean>> = {
  optional_cv: true, screening_questions: false, new_applications: true,
  interviews: true, team_activity: true, weekly_summary: false,
};
const THEME_OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: "system", label: "Sistema" }, { value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" },
];

function SettingsSection({ section, children }: { section: Section; children: React.ReactNode }) {
  return (
    <section id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-4">
      <Card>
        <CardHeader className="border-b border-border/60">
          <CardTitle><h2 id={`${section.id}-heading`} className="font-heading text-xl font-semibold">{section.title}</h2></CardTitle>
          <CardDescription>{section.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ItemGroup role="presentation"><ul className="flex w-full flex-col gap-4">{children}</ul></ItemGroup>
        </CardContent>
      </Card>
    </section>
  );
}

function SettingRow({ id, icon: Icon, title, description, children }: {
  id: string; icon: LucideIcon; title: string; description: string; children: React.ReactNode;
}) {
  return (
    <li className="min-w-0">
      <Item className="items-start">
        <ItemMedia><span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary"><Icon className="size-4" /></span></ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle id={`${id}-label`}>{title}</ItemTitle>
          <ItemDescription id={`${id}-description`}>{description}</ItemDescription>
        </ItemContent>
        <ItemActions className="w-full justify-end sm:w-auto">{children}</ItemActions>
      </Item>
    </li>
  );
}

/** Recruitment/notification controls own view state only; no backend save is claimed. */
export function EmployerSettingsWorkspace() {
  const [preferences, setPreferences] = React.useState(() => ({ ...DEFAULT_PREFERENCES }));
  const [theme, setTheme] = React.useState<ThemeMode>("system");
  React.useEffect(() => { setTheme(readStoredThemeMode(window.localStorage)); }, []);

  const preferenceRows = (items: readonly Preference[]) => items.map(item => {
    const id = `pf-employer-settings-${item.key}`;
    return (
      <SettingRow key={item.key} id={id} icon={item.icon} title={item.title} description={item.description}>
        <Switch
          checked={preferences[item.key]}
          onCheckedChange={checked => setPreferences(previous => ({ ...previous, [item.key]: checked }))}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-description`}
        />
      </SettingRow>
    );
  });

  return (
    <DashboardPageContent data-pf-employer-settings-workspace width="screen-2xl" className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <nav aria-label="Secciones de configuración de empresa" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1">
          {SECTIONS.map(({ id, title, icon: Icon }) => (
            <li key={id} className="min-w-0">
              <a href={`#${id}`} className="flex min-h-10 min-w-0 items-center gap-2 rounded-2xl px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30">
                <Icon aria-hidden="true" className="size-4 shrink-0" /><span className="min-w-0 truncate">{title}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col gap-5">
        <SettingsSection section={SECTIONS[0]}>
          <SettingRow id="pf-employer-settings-team" icon={UsersRound} title="Equipo y permisos" description="Consulta las personas y los roles de tu equipo de reclutamiento.">
            <Link href="/empresa/equipo" data-slot="button" className={cn(buttonVariants({ variant: "outline", className: "min-h-10" }))}>Administrar equipo</Link>
          </SettingRow>
          <SettingRow id="pf-employer-settings-site" icon={Globe2} title="Sitio de empleo" description="Edita la información que ven los candidatos sobre tu empresa.">
            <Link href="/empresa/sitio" data-slot="button" className={cn(buttonVariants({ variant: "outline", className: "min-h-10" }))}>Editar sitio</Link>
          </SettingRow>
        </SettingsSection>
        <SettingsSection section={SECTIONS[1]}>{preferenceRows(RECRUITMENT)}</SettingsSection>
        <SettingsSection section={SECTIONS[2]}>{preferenceRows(NOTIFICATIONS)}</SettingsSection>
        <SettingsSection section={SECTIONS[3]}>
          <SettingRow id="pf-employer-settings-theme" icon={Palette} title="Tema de la interfaz" description="Se aplica al instante en toda la aplicación.">
            <Select items={THEME_OPTIONS} value={theme} onValueChange={next => {
              if (next !== "system" && next !== "light" && next !== "dark") return;
              applyThemeMode(next);
              setTheme(next);
            }}>
              <SelectTrigger aria-labelledby="pf-employer-settings-theme-label" aria-describedby="pf-employer-settings-theme-description" className="min-h-10"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{THEME_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </SettingRow>
        </SettingsSection>
        <SettingsSection section={SECTIONS[4]}>
          <SettingRow id="pf-employer-settings-2fa" icon={ShieldCheck} title="Autenticación en dos pasos" description="Una verificación adicional para proteger tu cuenta.">
            <Switch checked={false} aria-labelledby="pf-employer-settings-2fa-label" aria-describedby="pf-employer-settings-2fa-description" />
          </SettingRow>
          <SettingRow id="pf-employer-settings-password" icon={KeyRound} title="Contraseña" description="Clave de acceso a tu cuenta.">
            <Button type="button" variant="outline" className="min-h-10">Cambiar contraseña</Button>
          </SettingRow>
        </SettingsSection>
      </div>
    </DashboardPageContent>
  );
}
