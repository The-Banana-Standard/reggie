---
entity: packages/reggie/src/packet.ts
kind: file
---

## how · 2026-09-18 · Claude via jacobpress · high
reggie packet writes the acceptance checklist between the two reggie:checks markers from the check records and nothing else: a box is ticked only when the latest record for its key passes, the evidence line holds that record's paths, and the check line says who, with what, when and the key. No evidence file is paired with a criterion by position any more. On a packet that exists only the text between the markers is rewritten; a packet with no markers predates check records and is left byte-identical. Every value that came out of a record is cleaned to one line before it is rendered, because a line break in a hand-written record's person field could otherwise forge a ticked box. assertTaskCheckout refuses outside the task's own checkout while the task branch exists and names the worktree, which closes the trap of a second, empty packet scaffolded in the integration checkout.
sources: low-risk-auto-approval

## how · 2026-09-18 · Claude via jacobpress · high
evidenceRefs is the only reader of evidence references: the task page through parsePacketCriteria in tasks.ts, the packet contract and the evidence gate all call it. A reference is the leading token of each comma- or semicolon-separated piece of an evidence: line or a bullet under the Evidence heading, when it is shaped like a path, plus what the older whole-piece reader returned. A citation is a reference that names the task's own evidence folder, as evidence/<name> or by its full path anywhere in the reference, so an absolute spelling is judged and refused rather than read as prose; other path-shaped words on those lines are prose. resolveEvidence judges citations against one commit with one ls-tree of the folder, handing git only a full commit id and Reggie's own folder name.
sources: low-risk-auto-approval

## gotcha · 2026-09-18 · Claude via jacobpress · high
The older reader hands back a path with its sentence's full stop or colon still attached. Kept verbatim, that spelling would be a citation that is missing on every commit, and the gate would refuse an honest packet; so it is dropped when it only repeats a reference already found. Any other change to evidenceRefs must be rerun over the landed packets before it ships: on 2026-09-18 it found a reference for 306 of 306 criteria with a checkbox, where the old reader found one for 220, lost none the old reader found, and of 285 citations refused exactly one, an honest empty diff file. A bail condition of the task hangs on those numbers.
sources: low-risk-auto-approval

## decision · 2026-09-18 · Claude via jacobpress · high
An empty evidence file fails although one landed packet holds an honest one: with no reader, an empty file cannot be told from a redirect that failed, and the message says to save the command and its exit status into the file. lintPacket is the packet contract, the third beside the brief's and the plan's; a hand approval does not run it, the policy report does. Whether a citation resolves is the gate's question and not the contract's, which only asks that it is well formed.
sources: low-risk-auto-approval
