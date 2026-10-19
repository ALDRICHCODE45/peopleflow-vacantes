import { mexicoLocationValue } from "../geography-fixture";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ countries: { data: { items: [] } }, states: { data: { items: [] } }, municipalities: { data: { items: [] } } }) }));
import { cleanup, render, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { createDraftModel } from "../model";
import type { DraftRichDescription } from "../rich/grammar";
import { DraftPreview } from "./draft-preview";
import { initialDraftFormState, type DraftFormState } from "./draft-form-state";

/**
 * The final-step preview replaces the old count summary: it must expose an
 * actual-content public look (requester excluded, salary opt-in only) plus a
 * separate internal review. Every assertion here reads the raw state passed in;
 * the preview owns no request, storage or mutation.
 */

it.each([
  [{ kind: "anywhere" } as const, "Remoto · Desde cualquier lugar"],
  [{ kind: "countries", countries: ["MX", "CO"] } as const, "Remoto · Solo desde México, Colombia"],
])("renders remote scope from server-provided names: %j", (scope, expected) => {
  const state = populatedState();
  state.work_mode = "remote";
  state.remote_scope = scope.kind === "anywhere" ? { kind: "anywhere" } : { kind: "countries", countries: [...scope.countries] };
  state.remoteCountries = [{ id: "MX", name: "México" }, { id: "CO", name: "Colombia" }];
  const { container } = render(<DraftPreview state={state} />);
  expect(container).toHaveTextContent(expected);
  expect(container).toHaveTextContent("Ciudad de México");
});

function emptyState(): DraftFormState {
  return initialDraftFormState(createDraftModel());
}

function populatedState(): DraftFormState {
  return {
    ...emptyState(),
    title: "Backend Go",
    location: mexicoLocationValue,
    locationLabel: "Ciudad de México",
    work_mode: "hybrid",
    work_schedule: "full_time",
    contract_type: "indefinite",
    seniority: "senior",
    professional_area: "technology_systems",
    required_requirements: "Go y PostgreSQL",
    preferred_requirements: "Kubernetes",
    skills: [
      { id: "skill-1", value: "Go" },
      { id: "skill-2", value: "React" },
    ],
    languages: [
      { id: "language-1", language: "en", customName: "", level: "advanced" },
      { id: "language-2", language: "other", customName: "Francés", level: "" },
    ],
    benefits: ["health_insurance"],
    custom_benefits: [{ id: "custom-benefit-1", value: "Café gratis" }],
    screening_questions: [
      { id: "screening-1", value: "¿Cuántos años de experiencia tienes con Go?" },
    ],
    requester: {
      original: { kind: "client", id: "123e4567-e89b-42d3-a456-426614174000" },
      kind: "client",
      id: "123e4567-e89b-42d3-a456-426614174000",
      name: "Cliente Ejemplo",
      changed: false,
      notice: null,
    },
    description: {
      schema_version: 1,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Buscamos talento" }],
          },
        ],
      },
    },
  };
}

function region(name: "public" | "internal"): HTMLElement {
  const node = document.querySelector(`[data-pf-draft-${name}]`);
  if (!(node instanceof HTMLElement)) throw new Error(`missing ${name} region`);
  return node;
}

afterEach(() => {
  cleanup();
});

describe("DraftPreview public look", () => {
  it("renders the actual entered basics and text instead of counts", () => {
    render(<DraftPreview state={populatedState()} />);
    const pub = region("public");

    expect(within(pub).getByText("Backend Go")).toBeVisible();
    expect(within(pub).getByText("Ciudad de México")).toBeVisible();
    expect(within(pub).getByText("Híbrido")).toBeVisible();
    expect(within(pub).getByText("Tiempo completo")).toBeVisible();
    expect(within(pub).getByText("Indefinido")).toBeVisible();
    expect(within(pub).getByText("Senior")).toBeVisible();
    expect(within(pub).getByText("Tecnología y sistemas")).toBeVisible();
    expect(within(pub).getByText("Go y PostgreSQL")).toBeVisible();
    expect(within(pub).getByText("Kubernetes")).toBeVisible();
    expect(within(pub).getByText("Buscamos talento")).toBeVisible();
  });

  it("renders the actual list values instead of their counts", () => {
    render(<DraftPreview state={populatedState()} />);
    const pub = region("public");

    expect(within(pub).getByText("Go")).toBeVisible();
    expect(within(pub).getByText("React")).toBeVisible();
    expect(within(pub).getByText("Inglés · Avanzado")).toBeVisible();
    expect(within(pub).getByText("Francés")).toBeVisible();
    expect(within(pub).getByText("Seguro de gastos médicos")).toBeVisible();
    expect(within(pub).getByText("Café gratis")).toBeVisible();
  });

  it("never shows the requester in the public look but keeps it in the internal review", () => {
    render(<DraftPreview state={populatedState()} />);
    const pub = region("public");
    const internal = region("internal");

    expect(within(pub).queryByText("Cliente Ejemplo")).toBeNull();
    expect(within(pub).queryByText("Cliente", { exact: true })).toBeNull();
    expect(within(internal).getByText("Cliente Ejemplo")).toBeVisible();
    expect(within(internal).getByText("Cliente")).toBeVisible();
  });

  it("renders the rich description as escaped plain text without interpreting HTML", () => {
    const state = populatedState();
    const payload = "<script>alert(1)</script>";
    state.description = {
      schema_version: 1,
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: payload }] }],
      },
    };

    const { container } = render(<DraftPreview state={state} />);

    expect(within(region("public")).getByText(payload)).toBeVisible();
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders the approved rich formatting instead of a plain-text limitation", () => {
    const state = populatedState();
    state.description = {
      schema_version: 1,
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Buscamos " },
              { type: "text", text: "talento", marks: [{ type: "bold" }] },
              { type: "text", text: " con " },
              { type: "text", text: "experiencia", marks: [{ type: "italic" }] },
            ],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Go" }] },
                ],
              },
            ],
          },
          {
            type: "orderedList",
            attrs: { start: 2, type: null },
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "PostgreSQL" }] },
                ],
              },
            ],
          },
        ],
      },
    };

    render(<DraftPreview state={state} />);
    const pub = region("public");

    expect(within(pub).getByText("talento").closest("strong")).not.toBeNull();
    expect(within(pub).getByText("experiencia").closest("em")).not.toBeNull();
    expect(pub.querySelector("ul.list-disc")).not.toBeNull();
    expect(pub.querySelector("ol.list-decimal")?.getAttribute("start")).toBe("2");
    expect(within(pub).queryByText(/formato/i)).toBeNull();
  });

  it("renders an honest empty public look for a default draft without crashing", () => {
    render(<DraftPreview state={emptyState()} />);
    const pub = region("public");

    expect(
      within(pub).getByRole("heading", { name: "Vista previa pública" }),
    ).toBeVisible();
    expect(within(pub).getByText(/sin descripción/i)).toBeVisible();
  });

  it("renders invalid rich data as an honest fallback without crashing", () => {
    const state = populatedState();
    state.description = {
      schema_version: 1,
      document: { type: "doc", content: [] },
    } as unknown as DraftRichDescription;

    render(<DraftPreview state={state} />);

    expect(
      within(region("public")).getByText(/todavía no se puede mostrar/i),
    ).toBeVisible();
  });
});

describe("DraftPreview compensation visibility", () => {
  it("hides the salary from the public look unless it is explicitly public", () => {
    const hidden = populatedState();
    hidden.compensation = {
      ...hidden.compensation,
      mode: "fixed",
      amount: "30000.50",
      currency: "MXN",
      pay_period: "monthly",
      basis: "gross",
      public_visible: false,
    };
    const first = render(<DraftPreview state={hidden} />);

    expect(within(region("public")).queryByText("30000.50")).toBeNull();
    expect(
      within(region("internal")).getByText("No se mostrará en la vista pública"),
    ).toBeVisible();
    first.unmount();

    const visible = populatedState();
    visible.compensation = { ...hidden.compensation, public_visible: true };
    render(<DraftPreview state={visible} />);

    expect(within(region("public")).getByText("$30,000.50 MXN")).toBeVisible();
    expect(
      within(region("internal")).getByText("Se mostrará en la vista pública"),
    ).toBeVisible();
  });

  it("labels currency, pay period and basis from the approved draft labels", () => {
    const state = populatedState();
    state.compensation = {
      ...state.compensation,
      mode: "fixed",
      amount: "30000.50",
      currency: "MXN",
      pay_period: "monthly",
      basis: "gross",
      public_visible: true,
    };

    render(<DraftPreview state={state} />);

    expect(
      within(region("public")).getByText(
        "Mensual · Bruto",
      ),
    ).toBeVisible();
  });

  it("does not present an inactive compensation buffer as the active amount", () => {
    const state = populatedState();
    state.compensation = {
      mode: "range",
      amount: "12000",
      min: "30000",
      max: "45000",
      currency: "MXN",
      pay_period: "monthly",
      basis: "gross",
      public_visible: true,
    };

    render(<DraftPreview state={state} />);
    const pub = region("public");

    expect(within(pub).queryByText("12000")).toBeNull();
    expect(within(pub).getByText("$30,000 – $45,000 MXN")).toBeVisible();
  });

  it("formats exact money without numeric conversion or precision loss", () => {
    const state = populatedState();
    state.compensation = {
      ...state.compensation,
      mode: "fixed",
      amount: "999999999999.99",
      currency: "MXN",
      pay_period: "monthly",
      basis: "gross",
      public_visible: true,
    };

    render(<DraftPreview state={state} />);

    expect(within(region("public")).getByText("$999,999,999,999.99 MXN")).toBeVisible();
  });

  it("formats a valid one-decimal amount without changing the raw buffer", () => {
    const state = populatedState();
    state.compensation = {
      ...state.compensation,
      mode: "fixed",
      amount: "12000.5",
      currency: "MXN",
      pay_period: "monthly",
      basis: "gross",
      public_visible: true,
    };

    render(<DraftPreview state={state} />);
    const pub = region("public");

    expect(within(pub).getByText("$12,000.50 MXN")).toBeVisible();
    expect(within(pub).queryByText("12000.50")).toBeNull();
  });
});

describe("DraftPreview internal review", () => {
  it("shows the actual screening prompts and an honest unknown requester", () => {
    const state = populatedState();
    state.requester = {
      ...state.requester,
      kind: "internal_area",
      id: null,
      name: null,
      changed: true,
    };

    render(<DraftPreview state={state} />);
    const internal = region("internal");

    expect(within(internal).getByText("Área interna")).toBeVisible();
    expect(within(internal).getByText("Sin seleccionar")).toBeVisible();
    expect(
      within(internal).getByText("¿Cuántos años de experiencia tienes con Go?"),
    ).toBeVisible();
  });

  it("never mutates or normalizes the raw state it receives", () => {
    const state = populatedState();
    const before = structuredClone(state);

    render(<DraftPreview state={state} />);

    expect(state).toEqual(before);
    expect(JSON.stringify(state)).toBe(JSON.stringify(before));
  });
});

describe("DraftPreview invalid compensation", () => {
  function withCompensation(
    overrides: Partial<DraftFormState["compensation"]>,
  ): DraftFormState {
    const state = populatedState();
    state.compensation = {
      mode: "fixed",
      amount: "30000.50",
      min: "",
      max: "",
      currency: "MXN",
      pay_period: "monthly",
      basis: "gross",
      public_visible: true,
      ...overrides,
    };
    return state;
  }

  it("flags malformed money as needing review instead of presenting it as salary", () => {
    const state = withCompensation({ amount: "1,5" });
    const before = structuredClone(state);

    render(<DraftPreview state={state} />);
    const pub = region("public");

    expect(within(pub).queryByText("1,5")).toBeNull();
    expect(within(pub).getByText("Revisar compensación")).toBeVisible();
    expect(state).toEqual(before);
  });

  it("flags a reversed range as needing review instead of a normal range", () => {
    const state = withCompensation({
      mode: "range",
      amount: "",
      min: "45000",
      max: "30000",
    });

    render(<DraftPreview state={state} />);
    const pub = region("public");

    expect(within(pub).queryByText("45000 – 30000")).toBeNull();
    expect(within(pub).getByText("Revisar compensación")).toBeVisible();
  });

  it("accepts a contract-valid single-bound range without a false invalid status", () => {
    const state = withCompensation({ mode: "range", amount: "", min: "30000", max: "" });

    render(<DraftPreview state={state} />);
    const pub = region("public");

    expect(within(pub).getByText("Desde $30,000 MXN")).toBeVisible();
    expect(within(pub).queryByText("Revisar compensación")).toBeNull();
  });

  it("keeps an invalid hidden compensation out of the public look", () => {
    const state = withCompensation({ amount: "1,5", public_visible: false });

    render(<DraftPreview state={state} />);
    const pub = region("public");

    expect(within(pub).queryByText("1,5")).toBeNull();
    expect(within(pub).queryByText("Revisar compensación")).toBeNull();
  });
});

describe("DraftPreview invalid languages", () => {
  it("does not render a level-only badge for a language without a chosen language", () => {
    const state = populatedState();
    state.languages = [{ id: "language-1", language: "", customName: "", level: "advanced" }];

    render(<DraftPreview state={state} />);
    const pub = region("public");

    expect(within(pub).queryByText("Avanzado")).toBeNull();
    expect(
      within(pub).getByText("Idioma sin definir · nivel Avanzado (revisar)"),
    ).toBeVisible();
  });

  it("still renders a fully specified language as a valid entry", () => {
    const state = populatedState();
    state.languages = [{ id: "language-1", language: "en", customName: "", level: "advanced" }];

    render(<DraftPreview state={state} />);
    const pub = region("public");

    expect(within(pub).getByText("Inglés · Avanzado")).toBeVisible();
    expect(within(pub).queryByText(/revisar/i)).toBeNull();
  });

  it("never mutates the raw language rows while checking them", () => {
    const state = populatedState();
    state.languages = [{ id: "language-1", language: "", customName: "", level: "advanced" }];
    const before = structuredClone(state.languages);

    render(<DraftPreview state={state} />);

    expect(state.languages).toEqual(before);
  });
});

describe("DraftPreview internal separation", () => {
  it("does not insert a Separator inside the enclosing wizard card", () => {
    render(<DraftPreview state={populatedState()} />);

    expect(
      document.querySelectorAll("[data-pf-draft-preview] [data-slot='separator']"),
    ).toHaveLength(0);
  });
});

describe("DraftPreview rendered-questions override", () => {
  it("shows the supplied local v2 prompts instead of the raw v1 rows", () => {
    render(
      <DraftPreview
        state={populatedState()}
        renderedQuestions={[{ id: "q-1", prompt: "¿Prefieres trabajo remoto?" }]}
      />,
    );
    const internal = region("internal");

    expect(within(internal).getByText("¿Prefieres trabajo remoto?")).toBeVisible();
    expect(
      within(internal).queryByText("¿Cuántos años de experiencia tienes con Go?"),
    ).toBeNull();
  });

  it("keeps the supplied questions presentation-only and never mutates them", () => {
    const state = populatedState();
    const provided = [{ id: "q-1", prompt: "  texto crudo  " }];
    const before = structuredClone(provided);

    render(<DraftPreview state={state} renderedQuestions={provided} />);

    expect(provided).toEqual(before);
    // The raw state is not rewritten either.
    expect(state.screening_questions).toHaveLength(1);
  });
});
