"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, BellRing, Clock3, KeyRound, Palette, ShieldCheck } from "lucide-react";

import { DashboardPageContent } from "@/components/dashboard-page-content";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { applyThemeMode, readStoredThemeMode } from "@/components/theme/theme-preferences";
import type { ThemeMode } from "@/components/theme/theme-preferences";

/**
 * Sole client leaf for the candidate settings destination: a compact in-page rail
 * plus one restrained Card per section, with grouped Item rows and contextual
 * medallions. It receives nothing through props, renders no personal fact sheet,
 * and every control owns only its own view state. Notifications link to their own
 * page (`/candidato/configuracion/notificaciones`, T4.4); the theme Select is the
 * single control wired to the shared theme preference helpers.
 */

/** Real in-page section ids; the nav anchors and the H2 headings share them. */
const NOTIFICATIONS_SECTION = { id: "notificaciones", heading: "Notificaciones", description: "Elige qué avisos quieres tener presentes." } as const;
const APPEARANCE_SECTION = { id: "apariencia", heading: "Apariencia", description: "Elige el tema de la interfaz para este dispositivo." } as const;
const SECURITY_SECTION = { id: "seguridad", heading: "Seguridad", description: "Controles de acceso de tu cuenta." } as const;

type SectionId = (typeof NOTIFICATIONS_SECTION | typeof APPEARANCE_SECTION | typeof SECURITY_SECTION)["id"];
type SectionSpec = Readonly<{ id: SectionId; heading: string; description: string }>;

/** Compact rail: one real anchor per section, in committed order. */
const NAV_ITEMS: readonly Readonly<{ section: SectionSpec; icon: LucideIcon }>[] = [
  { section: NOTIFICATIONS_SECTION, icon: BellRing },
  { section: APPEARANCE_SECTION, icon: Palette },
  { section: SECURITY_SECTION, icon: ShieldCheck },
];

/** Personal notification preferences live on their own page (T4.2); this section only links to it. */
const NOTIFICATIONS_HREF = "/candidato/configuracion/notificaciones";

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
          <CardTitle><h2 id={`${section.id}-heading`} className="font-heading text-xl font-semibold text-foreground">{section.heading}</h2></CardTitle>
          <CardDescription className="max-w-prose">{section.description}</CardDescription>
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
function SettingRow({ icon: Icon, titleId, title, descriptionId, description, compact = false, comingSoon = false, children }: {
  readonly icon: LucideIcon;
  readonly titleId: string;
  readonly title: string;
  readonly descriptionId: string;
  readonly description: string;
  /** A switch-sized control stays beside the copy at every width; wide controls drop below it on phones. */
  readonly compact?: boolean;
  /** Not wired to anything yet: the reason «Próximamente» stays visible under the description (the control links to `${descriptionId}` and `${descriptionId}-soon`). */
  readonly comingSoon?: boolean;
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
          <ItemTitle id={titleId} className="line-clamp-none break-words">{title}</ItemTitle>
          <ItemDescription id={descriptionId} className="max-w-prose line-clamp-none">{description}</ItemDescription>
          {comingSoon && <span id={`${descriptionId}-soon`} className="flex items-center gap-1.5 text-xs leading-4 text-muted-foreground"><Clock3 aria-hidden="true" className="size-3 shrink-0" />Próximamente</span>}
        </ItemContent>
        <ItemActions className={compact ? "shrink-0 justify-end" : "w-full justify-start sm:w-auto sm:justify-end [&_[data-slot=button]]:w-full [&_[data-slot=select-trigger]]:w-full sm:[&_[data-slot=button]]:w-auto sm:[&_[data-slot=select-trigger]]:w-auto"}>{children}</ItemActions>
      </Item>
    </li>
  );
}

function NotificationsSection() {
  return (
    <SettingsSection section={NOTIFICATIONS_SECTION}>
      <SettingsGroup>
        <SettingRow icon={BellRing} titleId="pf-settings-notifications-label" title="Mis preferencias" descriptionId="pf-settings-notifications-description" description="Elige qué avisos te llegan en la app y por correo.">
          <Link href={NOTIFICATIONS_HREF} data-slot="button" aria-describedby="pf-settings-notifications-description" className={cn(buttonVariants({ variant: "outline", className: "min-h-10" }))}>
            Elegir qué me llega<ArrowUpRight aria-hidden="true" />
          </Link>
        </SettingRow>
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
        <SettingRow icon={ShieldCheck} titleId="pf-settings-2fa-label" title="Autenticación en dos pasos" descriptionId="pf-settings-2fa-description" description="Segundo factor para iniciar sesión." compact comingSoon>
          <Switch checked={false} disabled aria-labelledby="pf-settings-2fa-label" aria-describedby="pf-settings-2fa-description pf-settings-2fa-description-soon" data-pf-settings-2fa />
        </SettingRow>
        <SettingRow icon={KeyRound} titleId="pf-settings-password-label" title="Contraseña" descriptionId="pf-settings-password-description" description="Clave de acceso a tu cuenta." comingSoon>
          <Button type="button" variant="outline" disabled aria-describedby="pf-settings-password-description pf-settings-password-description-soon" data-pf-settings-password className="min-h-10">Cambiar contraseña</Button>
        </SettingRow>
      </SettingsGroup>
    </SettingsSection>
  );
}

/** Candidate settings surface: responsive rail plus grouped section cards. */
export function SettingsWorkspace() {
  const [themeMode, setThemeMode] = React.useState<ThemeMode>("system");

  // The server carries no browser state, so the stored mode is read once after hydration.
  React.useEffect(() => {
    setThemeMode(readStoredThemeMode(window.localStorage));
  }, []);

  const changeThemeMode = (next: ThemeMode): void => {
    applyThemeMode(next);
    setThemeMode(next);
  };

  return (
    <DashboardPageContent
      data-pf-settings-workspace
      width="screen-2xl"
      className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
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
        <NotificationsSection />
        <AppearanceSection mode={themeMode} onModeChange={changeThemeMode} />
        <SecuritySection />
      </div>
    </DashboardPageContent>
  );
}
