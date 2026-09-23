# notes — knowledge arranged like the code

Find information about a path by opening the same path here:

- `notes/src/auth/login.ts.md` describes `src/auth/login.ts`
- `notes/src/auth/_dir.md` describes the `src/auth/` folder
- `notes/_repo.md` describes the whole repo
- `notes/_entities/<kind>/<name>.md` describes things that are not files:
  `store/` for databases and collections, `route/` for endpoints and screens,
  `service/` for external services, `env/` for environment variables.
- `notes/_symbols/<source-path>/<qualified-symbol>.md` describes one function,
  class, constructor, or method using its stable `sym:<path>::<qualified-name>` ID.

Each note file can hold a replaceable **current understanding** with a source
fingerprint and revision token, followed by append-only dated entries and update
history. A changed fingerprint marks current prose stale; only an explicit edit
or generation request refreshes it. Each dated entry has a type, an author, a
confidence, and the sources it came from. Types:

- **why** — why this exists or is shaped this way
- **how** — how it works, in plain words
- **gotcha** — what will bite you
- **verify** — how to prove it works
- **data-source** — where its data comes from and goes
- **decision** — a choice that was made, and the alternative that was not

An entry is stale when the code it describes changed after the entry was written.
`reggie note stale` lists those. Correct or confirm them; do not delete history.

Add an entry with `reggie note add <path> --type gotcha "text"` or ask your agent to.
