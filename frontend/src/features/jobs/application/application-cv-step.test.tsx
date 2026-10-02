import type { ComponentProps } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { ApplicationCvStep } from "./application-cv-step";

const SOURCE = readFileSync(
  join(process.cwd(), "src", "features", "jobs", "application", "application-cv-step.tsx"),
  "utf8",
);

/** A real `File`, since the step crosses the browser file boundary directly. */
function makeFile(name: string, type = "application/pdf"): File {
  return new File(["contenido"], name, { type });
}

/** Base UI reads matchMedia/ResizeObserver while its primitives mount in jsdom. */
function stubBrowserApis() {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, media: "", onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(() => false),
  })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
}

beforeEach(stubBrowserApis);
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function renderStep(overrides: Partial<ComponentProps<typeof ApplicationCvStep>> = {}) {
  const props = {
    file: null as File | null,
    error: null as string | null,
    onFiles: vi.fn(),
    onRemove: vi.fn(),
    onBack: vi.fn(),
    onContinue: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ApplicationCvStep {...props} />) };
}

const fileInput = (): HTMLInputElement =>
  document.getElementById("application-cv-file") as HTMLInputElement;
const dropArea = (container: HTMLElement): HTMLElement =>
  container.querySelector("[data-pf-application-cv-drop]") as HTMLElement;

describe("ApplicationCvStep controls", () => {
  it("labels one optional native file control with a keyboard-equivalent picker button", () => {
    const { container } = renderStep();
    expect(container.querySelector("[data-pf-application-step='cv']")).not.toBeNull();
    const input = fileInput();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("accept", ".pdf,.doc,.docx");
    expect(input).not.toBeDisabled();
    expect(screen.getByLabelText("Curriculum vitae (opcional)")).toBe(input);

    const picker = screen.getByRole("button", { name: /elegir archivo/i });
    expect(picker).toHaveAttribute("type", "button");
    expect(picker.className).toContain("min-h-11");

    // The drop surface is a real area with a real control, never a fake button.
    const area = dropArea(container);
    expect(area.tagName).toBe("DIV");
    expect(area).not.toHaveAttribute("role");
    expect(area).not.toHaveAttribute("tabindex");

    for (const name of [/atrás/i, /continuar/i]) {
      const action = screen.getByRole("button", { name });
      expect(action).toHaveAttribute("type", "button");
      expect(action.className).toContain("min-h-11");
    }
  });

  it("states the optional and local-only nature without implying the CV survives anything", () => {
    const { container } = renderStep();
    const text = container.textContent ?? "";
    expect(text).toMatch(/opcional/u);
    expect(text).toContain("PDF, DOC o DOCX");
    expect(text).toMatch(/se queda en esta página|solo .* esta página/u);
    expect(text).toMatch(/recargas o sales|recargar|salir/u);
    expect(text).not.toMatch(/demostraci[óo]n|no se env[íi]a|no se guarda/iu);
  });

  it("routes the picker and the explicit button through the same native input", () => {
    const { props } = renderStep();
    const input = fileInput();
    const clickSpy = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: /elegir archivo/i }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(props.onFiles).not.toHaveBeenCalled();
  });
});

describe("ApplicationCvStep selection parity", () => {
  it("reports picked files, resets the input and permits selecting the same file again", () => {
    const { props } = renderStep();
    const input = fileInput();
    const chosen = makeFile("Mi Cv.PDF");

    fireEvent.change(input, { target: { files: [chosen] } });
    expect(props.onFiles).toHaveBeenCalledTimes(1);
    expect((props.onFiles as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual([chosen]);
    expect(input.value).toBe("");

    fireEvent.change(input, { target: { files: [chosen] } });
    expect(props.onFiles).toHaveBeenCalledTimes(2);
  });

  it("reports a cancelled picker as an empty selection so the wizard can preserve the current file", () => {
    const { props } = renderStep();
    fireEvent.change(fileInput(), { target: { files: [] } });
    expect(props.onFiles).toHaveBeenCalledTimes(1);
    expect((props.onFiles as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual([]);
  });

  it("accepts a dropped file and prevents the browser from opening it", () => {
    const { props, container } = renderStep();
    const area = dropArea(container);
    const dropped = makeFile("cv.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");

    const result = fireEvent.drop(area, { dataTransfer: { files: [dropped], types: ["Files"] } });
    expect(result).toBe(false);
    expect(props.onFiles).toHaveBeenCalledTimes(1);
    expect((props.onFiles as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual([dropped]);
  });

  it("keeps the drop surface from triggering the browser file preview on dragover", () => {
    const { container } = renderStep();
    const area = dropArea(container);
    const over = fireEvent.dragOver(area, { dataTransfer: { files: [], types: ["Files"] } });
    expect(over).toBe(false);
    expect(area).toHaveAttribute("data-dragging", "true");
    fireEvent.dragLeave(area);
    expect(area).toHaveAttribute("data-dragging", "false");
  });
});

describe("ApplicationCvStep error state", () => {
  it("announces the error as an alert wired to the input", () => {
    const { container } = renderStep({ error: "El CV no puede superar los 10 MB." });
    const input = fileInput();
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = (input.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(Boolean);
    expect(describedBy).toContain("application-cv-help");
    expect(describedBy).toContain("application-cv-error");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("El CV no puede superar los 10 MB.");
    expect(container.querySelectorAll("#application-cv-error")).toHaveLength(1);
  });

  it("has no alert and no invalid flag without an error", () => {
    renderStep();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fileInput()).not.toHaveAttribute("aria-invalid");
  });
});

describe("ApplicationCvStep selected document", () => {
  it("keeps a long file name fully readable instead of inheriting the one-line clamp", () => {
    const longName = `curriculum-vitae-${"muy-largo-".repeat(8)}final.pdf`;
    const { container } = renderStep({ file: makeFile(longName) });
    const title = container.querySelector("[data-pf-application-cv-selected-name]") as HTMLElement;
    // The full user-provided name stays in the DOM and is never clipped to one line.
    expect(title).toHaveTextContent(longName);
    expect(title.className).toContain("line-clamp-none");
    expect(title.className).not.toContain("line-clamp-1");
    expect(title.className).toContain("break-words");
    expect(title.className).toContain("w-full");
    // The wrapping parent may shrink below its content so the title can wrap.
    const content = title.closest("[data-slot='item-content']") as HTMLElement;
    expect(content.className).toContain("min-w-0");
  });

  it("exposes the step title as a programmatic focus target, not a tab stop", () => {
    const { container } = renderStep();
    const title = container.querySelector("[data-pf-application-step-title]") as HTMLElement;
    expect(title).toHaveTextContent("Tu CV");
    expect(title).toHaveAttribute("tabindex", "-1");
    expect(title).toHaveAttribute("role", "heading");
    expect(title).toHaveAttribute("aria-level", "2");
  });

  it("shows the accepted file name, format and size with a named remove action", () => {
    const selected = makeFile("Mi Cv.PDF");
    const { container } = renderStep({ file: selected });
    const item = container.querySelector("[data-pf-application-cv-selected]") as HTMLElement;
    expect(item).not.toBeNull();
    expect(item).toHaveTextContent("Mi Cv.PDF");
    expect(item).toHaveTextContent("PDF");
    expect(item).toHaveTextContent(/\d+(?:\.\d+)?\s?(?:KB|MB)/u);
    expect(screen.getByRole("button", { name: "Quitar Mi Cv.PDF" })).toBeInTheDocument();
  });

  it("hides the native picker and leaves one visible keyboard-accessible selection control", () => {
    renderStep({ error: "El CV no puede superar los 10 MB." });
    const input = fileInput();
    expect(input).toHaveAttribute("type", "file");
    expect(input).toHaveAttribute("hidden");
    expect(input).toHaveAttribute("tabindex", "-1");
    const picker = screen.getByRole("button", { name: "Elegir archivo" });
    expect(picker).toHaveAttribute("aria-describedby", "application-cv-help application-cv-error");
    picker.focus();
    expect(picker).toHaveFocus();
  });

  it("removes the current file and returns focus to the visible picker button", () => {
    const selected = makeFile("Mi Cv.PDF");
    const { container } = renderStep({ file: selected });
    fireEvent.click(screen.getByRole("button", { name: "Quitar Mi Cv.PDF" }));
    const input = fileInput();
    // The file input itself is not focused — it is visually hidden.
    expect(input).not.toHaveFocus();
    // The visible "Elegir archivo" button receives focus.
    const pickerButton = container.querySelector("button") as HTMLElement;
    expect(pickerButton).toHaveFocus();
  });

  it("marks the drop surface as the replacement path while a file is selected", () => {
    const { container } = renderStep({ file: makeFile("Mi Cv.PDF") });
    expect(dropArea(container)).toHaveTextContent(/reemplaz/u);
  });
});

describe("ApplicationCvStep navigation and boundary", () => {
  it("forwards Back and Continue without ever submitting", () => {
    const { props, container } = renderStep();
    fireEvent.click(screen.getByRole("button", { name: /atrás/i }));
    fireEvent.click(screen.getByRole("button", { name: /continuar/i }));
    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onContinue).toHaveBeenCalledTimes(1);
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("[type='submit']")).toBeNull();
  });

  it("stays free of transport, storage, readers, object URLs, progress and serialization", () => {
    for (const pattern of [
      /\bfetch\(|XMLHttpRequest|axios/u,
      /localStorage|sessionStorage|indexedDB|document\.cookie/u,
      /FileReader|createObjectURL|FormData|JSON\.stringify/u,
      /setTimeout|setInterval|requestAnimationFrame|Math\.random|Date\.now/u,
      /upload(?:Progress|Percent)|onUploadProgress/u,
    ]) {
      expect(SOURCE).not.toMatch(pattern);
    }
    expect(SOURCE).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/u);
  });
});
