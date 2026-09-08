# Journal · 2026-09-08 · jacobpress · session

Plain-English record of what happened, written as it happened. No file paths in the prose; link evidence instead.

### 13:50 · jacobpress · claude · tasks-page · build
Split grooming into two phases, because shaping a task and planning it are different work: shaping is cheap, happens in bulk, and needs no code reading, while planning is expensive and one at a time. A task now goes capture, shape, plan, build. The board grew a page that can start the work: shape a whole column of raw items at once, launch planning or implementation in either tool, or open a discussion whose prompt forbids editing anything. Finished tasks show the verdict, each criterion with its evidence, the diff and the journal. One real bug came out of building it: starting a session could hang the whole server, because macOS asks permission to drive Terminal and nobody was bounding the wait.

### 19:28 · jacobpress · claude · services-and-flows · build
Added two derived pages. One shows what a repo talks to: every binding, table, queue and outbound API, with the manifest line that declares it and the files that read or write it, and it puts the mismatches first because a name the code needs that nothing declares is invisible until it breaks. The other traces data from an entry point to its sinks and writes the payload on every edge, saying plainly whether each shape was read from the code or merely inferred from a signature. Building it caught a lie worth catching: a traced flow was reporting a service that no drawn step reached, because the step that would have shown it had been dropped by a cap.

