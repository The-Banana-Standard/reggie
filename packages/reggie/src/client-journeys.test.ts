import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempRepo, type TempRepo } from "../test/helpers.js";
import { buildGraph } from "./graph.js";
import { repoPaths } from "./paths.js";
import { buildSemanticIndex, type SemanticIndex, type RouteRecord } from "./semantic-index.js";
import { clientJourneys } from "./client-journeys.js";
import { traceFlow } from "./flows.js";

describe("client-to-endpoint evidence", () => {
  let repo: TempRepo;
  let index: SemanticIndex;
  let route: RouteRecord;
  beforeAll(() => {
    repo = makeTempRepo("reggie-client-");
    repo.write("src/request.ts", `export async function send(message, options = {}) {
      return fetch('/api/chat', {method:'POST', body: JSON.stringify({message, selectedPromptId:options.id, session_id:options.session, history:[], context: {doc: 1}, clicked: []})});
    }`);
    repo.write("src/Chat.tsx", `import {useEffect as effect} from 'react';
      import {send as request} from './request';
      export function Chat({initialQuestion, initialPromptId}) {
        const submit = (event) => {event.preventDefault(); request(inputValue);};
        effect(() => { if(initialQuestion) request(initialQuestion, {id:initialPromptId}); }, [initialQuestion]);
        external(() => request('callback'));
        effect.notAnEffect(() => request('not-an-effect'));
        return <form onSubmit={submit}><button aria-label="Suggested message" onClick={() => request('hello', {id:'starter'})}>Ask</button></form>;
      }`);
    repo.write("src/other.jsx", `import {send} from './request';
      const useEffect = cb => cb();
      export function Other() { useEffect(() => send('not-react')); return <Custom onClick={() => send('not-native')}/>; }`);
    repo.write("src/request.test.ts", "import {send} from './request'; test('request', () => send('test-only'));");
    repo.write("functions/api/chat.js", `export async function onRequestPost({request}) {
      const payload = await request.json();
      if(payload.selectedPromptId) return authored(payload);
      return Response.json({answer:payload.message});
    }
    function authored(payload) { return Response.json({answer:'hello'}); }`);
    repo.write("src/guard.js", "function check() {return true;} export function guarded() {if(check()) {check();} else {check();}}");
    repo.commitAll("fixture");
    index = buildSemanticIndex(repoPaths(repo.root), buildGraph(repoPaths(repo.root)));
    route = index.routes.find((record) => record.path === "/api/chat")!;
  });
  afterAll(() => repo.cleanup());

  it("follows imported aliases and distinguishes native events and imported effects", () => {
    const result = clientJourneys(index, route);
    expect(result.paths.filter((path) => path.trigger?.kind === "ui-event").map((path) => path.trigger?.label).sort()).toEqual(["Click Suggested message", "Submit form"]);
    expect(result.paths.filter((path) => path.trigger?.kind === "react-effect")).toHaveLength(1);
    const submit = result.paths.find((path) => path.trigger?.event === "onSubmit")!;
    expect(submit.calls.map((call) => call.calleeExpression)).toEqual(["request", "fetch"]);
    expect(submit.calls[0]?.arguments[0]?.expression).toBe("inputValue");
    expect(submit.symbols.some((symbol) => symbol.id === "sym:src/request.ts::send")).toBe(true);
    expect(submit.request.requestShape?.fields).toHaveLength(6);
    expect(submit.calls[0]?.arguments[0]?.explicitType).toBeNull();
    expect(result.limitations.join(" ")).toContain("state and prop");
    expect(result.paths.some((path) => path.boundary?.includes("anonymous callback"))).toBe(true);
    expect(result.paths.every((path) => path.calls.every((call) => !call.source.file.includes(".test.")))).toBe(true);
  });

  it("preserves call conditions and client paths on the public flow without faking server selection", () => {
    const flow = traceFlow(repoPaths(repo.root), buildGraph(repoPaths(repo.root)), route.handlerSymbolId!, { semanticIndex: index });
    expect(flow.clients?.paths.length).toBeGreaterThan(2);
    expect(flow.steps.find((step) => step.to.endsWith("::authored"))?.condition).toBe("payload.selectedPromptId");
    expect(flow.steps[0]?.from).toBe("route:POST:/api/chat");
  });

  it("reports caps, cycles and no detected clients", () => {
    const capped = clientJourneys(index, route, {maxPaths:1});
    expect(capped.paths).toHaveLength(1);
    expect(capped.truncated).toBe(true);
    expect(capped.limitations.join(" ")).toContain("bounded");
    expect(clientJourneys(index, {...route, clientCalls: []}).paths).toEqual([]);
    const send = index.calls.find((call) => call.calleeId === "sym:src/request.ts::send")!;
    const loop = { ...send, id:"cycle", callerId:"sym:src/request.ts::send" };
    expect(clientJourneys({...index, calls:[...index.calls, loop]}, route).limitations.join(" ")).toContain("cycle");
  });

  it("does not label evaluation of an if-condition as conditional on its own result", () => {
    const calls = index.calls.filter((call) => call.source.file === "src/guard.js");
    expect(calls.map((call) => call.condition)).toEqual([null, "check()", "not (check())"]);
  });
});
