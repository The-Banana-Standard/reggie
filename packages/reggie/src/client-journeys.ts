import type { CallSite, ClientRouteCall, ClientTrigger, RouteRecord, SemanticIndex, SymbolRecord } from "./semantic-index.js";

export interface ClientJourney {
  id: string;
  title: string;
  trigger: ClientTrigger | null;
  calls: CallSite[];
  request: ClientRouteCall;
  symbols: SymbolRecord[];
  boundary: string | null;
}

export interface ClientJourneys {
  paths: ClientJourney[];
  limitations: string[];
  truncated: boolean;
}

/** Reverse exact call sites, not just caller names; retain distinct payload contributions. */
export function clientJourneys(index: SemanticIndex, route: RouteRecord, options: { maxPaths?: number; maxDepth?: number } = {}): ClientJourneys {
  const maxPaths = Math.max(1, Math.min(options.maxPaths ?? 24, 100));
  const maxDepth = Math.max(1, Math.min(options.maxDepth ?? 6, 12));
  const paths: ClientJourney[] = [];
  const limits = new Set<string>(["This view follows production-code callers. Tests, scripts, migrations and generated code remain available on symbol pages."]);
  limits.add("Only direct calls are followed. Dynamic dispatch, callback props, non-JSX event registration and runtime-selected URLs may add other paths.");
  const roles = new Map(index.files.map((file) => [file.file, file.codeRole]));
  const production = (file: string): boolean => roles.get(file) === "production";
  const symbols = new Map(index.symbols.map((symbol) => [symbol.id, symbol]));
  const calls = new Map(index.calls.map((call) => [call.id, call]));
  const incoming = new Map<string, CallSite[]>();
  for (const call of index.calls) {
    if (call.resolution !== "exact" || !call.calleeId || !production(call.source.file)) continue;
    incoming.set(call.calleeId, [...(incoming.get(call.calleeId) ?? []), call]);
  }
  let truncated = false;
  let visited = 0;
  const triggers = index.clientTriggers ?? [];
  for (const request of route.clientCalls) {
    if (!production(request.source.file)) continue;
    const fetch = calls.get(request.callSiteId);
    if (!fetch) continue;
    const emit = (chain: CallSite[], trigger: ClientTrigger | null, boundary: string | null): void => {
      if (paths.length >= maxPaths) { truncated = true; return; }
      if (boundary) limits.add(boundary);
      if (trigger?.kind === "react-effect") limits.add("React state and prop handoffs into effects are not traced; an effect is not proof of a specific button click.");
      const first = chain[0]!;
      const owner = symbols.get(first.callerId);
      const title = trigger ? `${trigger.label} · ${owner?.qualifiedName ?? first.source.file}` : `Client call · ${owner?.qualifiedName ?? first.source.file}`;
      paths.push({
        id: `${request.callSiteId}|${trigger?.id ?? first.id}|${chain.map((call) => call.id).join("|")}`,
        title, trigger, calls: chain, request, boundary,
        symbols: [...new Set(chain.flatMap((call) => [call.callerId, ...(call.calleeId ? [call.calleeId] : [])]))].flatMap((id) => symbols.has(id) ? [symbols.get(id)!] : []),
      });
    };
    const walk = (chain: CallSite[], seen: Set<string>): void => {
      if (++visited > 500 || paths.length >= maxPaths) { truncated = true; return; }
      const first = chain[0]!;
      const matches = triggers.filter((trigger) => trigger.callSiteIds.includes(first.id) || (!first.callback && trigger.targetSymbolId === first.callerId));
      for (const trigger of matches) emit(chain, trigger, null);
      if (first.callback) {
        if (!matches.length) emit(chain, null, "An anonymous callback supplies this call. Its invocation is not resolved.");
        return;
      }
      const parents = incoming.get(first.callerId) ?? [];
      if (!parents.length) {
        if (!matches.length) emit(chain, null, "No earlier UI event is proven for this client function; callback props and dynamic dispatch may supply other callers.");
        return;
      }
      if (chain.length >= maxDepth) {
        truncated = true;
        if (!matches.length) emit(chain, null, "The client call-depth limit was reached.");
        return;
      }
      for (const parent of parents) {
        if (seen.has(parent.id)) {
          truncated = true;
          limits.add("A recursive client call path was stopped at a cycle.");
          continue;
        }
        walk([parent, ...chain], new Set([...seen, parent.id]));
      }
    };
    walk([fetch], new Set([fetch.id]));
  }
  if (truncated) limits.add(`Client paths are bounded to ${maxPaths} origins, ${maxDepth} calls per path and 500 search visits; additional paths may be missing.`);
  paths.sort((a, b) => Number(b.trigger?.kind === "ui-event") - Number(a.trigger?.kind === "ui-event"));
  return { paths, limitations: [...limits], truncated };
}
