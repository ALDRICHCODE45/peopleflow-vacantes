import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ComponentProps } from "react";
import { StartReplacementHost } from "./start-replacement-host";
import { StartReplacementDialog } from "@/features/vacancy-replacement/start-replacement-dialog";
import { useCompanyMembershipState } from "@/features/employer-company/company-membership-context";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/features/vacancy-replacement/start-replacement-dialog", () => ({ StartReplacementDialog: vi.fn(() => null) }));
vi.mock("@/features/employer-company/company-membership-context", () => ({ useCompanyMembershipState: vi.fn() }));

const source = { stages: [], unavailableHires: [] };
const company = { name: "Grupo Altavista" };
const passed = () => vi.mocked(StartReplacementDialog).mock.calls.at(-1)?.[0] as ComponentProps<typeof StartReplacementDialog>;
function mount() { render(<StartReplacementHost draftId="d1" title="Supervisor(a) de Almacén" source={source} onClose={vi.fn()} />); }
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("StartReplacementHost company name", () => {
  it("passes the company name of the membership", () => {
    vi.mocked(useCompanyMembershipState).mockReturnValue({ userId: "u1", state: { kind: "exists", company } as never, reload: vi.fn() });
    mount();
    expect(passed().companyName).toBe("Grupo Altavista");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it.each([
    ["outside the provider", null],
    ["while the membership loads", { userId: "u1", state: null, reload: vi.fn() }],
    ["without a company", { userId: "u1", state: { kind: "none", industries: [] }, reload: vi.fn() }],
  ])("passes no company name %s", (_name, value) => {
    vi.mocked(useCompanyMembershipState).mockReturnValue(value as never);
    mount();
    expect(passed().companyName).toBeUndefined();
  });
});
