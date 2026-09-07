# Journal · 2026-09-07 · jacobpress · session

Plain-English record of what happened, written as it happened. No file paths in the prose; link evidence instead.

### 03:05 · jacobpress · claude · repo-manager-mvp · build
Added a first local web view because there was nothing to look at yet. The server draws the repo's import graph with note coverage and task plans overlaid, and lists tasks, notes, and the journal. On this repo it found one hundred forty files and three hundred forty-one imports; the most imported modules are the new package's paths and util helpers and the legacy terminal types. Only two files have notes so far, which the graph makes obvious.

### 19:46 · jacobpress · claude · repo-manager-ui · build
Rebuilt the web view as the Guidebook: a plain-English story column beside a map that stays in step with it, with levels from the workspace down to a file and no canvas ever drawing more than about forty nodes. Four designs competed and three judges picked this one. Verification ran in a real browser rather than on assertion, and it caught things the builders had claimed were done: the map did not refit when its pane changed size, a file with two neighbours drew a nearly empty canvas, the legend named a colour that two different nodes shared, and a node whose history was unknown was labelled as having no commits. All of those are fixed and measured. The commit history here is too thin for the heat view to say much over a month, so it now widens its window until the numbers separate and says which window it used.

