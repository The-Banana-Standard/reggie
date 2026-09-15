---
entity: packages/reggie/src/claim.ts
kind: file
---

## gotcha · 2026-09-06 · Claude via jacobpress · high
Ownership comes from the claim record committed on the task branch, not from the tip author. Releasing refuses another person's branch and refuses unmerged commits unless forced; the claim commit itself does not count as unmerged work.
sources: packages/reggie/src/claim.ts

## gotcha · 2026-09-15 · Claude via jacobpress · high
A worktree claim writes its journal entry in the worktree and commits it in the claim commit beside claim.md, so the serving checkout that performs the merge is never left holding it uncommitted. An in-place claim and every resume write the entry uncommitted in the checkout they run in. Committing it in place would track a dirty day file that release then cannot switch away from, and a resume commit would count as unmerged work beyond the claim.
sources: packages/reggie/src/claim.ts:84

