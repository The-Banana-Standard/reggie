# Contributing to Reggie

Thanks for your interest in contributing. Reggie is a personal system shared openly — contributions that improve it for everyone are welcome.

## How to Contribute

1. **Fork** the repository
2. **Create a branch** for your change (`git checkout -b my-change`)
3. **Make your changes**
4. **Test** by running `./install.sh` and verifying your changes work in Claude Code
5. **Submit a pull request**

## What You Can Contribute

### Agents
- New agents for uncovered specialties
- Improvements to existing agent prompts (quality standards, common pitfalls, process)
- Bug fixes in agent logic

### Commands
- New commands for workflows not yet covered
- Improvements to existing command instructions
- Bug fixes in command context scripts

### Documentation
- Clarifications and corrections
- New guides and tutorials
- Examples and use cases

### Bug Fixes
- Fix broken cross-references between agents/commands
- Fix incorrect tool permissions in agent frontmatter
- Fix outdated counts or references

## Guidelines

- **Follow existing patterns.** Read 2-3 similar files before creating new ones. Agents follow: Role → Core Responsibilities → Process → Quality Standards → Output Format → Common Pitfalls.
- **Keep it concise.** Agents and commands should be as short as possible while being complete.
- **Test your changes.** Install locally and verify the agent/command works in Claude Code.
- **One change per PR.** Don't bundle unrelated changes.

## Review Process

- All PRs are reviewed by the maintainer
- No direct pushes to main
- Expect feedback on prompt quality, consistency with existing patterns, and integration completeness

## Questions?

Open an issue if you're unsure about an approach before investing time in a PR.
