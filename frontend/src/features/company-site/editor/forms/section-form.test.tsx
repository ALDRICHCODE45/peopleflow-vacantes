import React, { useReducer } from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import "../browser-platform.test-support";
import { defaultBlock, defaultSiteDraft } from "../../defaults";
import { createEditorState, editorReducer, type MappedFieldError } from "../../editor-state";
import { blockSchema, type BlockType, type SiteBlock } from "../../model";
import type { ImageFieldProps } from "../media/contract";
import { SectionForm } from "@/features/company-site/editor/forms/section-form";
vi.mock("../media", () => ({ ImageField: ({ kind, label, value, onChange, error }: ImageFieldProps) => <div data-kind={kind}><button onClick={() => onChange({ media_id: "11111111-1111-4111-8111-111111111111" })}>{label}</button><span>{value?.media_id}</span>{error}</div> }));
// jsdom has no popup geometry. Keep the real menu controls and keyboard
// handlers, replacing only the portal/positioner as in the shell tests.
vi.mock("@/components/ui/dropdown-menu", async original => {
  const parts = await original<typeof import("@/components/ui/dropdown-menu")>();
  return { ...parts, DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <parts.DropdownMenuGroup>{children}</parts.DropdownMenuGroup> };
});
vi.mock("@/components/ui/popover", async original => {
  const parts = await original<typeof import("@/components/ui/popover")>();
  return { ...parts, PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});
vi.mock("@/components/ui/select", async original => {
  const parts = await original<typeof import("@/components/ui/select")>();
  return { ...parts, SelectContent: ({ children }: { children: React.ReactNode }) => <parts.SelectGroup>{children}</parts.SelectGroup> };
});
// Preserve Tooltip's real root/trigger open events; jsdom cannot position the
// floating popup, so replace only its portal/geometry-dependent content.
vi.mock("@/components/ui/tooltip", async original => {
  const parts = await original<typeof import("@/components/ui/tooltip")>();
  const React = await import("react");
  const Open = React.createContext(false);
  return { ...parts,
    Tooltip: ({ children }: { children: React.ReactNode }) => {
      const [open, setOpen] = React.useState(false);
      return <parts.Tooltip onOpenChange={setOpen}><Open.Provider value={open}>{children}</Open.Provider></parts.Tooltip>;
    },
    TooltipContent: ({ children }: { children: React.ReactNode }) => React.useContext(Open) ? <div role="tooltip">{children}</div> : null,
  };
});
vi.mock("@/features/geo/use-geo-catalog", () => ({
  useGeoCatalog: () => ({ countries: { status: "success", data: { items: [{ id: "MX", name: "México" }] }, retry: vi.fn() }, states: { status: "success", data: { items: [] }, retry: vi.fn() }, municipalities: { status: "success", data: { items: [] }, retry: vi.fn() } }),
  useGeoPostalCode: () => ({ status: "idle", data: undefined }),
}));
beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(block: SiteBlock, errors: MappedFieldError[] = []) {
  const draft = defaultSiteDraft();
  draft.blocks = block.type === "hero" || block.type === "jobs" ? draft.blocks.map(b => b.type === block.type ? block : b) : [...draft.blocks, block];
  const initial = createEditorState({ draft, draft_version: 1, published: null, has_unpublished_changes: false, media: [], updated_at: "2026-01-01T00:00:00Z" }, '"1"');
  initial.fieldErrors = errors;
  function Harness() {
    const [state, dispatch] = useReducer(editorReducer, initial);
    const current = state.draft.blocks.find(b => b.id === block.id)!;
    return <><SectionForm block={current} dispatch={dispatch} fieldErrors={state.fieldErrors} /><output data-testid="content">{JSON.stringify(current.content)}</output></>;
  }
  render(<Harness />);
}
const cases = [
  ["hero", "Título principal", "title"], ["story", "Título", "title"], ["values", "Misión", "mission"],
  ["benefits", "Título", "title"], ["stats", "Valor", "value"], ["process", "Título", "title"],
  ["gallery", "Texto alternativo", "alt"], ["testimonials", "Nombre", "name"], ["video", "Título", "title"],
  ["offices", "Nombre de la oficina", "name"], ["jobs", "Título", "title"], ["faq", "Pregunta", "question"], ["closing", "Título", "title"],
] as const;
it.each(cases)("%s renders current fields and edits through the reducer", async (type, label, key) => {
  const block = defaultBlock(type);
  if ("items" in block.content) {
    mount(block);
    fireEvent.click(screen.getByRole("button", { name: /^Agregar / }));
  } else {
    Object.assign(block.content, { [key]: "Actual" });
    mount(block);
    expect(screen.getByLabelText(label)).toHaveValue("Actual");
  }
  fireEvent.change(screen.getByLabelText(label), { target: { value: "Nuevo" } });
  expect(screen.getByTestId("content")).toHaveTextContent(`"${key}":"Nuevo"`);
});
const emptyCollections = [
  ["values", "valores", "valor", "Explica qué guía a tu equipo. Agrega el primer valor para empezar.", "compass"],
  ["benefits", "beneficios", "beneficio", "Cuenta qué ofrece tu empresa a quienes se suman al equipo. Agrega el primer beneficio para empezar.", "gift"],
  ["stats", "cifras", "cifra", "Comparte datos reales sobre tu empresa. Agrega una cifra y explica qué representa.", "chart-no-axes-column"],
  ["process", "pasos", "paso", "Cuenta cómo es tu proceso de selección. Agrega el primer paso para empezar.", "sliders-horizontal"],
  ["gallery", "fotos", "foto", "Muestra cómo se vive en tu empresa. Agrega una foto con su texto alternativo.", "images"],
  ["testimonials", "testimonios", "testimonio", "Comparte la experiencia de tu equipo. Necesitas su permiso para publicarla.", "message-square-quote"],
  ["offices", "oficinas", "oficina", "Ayuda a las personas a conocer tus sedes. Agrega una oficina para empezar.", "map-pin"],
  ["faq", "preguntas frecuentes", "pregunta", "Resuelve dudas sobre tu empresa. Agrega una pregunta y su respuesta.", "circle-question-mark"],
] as const;
it.each(emptyCollections)("%s has a complete collection empty with its existing add action", (type, noun, singular, description, icon) => {
  mount(defaultBlock(type));
  const heading = screen.getByRole("heading", { name: `Todavía no hay ${noun}`, level: 3 });
  const empty = heading.closest('[data-slot="empty"]')!;
  expect(within(empty as HTMLElement).getByText(description)).toBeVisible();
  expect(empty.querySelector('[data-slot="empty-icon"]')).toHaveClass("bg-primary/10");
  expect(empty.querySelector("svg")).toHaveClass(`lucide-${icon}`);
  const add = within(empty as HTMLElement).getByRole("button", { name: `Agregar ${singular}` });
  expect(savedItems()).toEqual([]);
  fireEvent.click(add);
  expect(savedItems()).toHaveLength(1);
  expect(screen.queryByRole("heading", { name: `Todavía no hay ${noun}` })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Elemento 1" })).toHaveAttribute("aria-expanded", "true");
});
const textFields: [BlockType, [string, string, number][]][] = [
  ["hero", [["Título principal", "title", 80], ["Subtítulo", "subtitle", 200]]],
  ["story", [["Título", "title", 80]]],
  ["values", [["Misión", "mission", 300], ["Título", "title", 60], ["Descripción", "description", 240]]],
  ["benefits", [["Título", "title", 60], ["Descripción", "description", 160]]],
  ["stats", [["Valor", "value", 12], ["Etiqueta", "label", 60]]],
  ["process", [["Título", "title", 60], ["Descripción", "description", 200], ["Duración", "duration", 30]]],
  ["gallery", [["Texto alternativo", "alt", 160], ["Pie de foto", "caption", 120]]],
  ["testimonials", [["Testimonio", "quote", 400], ["Nombre", "name", 80], ["Puesto", "role", 80]]],
  ["video", [["Título", "title", 80], ["Descripción", "description", 200]]],
  ["offices", [["Nombre de la oficina", "name", 80], ["Dirección", "address", 200], ["Enlace del mapa", "map_url", 500]]],
  ["jobs", [["Título", "title", 80], ["Subtítulo", "intro", 200]]],
  ["faq", [["Pregunta", "question", 160], ["Respuesta", "answer", 1000]]],
  ["closing", [["Título", "title", 80], ["Texto", "text", 240]]],
];
it.each(textFields)("%s displays every text field, codepoint limit, description and edits", (type, fields) => {
  const block = defaultBlock(type);
  const blanks: Record<string, object> = { values: { icon: "heart", emoji: null }, benefits: { icon: "gift", emoji: null }, stats: {}, process: {}, gallery: { image: null }, testimonials: { photo: null, consent: false }, offices: { location: { country: "MX", state: "01", municipality: "01001", postal_code: "20000" } }, faq: {} };
  const values = Object.fromEntries(fields.filter(([, key]) => key !== "mission").map(([, key]) => [key, key === "map_url" ? "https://example.com" : "Actual"]));
  if ("items" in block.content) Object.assign(block.content, { items: [{ ...blanks[type], ...values }], ...(type === "values" ? { mission: "Actual" } : {}) });
  else Object.assign(block.content, values);
  mount(blockSchema.parse(block));
  for (const [label, key, max] of fields) {
    const input = screen.getByLabelText(label);
    const field = input.closest('[data-slot="field"]') as HTMLElement;
    const initial = key === "map_url" ? "https://example.com" : "Actual";
    expect(input).toHaveValue(initial);
    expect(within(field).getByText(`${[...initial].length}/${max}`)).toBeVisible();
    expect(field.querySelector('[data-slot="field-description"]')).not.toBeNull();
    const value = key === "map_url" ? "https://example.com/mapa" : `Actual ${key}`;
    fireEvent.change(input, { target: { value } });
    expect(input).toHaveValue(value);
    expect(screen.getByTestId("content")).toHaveTextContent(`"${key}":"${value}"`);
    expect(within(field).getByText(`${[...value].length}/${max}`)).toBeVisible();
  }
});
it("renders saved collection values immediately, and preserves disclosure state while editing", async () => {
  const block = defaultBlock("faq");
  if (block.type !== "faq") throw new Error("fixture");
  block.content.items = [{ question: "¿Cómo postulo?", answer: "Desde la vacante." }];
  mount(block);
  expect(screen.getByLabelText("Pregunta")).toHaveValue("¿Cómo postulo?");
  expect(screen.getByLabelText("Respuesta")).toHaveValue("Desde la vacante.");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "¿Cómo postulo?" }));
  expect(screen.queryByLabelText("Pregunta")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "¿Cómo postulo?" }));
  expect(screen.getByLabelText("Respuesta")).toHaveValue("Desde la vacante.");
});
it("lets long text grow from three to ten lines before scrolling", () => {
  mount(defaultBlock("values"));
  const textarea = screen.getByLabelText("Misión");
  expect(textarea).toHaveClass("field-sizing-content", "min-h-[calc(3lh+1rem)]", "max-h-[calc(10lh+1rem)]");
  expect(textarea).toHaveAttribute("rows", "3");
  const value = Array.from({ length: 8 }, (_, i) => `Línea ${i}`).join("\n");
  fireEvent.change(textarea, { target: { value } });
  expect(textarea).toHaveValue(value);
});
it.each(["hover", "focus"] as const)("names each icon with a tooltip on %s", async interaction => {
  mount(defaultBlock("benefits"));
  fireEvent.click(screen.getByRole("button", { name: "Agregar beneficio" }));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Ícono o emoji" }));
  const option = screen.getByRole("option", { name: "Cohete" });
  if (interaction === "hover") await user.hover(option);
  else { act(() => option.focus()); }
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Cohete");
  expect(option).toHaveAccessibleName("Cohete");
  await user.click(option);
  expect(screen.getByTestId("content")).toHaveTextContent('"icon":"rocket"');
});
it("keeps icon selection accessible without a separate visible check indicator", async () => {
  const block = defaultBlock("values");
  mount(block);
  fireEvent.click(screen.getByRole("button", { name: "Agregar valor" }));
  const user = userEvent.setup({ delay: null });
  const trigger = screen.getByRole("button", { name: "Ícono o emoji" });
  expect(trigger).toHaveTextContent("Corazón");
  expect(trigger.querySelector("svg")).toHaveClass("lucide-heart");
  await user.click(trigger);
  const selected = screen.getByRole("option", { name: "Corazón", selected: true });
  expect(selected.querySelectorAll("svg")).toHaveLength(1);
  for (const option of screen.getAllByRole("option")) {
    expect(option).toHaveAccessibleName(option.getAttribute("aria-label")!);
    expect(option).toHaveClass("aspect-square", "min-h-10", "p-0", "justify-center");
  }
  expect(selected).toHaveClass("aria-selected:ring-2", "aria-selected:ring-inset", "aria-selected:ring-primary");
});
it("updates the selected icon, Spanish trigger label and accessible selection", async () => {
  mount(defaultBlock("values"));
  fireEvent.click(screen.getByRole("button", { name: "Agregar valor" }));
  const user = userEvent.setup({ delay: null });
  const trigger = screen.getByRole("button", { name: "Ícono o emoji" });
  await user.click(trigger);
  const rocket = screen.getByRole("option", { name: "Cohete" });
  expect(rocket).toHaveAttribute("aria-selected", "false");
  await user.click(rocket);
  expect(screen.getByTestId("content")).toHaveTextContent('"icon":"rocket"');
  expect(trigger).toHaveTextContent("Cohete");
  expect(trigger.querySelector("svg")).toHaveClass("lucide-rocket");
  expect(rocket).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("option", { name: "Corazón" })).toHaveAttribute("aria-selected", "false");
  expect(rocket).toHaveClass("aria-selected:ring-primary", "data-[highlighted]:bg-accent");
});
it.each(["icon", "emoji"] as const)("marks a decoration's %s error on the shared picker trigger", field => {
  const block = collectionBlock("benefits", 1);
  mount(block, [{ blockId: block.id, field: `content.items[0].${field}`, code: "invalid" }]);
  const trigger = screen.getByRole("button", { name: "Ícono o emoji" });
  expect(trigger).toHaveAttribute("aria-invalid", "true");
  expect(trigger.getAttribute("aria-describedby")).toContain(screen.getByText("Revisa este dato.").id);
});
it("counts Unicode code points, warns near the limit, and associates field errors", () => {
  const block = defaultBlock("hero");
  block.content = { title: "😀".repeat(72), subtitle: null, cover: null };
  mount(block, [{ blockId: block.id, field: "content.title", code: "too_long" }]);
  const input = screen.getByLabelText("Título principal");
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByText("72/80")).toHaveAttribute("data-variant", "review");
  expect(screen.getByText("Acorta este texto.")).toBeVisible();
  expect(input.getAttribute("aria-describedby")).toContain(screen.getByText("Acorta este texto.").id);
  fireEvent.change(input, { target: { value: "😀".repeat(81) } });
  expect(input).toHaveValue("😀".repeat(81));
  expect(screen.getByText("81/80")).toHaveAttribute("data-variant", "danger");
  expect(screen.getByText("Usa hasta 80 caracteres.")).toBeVisible();
});
const collections: [BlockType, number, number][] = [["values",1,8],["benefits",1,24],["stats",1,6],["process",2,8],["gallery",2,12],["testimonials",1,6],["offices",1,20],["faq",1,20]];
// Seed the public reducer harness, not ItemList internals. Boundary tests need
// one UI addition, reorder needs two distinct items, removal needs min + 1.
function collectionBlock(type: BlockType, count: number): SiteBlock {
  const templates: Record<string, object> = {
    values: { icon: "heart", emoji: null, title: null, description: null },
    benefits: { icon: "gift", emoji: null, title: null, description: null },
    stats: { value: null, label: null },
    process: { title: null, description: null, duration: null },
    gallery: { image: null, alt: null, caption: null },
    testimonials: { quote: null, name: null, role: null, photo: null, consent: false },
    offices: { name: null, location: null, address: null, map_url: null },
    faq: { question: null, answer: null },
  };
  const block = defaultBlock(type);
  const key = collectionKey(type);
  return blockSchema.parse({ ...block, content: { ...block.content, items: Array.from({ length: count }, (_, i) => ({ ...templates[type], [key]: `Dato ${i + 1}` })) } });
}
function collectionKey(type: BlockType) {
  return type === "values" ? "title" : cases.find(entry => entry[0] === type)![2];
}
function savedItems(): Record<string, unknown>[] {
  return JSON.parse(screen.getByTestId("content").textContent!).items;
}
function collectionRows() {
  return screen.getAllByRole("button", { name: /^Acciones de elemento/ }).map(button => within(button.closest('[data-slot="accordion-item"]') as HTMLElement));
}
it.each(collections)("%s enforces its minimum and move boundaries", (type, min) => {
  mount(collectionBlock(type, min));
  const rows = collectionRows();
  for (const row of rows) {
    const remove = row.getByRole("menuitem", { name: "Eliminar" });
    expect(remove).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(remove);
  }
  expect(savedItems()).toHaveLength(min);
  expect(rows[0].getByRole("menuitem", { name: "Subir" })).toHaveAttribute("aria-disabled", "true");
  expect(rows[min - 1].getByRole("menuitem", { name: "Bajar" })).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByText(`Conserva al menos ${min} ${min === 1 ? "elemento" : "elementos"} para publicar.`)).toBeVisible();
});
it.each(collections)("%s reaches its maximum with disabled Agregar and an associated reason", (type, _min, max) => {
  mount(collectionBlock(type, max - 1));
  const add = screen.getByRole("button", { name: "Agregar" });
  expect(add).toBeEnabled();
  fireEvent.click(add);
  expect(savedItems()).toHaveLength(max);
  expect(add).toBeDisabled();
  const reason = screen.getByText(`Llegaste al límite de ${max} elementos.`);
  expect(reason).toBeVisible();
  expect(add).toHaveAttribute("aria-describedby", reason.id);
  fireEvent.click(add);
  expect(savedItems()).toHaveLength(max);
});
it.each(collections)("%s reorders two items using keyboard Subir/Bajar", async type => {
  mount(collectionBlock(type, 2));
  const user = userEvent.setup({ delay: null });
  const second = collectionRows()[1];
  const key = collectionKey(type);
  act(() => second.getByRole("menuitem", { name: "Subir" }).focus());
  await user.keyboard("{Enter}");
  expect(savedItems().map(item => item[key])).toEqual(["Dato 2", "Dato 1"]);
  act(() => second.getByRole("menuitem", { name: "Bajar" }).focus());
  await user.keyboard("{Enter}");
  expect(savedItems().map(item => item[key])).toEqual(["Dato 1", "Dato 2"]);
});
it.each(collections)("%s removes an item while preserving its neighbors and minimum", (type, min) => {
  mount(collectionBlock(type, min + 1));
  const remove = collectionRows()[0].getByRole("menuitem", { name: "Eliminar" });
  expect(remove).not.toHaveAttribute("aria-disabled", "true");
  fireEvent.click(remove);
  expect(savedItems().map(item => item[collectionKey(type)])).toEqual(Array.from({ length: min }, (_, i) => `Dato ${i + 2}`));
  for (const row of collectionRows()) expect(row.getByRole("menuitem", { name: "Eliminar" })).toHaveAttribute("aria-disabled", "true");
});
it("maps indexed field errors only to the owning item", () => {
  const block = defaultBlock("faq");
  if (block.type !== "faq") throw new Error("fixture");
  block.content.items = [{ question: "¿Cómo postulo?", answer: null }];
  mount(block, [{ blockId: block.id, field: "content.items[0].answer", code: "required" }]);
  expect(screen.getByLabelText("Respuesta")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Pregunta")).toHaveAttribute("aria-invalid", "false");
  expect(screen.getByText("Completa este campo.")).toBeVisible();
});
it.each([["hero", "Imagen de portada", "cover"], ["story", "Imagen de la historia", "story"], ["gallery", "Imagen", "gallery"], ["testimonials", "Foto", "portrait"]] as const)("%s delegates the correct image kind", (type, label, kind) => {
  const block = defaultBlock(type);
  mount(block);
  if ("items" in block.content) fireEvent.click(screen.getByRole("button", { name: /^Agregar / }));
  const image = screen.getByRole("button", { name: label });
  expect(image.parentElement).toHaveAttribute("data-kind", kind);
  fireEvent.click(image);
  expect(screen.getByTestId("content")).toHaveTextContent('"media_id":"11111111-1111-4111-8111-111111111111"');
});
it("initializes a saved video URL and permits explicitly clearing it", () => {
  const block = defaultBlock("video");
  if (block.type !== "video") throw new Error("fixture");
  block.content.video = { provider: "vimeo", video_id: "123456" };
  mount(block);
  const url = screen.getByLabelText("Enlace del video");
  expect(url).toHaveValue("https://vimeo.com/123456");
  fireEvent.change(url, { target: { value: "" } });
  expect(screen.getByTestId("content")).toHaveTextContent('"video":null');
  expect(url).toHaveAttribute("aria-invalid", "false");
});
it("parses YouTube/Vimeo without storing an invalid URL", () => {
  mount(defaultBlock("video"));
  const url = screen.getByLabelText("Enlace del video");
  fireEvent.change(url, { target: { value: "https://youtu.be/dQw4w9WgXcQ" } });
  expect(screen.getByTestId("content")).toHaveTextContent('"provider":"youtube","video_id":"dQw4w9WgXcQ"');
  fireEvent.change(url, { target: { value: "https://vimeo.com/123456" } });
  expect(screen.getByText("Vimeo · 123456")).toBeVisible();
  fireEvent.change(url, { target: { value: "https://example.com/video" } });
  expect(screen.getByText("Pega un enlace de YouTube o Vimeo.")).toBeVisible();
  expect(url).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByTestId("content")).toHaveTextContent('"video":null');
});
it("uses the real story editor with the story accessible name", () => {
  const block = defaultBlock("story");
  if (block.type !== "story") throw new Error("fixture");
  block.content.body = { schema_version: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Nuestra historia" }] }] } };
  mount(block);
  const editor = screen.getByLabelText("Historia de la empresa");
  expect(editor).toHaveTextContent("Nuestra historia");
  expect(editor).toHaveAttribute("contenteditable", "true");
  fireEvent.paste(editor, { clipboardData: { getData: () => "Hola ", types: ["text/plain"] } });
  expect(screen.getByTestId("content")).toHaveTextContent('"schema_version":1');
  expect(screen.getByTestId("content")).toHaveTextContent("Hola");
  expect(screen.getByRole("toolbar", { name: "Formato de la historia" })).toHaveClass("flex-nowrap");
});
it("wires testimonial consent and image refs", async () => {
  mount(defaultBlock("testimonials"));
  fireEvent.click(screen.getByRole("button", { name: "Agregar testimonio" }));
  const consent = screen.getByRole("switch", { name: "Tengo permiso para publicar este testimonio" });
  expect(consent).not.toBeChecked();
  fireEvent.click(consent);
  expect(screen.getByTestId("content")).toHaveTextContent('"consent":true');
  fireEvent.click(screen.getByRole("button", { name: "Foto" }));
  expect(screen.getByTestId("content")).toHaveTextContent('"media_id":"11111111-1111-4111-8111-111111111111"');
});
it("picks a contract icon with the public site's icon mapping", async () => {
  mount(defaultBlock("benefits"));
  fireEvent.click(screen.getByRole("button", { name: "Agregar beneficio" }));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Ícono o emoji" }));
  const option = await screen.findByRole("option", { name: "Cohete" });
  expect(option.querySelector("svg")).toHaveClass("lucide-rocket");
  await user.click(option);
  expect(screen.getByTestId("content")).toHaveTextContent('"icon":"rocket"');
});
it("explains automatic jobs and fixed CTA destinations", () => {
  mount(defaultBlock("jobs"));
  expect(screen.getByRole("link", { name: "Administrar vacantes" })).toHaveAttribute("href", "/empresa/vacantes");
  expect(screen.getByText("Se muestran automáticamente las vacantes publicadas de tu empresa.")).toBeVisible();
});
