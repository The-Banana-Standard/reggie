# Journal · 2026-09-13 · jacobpress · session

Plain-English record of what happened, written as it happened. No file paths in the prose; link evidence instead.

### 09:13 · jacobpress · claude · - · audit
Audited the web view against the three things it is supposed to do: explain a codebase, explain what changed, and carry the user's intent to an agent. It explains a codebase well and is close to silent on the other two, and the cause is single: everything it derives is keyed to the last commit, so work in progress is invisible to it. Wrote the findings, the designs that were considered, and the decisions into a discussion so the reasoning survives, and deleted the old desktop app that the build and the generated instructions still described.

### 10:03 · jacobpress · claude · - · build
Reviewed the web-view audit and its plan against the code and the running page, then built the pieces that were on the loop's own path: the brief now reaches the context pack, the planning prompt and the agent tools; launching a session no longer fires a Reggie command but opens the tool in plan mode with a prompt that frames a conversation, carries a sentence of the user's own, writes the context pack to a file the prompt names, mints a session id so the chat can be found again, and for a build claims the task first and opens its worktree. A task without a plan now tells its own story: what was written, where it probably lives, what is known there, what it resembles, what is unclear; a form adds what the user meant under the intake line; and every story can be read aloud, made into an audio episode, and subscribed to as a private feed. Dropped the dead backlog from the old desktop app. Two audit claims were corrected on the way: the desktop continue link rejects a CLI session id, and Codex does have a plan mode.

