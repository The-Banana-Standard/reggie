import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkKey, checkPostOrigin, isLoopbackHost, keyOf, lanAddresses, readOrMintServeKey, serveKeyFile } from "./serve.js";

function fakeReq(remote: string, headers: Record<string, string> = {}): IncomingMessage {
  return { headers, socket: { remoteAddress: remote } } as unknown as IncomingMessage;
}

const KEY = "abcDEF123-_xyz";
const u = (path: string) => new URL(`http://192.0.2.7:4310${path}`);

describe("the serve key", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "reggie-key-"));
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("is minted once under the cache and read back unchanged", () => {
    const first = readOrMintServeKey(root);
    expect(first).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(readFileSync(serveKeyFile(root), "utf8").trim()).toBe(first);
    expect(readOrMintServeKey(root)).toBe(first);
  });

  it("knows which bind addresses keep the server on this machine", () => {
    for (const h of ["127.0.0.1", "localhost", "::1", "127.0.0.5", ""]) expect(isLoopbackHost(h), h).toBe(true);
    for (const h of ["0.0.0.0", "::", "192.168.1.18", "100.64.0.3"]) expect(isLoopbackHost(h), h).toBe(false);
    expect(lanAddresses("127.0.0.1")).toEqual([]);
    expect(lanAddresses("192.168.1.18")).toEqual(["192.168.1.18"]);
    for (const a of lanAddresses("0.0.0.0")) expect(a).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
  });

  it("reads the key from the header first, then the query string", () => {
    expect(keyOf(fakeReq("10.0.0.2", { "x-reggie-key": KEY }), u("/api/facts"))).toBe(KEY);
    expect(keyOf(fakeReq("10.0.0.2"), u(`/api/episode?scope=task&id=x&key=${KEY}`))).toBe(KEY);
    expect(keyOf(fakeReq("10.0.0.2", { "x-reggie-key": " " }), u("/api/facts"))).toBeNull();
  });

  it("never asks a loopback socket for a key, whatever the server was bound to", () => {
    expect(checkKey(fakeReq("127.0.0.1"), u("/api/facts"), KEY)).toBeNull();
    expect(checkKey(fakeReq("::1"), u("/api/facts"), KEY)).toBeNull();
    expect(checkKey(fakeReq("::ffff:127.0.0.1"), u("/api/facts"), null)).toBeNull();
  });

  it("refuses a network socket outright when no key was set up, and with 401 when the key is missing or wrong", () => {
    const off = checkKey(fakeReq("192.168.1.5"), u("/api/facts"), null);
    expect(off?.status).toBe(403);
    expect(off?.error).toContain("--host 0.0.0.0");
    const missing = checkKey(fakeReq("::ffff:192.168.1.5"), u("/api/facts"), KEY);
    expect(missing?.status).toBe(401);
    expect(missing?.error).toContain("key required");
    expect(checkKey(fakeReq("192.168.1.5", { "x-reggie-key": "nope" }), u("/api/facts"), KEY)?.status).toBe(401);
    expect(checkKey(fakeReq("192.168.1.5", { "x-reggie-key": KEY.slice(0, -1) }), u("/api/facts"), KEY)?.status).toBe(401);
  });

  it("lets a network socket through with the right key in the header or the query", () => {
    expect(checkKey(fakeReq("192.168.1.5", { "x-reggie-key": KEY }), u("/api/facts"), KEY)).toBeNull();
    expect(checkKey(fakeReq("100.64.0.9"), u(`/api/feed.xml?key=${KEY}`), KEY)).toBeNull();
  });
});

describe("checkPostOrigin over the network", () => {
  const port = 4310;

  it("still accepts a loopback origin and still refuses a cross-site request, keyed or not", () => {
    expect(checkPostOrigin(fakeReq("127.0.0.1", { origin: "http://127.0.0.1:4310" }), port)).toBeNull();
    expect(checkPostOrigin(fakeReq("192.168.1.5", { "sec-fetch-site": "cross-site", origin: "http://192.168.1.18:4310", host: "192.168.1.18:4310" }), port, { keyed: true })).toContain("cross-site");
  });

  it("accepts an origin equal to the request's own host only for a keyed request", () => {
    const headers = { origin: "http://192.168.1.18:4310", host: "192.168.1.18:4310" };
    expect(checkPostOrigin(fakeReq("192.168.1.5", headers), port, { keyed: true })).toBeNull();
    expect(checkPostOrigin(fakeReq("192.168.1.5", headers), port)).toContain("origin does not match");
    expect(checkPostOrigin(fakeReq("192.168.1.5", { origin: "http://evil.example.com", host: "192.168.1.18:4310" }), port, { keyed: true })).toContain("origin does not match");
    expect(checkPostOrigin(fakeReq("192.168.1.5", { origin: "https://192.168.1.18:4310", host: "192.168.1.18:4310" }), port, { keyed: true })).toContain("origin does not match");
  });
});
