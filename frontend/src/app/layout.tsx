import * as React from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Preset b27M1Ev2 typography: Inter serves the body role; Clash Display is
// layered on top as the heading role. Fontshare's license requires hosted
// delivery, so the display face loads through their global stylesheet (with
// preconnects) instead of next/font or self-hosted files.
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
    <html lang="es-MX" className={`${inter.variable} ${inter.className}`}>
      {/* Fontshare delivery: warm the two origins, then load the display
              face. Offline, the "Clash Display" stack falls back to Inter. */}
      <link
        rel="preconnect"
        href="https://api.fontshare.com"
        crossOrigin="anonymous"
      />
      <link
        rel="preconnect"
        href="https://cdn.fontshare.com"
        crossOrigin="anonymous"
      />
      <link
        rel="stylesheet"
        href="https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&display=swap"
      />
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
