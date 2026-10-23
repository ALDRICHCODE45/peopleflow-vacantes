import { useState, type ReactNode } from "react";
// jsdom's anchored portal repositions in a loop; keep actual filtering and selection.
vi.mock("@/components/ui/combobox", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/combobox")>(),
  ComboboxContent: ({ children }: { children: ReactNode }) => <div data-slot="combobox-content">{children}</div>,
}));
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { DialCodeField } from "@/components/forms/dial-code-field";

afterEach(cleanup);
function Controlled({ initial = "+52", onChange = vi.fn() }: { initial?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return <DialCodeField id="dial" value={value} onChange={next => { setValue(next); onChange(next); }} />;
}

describe("dial country combobox", () => {
  it("defaults to Mexico and preserves the field label, id and description/error wiring", () => {
    render(<DialCodeField id="dial" onChange={vi.fn()} description="Ayuda" error="Revisa la lada." />);
    const input = screen.getByRole("combobox", { name: "Lada de país" });
    expect(input).toHaveValue("México +52");
    expect(input).toHaveAttribute("id", "dial");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Ayuda Revisa la lada.");
  });
  it("searches Spanish names without accents and writes only the selected dial", async () => {
    const onChange = vi.fn(); const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Lada de país" });
    await user.click(input); await user.clear(input); await user.type(input, "ecuador");
    expect(await screen.findByRole("option", { name: "Ecuador +593" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "México +52" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Ecuador +593" }));
    expect(onChange).toHaveBeenLastCalledWith("+593");
    expect(input).toHaveValue("Ecuador +593");
  });
  it("searches digits and retains Canada after blur/reopen even though its dial equals US", async () => {
    const onChange = vi.fn(); const user = userEvent.setup();
    render(<Controlled initial="+1" onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Lada de país" });
    expect(input).toHaveValue("Estados Unidos +1");
    await user.click(input); await user.clear(input); await user.type(input, "1");
    expect(await screen.findByRole("option", { name: "Canadá +1" })).toBeVisible();
    await user.click(screen.getByRole("option", { name: "Canadá +1" }));
    expect(onChange).toHaveBeenLastCalledWith("+1");
    await user.tab(); expect(input).toHaveValue("Canadá +1");
    await user.click(input);
    expect(await screen.findByRole("option", { name: "Canadá +1" })).toHaveAttribute("aria-selected", "true");
  });
  it("restores the stored selection after uncommitted search and reacts to external dial changes", async () => {
    const onChange = vi.fn(); const user = userEvent.setup();
    const view = render(<DialCodeField id="dial" value="+52" onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Lada de país" });
    await user.click(input); await user.clear(input); await user.type(input, "inexistente");
    expect(await screen.findByText("Sin coincidencias.")).toBeVisible();
    await user.tab(); expect(input).toHaveValue("México +52"); expect(onChange).not.toHaveBeenCalled();
    view.rerender(<DialCodeField id="dial" value="+44" onChange={onChange} />);
    await waitFor(() => expect(input).toHaveValue("Reino Unido +44"));
    view.rerender(<DialCodeField id="dial" value="" onChange={onChange} />);
    await waitFor(() => expect(input).toHaveValue(""));
    fireEvent.blur(input); expect(onChange).not.toHaveBeenCalled();
  });
  it("discards a remembered shared-plan country when the external dial changes away and back", async () => {
    const onChange = vi.fn(); const user = userEvent.setup();
    const view = render(<DialCodeField id="dial" value="+1" onChange={onChange} />);
    const input = screen.getByRole("combobox", { name: "Lada de país" });
    await user.click(input); await user.clear(input); await user.type(input, "canada");
    await user.click(await screen.findByRole("option", { name: "Canadá +1" }));
    expect(input).toHaveValue("Canadá +1");
    view.rerender(<DialCodeField id="dial" value="+44" onChange={onChange} />);
    await waitFor(() => expect(input).toHaveValue("Reino Unido +44"));
    view.rerender(<DialCodeField id="dial" value="+1" onChange={onChange} />);
    await waitFor(() => expect(input).toHaveValue("Estados Unidos +1"));
  });
  it("supports keyboard selection without submitting a form and honors disabled", async () => {
    const onChange = vi.fn(); const onSubmit = vi.fn(); const user = userEvent.setup();
    const view = render(<form onSubmit={event => { event.preventDefault(); onSubmit(); }}><Controlled onChange={onChange} /></form>);
    const input = screen.getByRole("combobox", { name: "Lada de país" });
    await user.click(input); await user.clear(input); await user.type(input, "593");
    await screen.findByRole("option", { name: "Ecuador +593" });
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith("+593"); expect(onSubmit).not.toHaveBeenCalled();
    view.rerender(<DialCodeField id="dial" value="+52" disabled onChange={onChange} />);
    expect(screen.getByRole("combobox", { name: "Lada de país" })).toBeDisabled();
  });
});
