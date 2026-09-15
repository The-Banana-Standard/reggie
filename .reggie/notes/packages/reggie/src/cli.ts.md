---
entity: packages/reggie/src/cli.ts
kind: file
---

## how · 2026-09-13 · Claude via jacobpress · medium
reggie serve --host 0.0.0.0 prints one phone address per network interface with ?key= appended, from ServerHandle.addresses and .key; --key overrides the minted key but is ignored on a loopback bind. In team mode it says writes are refused over the network. PORT in the environment is the default port.
sources: packages/reggie/src/cli.ts:604

## how · 2026-09-15 · Claude via jacobpress · medium
A preAction hook on the root program runs checkBuild before every command's action, nested subcommands included: when the running dist/ is behind src/ it prints the refusal to stderr and exits 1, and with REGGIE_ALLOW_STALE=1 it prints the warning and carries on. The mcp command is exempt from the hook; it records the build it loaded and passes a per-call check to the server instead. --help and --version exit before the hook runs.

## how · 2026-09-15 · Claude via jacobpress · high
decide approved in solo mode lands the task branch through landTask and prints the merge sha, or 'had already landed' with the existing merge, then what was released; a refusal or conflict exits 1 with the reason. needs-work only writes the verdict into the packet on disk.
sources: task-attribution-by-merge

