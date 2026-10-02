import * as React from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { THEME_BOOTSTRAP_SCRIPT } from "@/components/theme/theme-preferences";
import "./globals.css";

// Preset b27M1Ev2 typography: Inter serves the body role through the
// framework-managed next/font loader (self-hosted at runtime, no network font
// dependency). The heading role keeps the licensed "Clash Display" preference
// in --font-heading (globals.css) and degrades to Inter when that face is not
// available, so no hosted stylesheet or CDN preconnect is needed.
const inter = Inter({
    subsets: ["latin"],
    display: "swap",
    variable: "--font-sans",
});

export const metadata: Metadata = {
    title: {
        default: "PeopleFlow",
        template: "%s | PeopleFlow",
    },
    description:
        "Descubre vacantes en PeopleFlow y encuentra tu próxima oportunidad.",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html
            lang="es-MX"
            className={`${inter.variable} ${inter.className}`}
            // The pre-paint theme bootstrap mutates <html> before React hydrates;
            // suppressHydrationWarning keeps that mutation from being reported as a
            // hydration mismatch.
            suppressHydrationWarning
        >
            {/* Pre-paint theme bootstrap: resolves the persisted manual choice (or
          the OS preference) into the dark class / data-theme attribute before
          first paint. It renders as the FIRST element of <body> — valid HTML
          placement inside the React tree — and runs parser-blocking before
          any following content is parsed, so neither the server render nor
          hydration reads browser state. A <script> directly under <html> is
          invalid placement and trips the Next hydration-error overlay. */}
            <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
                <script data-pf-theme-bootstrap="">
                    {THEME_BOOTSTRAP_SCRIPT}
                </script>
                {children}
            </body>
        </html>
    );
}
