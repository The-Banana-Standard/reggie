# Update Project Documentation

Add a learning, rule, or convention to the project's CLAUDE.md or foundational docs.

## Context

```bash
echo "=== Current CLAUDE.md ==="
if [ -f "CLAUDE.md" ]; then
  cat CLAUDE.md
else
  echo "No CLAUDE.md found in project root"
fi

echo ""
echo "=== Foundational Docs ==="
for doc in architecture.md patterns.md styling-guide.md data-models.md getting-started.md contributing.md; do
  if [ -f "docs/$doc" ]; then echo "docs/$doc: exists"; else echo "docs/$doc: missing"; fi
done
```

## Instructions

Add the following to the appropriate project documentation: $ARGUMENTS

Determine which document the learning belongs in:
- **CLAUDE.md** — Project-wide rules, commands, key files, agent preferences
- **docs/architecture.md** — System design decisions, component boundaries, data flow changes
- **docs/patterns.md** — Coding conventions, new approved/anti patterns, error handling approaches
- **docs/styling-guide.md** — Visual design decisions, color/typography/spacing changes
- **docs/data-models.md** — Schema changes, new models, relationship updates
- **docs/getting-started.md** — Setup changes, new prerequisites, environment configuration
- **docs/contributing.md** — Workflow changes, branch conventions, PR process updates

If the learning is a general project rule, it goes in CLAUDE.md. If it's specific to a domain (architecture, patterns, UI, data), route it to the appropriate foundational doc.

### Guidelines

- Keep entries concise and actionable
- Format as a rule Claude can follow: "Do X" or "Don't do Y"
- Include context if the rule isn't obvious
- Group with related existing rules if applicable

### If no CLAUDE.md exists

Warn the user: "No CLAUDE.md found. Consider running `/reggie-onboard` to generate CLAUDE.md and all foundational docs."

If the user wants to proceed without onboarding, create a minimal CLAUDE.md:
```markdown
# CLAUDE.md

## Project Overview
[Brief description]

## Commands
[Common commands for this project]

## Rules
[Things Claude should do or avoid]

## Patterns
[Preferred patterns in this codebase]

## Documentation
See `docs/` for detailed documentation (run `/reggie-onboard` to generate).
```

Then add the new learning to the appropriate section.

### If the target foundational doc doesn't exist

If the learning should go in a foundational doc that doesn't exist yet (e.g., `docs/patterns.md`), add it to CLAUDE.md instead and note: "This convention is documented in CLAUDE.md. Run `/reggie-onboard` to generate `docs/patterns.md` for a dedicated home."

### If CLAUDE.md exists

Add the new rule to the most appropriate section. If no section fits, add a new one.

Confirm the addition by showing the updated section.

