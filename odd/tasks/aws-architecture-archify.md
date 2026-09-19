# AWS Architecture Archify

## Goal

Replace the expiring Excalidraw-only reference with a repository-owned, meeting-ready Archify architecture artifact for PeopleFlow's planned AWS deployment.

## Authority and boundaries

- Artifact language: Spanish, matching the existing architecture documentation and intended meeting audience.
- Diagram type: Archify `architecture`, showcase quality.
- Truth boundary: distinguish delivered application capabilities from planned, not-yet-provisioned AWS infrastructure.
- Evidence sources:
  - `README.md`
  - `docs/arquitectura-backend-proyecto-04.md`
  - `docs/modelo-de-datos-proyecto-04.md`
  - `docs/decision-frontend-hosting.md`
  - canonical Excalidraw share reference, when retrievable
- Do not provision AWS, change runtime code, alter frontend/backend contracts, or push.
- Preserve the primary worktree and every frontend worktree untouched.

## Tasks

- [x] **ARCH-01 — Freeze evidence and status.** Confirmed frontend Amplify, backend Go on ECS/Fargate, Cognito/JWKS plus PostConfirmation Lambda, RDS Multi-AZ through RDS Proxy, one-off ECS migrations, and future EventBridge → SQS → workers. Confirmed `/infra`, `/workers`, Dockerfiles, workflows, and all AWS resources remain unimplemented. The Excalidraw page is reachable but its scene content is client-rendered; repository decisions are the authoritative source.
- [x] **ARCH-02 — Author the Archify specification.** Created `docs/architecture/peopleflow-aws-target.architecture.json`: an 11-node Spanish target-state map with repository evidence, explicit planned-status tags, public request, identity/bootstrap, persistence, and asynchronous paths.
- [x] **ARCH-03 — Reach showcase acceptance.** Archify validation passes all 9/9 artifact checks with zero composition errors and zero warnings; no crossings, ambiguous corridors, border runs, micro-segments, or desktop-readability defects remain.
- [x] **ARCH-04 — Deliver and inspect.** Deterministic delivery succeeded; automated Chrome evidence passes containment, readability, and viewer chrome at 1440×900, 1600×1000, 1920×1080, and 2048×1320. Light/dark endpoint screenshots were inspected and perceptual review passed after one vertical-composition correction round.
- [x] **ARCH-05 — Freeze locally.** Independent verification passed. The Archify JSON, delivered HTML, repository-safe endpoint screenshots, consolidated review record, and tracker were committed locally on `docs/aws-architecture-archify`. Raw tool receipts with machine-local paths were intentionally excluded. Nothing was pushed.

## Evidence

- Artifact commit: `c23a02fd114729e86ed0f3979bd3f1b77ce846e6` (`docs(architecture): add AWS target diagram`).
- Independent verifier: PASS; 9/9 showcase, exact spec/artifact bindings, all viewport and PNG dimensions, no path leakage, no semantic mismatch, no blockers.
- Specification SHA-256: `bc8fe671ded49f8cf9a6a24743ebf2cbca179c7677a26760441c931d21627531`.
- Artifact SHA-256: `8e4a734278497c473098c3bb82f5ecc4af4a98a779ccbddd8aee987cc495de49`.
- Push: not performed; maintainer-owned.

## Decisions

- The diagram represents the **planned AWS target state**, not a deployed environment.
- Planned AWS components use a visually distinct dashed treatment.
- The current delivered boundary is the Go modular monolith, migration executable, Cognito-compatible JWT/JWKS verification, and PostConfirmation executable.
- EventBridge, SQS, workers, outbox/dispatcher, Terraform, CI/CD, and cloud resources remain future work.
