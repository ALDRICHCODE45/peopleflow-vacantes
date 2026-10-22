import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ImpactDetails } from "./impact-details";
import { pipelineFixture } from "./test-fixture";
import type { PipelineImpactPreview } from "@/features/jobs/drafts/pipeline/client";

const baseline = pipelineFixture();
const candidate = { id: "candidate", full_name: "Ana Pérez" };
const preview: PipelineImpactPreview = {
  stages: baseline.stages,
  has_impact: true,
  not_applicable: [{ participation_id: "a", candidate, stage_id: "s" }],
  recovery_reassigned: [{ participation_id: "a", candidate, retired_stage_id: "old", default_stage_id: "n" }],
};
afterEach(cleanup);

it.each([
  ["No aplica por cambio de proceso", "Ana Pérez → Screening"],
  ["Al recuperarse elegirán columna", "Ana Pérez → Técnica → Nuevos"],
])("puts %s rows in the official title-only Item composition", (heading, text) => {
  const { getByRole } = render(<ImpactDetails preview={preview} baseline={{ ...baseline, stages: [...baseline.stages, { id: "old", kind: "custom", name: "Técnica" }] }} />);
  const card = getByRole("heading", { name: heading }).closest('[data-slot="card"]')!;
  expect([...card.children].map(node => node.getAttribute("data-slot"))).toEqual(["card-header", "card-content"]);
  const content = card.querySelector('[data-slot="card-content"] [data-slot="item-group"] [data-slot="item"] > [data-slot="item-content"]')!;
  expect([...content.children].map(node => node.getAttribute("data-slot"))).toEqual(["item-title"]);
  expect(content.querySelector('[data-slot="item-title"]')).toHaveTextContent(text);
});

it("preserves the unavailable-column fallback and omits empty impact groups", () => {
  const { container, getByText } = render(<ImpactDetails preview={{ ...preview, not_applicable: [], stages: [] }} baseline={baseline} />);
  expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
  expect(getByText("Ana Pérez → Columna no disponible → Nuevos")).toBeVisible();
});

it("renders no cards for an empty impact", () => {
  const { container } = render(<ImpactDetails preview={{ ...preview, has_impact: false, not_applicable: [], recovery_reassigned: [] }} baseline={baseline} />);
  expect(container).toBeEmptyDOMElement();
});
