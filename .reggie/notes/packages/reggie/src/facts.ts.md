---
entity: packages/reggie/src/facts.ts
kind: file
---

## decision · 2026-09-15 · Claude via jacobpress · high
Whether a file is code is decided in exactly one place: codeLanguageOf, which returns the language table's answer unless that language is in NON_CODE_LANGUAGES. The rule is that a file is code when a person wrote it as part of how the product behaves or looks, and is not code when it describes or configures the product, so stylesheets, markup, shell and SQL are code and Markdown, JSON, YAML and TOML are not. It exists because the coverage claim on the repo page needs a denominator: counting every tracked file says this repo skipped 137 of 223 and counting every recognised language says 129 of 215 with 96 of them Markdown, and a disclaimer a reader learns to ignore is worse than none. Markup and stylesheets stay in on purpose, because dropping them would tell a static-site repo that Reggie read all of nothing. The workspace module keeps its own narrower table and was deliberately left alone; that duplication is captured as its own item.
sources: packages/reggie/src/facts.ts, graph-coverage-published

