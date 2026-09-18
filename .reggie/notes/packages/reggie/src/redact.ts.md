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

## gotcha · 2026-09-18 · Claude via jacobpress · high
The redactor's regexes are a security boundary and were rewritten on 2026-09-18 after an independent review found many bypasses. The order is: strip invisible characters first (so a key split by a zero-width joiner or a soft hyphen rejoins and is seen), then drop code blocks (fences under list and quote markers, indented code, <pre> too), then redact, then flatten, then redact again, then cut. A name=value secret is withheld to the end of the line, so a passphrase with spaces or a value with a comma goes whole; the cost is that trailing prose on that line goes too. Every quantifier is bounded and the raw input is capped to 32 KB before the passes, because an unbounded name pattern took eleven seconds on 8 KB of a hostile commit subject; after the fix the 1 MB line ceiling case runs in about ten milliseconds. Never write a control or invisible character literally in this file: build the class from escapes in code, because the editor decodes a literal escape once and puts a raw line-separator into the source that breaks the parser.
sources: derive-the-journal

## decision · 2026-09-18 · Claude via jacobpress · high
What the redactor is documented not to catch, so the boundary is a decision and not an accident: a secret spoken in prose, a value passed as a bare flag (--password X, curl -u a:b), a key with no known prefix and no mixed case (hex or UUID keys, anything short), a phone, an IP, an internal hostname, an obfuscated email, a client or person name, a relative path holding a username, a URL password containing a close-paren (a paren ends URLs in prose), and a token split by a real newline. These are asserted as a limits table in redact.test.ts so that a future change which starts catching one is noticed, and they are stated plainly in the README and the vision for the owner. The withheld count is the number of shapes recognised, not a measure of safety; the real safeguard is that the verb never commits.
sources: derive-the-journal

