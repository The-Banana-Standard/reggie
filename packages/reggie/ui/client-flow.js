import { h, formatRoute, routeForNode, renderValueTree, section } from "./app.js";

function symbolLabel(id) { return id?.split("::").at(-1) ?? "client"; }
function sourceLink(repo, source) {
  return h("a", { href: formatRoute({ level: "file", repo, id: source.file, query: { line: source.startLine } }) }, source.file);
}
function symbolLink(repo, id) {
  return h("a", { href: routeForNode(repo, id.startsWith("file:") ? id.slice(5) : id) }, symbolLabel(id));
}

/** All origins are additive by default. Selection highlights evidence, never guesses runtime branches. */
export function withClientJourney(flow, id, { requestOnly = false } = {}) {
  const journey = flow.clients?.paths?.find((path) => path.id === id);
  if (!journey) return flow;
  const paths = requestOnly ? [journey] : flow.clients.paths;
  const nodes = new Map((flow.nodes ?? []).map((node) => [node.id, node]));
  const upstream = new Map();
  for (const path of paths) {
    for (const symbol of path.symbols) nodes.set(symbol.id, { id: symbol.id, kind: symbol.kind === "method" ? "method" : "function", label: symbol.qualifiedName, path: symbol.file, file: symbol.file });
    const step = (from, to, call = null, payload = null) => {
      const key = JSON.stringify([from, to, call?.id ?? null]);
      const previous = upstream.get(key);
      upstream.set(key, {
        from, to, kind: "call", label: call?.calleeExpression ?? path.trigger?.label ?? "Request",
        arguments: payload ? [] : call?.arguments ?? [], requestPayload: payload, servicePayload: null,
        returns: [], callSiteId: call?.id ?? null, source: { file: call?.source.file ?? path.trigger?.source.file, line: call?.source.startLine ?? path.trigger?.source.startLine },
        confidence: "exact", via: null,
        clientPathSelected: path.id === id || previous?.clientPathSelected === true,
      });
    };
    if (path.trigger) {
      const trigger = path.trigger;
      nodes.set(trigger.id, { id: trigger.id, kind: trigger.kind === "ui-event" ? "client event" : "client effect", label: trigger.label, path: trigger.source.file, file: trigger.source.file });
      step(trigger.id, path.calls[0].callerId);
    }
    path.calls.forEach((call, i) => {
      if (!nodes.has(call.callerId)) nodes.set(call.callerId, { id: call.callerId, kind: "file", label: call.source.file, path: call.source.file, file: call.source.file });
      step(call.callerId, i === path.calls.length - 1 ? flow.entryNode : call.calleeId, call, i === path.calls.length - 1 ? path.request.requestShape : null);
    });
  }
  const steps = [...upstream.values(), ...(requestOnly ? flow.steps.slice(0, 1) : flow.steps)];
  return { ...flow, nodes: [...nodes.values()], steps,
    ...(requestOnly ? { requestPathOnly: true, services: [], servicesBeyondCap: [], depth: steps.length, dropped: [], truncated: false } : {}) };
}

export function clientFlowSection(flow, repo, { selected, onSelect, onScope } = {}) {
  const paths = flow.clients?.paths ?? [];
  const current = paths.find((path) => path.id === selected) ?? paths[0] ?? null;
  const details = h("div", { class: "client-flow__details" });
  const renderPath = (journey) => {
    details.replaceChildren();
    if (!journey) return;
    details.append(h("p", { class: "para" }, journey.trigger?.kind === "ui-event"
      ? "This browser event can reach the endpoint through the calls below."
      : journey.trigger?.kind === "react-effect"
        ? "This React effect sends a request when its source conditions allow it. The UI state or props that activate it are not traced."
        : "This client function reaches the endpoint. Its earlier UI interaction is not proven."));
    journey.calls.forEach((call, i) => {
      const isRequest = i === journey.calls.length - 1;
      const target = isRequest ? flow.entryNode : call.calleeId;
      const body = h("details", { class: "flow-step__detail" }, h("summary", {}, isRequest ? "Request payload" : "Arguments"));
      if (isRequest) body.append(journey.request.requestShape
        ? renderValueTree(journey.request.requestShape, { repo, prefix: "request" })
        : h("p", { class: "muted" }, "The request body shape is not statically resolved."));
      else for (const argument of call.arguments) {
        const parameter = journey.symbols.find((symbol) => symbol.id === target)?.parameters?.[argument.index];
        const declaredType = argument.explicitType ?? parameter?.explicitType;
        body.append(h("div", { class: "parameter-card" },
          h("code", {}, `${argument.index + 1}. ${argument.expression}`),
          h("p", { class: "muted" }, `Parameter: ${argument.parameterName ?? "not resolved"} · Type: ${declaredType?.text ?? "not declared"}`),
          argument.shape ? renderValueTree(argument.shape, { repo, prefix: `argument:${argument.index}` }) : null));
      }
      if (!isRequest && !call.arguments.length) body.append(h("p", { class: "muted" }, "No arguments."));
      details.append(h("article", { class: "card flow-step client-flow__step" },
        h("p", { class: "flow-step__number" }, `Client step ${i + 1}`),
        h("p", { class: "flow-step__summary" }, isRequest ? "The client sends the HTTP request to the shared server endpoint." : `${symbolLabel(call.callerId)} passes data to ${symbolLabel(target)}.`),
        h("p", { class: "flow-step__technical" }, symbolLink(repo, call.callerId), isRequest ? " requests " : " calls ",
          isRequest ? h("a", { href: routeForNode(repo, target) }, flow.title) : symbolLink(repo, target),
          " in ", sourceLink(repo, call.source), "."),
        call.condition ? h("details", {}, h("summary", {}, "Enclosing condition"), h("code", {}, call.condition)) : null,
        body));
    });
    if (journey.boundary) details.append(h("p", { class: "para para--gap" }, journey.boundary));
  };
  renderPath(current);
  const select = h("select", { id: "client-origin", class: "client-flow__select", on: { change: (event) => {
    const chosen = paths.find((path) => path.id === event.target.value);
    renderPath(chosen);
    onSelect?.(chosen?.id ?? null);
  } } }, paths.map((path) => h("option", { value: path.id, selected: path.id === current?.id ? true : null }, path.title)));
  const conditions = flow.steps.filter((step) => step.condition);
  return section("client-origins", "Client → endpoint",
    h("a", { class: "btn flow-all-link", href: formatRoute({ level: "flows", repo, query: {} }) }, "← All flows"),
    paths.length ? h("div", {}, h("label", { for: "client-origin", class: "entity-subhead" }, "Highlight client origin"), select)
      : h("p", { class: "para para--gap" }, "No statically matched client calls were found. This does not mean the endpoint has no clients; external callers and dynamic URLs are not resolved."),
    paths.length ? h("fieldset", { class: "client-flow__scope" },
      h("legend", {}, "Map detail"),
      h("label", {}, h("input", { type: "radio", name: "client-map-scope", value: "full", checked: true, on: { change: () => onScope?.("full") } }), " Clients + server"),
      h("label", {}, h("input", { type: "radio", name: "client-map-scope", value: "request", on: { change: () => onScope?.("request") } }), " Focus on this path"),
      h("p", { class: "muted" }, "All detected origins and the server graph stay visible. Blue arrows highlight the selected client path; focus shows only its handoff to the handler. Server steps and analysis limits remain below.")) : null,
    paths.length ? details : null,
    h("p", { class: "para muted" }, "The server map below shows possible calls, not a recorded execution. Different client inputs can select different branches of the same handler."),
    conditions.length ? h("details", { class: "client-flow__conditions" }, h("summary", {}, `Server conditions (${conditions.length})`),
      h("p", { class: "muted" }, "Lexically enclosing if-conditions only; earlier returns, switch cases, and runtime values may further constrain these calls."),
      conditions.map((step) => h("p", {}, symbolLink(repo, step.to), " — ", h("code", {}, step.condition)))) : null,
    flow.clients?.limitations?.length ? h("details", { class: "client-flow__limits" }, h("summary", {}, "What is not traced"),
      h("ul", {}, flow.clients.limitations.map((limit) => h("li", {}, limit)))) : null);
}
