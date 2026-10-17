import type { EditorPipeline } from "@/features/jobs/drafts/pipeline/editor-model";

export function pipelineFixture(): EditorPipeline {
  return {
    version: "0",
    structure_locked: false,
    stages: [
      { id: "n", kind: "new", name: "Nuevos" },
      { id: "s", kind: "screening", name: "Screening" },
      { id: "o", kind: "screening_ok", name: "Screening OK" },
      { id: "i", kind: "in_process", name: "En proceso" },
      { id: "p", kind: "placement", name: "Placement" },
    ],
    exit: { id: "e", kind: "discarded", name: "Descartados" },
    limits: { maxCustomStages: 3, nameMaxLength: 40 },
  };
}
