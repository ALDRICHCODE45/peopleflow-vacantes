"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { BellRing, CalendarClock, KeyRound, MessagesSquare, Palette, ShieldCheck, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { applyThemeMode, readStoredThemeMode } from "@/components/theme/theme-preferences";
import type { ThemeMode } from "@/components/theme/theme-preferences";

/**
 * Sole client leaf for the candidate settings destination: a compact in-page rail
 * plus one restrained Card per section, with grouped Item rows and contextual
 * medallions. It receives nothing through props, renders no personal fact sheet,
 * and every control owns only its own view state. The four notification switches
 * live in component memory for the current visit; the theme Select is the single
 * control wired to the shared theme preference helpers.
 */

/** Real in-page section ids; the nav anchors and the H2 headings share them. */
const NOTIFICATIONS_SECTION = { id: "notificaciones", heading: "Notificaciones", description: "Elegí qué avisos querés tener presentes." } as const;
const APPEARANCE_SECTION = { id: "apariencia", heading: "Apariencia", description: "Elegí el tema de la interfaz para este dispositivo." } as const;
const SECURITY_SECTION = { id: "seguridad", heading: "Seguridad", description: "Controles de acceso de tu cuenta." } as const;

type SectionId = (typeof NOTIFICATIONS_SECTION | typeof APPEARANCE_SECTION | typeof SECURITY_SECTION)["id"];
type SectionSpec = Readonly<{ id: SectionId; heading: string; description: string }>;

/** Compact rail: one real anchor per section, in committed order. */
const NAV_ITEMS: readonly Readonly<{ section: SectionSpec; icon: LucideIcon }>[] = [
  { section: NOTIFICATIONS_SECTION, icon: BellRing },
  { section: APPEARANCE_SECTION, icon: Palette },
  { section: SECURITY_SECTION, icon: ShieldCheck },
];

/** Closed vocabulary of session-scoped notification preferences. */
type NotificationKey = "matching_vacancies" | "application_updates" | "recruiter_messages" | "weekly_summary";
type NotificationSpec = Readonly<{ key: NotificationKey; label: string; description: string; icon: LucideIcon }>;

/** The four notification rows, in committed order, with their visible labels. */
const NOTIFICATIONS: readonly NotificationSpec[] = [
  { key: "matching_vacancies", label: "Alertas de vacantes compatibles", description: "Vacantes que coincidan con tu perfil profesional.", icon: Sparkles },
  { key: "application_updates", label: "Cambios en tus postulaciones", description: "Novedades sobre el estado de tus postulaciones.", icon: CalendarClock },
  { key: "recruiter_messages", label: "Mensajes de reclutadores", description: "Mensajes de empresas interesadas en tu perfil.", icon: MessagesSquare },
  { key: "weekly_summary", label: "Resumen semanal", description: "Un repaso de tu actividad de la semana.", icon: BellRing },
];

/** Initial state: the three continuous alerts start on, the weekly digest starts off. */
const NOTIFICATION_DEFAULTS: Readonly<Record<NotificationKey, boolean>> = { matching_vacancies: true, application_updates: true, recruiter_messages: true, weekly_summary: false };
/** Fresh mutable copy per mount so the frozen defaults are never shared. */
const initialNotifications = (): Record<NotificationKey, boolean> => ({ ...NOTIFICATION_DEFAULTS });

/** Theme vocabulary for the Select; every value crosses to the shared theme helper. */
const THEME_OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
];

/** A real section: one Card with real anatomy and one real H2 per nav target. */
function SettingsSection({ section, children }: { readonly section: SectionSpec; readonly children: React.ReactNode }) {
  return (
    <section id={section.id} aria-labelledby={`${section.id}-heading`} data-pf-settings-section={section.id} className="scroll-mt-4">
      <Card>
        <CardHeader className="border-b border-border/60">
          <h2 id={`${section.id}-heading`} className="font-heading text-xl font-semibold text-foreground">{section.heading}</h2>
          <CardDescription>{section.description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}

/**
 * Grouped rows. `ItemGroup` ships `role="list"`, so the wrapper drops to
 * presentation and the rows keep one valid list role through real `<li>`.
 */
function SettingsGroup({ children }: { readonly children: React.ReactNode }) {
  return (
    <ItemGroup role="presentation">
      <ul className="flex w-full flex-col gap-4">{children}</ul>
    </ItemGroup>
  );
}

/** One setting row: contextual medallion, labelled copy and the control slot. */
function SettingRow({ icon: Icon, titleId, title, descriptionId, description, children }: {
  readonly icon: LucideIcon;
  readonly titleId: string;
  readonly title: string;
  readonly descriptionId: string;
  readonly description: string;
  readonly children: React.ReactNode;
}) {
  return (
    <li className="min-w-0">
      <Item className="items-start">
        <ItemMedia>
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle id={titleId}>{title}</ItemTitle>
          <ItemDescription id={descriptionId}>{description}</ItemDescription>
        </ItemContent>
        <ItemActions className="w-full justify-end sm:w-auto">{children}</ItemActions>
      </Item>
    </li>
  );
}

function NotificationsSection({ notifications, onToggle }: {
  readonly notifications: Readonly<Record<NotificationKey, boolean>>;
  readonly onToggle: (key: NotificationKey, checked: boolean) => void;
}) {
  return (
    <SettingsSection section={NOTIFICATIONS_SECTION}>
      <SettingsGroup>
        {NOTIFICATIONS.map((notification) => {
          const labelId = `pf-settings-${notification.key}-label`;
          const descriptionId = `pf-settings-${notification.key}-description`;
          return (
            <SettingRow key={notification.key} icon={notification.icon} titleId={labelId} title={notification.label} descriptionId={descriptionId} description={notification.description}>
              <Switch
                checked={notifications[notification.key]}
                onCheckedChange={(checked) => onToggle(notification.key, checked)}
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                data-pf-settings-notification={notification.key}
              />
            </SettingRow>
          );
        })}
      </SettingsGroup>
    </SettingsSection>
  );
}

function AppearanceSection({ mode, onModeChange }: { readonly mode: ThemeMode; readonly onModeChange: (next: ThemeMode) => void }) {
  return (
    <SettingsSection section={APPEARANCE_SECTION}>
      <SettingsGroup>
        <SettingRow icon={Palette} titleId="pf-settings-theme-label" title="Tema de la interfaz" descriptionId="pf-settings-theme-description" description="Se aplica al instante en toda la aplicación.">
          <Select items={THEME_OPTIONS} value={mode} onValueChange={(next) => onModeChange(next as ThemeMode)}>
            <SelectTrigger data-pf-settings-theme aria-labelledby="pf-settings-theme-label" aria-describedby="pf-settings-theme-description" className="min-h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {THEME_OPTIONS.map((option) => (<SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingsGroup>
    </SettingsSection>
  );
}

function SecuritySection() {
  return (
    <SettingsSection section={SECURITY_SECTION}>
      <SettingsGroup>
        <SettingRow icon={ShieldCheck} titleId="pf-settings-2fa-label" title="Autenticación en dos pasos" descriptionId="pf-settings-2fa-description" description="Segundo factor para iniciar sesión.">
          {/* Controlled `false` keeps the switch enabled, focusable and inert. */}
          <Switch checked={false} aria-labelledby="pf-settings-2fa-label" aria-describedby="pf-settings-2fa-description" data-pf-settings-2fa />
        </SettingRow>
        <SettingRow icon={KeyRound} titleId="pf-settings-password-label" title="Contraseña" descriptionId="pf-settings-password-description" description="Clave de acceso a tu cuenta.">
          <Button type="button" variant="outline" data-pf-settings-password className="min-h-10">Cambiar contraseña</Button>
        </SettingRow>
      </SettingsGroup>
    </SettingsSection>
  );
}

/** Candidate settings surface: responsive rail plus grouped section cards. */
export function SettingsWorkspace() {
  const [notifications, setNotifications] = React.useState<Record<NotificationKey, boolean>>(initialNotifications);
  const [themeMode, setThemeMode] = React.useState<ThemeMode>("system");

  // The server carries no browser state, so the stored mode is read once after hydration.
  React.useEffect(() => {
    setThemeMode(readStoredThemeMode(window.localStorage));
  }, []);

  const toggleNotification = (key: NotificationKey, checked: boolean): void => {
    setNotifications((previous) => ({ ...previous, [key]: checked }));
  };

  const changeThemeMode = (next: ThemeMode): void => {
    applyThemeMode(next);
    setThemeMode(next);
  };

  return (
    <div
      data-pf-settings-workspace
      className="mx-auto grid w-full max-w-screen-2xl grid-cols-1 gap-5 px-4 py-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:px-6"
    >
      <nav data-pf-settings-nav aria-label="Secciones de configuración" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-3 lg:grid-cols-1">
          {NAV_ITEMS.map(({ section, icon: Icon }) => (
            <li key={section.id} className="min-w-0">
              <a
                href={`#${section.id}`}
                data-pf-settings-nav-link={section.id}
                className="flex min-h-10 min-w-0 items-center gap-2 rounded-2xl px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="min-w-0 truncate">{section.heading}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col gap-5">
        <NotificationsSection notifications={notifications} onToggle={toggleNotification} />
        <AppearanceSection mode={themeMode} onModeChange={changeThemeMode} />
        <SecuritySection />
      </div>
    </div>
  );
}
