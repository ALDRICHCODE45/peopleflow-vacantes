import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NavUser } from "./nav-user";
import { SidebarProvider } from "./ui/sidebar";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const source = readFileSync(
  join(process.cwd(), "src/components/company-dashboard/nav-user.tsx"),
  "utf8",
);

// The agreed fictional employer identity for the PDC-01 correction: Nexo Labs
// hires Tomás Ríos as Talent Lead. PDC-03 removed the stock photo, so the
// account carries no avatar field any more: identity renders from initials.
const ACCOUNT = {
  name: "Tomás Ríos",
  email: "tomas.rios@nexolabs.mx",
  role: "Talent Lead",
  company: "Nexo Labs",
} as const;

// jsdom implements neither matchMedia nor ResizeObserver; the sidebar reads the
// first through `useIsMobile`, so it is stubbed to the desktop branch.
function stubBrowserApis() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("innerWidth", 1280);
}

function renderNavUser() {
  return render(
    <SidebarProvider>
      <NavUser user={{ ...ACCOUNT }} />
    </SidebarProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("company dashboard account summary identity", () => {
  beforeEach(stubBrowserApis);

  it("renders the agreed employer name and role in the account summary", () => {
    renderNavUser();

    expect(screen.getByText("Tomás Ríos")).toBeInTheDocument();
    // The role and employer are real text, not decoration, so screen readers
    // reach them through the account summary.
    expect(screen.getByText("Talent Lead · Nexo Labs")).toBeInTheDocument();
    // The avatar fallback stays coherent with the new account name.
    expect(screen.getByText("TR")).toBeInTheDocument();
  });

  it("exposes the role through the account summary trigger name", () => {
    renderNavUser();

    const trigger = screen.getByRole("button", { name: /Tomás Ríos/ });

    expect(trigger).toHaveTextContent("Talent Lead");
    expect(trigger).toHaveTextContent("Nexo Labs");
  });

  it("binds the employer email into the account dropdown summary", () => {
    // The Base UI menu popup cannot be driven in jsdom without hanging, so the
    // email binding is asserted at the source boundary instead of opening the
    // portal. The trigger itself keeps the role summary, not the email.
    expect(source).toContain("{user.email}");
  });

  it("keeps no trace of the retained demo account", () => {
    expect(source).not.toContain(">CN<");
    expect(source).not.toContain("camila");
  });

  it("introduces no raw color value", () => {
    expect(source).not.toMatch(/oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\s*\(/);
  });
});

describe("company dashboard account avatar identity", () => {
  beforeEach(stubBrowserApis);

  it("drops the stock avatar asset from the account plumbing", () => {
    // The stock photo is gone end to end: no field, no image import, no src.
    expect(source).not.toContain("/avatars");
    expect(source).not.toContain("AvatarImage");
    expect(source).not.toContain("user.avatar");
  });

  it("renders initials only, with no avatar image request", () => {
    renderNavUser();

    expect(document.querySelectorAll("[data-slot='avatar-image']")).toHaveLength(0);
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(screen.getByText("TR")).toBeInTheDocument();
  });

  it("styles the initials fallback with semantic tokens only", () => {
    renderNavUser();

    const fallbacks = Array.from(
      document.querySelectorAll("[data-slot='avatar-fallback']"),
    );
    expect(fallbacks.length).toBeGreaterThan(0);

    for (const fallback of fallbacks) {
      expect(fallback.className).toContain("bg-primary");
      expect(fallback.className).toContain("text-primary-foreground");
      expect(fallback.className).not.toMatch(
        /oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(/,
      );
    }
  });

  it("keeps the avatar box and account geometry while dropping the photo filter", () => {
    renderNavUser();

    const avatar = document.querySelector("[data-slot='avatar']");
    expect(avatar).not.toBeNull();
    expect(avatar!.className).toContain("size-8");
    expect(avatar!.className).toContain("rounded-lg");
    // `grayscale` existed to tone the photo down; on initials-only identity it
    // would desaturate the semantic fallback instead, so it goes with the image.
    expect(avatar!.className).not.toContain("grayscale");
  });
});

describe("company dashboard account menu labels", () => {
  it("localizes every account menu entry", () => {
    // The Base UI menu popup cannot be driven in jsdom without hanging, so the
    // Spanish menu copy is asserted at the source boundary. Every entry stays a
    // plain label: none of them implies a working destination or a mutation.
    for (const [spanish, stock] of [
      ["Mi perfil", "Account"],
      ["Plan y facturación", "Billing"],
      ["Notificaciones", "Notifications"],
      ["Cerrar sesión", "Log out"],
    ] as const) {
      expect(source, `${spanish} label`).toContain(spanish);
      expect(source, `${stock} stock label`).not.toContain(stock);
    }
  });

  it("keeps the account menu icons and grouping", () => {
    for (const icon of [
      "IconUserCircle",
      "IconCreditCard",
      "IconNotification",
      "IconLogout",
    ]) {
      expect(source, `${icon} icon`).toContain(`<${icon}`);
    }

    // Two grouped blocks split by the two separators: same menu geometry.
    expect(source.match(/<DropdownMenuGroup>/g)).toHaveLength(2);
    expect(source.match(/<DropdownMenuSeparator \/>/g)).toHaveLength(2);
  });
});
