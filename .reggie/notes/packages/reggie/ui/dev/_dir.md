---
entity: packages/reggie/ui/dev/
kind: dir
---

## gotcha · 2026-09-15 · Claude via jacobpress · high
Not every sample here is generated. The script writes the container, dir, dir-tests, impact, blast and workspace payloads; the story and explain payloads are hand-written and have no generator and no test reading them, so a wording change in the story code does not reach them and the dev harness keeps rendering the old sentence until someone edits them by hand. When you change a sentence, grep the whole repo for the phrase you retired. Keep the hand-written numbers consistent with the aggregates the same areas carry in the container sample.
sources: packages/reggie/ui/dev/gen-samples.mjs, false-tests-sentence

## gotcha · 2026-09-15 · Claude via jacobpress · high
The generated samples take the repo's coverage figures from one shared constant in the generator, so every level's counts block agrees. The story sample has no generator and carries the coverage paragraph by hand, with numbers that must stay consistent with the container sample's counts: the files read plus the files skipped is the total the sentence names. Change one and change the other in the same commit.
sources: packages/reggie/ui/dev/gen-samples.mjs, graph-coverage-published

