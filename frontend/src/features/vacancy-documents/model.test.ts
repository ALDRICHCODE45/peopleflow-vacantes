/* eslint-disable @typescript-eslint/no-explicit-any -- the table cases mutate deep paths of a wire fixture; the schema under test is what types them */
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_REQUEST_CAP_BYTES, MAX_DOCUMENT_BYTES, createLinkBodySchema, documentListSchema, itemWriteSchema, linkSchema, linkWriteSchema, overviewSchema,
  scopeSchema, scopeWriteSchema, sourcesSchema, versionHistorySchema,
} from "./model";
import {
  ids, inaccessibleLinkWire, itemWire, linkWire, listWire, overviewWire, removedLinkWire, scopeWire, sourceWire, sourcesWire, versionsWire,
} from "./test-fixtures";

const clone = <T,>(value: T): T => structuredClone(value);

describe("limits", () => {
  it("pins the BFF request cap to 10 485 760 + 65 536 bytes (contract «Formats, size and inspection»)", () => {
    expect(MAX_DOCUMENT_BYTES).toBe(10_485_760);
    expect(DOCUMENT_REQUEST_CAP_BYTES).toBe(10_551_296);
  });
});

describe("scope", () => {
  it("accepts the contract example, with formats carrying extensions and content type", () => {
    const scope = scopeSchema.parse(scopeWire());
    expect(scope.limits.formats).toHaveLength(5);
    expect(scope.limits.formats[3]).toEqual({ format: "jpg", extensions: [".jpg", ".jpeg"], content_type: "image/jpeg" });
    expect(scope).toMatchObject({ can_manage: true, upload_blocked_reason: null, counts: { documents: 3, links: 1 } });
  });
  it("accepts a full scope and a stakeholder (cannot manage, nothing allowed, no reason)", () => {
    expect(scopeSchema.parse(scopeWire({ allowed_actions: [], upload_blocked_reason: "limit_reached" })).upload_blocked_reason).toBe("limit_reached");
    expect(scopeSchema.parse(scopeWire({ can_manage: false, allowed_actions: [] })).allowed_actions).toEqual([]);
  });
  it.each([
    ["an unknown scope key", { extra: 1 }],
    ["an unknown action", { allowed_actions: ["upload", "rename"] }],
    ["an unknown blocked reason", { upload_blocked_reason: "not_in_placement" }],
    ["a missing blocked reason", { upload_blocked_reason: undefined }],
    ["a missing counts.links", { counts: { documents: 1 } }],
    ["an unknown counts key", { counts: { documents: 1, links: 0, versions: 1 } }],
    ["a negative count", { counts: { documents: -1, links: 0 } }],
    ["an unknown limits key", { limits: { max_bytes: 1, max_documents: 1, max_versions: 1, formats: [], max_links: 1 } }],
    ["an unknown format", { limits: { max_bytes: 1, max_documents: 1, max_versions: 1, formats: [{ format: "doc", extensions: [".doc"], content_type: "application/msword" }] } }],
    ["an unknown format descriptor key", { limits: { max_bytes: 1, max_documents: 1, max_versions: 1, formats: [{ format: "pdf", extensions: [".pdf"], content_type: "application/pdf", label: "PDF" }] } }],
  ])("rejects %s", (_name, over) => {
    expect(scopeSchema.safeParse(scopeWire(over)).success).toBe(false);
  });
});

describe("document list", () => {
  it("accepts the contract example: an item, an available link and a removed link", () => {
    const list = documentListSchema.parse(listWire());
    expect(list.items[0]).toMatchObject({ participation_id: null, version_count: 2, allowed_actions: ["download", "replace", "delete"] });
    expect(list.links.map(link => link.state)).toEqual(["available", "removed"]);
    expect(list.links[0].source).toMatchObject({ sequence: 0, participation_id: null, has_newer_version: true, version: 1, version_count: 3 });
    expect(list.links[1].source).toBeNull();
  });
  it("accepts empty lists", () => {
    expect(documentListSchema.parse({ items: [], links: [], scope: scopeWire({ counts: { documents: 0, links: 0 } }) }).items).toEqual([]);
  });
  it("accepts a participation document and a stakeholder's download-only item", () => {
    expect(documentListSchema.parse({ ...listWire(), items: [itemWire({ participation_id: ids.participation, allowed_actions: ["download"] })] }).items[0].participation_id).toBe(ids.participation);
  });
  it.each([
    ["an unknown top-level key", (value: Record<string, unknown>) => { value.next_cursor = null; }],
    ["a missing scope", (value: Record<string, unknown>) => { delete value.scope; }],
    ["a missing links array", (value: Record<string, unknown>) => { delete value.links; }],
  ])("rejects %s", (_name, mutate) => {
    const value = clone(listWire()) as unknown as Record<string, unknown>;
    mutate(value);
    expect(documentListSchema.safeParse(value).success).toBe(false);
  });
});

describe("item", () => {
  const parse = (over: Record<string, unknown>) => documentListSchema.safeParse({ ...listWire(), items: [itemWire(over)] }).success;
  it("requires participation_id to be present, never omitted", () => {
    const wire = itemWire() as Record<string, unknown>;
    delete wire.participation_id;
    expect(documentListSchema.safeParse({ ...listWire(), items: [wire] }).success).toBe(false);
  });
  it.each([
    ["an unknown key", { name_extra: 1 }],
    ["a non-uuid id", { id: "nope" }],
    ["an unknown format", { format: "doc" }],
    ["an unknown action", { allowed_actions: ["download", "rename"] }],
    ["an item action of a link", { allowed_actions: ["unlink"] }],
    ["an empty name", { name: "" }],
    ["a zero size", { size: 0 }],
    ["a zero version", { version: 0 }],
    ["a fractional version_count", { version_count: 1.5 }],
    ["a created_by without a name", { created_by: { id: ids.ana } }],
    ["an extra key in updated_by", { updated_by: { id: ids.luis, name: "Luis", email: "x" } }],
    ["a timestamp that is not a date", { updated_at: "ayer" }],
    ["a null content type", { content_type: null }],
  ])("rejects %s", (_name, over) => {
    expect(parse(over)).toBe(false);
  });
});

describe("version history", () => {
  it("accepts the contract example, newest first with is_current", () => {
    const history = versionHistorySchema.parse(versionsWire());
    expect(history.versions.map(version => [version.version, version.format, version.is_current])).toEqual([[2, "pdf", true], [1, "docx", false]]);
  });
  it.each([
    ["an unknown key", (value: Record<string, any>) => { value.total = 2; }],
    ["an unknown format", (value: Record<string, any>) => { value.versions[0].format = "xls"; }],
    ["an unknown version key", (value: Record<string, any>) => { value.versions[0].note = "x"; }],
    ["a missing is_current", (value: Record<string, any>) => { delete value.versions[0].is_current; }],
  ])("rejects %s", (_name, mutate) => {
    const value = clone(versionsWire()) as any;
    mutate(value);
    expect(versionHistorySchema.safeParse(value).success).toBe(false);
  });
});

describe("link", () => {
  it("accepts the three states with their source rule: available has a source, removed and inaccessible have none", () => {
    expect(linkSchema.parse(linkWire()).state).toBe("available");
    expect(linkSchema.parse(removedLinkWire()).source).toBeNull();
    expect(linkSchema.parse(inaccessibleLinkWire())).toMatchObject({ state: "inaccessible", source: null, allowed_actions: ["unlink"] });
  });
  it("accepts a source that comes from a participation document and a stakeholder's empty actions", () => {
    expect(linkSchema.parse(linkWire({ source: sourceWire({ participation_id: ids.participation, sequence: 2 }) })).source?.participation_id).toBe(ids.participation);
    expect(linkSchema.parse(inaccessibleLinkWire()).allowed_actions).toEqual(["unlink"]);
    expect(linkSchema.parse({ ...inaccessibleLinkWire(), allowed_actions: [] }).allowed_actions).toEqual([]);
  });
  it.each([
    ["an unknown state", { state: "pending" }],
    ["an available link without a source", { source: null }],
    ["a removed link that still has a source", { state: "removed", source: sourceWire() }],
    ["an unknown link action", { allowed_actions: ["download", "replace"] }],
    ["an unknown key", { note: "x" }],
    ["a source without participation_id", { source: (() => { const source = sourceWire() as Record<string, unknown>; delete source.participation_id; return source; })() }],
    ["a source with an unknown key", { source: sourceWire({ content_type: "application/pdf" }) }],
    ["a source with an unknown format", { source: sourceWire({ format: "doc" }) }],
    ["a source with a negative sequence", { source: sourceWire({ sequence: -1 }) }],
    ["a source without has_newer_version", { source: sourceWire({ has_newer_version: undefined }) }],
  ])("rejects %s", (_name, over) => {
    expect(linkSchema.safeParse(linkWire(over)).success).toBe(false);
  });
});

describe("document sources", () => {
  it("accepts the contract example", () => {
    const sources = sourcesSchema.parse(sourcesWire());
    expect(sources.can_link).toBe(true);
    expect(sources.sources[0]).toMatchObject({ sequence: 0, participation_id: null });
    expect(sources.sources[0].documents[0]).toMatchObject({ version_count: 1, already_linked: false });
  });
  it("accepts the empty shape of a scope that cannot receive links", () => {
    expect(sourcesSchema.parse({ can_link: false, sources: [] })).toEqual({ can_link: false, sources: [] });
  });
  it.each([
    ["an unknown key", (value: Record<string, any>) => { value.total = 1; }],
    ["a missing participation_id on a group", (value: Record<string, any>) => { delete value.sources[0].participation_id; }],
    ["an unknown document key", (value: Record<string, any>) => { value.sources[0].documents[0].content_type = "x"; }],
    ["an unknown format", (value: Record<string, any>) => { value.sources[0].documents[0].format = "ppt"; }],
    ["a missing already_linked", (value: Record<string, any>) => { delete value.sources[0].documents[0].already_linked; }],
  ])("rejects %s", (_name, mutate) => {
    const value = clone(sourcesWire()) as any;
    mutate(value);
    expect(sourcesSchema.safeParse(value).success).toBe(false);
  });
});

describe("document overview", () => {
  it("accepts the P7b contract example key for key", () => {
    const overview = overviewSchema.parse(overviewWire());
    expect(overview.vacancy).toEqual({ id: ids.draft, title: "Analista contable", publication: "published", process: "active", kind: "replacement", visibility: "private" });
    expect(overview.items.map(item => item.owner.kind)).toEqual(["participation", "vacancy"]);
    expect(overview.items[0].owner).toEqual({
      kind: "participation", participation_id: ids.participation, candidate: { kind: "manual", id: ids.marta, full_name: "Marta Ruiz" }, discarded: false,
    });
    expect(overview.links.map(link => [link.state, link.owner.kind])).toEqual([["available", "vacancy"], ["removed", "participation"]]);
    expect(overview.participations.map(item => [item.discarded, item.stage.kind, item.upload_blocked_reason])).toEqual([[false, "placement", null], [true, "screening", "limit_reached"]]);
    expect(overview.truncated).toBe(false);
  });
  it("accepts a null title, and a never-published draft with null publication, process and visibility", () => {
    const wire = overviewWire();
    Object.assign(wire.vacancy, { title: null, publication: null, process: null, kind: "original", visibility: null });
    wire.items = []; wire.links = []; wire.participations = []; wire.truncated = true;
    expect(overviewSchema.parse(wire)).toMatchObject({ vacancy: { title: null, publication: null, process: null, visibility: null, kind: "original" }, truncated: true });
  });
  it.each([
    ["published", "active", "public"], ["paused", "active", "private"], ["closed", "finished", "public"],
  ])("accepts the lifecycle vocabulary %s / %s / %s", (publication, process, visibility) => {
    const wire = overviewWire();
    Object.assign(wire.vacancy, { publication, process, visibility });
    expect(overviewSchema.safeParse(wire).success).toBe(true);
  });
  it.each([
    ["an unknown top-level key", (value: Record<string, any>) => { value.next = 1; }],
    ["a missing truncated", (value: Record<string, any>) => { delete value.truncated; }],
    ["an undefined title key", (value: Record<string, any>) => { delete value.vacancy.title; }],
    ["an unknown vacancy key", (value: Record<string, any>) => { value.vacancy.team = []; }],
    ["an unknown publication", (value: Record<string, any>) => { value.vacancy.publication = "draft"; }],
    ["an unknown process", (value: Record<string, any>) => { value.vacancy.process = "closed"; }],
    ["an unknown vacancy kind", (value: Record<string, any>) => { value.vacancy.kind = "carried"; }],
    ["an unknown visibility", (value: Record<string, any>) => { value.vacancy.visibility = "internal"; }],
    ["an item without owner", (value: Record<string, any>) => { delete value.items[0].owner; }],
    ["a vacancy owner with extra keys", (value: Record<string, any>) => { value.items[1].owner = { kind: "vacancy", participation_id: null }; }],
    ["an unknown owner kind", (value: Record<string, any>) => { value.items[1].owner = { kind: "team" }; }],
    ["a participation owner without discarded", (value: Record<string, any>) => { delete value.items[0].owner.discarded; }],
    ["an owner candidate of an unknown kind", (value: Record<string, any>) => { value.items[0].owner.candidate.kind = "agency"; }],
    ["an owner candidate with an unknown key", (value: Record<string, any>) => { value.items[0].owner.candidate.email = "x"; }],
    ["a link without owner", (value: Record<string, any>) => { delete value.links[0].owner; }],
    ["a participation without stage", (value: Record<string, any>) => { delete value.participations[0].stage; }],
    ["a participation with an unknown action", (value: Record<string, any>) => { value.participations[0].scope_allowed_actions = ["delete"]; }],
    ["a participation with an unknown blocked reason", (value: Record<string, any>) => { value.participations[1].upload_blocked_reason = "discarded"; }],
    ["a participation with an unknown key", (value: Record<string, any>) => { value.participations[0].count = 1; }],
    ["an unknown item action", (value: Record<string, any>) => { value.items[0].allowed_actions = ["rename"]; }],
  ])("rejects %s", (_name, mutate) => {
    const value = clone(overviewWire()) as any;
    mutate(value);
    expect(overviewSchema.safeParse(value).success).toBe(false);
  });
});

describe("write responses", () => {
  it("accepts {item, scope} (upload and replace), {link, scope} (link) and {scope} (delete and unlink)", () => {
    expect(itemWriteSchema.parse({ item: itemWire(), scope: scopeWire() }).item.name).toBe("Contrato marco");
    expect(linkWriteSchema.parse({ link: linkWire(), scope: scopeWire() }).link.id).toBe(ids.link);
    expect(scopeWriteSchema.parse({ scope: scopeWire() }).scope.can_manage).toBe(true);
  });
  it.each([
    ["an item response without scope", itemWriteSchema, { item: itemWire() }],
    ["an item response with an unknown key", itemWriteSchema, { item: itemWire(), scope: scopeWire(), replayed: true }],
    ["a link response with a removed link carrying a source", linkWriteSchema, { link: linkWire({ state: "removed" }), scope: scopeWire() }],
    ["a link response without scope", linkWriteSchema, { link: linkWire() }],
    ["a delete response with an item", scopeWriteSchema, { scope: scopeWire(), item: itemWire() }],
    ["a delete response without scope", scopeWriteSchema, {}],
    ["a 204-like null body", scopeWriteSchema, null],
  ])("rejects %s", (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});

describe("create link body", () => {
  it("accepts the source document with or without a pinned version", () => {
    expect(createLinkBodySchema.parse({ source_document_id: ids.source })).toEqual({ source_document_id: ids.source });
    expect(createLinkBodySchema.parse({ source_document_id: ids.source, version: 1 })).toEqual({ source_document_id: ids.source, version: 1 });
  });
  it.each([
    [{ source_document_id: "nope" }],
    [{ source_document_id: ids.source, version: 0 }],
    [{ source_document_id: ids.source, version: 1.5 }],
    [{ source_document_id: ids.source, version: null }],
    [{ source_document_id: ids.source, version: 1_000_000_000 }],
    [{ source_document_id: ids.source, extra: true }],
    [{}],
  ])("rejects %j", value => {
    expect(createLinkBodySchema.safeParse(value).success).toBe(false);
  });
});
