# Update CLAUDE.md

Add a learning or rule to the project's CLAUDE.md file.

## Context

```bash
echo "=== Current CLAUDE.md ==="
if [ -f "CLAUDE.md" ]; then
  cat CLAUDE.md
else
  echo "No CLAUDE.md found in project root"
fi
```

## Instructions

Add the following to CLAUDE.md: $ARGUMENTS

### Guidelines

- Keep entries concise and actionable
- Format as a rule Claude can follow: "Do X" or "Don't do Y"
- Include context if the rule isn't obvious
- Group with related existing rules if applicable

### If no CLAUDE.md exists

Create one with this structure:
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
```

Then add the new learning to the appropriate section.

### If CLAUDE.md exists

Add the new rule to the most appropriate section. If no section fits, add a new one.

Confirm the addition by showing the updated section.

