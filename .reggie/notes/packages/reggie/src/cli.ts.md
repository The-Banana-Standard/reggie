---
entity: packages/reggie/src/cli.ts
kind: file
---

## how · 2026-09-13 · Claude via jacobpress · medium
reggie serve --host 0.0.0.0 prints one phone address per network interface with ?key= appended, from ServerHandle.addresses and .key; --key overrides the minted key but is ignored on a loopback bind. In team mode it says writes are refused over the network. PORT in the environment is the default port.
sources: packages/reggie/src/cli.ts:604

