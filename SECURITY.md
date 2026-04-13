# Security Policy

## Supported Versions

Reggie supports the following release channels:

| Channel | Supported |
|---------|-----------|
| Latest tagged release | Yes |
| `main` (edge) | Best effort |
| Older tags | No |

## Reporting a Vulnerability

Please do not open public issues for security vulnerabilities.

1. Use GitHub private vulnerability reporting for this repository.
2. Include reproduction steps, impact, and any known mitigations.
3. If relevant, include affected files/paths and environment details.

If private reporting is unavailable, contact the maintainers directly and mark the report as security-sensitive.

## Response Targets

- Initial triage response: within 5 business days
- Confirmation and severity assessment: within 10 business days
- Remediation timeline: based on severity and exploitability

## Scope

In scope:
- Hooks and automation scripts (`resources/hooks/`)
- Registry files and capability plumbing (`resources/registries/mcp-registry.yaml`, `resources/registries/skills-registry.yaml`, capability refresh flows)
- Agent/command definitions that can affect execution safety
- Tauri app Rust code under `src-tauri/src/` — in particular `installer.rs` (writes to `~/.claude/` and shell profile), `commands/terminal.rs` (PTY spawning with user PATH), and `commands/skills.rs` (path traversal validation for skill IDs)
- Tauri command surface generally — file system, process, and shell profile access exposed to the webview

Out of scope:
- Third-party services and external MCP providers themselves
- Local machine misconfiguration unrelated to Reggie code
- Issues requiring physical access to a developer machine

## Disclosure

Please allow maintainers time to validate and patch before public disclosure.
