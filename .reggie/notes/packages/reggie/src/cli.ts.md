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

## how · 2026-09-15 · Claude via jacobpress · medium
reggie claim prints one line per configured dependency directory after the claim line, and anything the session still owes ends with the command and the directory to run it in. launch --run claims with deps: defer instead, so a cold install never delays opening the session; what is left goes into the prompt.
sources: packages/reggie/src/cli.ts:437

## how · 2026-09-15 · Claude via jacobpress · medium
reggie triage --all scaffolds only for ungroomed tasks with no brief, and names the ungroomed ones that already have an unfilled draft in the closing line: after the draft rule they stay ungroomed, so scaffolding over them would print 'already exists' forever. plan done is kept as the sweep for a line that outlived its brief.

## gotcha · 2026-09-15 · Claude via jacobpress · medium
The Ungroomed column holds two kinds of work now and each needs a different verb: a raw line wants reggie triage, a scaffold nobody filled in wants a session. reggie tasks prints a line for each when both exist, and the two counts add up to the column header; collapsing them into one number contradicts the header and hides whichever half loses.

## how · 2026-09-17 · Claude via jacobpress · high
reggie journal derive <slug> prints each entry in full, the file it went to with a reminder that it is uncommitted and that the next decide in that checkout refuses until it is committed, then any Codex or missing-transcript notice, and last a summary line that holds counts only. A refusal exits 1 and still prints that summary first, so the last line of output is always content free. The CLI is the only caller of defaultClaudeHome and the only builder of the real rewrite runner, and it builds one only when the rewrite flag is passed.
sources: derive-the-journal

## gotcha · 2026-09-18 · Claude via jacobpress · medium
The reggie journal derive output no longer over-promises that an uncommitted entry blocks the next decide: a journal file already tracked on the branch does block landTask until committed, but a brand-new untracked day file does not, so the wording says to commit it before landing rather than claiming the merge will refuse.
sources: derive-the-journal

