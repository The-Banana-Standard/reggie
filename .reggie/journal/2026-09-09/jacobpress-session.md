# Journal · 2026-09-09 · jacobpress · session

Plain-English record of what happened, written as it happened. No file paths in the prose; link evidence instead.

### 01:35 · jacobpress · claude · - · build
The tasks page was only showing what Reggie itself had captured, so on a repo with a real hand-written backlog it showed four items over two hundred. It now reads that backlog in place — the open file, the finished file, and the old folder of per-task plans — and never writes to any of them. Every line in both files on the test repo comes through exactly once, checked against an independent scan. The Services and Data flow tabs were not broken: the copy of Reggie on the PATH was a build from before those endpoints were written, and nothing said so, so commands now warn when the build is behind the source. The web view also picked up the desktop app's identity: the mascot, the orange accent, and the wordmark, kept to the chrome so no colour on the map changes meaning.
evidence: packages/reggie/src/legacy.test.ts

