# Intake

Raw items waiting for triage. Anyone can add a line here, by hand, by voice
note, or by asking Claude or Codex to capture it. No structure is required.

Format Reggie writes (angle brackets are placeholders):

    - <slug>: <one-line description> (<person>, <source>, <date>)
      > <optional detail>

Reggie turns items into plans under `tasks/<slug>/plan.md`. Once a plan is
merged, the intake line is removed.

- a-task-worktree-has-no-node-modules-so-nothing-r: A task worktree has no node_modules, so nothing runs in it until deps are installed or linked (jacobpress, cli, 2026-09-13)
  > Discovered building mobile-ui: reggie claim --worktree checks out .worktree/<slug> from git, and packages/reggie/node_modules is ignored, so npm test and the server fail there until npm ci runs (slow) or node_modules is symlinked from the main checkout (what I did). claim --worktree should either run the repo's install command from the generated facts or link node_modules from the root checkout when the lockfile is identical.
  > Decided 2026-09-15: hybrid. Link the serving checkout node_modules when the lockfiles are byte-identical, otherwise run the install command from a config key; the launch prompt says to unlink before adding a dependency.
- notes-have-no-way-to-retire-an-entry-so-a-supers: Notes have no way to retire an entry, so a superseded note keeps rendering beside its replacement (jacobpress, cli, 2026-09-13)
  > Seen on the repo overview: two repo notes, the 6 Sep one saying the Tauri app is slated for removal and the 10 Sep one saying it was deleted. Note files are append-only and nothing marks an older entry as superseded; the staleness check only compares a file entity's own commits. Wanted: a note supersede or retire verb (and an MCP tool) that folds an entry into history so the story shows one current answer, with the old one reachable but not narrated.
- derive-the-journal: Derive the journal from session transcripts, commits and state transitions instead of asking sessions to write it (jacobpress, cli, 2026-09-13)
  > Decided 2026-09-13 (vision doc, Decisions made on 2026-09-13). Both tools leave a transcript on disk: Claude under ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl (the uuid is the one Reggie mints at launch and records in claim.md and .reggie/.cache/launches/<slug>.json), Codex under ~/.codex/sessions/<date>/rollout-*.jsonl with cwd in session_meta. Read the session's own summary messages plus the commits on the task branch, write one listener-register entry per session attributed to person and tool, link the evidence, never repeat what an earlier entry said. Trigger is an open fork: a session-end hook, a pass in reggie serve, or reggie journal derive <slug>. Journal files should also stop colliding on merge (see the captured journal-conflict item): name them by slug or union-merge them via .gitattributes.
  > Decided 2026-09-15: an explicit verb, reggie journal derive <slug>, that works for a task in flight and for a completed one by reading the commits from its merge commit; a pass in reggie serve may call it later once trusted.
- go-deeper-on-own-page: Go deeper on a file's own Spotlight links to the page you are already on (jacobpress, cli, 2026-09-14)
  > explainActions always emits Go deeper pointing at the entity's own route. On the repo overview and an area page that is a real step down; on a file page the Spotlight is pinned above the same file's story, so the button reloads the page you are on and appears to do nothing. It should point at the next level (the first exported symbol, or open the source in the reader) or not appear on the file level.
- stats-json-changes-under-test: Running the test suite modifies packages/reggie/.claude/stats.json in the working tree, so git add -A during a task commit sweeps it in; it should be ignored or written elsewhere (jacobpress, cli, 2026-09-14)
  > Decided 2026-09-15: untrack the file first, then unanchor the ignore. The writer was the v2 track-stats hook, not the test suite; its registration was removed from ~/.claude/settings.json on 2026-09-15.
- task-attribution-by-merge: Join commits to tasks by the merge commit, so Completed shows files and a finished task's commits stay findable (jacobpress, cli, 2026-09-15)
  > Decided 2026-09-15. Parse the Task: line anywhere in a commit body (sessions write it above Co-Authored-By, outside git's trailer block), take a merge commit's files against its first parent (history reads numstat without -m), and let reggie decide approved perform the no-ff merge in solo mode so the merge commit always exists. Team mode requires merge commits on GitHub.
- branch-diff-in-reader: Show a task branch's diff inside the reader; no route returns hunks anywhere today (jacobpress, cli, 2026-09-15)
  > patchFor and numstatRange in git.ts, a changes.ts with a unified-diff parser, GET /api/changes and /api/filediff for in-process and awaiting-decision tasks, a diff mode in reader.js fed branch-side text, and the routes written into ui-api-contract.md. The first surface for reviewing what changed.
- needs-you-queue: Needs you lists decisions only; intake items, failing lint, open questions and stale notes wait unseen (jacobpress, cli, 2026-09-15)
  > Deterministic queue rows over decisions, plan and brief lint messages (only a boolean reaches the board today), unanswered brief questions, and stale notes including a new entity-no-longer-exists class (the stale check silently skips notes whose path is gone). Distinguish a scaffolded brief from a filled one that fails lint. Answer open questions in place, appended under the brief's questions section.
- idea-from-every-page: An idea action on every page that captures a line and opens a discuss session with the current page as context (jacobpress, cli, 2026-09-15)
  > Decided 2026-09-15: all planning happens in Claude Code or Codex sessions. Launch refuses to run without a task slug today; the action captures the line (minting the slug), then launches discuss mode in plan mode with the file, area or repo the reader was on in the context pack.
- low-risk-auto-approval: Low-risk plans and completions pass by policy in solo mode (jacobpress, cli, 2026-09-15)
  > Decided 2026-09-15. Preconditions built as one task: an evidence gate so no packet passes citing evidence files that do not exist; checks recorded as data (a reggie check verb) rather than a ticked box; Reggie owning the merge; and the packet's discovered issues auto-captured into intake so what a human would not have approved becomes the next task. Risk class stays the path-rule proxy until it derives from the graph.
- mcp-packet-and-pr-tools: Expose packet and pr as MCP tools so a build session does not depend on a shell PATH (jacobpress, cli, 2026-09-15)
  > Decided 2026-09-15: MCP and CLI wrap the same functions; decide is never a session tool.
- retire-onboard-slash-commands: Retire the six project slash commands onboard installs; capture has three doors: CLI, MCP tool, web form (jacobpress, cli, 2026-09-15)
  > Decided 2026-09-15. Nothing emits them since the launch redesign, their bodies teach the retired journal habit, the plan template drifts from launch.ts, and the docs say four. Delete the installer entries and the files in onboarded repos.
- retire-v2-resources-before-merge: Move resources/ to an archive and repoint the ~/.claude symlinks before repo-manager lands on main (jacobpress, cli, 2026-09-15)
  > Decided 2026-09-15. The home agents, commands and hooks folders symlink into the main clone's resources/, so deleting the folder with the merge would remove the v2 agents from every project on the machine. Sequence: create the archive, repoint the symlinks, then delete from the branch. The track-stats hook registration was already removed on 2026-09-15.
- co-authored-by-parsed: History reads only the git author, so agent-written code looks like the owner's own (jacobpress, cli, 2026-09-15)
  > Parse the Co-Authored-By trailer into coauthors per commit (44 of the last 60 carry one, several model names), derive a per-file written-with-an-agent share and last human-only touch, and surface it in Owners and knowledge coverage.
- graph-coverage-published: The map never says what it skipped; unresolved imports and skipped languages are computed and discarded (jacobpress, cli, 2026-09-15)
  > Add a skipped-by-language count to the graph payload, say it in the repo story's made-of section, and show the unresolved count in the map footer so a partly-read repo is distinguishable from a complete one.
- false-tests-sentence: The landing paragraph prints a total file count as a tests claim (jacobpress, cli, 2026-09-15)
  > story.ts emits (N with tests) from the aggregate file count at three sites while the graph keeps a separate tests count. Print the test-file count, or drop the clause when it is zero.
- note-form-on-repo-and-area: Once a repo or area has one note there is no way to add another from the page (jacobpress, cli, 2026-09-15)
  > The add-note section is emitted for file scope only; repo and area expose the form only through the empty-state action. Emit it for all three scopes.
- codex-parity-end-to-end: Run one task through the loop with Codex end to end and fix what breaks (jacobpress, cli, 2026-09-15)
  > From the 2026-09-06 backlog. Every claim and journal so far says tool: claude, and launch mints no session reference for Codex. Write a parity note afterwards.
- cross-repo-from-remotes: Derive sibling repos and shared-service edges from git remotes and manifests, never from workspace folders (jacobpress, cli, 2026-09-15)
  > From the 2026-09-06 backlog; deferred by the one-repo-at-a-time decision of 2026-09-15. Same-org edges exist, shares-service is declared and never produced, discovery still needs the parent CLAUDE.md.
- people-page-or-drop-links: Story links to a People page that renders nothing (jacobpress, cli, 2026-09-15)
  > From the 2026-09-06 backlog. Either render the page from /api/people with a bus-factor note per area, or drop the person links from the story.
- docs-check-in-ci: Three docs promise reggie docs check runs in CI; ci.yml never runs it (jacobpress, cli, 2026-09-15)
  > Add the step after build. The generated block was refreshed on 2026-09-15 so the check passes on a clean tree.
- pr-review-decision-as-verdict: Read reviewDecision from gh and record decided_by and decided_at; map a closed unmerged PR back to in-process (jacobpress, cli, 2026-09-15)
  > From the 2026-09-06 backlog. Team-mode path; the gh query requests only number, url, state, headRefName and title today.
- discussion-story-scope: Nothing reads .reggie/discussions; give it a story scope and a way to graduate a capture from it (jacobpress, cli, 2026-09-15)
  > From the 2026-09-06 backlog. The folder holds the UI audit and is created by layout.ts, but no story or page narrates it.
- evidence-viewer-inline: Render evidence images and text inline with a size guard and a redaction check before commit (jacobpress, cli, 2026-09-15)
  > From the 2026-09-06 backlog. The client only links out, sandboxed serving is already done, and screenshots are committed raw with no cap.
- container-view: One view placing apps, entry points and external services together (jacobpress, cli, 2026-09-15)
  > From the 2026-09-06 backlog. containerView draws areas only; services and entry points live on other pages.
- route-detection-more-languages: Route and entry-point detection for Go, Swift and Kotlin on the existing Flows page (jacobpress, cli, 2026-09-15)
  > From the 2026-09-06 backlog; deferred with language support on 2026-09-15.
- claude-md-staleness-pass: Check curated CLAUDE.md lines against the graph and report which drifted (jacobpress, cli, 2026-09-15)
  > From the 2026-09-06 backlog. docs check compares whole generated blocks; curated sections are extracted and never matched.
- curated-flows: Declare curated flows in notes or config so non-route scenarios get traced, with a Mermaid serialiser (jacobpress, cli, 2026-09-15)
  > From the 2026-09-06 backlog. flows.ts detects only cloudflare, http, next, cli, mcp and main entries.
- graph-facts-in-generated-block: Put graph and note facts into the generated CLAUDE.md block (jacobpress, cli, 2026-09-15)
  > From the 2026-09-06 backlog. renderGeneratedBlock is a pure function of RepoFacts today. Decide the boundary with the MCP derived layer.
- context-pack-omits-intake-line: The context pack for an ungroomed item never includes its intake line or detail, though the shaping prompt says to work from them (jacobpress, cli, 2026-09-15)
  > Found 2026-09-15 while preparing shaping sessions: context.ts reads brief.md and plan.md for a slug and never .reggie/intake.md, so for an ungroomed item the pack is only the repo notes and the working agreement. The session has to open intake.md itself and misses the dated decision details. Fix: render the intake line and its detail lines at the top of the pack when no brief exists, and the brief when it does.
- intake-line-leaves-at-triage: Remove the intake line at triage instead of at plan done, and report a scaffolded but unfilled brief as ungroomed (jacobpress, cli, 2026-09-15)
  > Decided 2026-09-15. Today removeFromIntake runs only from reggie plan done (cli.ts, capture.ts), and tasks.ts and ui-api-contract.md describe triage as keeping the line. Move the removal into triage, reword the state rule and the contract, and derive ungroomed from a scaffolded brief that fails lint, with the reason naming the draft. Precondition for needs-you-queue.
- session-name-reads-real-id: sessionName falls back to the word session, so claim records and journal files written from inside a session carry no real session id (jacobpress, cli, 2026-09-15)
  > Split out of derive-the-journal on 2026-09-15 as its own small slice, to land before it. Read CLAUDE_CODE_SESSION_ID (the id that names the transcript file) with REGGIE_SESSION as override; launch already writes its minted uuid into the claim record. Ends the shared day-file name that the journal collision item works around.
- npm-ci-without-legacy-peer-deps: packages/reggie needs npm ci --legacy-peer-deps because of a vitest 4 peer conflict; fix the dependency set so plain npm ci works (jacobpress, cli, 2026-09-15)
  > Split out of the worktree-dependencies brief on 2026-09-15: the install config key keeps the flag for now; this item removes the need for it.
- file-page-for-unread-file: A file the graph did not read (a Go or Swift file, or one outside CODE_EXT) answers 404 on its file page instead of saying why it has no node (jacobpress, cli, 2026-09-15)
  > Found while shaping graph-coverage-published on 2026-09-15. fileStory returns null and the route answers 404; the page should say the language is not read yet and link the coverage sentence.
- reggie-packet-pairs-evidence-files-with-acceptan: reggie packet pairs evidence files with acceptance criteria round-robin (jacobpress, cli, 2026-09-15)
  > Seen 2026-09-15 on stale-dev-bin: with four evidence files and eleven criteria, the scaffold assigned the files to the first four criteria in order and left the rest as placeholders, so criterion 1 (a unit test) pointed at the docs grep. A reader trusting the scaffold would approve against the wrong proof. It should leave every evidence line as a placeholder, or match on the plan's Verification strategy lines.
- when-decide-approved-performs-the-merge-in-solo: When decide approved performs the merge in solo mode, decide still appends its journal entry to the serving checkout uncommitted, right before merging. If the task branch touched the same day file, git refuses the merge. Commit that entry before merging, or write it after the merge. (jacobpress, cli, 2026-09-15)
- the-packet-scaffold-pairs-each-acceptance-criter: The packet scaffold pairs each acceptance criterion with an evidence file by position, so the first criterion is pointed at whichever evidence file sorts first. On the attribution packet it pointed a parser criterion at the conflict transcript. The hint should be blank or matched to the Verification strategy line that names the file. (jacobpress, cli, 2026-09-15)
- the-web-page-s-own-writes-notes-journal-entries: The web page's own writes (notes, journal entries, triage, capture) leave the serving checkout with uncommitted changes, and a solo Approve now merges, so it refuses until someone commits them by hand. The page should either commit its own metadata writes on the base branch or offer to commit them before landing. (jacobpress, cli, 2026-09-15)
