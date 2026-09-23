import { createHash } from "node:crypto";

export type ConceptOccurrenceKind = "binding" | "field" | "parameter" | "return" | "request" | "response";

export interface ConceptSource {
  file: string;
  line: number;
  endLine?: number;
}

/** One source-backed place where a value is named or crosses a boundary. */
export interface ConceptOccurrence {
  id: string;
  name: string;
  path: string[];
  kind: ConceptOccurrenceKind;
  source: ConceptSource;
  symbolId: string | null;
  explicitType: string | null;
  validationIds: string[];
  routeIds: string[];
}

export type ConceptLinkKind = "assignment" | "destructure" | "argument-parameter" | "return-assignment";

/** A proof-bearing relationship. Same spelling alone is never a concept link. */
export interface ConceptLink {
  from: string;
  to: string;
  kind: ConceptLinkKind;
  source: ConceptSource;
  transformation: string | null;
}

export interface DataConcept {
  id: string;
  canonicalName: string;
  aliases: string[];
  occurrences: ConceptOccurrence[];
  links: ConceptLink[];
  explicitTypes: Array<{ occurrenceId: string; type: string }>;
  validationIds: string[];
  transformations: string[];
  routeIds: string[];
  symbolIds: string[];
}

export interface ConceptEvidence {
  occurrences: ConceptOccurrence[];
  links: ConceptLink[];
}

class DisjointSet {
  private readonly parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    const current = this.parent.get(id);
    if (current === undefined) {
      this.parent.set(id, id);
      return id;
    }
    if (current === id) return id;
    const root = this.find(current);
    this.parent.set(id, root);
    return root;
  }

  join(a: string, b: string): void {
    const left = this.find(a);
    const right = this.find(b);
    if (left === right) return;
    if (left.localeCompare(right) <= 0) this.parent.set(right, left);
    else this.parent.set(left, right);
  }
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function conceptName(occurrences: readonly ConceptOccurrence[]): string {
  const names = unique(occurrences.map((item) => item.path.at(-1) || item.name).filter(Boolean));
  return names.sort((a, b) => a.length - b.length || a.localeCompare(b))[0] ?? "value";
}

function conceptSlug(name: string): string {
  const slug = name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "value";
}

/**
 * Collapse only explicitly linked occurrences. A repeated name with no assignment,
 * destructuring, call binding, or return binding remains a separate singleton and is omitted.
 */
export function buildDataConcepts(evidence: ConceptEvidence): DataConcept[] {
  const occurrenceById = new Map(evidence.occurrences.map((item) => [item.id, item]));
  const sets = new DisjointSet();
  for (const item of evidence.occurrences) sets.add(item.id);
  const validLinks = evidence.links.filter((link) => occurrenceById.has(link.from) && occurrenceById.has(link.to) && link.from !== link.to);
  for (const link of validLinks) sets.join(link.from, link.to);

  const grouped = new Map<string, ConceptOccurrence[]>();
  for (const item of evidence.occurrences) {
    const root = sets.find(item.id);
    const group = grouped.get(root) ?? [];
    group.push(item);
    grouped.set(root, group);
  }

  const usedIds = new Set<string>();
  const concepts: DataConcept[] = [];
  for (const occurrences of grouped.values()) {
    if (occurrences.length < 2) continue;
    occurrences.sort((a, b) => a.source.file.localeCompare(b.source.file) || a.source.line - b.source.line || a.id.localeCompare(b.id));
    const memberIds = new Set(occurrences.map((item) => item.id));
    const links = validLinks
      .filter((link) => memberIds.has(link.from) && memberIds.has(link.to))
      .sort((a, b) => a.source.file.localeCompare(b.source.file) || a.source.line - b.source.line || a.kind.localeCompare(b.kind));
    if (links.length === 0) continue;

    const canonicalName = conceptName(occurrences);
    const base = `concept:${conceptSlug(canonicalName)}`;
    let id = base;
    if (usedIds.has(id)) {
      const digest = createHash("sha1")
        .update(occurrences.map((item) => item.id).sort().join("\n"))
        .digest("hex")
        .slice(0, 8);
      id = `${base}-${digest}`;
    }
    usedIds.add(id);
    concepts.push({
      id,
      canonicalName,
      aliases: unique(occurrences.flatMap((item) => [item.name, item.path.at(-1) ?? ""]).filter(Boolean)),
      occurrences,
      links,
      explicitTypes: occurrences
        .filter((item): item is ConceptOccurrence & { explicitType: string } => item.explicitType !== null)
        .map((item) => ({ occurrenceId: item.id, type: item.explicitType })),
      validationIds: unique(occurrences.flatMap((item) => item.validationIds)),
      transformations: unique(links.map((link) => link.transformation).filter((value): value is string => value !== null)),
      routeIds: unique(occurrences.flatMap((item) => item.routeIds)),
      symbolIds: unique(occurrences.map((item) => item.symbolId).filter((value): value is string => value !== null)),
    });
  }
  return concepts.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName) || a.id.localeCompare(b.id));
}
