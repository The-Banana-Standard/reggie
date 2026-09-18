---
entity: packages/reggie/test/serve-idea-fixture.ts
kind: file
---

## how · 2026-09-18 · Claude via jacobpress · high
The one way to exercise the idea action in a browser without opening a Terminal window. It replaces spawnSync on the child_process module before the server is imported and syncs the builtin ESM exports so the named import in the git module sees the stub; osascript alone is intercepted, in ok, deny or hang mode from IDEA_TERMINAL, and every git call still runs. Hang blocks synchronously for the caller's timeout the way an unanswered consent dialog does, which also reproduces the server being held for those seconds. It serves a workspace of the fixture repo plus a bare repo with no .reggie directory; --single and --empty cover single-repo mode and a listing with no usable repo.
sources: idea-from-every-page

