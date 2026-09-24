import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientFlowSection, withClientJourney } from "./client-flow.js";
import { buildModel } from "./map.js";
import { resetDom } from "./test/dom-fixture.js";

const source = { file:"src/Chat.jsx", startLine:10, startOffset:40, endOffset:100 };
const caller = "sym:src/Chat.jsx::submit";
const send = "sym:src/request.js::send";
const route = "route:POST:/api/chat";
const fields = ["message","selectedPromptId","history","session_id","context","clicked"].map((name) => ({name,path:[name],explicitType:null,shape:null}));
const request = {requestShape:{kind:"object",fields,elements:[],variants:[]}};
const calls = [
  {id:"call:submit",callerId:caller,calleeId:send,calleeExpression:"send",arguments:[{index:0,expression:"inputValue",parameterName:"message",explicitType:null}],source,condition:null},
  {id:"call:fetch",callerId:send,calleeId:null,calleeExpression:"fetch",arguments:[],source}
];
const first = {id:"submit",title:"Submit form",trigger:{id:"client:src/Chat.jsx:40",kind:"ui-event",label:"Submit form",source},calls,request,symbols:[{id:caller,qualifiedName:"submit",file:source.file},{id:send,qualifiedName:"send",file:"src/request.js"}]};
const effect = {...first,id:"effect",title:"React effect",trigger:{...first.trigger,id:"client:src/Chat.jsx:80",kind:"react-effect",label:"React effect"},calls:[{...calls[0],arguments:[{index:0,expression:"initialQuestion",explicitType:null}]},calls[1]]};
const flow = {id:"chat",title:"POST /api/chat",entryNode:route,entry:"sym:functions/api/chat.js::onRequestPost",
  nodes:[{id:route,kind:"endpoint",label:"POST /api/chat",path:"/api/chat"}],
  steps:[{from:route,to:"sym:functions/api/chat.js::onRequestPost",kind:"call",arguments:[],returns:[],condition:"payload.selectedPromptId && starterPrompt",source:{file:"functions/api/chat.js"}}],
  clients:{paths:[first,effect],limitations:["State and props are not traced."]}};

beforeEach(() => resetDom('<main id="sections"></main>'));
describe("client flow", () => {
  it("switches origins with a labelled native selector and complete payload details", () => {
    const onSelect = vi.fn();
    const section = clientFlowSection(flow,"demo",{onSelect});
    document.getElementById("sections").append(section);
    expect(section.textContent).toContain("inputValue");
    expect(section.querySelector('label[for="client-origin"]')).toBeTruthy();
    expect(section.querySelectorAll(".value-tree > details")).toHaveLength(6);
    expect(section.textContent).toContain("Type: not declared");
    expect(section.textContent).toContain("not a recorded execution");
    expect(section.textContent).toContain("payload.selectedPromptId");
    expect(section.querySelector('a[href="#/repo/demo/symbol/sym:src/request.js::send"]')).toBeTruthy();
    expect(section.querySelector('a[href="#/repo/demo/route/route:POST:/api/chat"]')).toBeTruthy();
    const select = section.querySelector("select");
    select.value = "effect";
    select.dispatchEvent(new Event("change"));
    expect(onSelect).toHaveBeenCalledWith("effect");
    expect(section.textContent).toContain("initialQuestion");
    expect(section.textContent).not.toContain("inputValue");
  });
  it("draws the selected client path before the same server nodes without mutating the source", () => {
    const combined = withClientJourney(flow,"submit");
    expect(flow.steps).toHaveLength(1);
    expect(combined.steps).toHaveLength(5);
    expect(combined.steps.filter((step) => step.callSiteId === "call:fetch")).toHaveLength(1);
    expect(combined.steps.some((step) => step.from === effect.trigger.id)).toBe(true);
    const model = buildModel({level:"flow",flow:combined,services:[]});
    expect(model.nodeById.get(first.trigger.id).label).toContain("CLIENT EVENT");
    expect(model.nodeById.get(caller).label).toContain("FUNCTION");
    expect(model.edges.some((edge) => edge.source === send && edge.target === route)).toBe(true);
    expect(model.edges.some((edge) => edge.source === route && edge.target === flow.entry)).toBe(true);
    expect(withClientJourney(flow,"absent")).toBe(flow);
    const focused = withClientJourney({...flow,steps:[...flow.steps,...flow.steps],services:["svc:api:remote"]},"submit",{requestOnly:true});
    expect(focused.steps).toHaveLength(4);
    expect(focused.services).toEqual([]);
    expect(buildModel({level:"flow",flow:focused,services:[]}).layout.name).toBe("serpentine");
  });
  it("defaults to clients plus server, with explicit focus and All flows controls", () => {
    const onScope = vi.fn();
    const section = clientFlowSection(flow,"demo",{onScope});
    document.getElementById("sections").append(section);
    expect(section.querySelector('input[value="full"]').checked).toBe(true);
    expect(section.querySelector('input[value="request"]').checked).toBe(false);
    expect(section.querySelector(".flow-all-link").getAttribute("href")).toBe("#/repo/demo/flows");
    section.querySelector('input[value="request"]').click();
    expect(onScope).toHaveBeenCalledWith("request");
    expect(section.querySelectorAll(".client-flow__step")).toHaveLength(calls.length);
  });
  it("origin selection retains all server evidence and only changes the highlighted client edges", () => {
    const server = { ...flow, steps: [...flow.steps, {from:flow.entry,to:"svc:kv:CACHE",kind:"read",arguments:[],returns:[]}],
      services:["svc:kv:CACHE"], dropped:[{hop:2,count:4}], truncated:true, depth:6 };
    const a = withClientJourney(server, "submit");
    const b = withClientJourney(server, "effect");
    expect(a.steps.map((s) => [s.from,s.to])).toEqual(b.steps.map((s) => [s.from,s.to]));
    expect(a.steps.slice(-server.steps.length)).toEqual(server.steps);
    expect(b).toMatchObject({ services:server.services, dropped:server.dropped, truncated:true, depth:6 });
    expect(a.steps.find((s) => s.from === first.trigger.id).clientPathSelected).toBe(true);
    expect(b.steps.find((s) => s.from === first.trigger.id).clientPathSelected).toBe(false);
    expect(b.steps.find((s) => s.from === effect.trigger.id).clientPathSelected).toBe(true);
    expect(buildModel({level:"flow",flow:b}).layout.name).toBe("dagre");
  });
  it("preserves explicit callee parameter declarations when a caller has no declared type", () => {
    const typed = {...first, symbols:[...first.symbols.filter((symbol) => symbol.id !== send),{id:send,parameters:[{explicitType:{text:"string",source:"typescript"}}]}]};
    expect(clientFlowSection({...flow,clients:{paths:[typed]}},"demo").textContent).toContain("Type: string");
  });
  it("treats source labels and arguments as text and distinguishes missing evidence from no clients", () => {
    const hostile = {...first,title:'<img src=x onerror=alert(1)>',calls:[{...calls[0],arguments:[{index:0,expression:'<script>bad()</script>'}]},calls[1]]};
    const section = clientFlowSection({...flow,clients:{paths:[hostile]}},"demo");
    expect(section.querySelector("script,img")).toBeNull();
    expect(section.textContent).toContain("<script>bad()</script>");
    expect(clientFlowSection({...flow,clients:{paths:[]}},"demo").textContent).toContain("does not mean the endpoint has no clients");
  });
});
