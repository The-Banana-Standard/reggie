---
entity: packages/reggie/src/redact.ts
kind: file
---

## how · 2026-09-17 · Claude via jacobpress · high
Everything a passage goes through before it may be written into the journal, and so into git: fenced code blocks and table rows are dropped whole, secret shapes and addresses and local paths become the fixed word [withheld] and are counted, the rest is flattened to one line of plain prose, the patterns run once more over the flat line, double square brackets are pulled apart, and the result is cut to 800 characters at a sentence end. The order matters: redaction runs before flattening because a flattener that ran first would take the underscore out of a key prefix and the pattern would no longer know it. One line is what makes forging an entry header, a trailer or a front matter fence impossible rather than unlikely. Commit subjects and a model reply go through the same function as a quotation.
sources: derive-the-journal

## gotcha · 2026-09-17 · Claude via jacobpress · high
Neither the kind filter nor these patterns is a guarantee: an assistant can repeat something private in words no pattern knows. The patterns err toward withholding on purpose (a path carries on across a space when the next word runs into a slash, a name and value pair takes trailing punctuation with it), but a bare leading slash is not a path, because routes like the journal route are common in closing messages. Measured on 2026-09-17 over all 1,561 real closing messages on the owner's machine, counts only: 7 percent had something withheld, so the filter does not cry wolf. The same run showed the plan's size assumption was wrong: the median real closing message is 2,111 characters, not 146, so 78 percent of quotations are cut at the limit. Write control characters in this file as escapes built by code, never literally: an editor that decodes escapes once put raw NUL and bidirectional characters into the source.
sources: derive-the-journal

