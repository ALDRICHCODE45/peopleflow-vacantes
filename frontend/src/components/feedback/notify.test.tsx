import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { sileo } from "sileo";
import { dismissActionResult, notifyActionResult } from "./notify";

vi.mock("sileo", () => ({ sileo: {
  success: vi.fn(() => "success-id"), error: vi.fn(() => "error-id"),
  warning: vi.fn(() => "warning-id"), info: vi.fn(() => "info-id"), dismiss: vi.fn(),
} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it.each(["success", "error", "warning", "info"] as const)("emits %s with a hidden own icon and only errors sticky", type => {
  notifyActionResult({ key: `type-${type}`, type, title: "Resultado", description: "Descripción" });
  expect(sileo[type]).toHaveBeenCalledTimes(1);
  const options = vi.mocked(sileo[type]).mock.calls[0][0];
  expect(options).toMatchObject({ title: "Resultado", description: "Descripción" });
  if (type === "error") expect(options).toHaveProperty("duration", null);
  else expect(options).not.toHaveProperty("duration");
  expect(options).not.toHaveProperty("fill");
  expect(options).not.toHaveProperty("position");
  const { container } = render(options.icon as ReactNode);
  expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
});
it("replaces only the matching key and allows explicit dismissal", () => {
  notifyActionResult({key:"replace", type:"success", title:"Uno"});
  notifyActionResult({key:"other", type:"info", title:"Otro"});
  expect(sileo.dismiss).not.toHaveBeenCalled();
  notifyActionResult({key:"replace", type:"error", title:"Dos"});
  expect(sileo.dismiss).toHaveBeenCalledExactlyOnceWith("success-id");
  dismissActionResult("replace");
  expect(sileo.dismiss).toHaveBeenLastCalledWith("error-id");
  dismissActionResult("replace");
  dismissActionResult("unknown");
  expect(sileo.dismiss).toHaveBeenCalledTimes(2);
});
it("appends only HTTP, code and local h23 time to an error description", () => {
  notifyActionResult({key:"reference",type:"error",title:"Error",description:"Tus cambios siguen aquí.",reference:{status:500,code:"internal_error",at:"2026-10-06T17:58:46"}});
  render(vi.mocked(sileo.error).mock.calls[0][0].description as ReactNode);
  expect(screen.getByText("Tus cambios siguen aquí.")).toBeInTheDocument();
  expect(screen.getByText("HTTP 500 · internal_error · 17:58:46")).toHaveClass("text-muted-foreground");
});
it.each([
  [{code:"conflict"}, "conflict"],
  [{status:401}, "HTTP 401"],
  [{at:"invalid"}, ""],
  [{}, ""],
] as const)("omits missing or invalid reference parts: %j", (reference, expected) => {
  notifyActionResult({key:"parts",type:"error",title:"Error",reference});
  const {container} = render(<>{vi.mocked(sileo.error).mock.calls[0][0].description as ReactNode}</>);
  expect(container.textContent).toBe(expected);
});
it.each(["success", "warning", "info"] as const)("never includes references in %s", type => {
  notifyActionResult({key:"no-ref",type,title:"Resultado",description:"Listo",reference:{status:500,code:"internal_error"}});
  expect(vi.mocked(sileo[type]).mock.calls[0][0].description).toBe("Listo");
});
it("maps an optional real callback to the toast shortcut", () => {
  const action = {title:"Reintentar",onClick:vi.fn()};
  notifyActionResult({key:"action",type:"error",title:"Error",action});
  expect(vi.mocked(sileo.error).mock.calls[0][0].button).toEqual(action);
});
