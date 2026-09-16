---
entity: packages/reggie/src/graph.test.ts
kind: file
---

## gotcha · 2026-09-15 · Claude via jacobpress · high
A fixture written in this file can change what the repo page says about this repo. The scanner that finds imports is not anchored to a line, so a require call or a dynamic import written out in full, even inside a string or a comment, is read as a real import of this file. Two such literals in the import-parsing test are the entire reason this repo publishes two imports that point at no file. When a new fixture needs one, build the specifier by interpolation so this file's own text does not contain the call; a literal silently moves the number on the landing page. The wider problem is captured as its own item.
sources: packages/reggie/src/graph.test.ts, graph-coverage-published

