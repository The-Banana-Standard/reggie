# Open Source Release Checklist

This checklist captures the remaining operational steps that are intentionally not automated in this repo.

## 1. Preflight

- Confirm `resources/registries/mcp-registry.yaml` and `resources/registries/skills-registry.yaml` are tracked.
- Confirm `.claude/` and `capability-manifest.yaml` are ignored and untracked.
- Confirm install/uninstall docs match current behavior.
- Confirm security baseline files exist (`SECURITY.md`, `.github/CODEOWNERS`, CI workflows).

## 2. Purge Historical Runtime Data

Run in a clean clone with backups available:

```bash
# Install git-filter-repo if needed
# https://github.com/newren/git-filter-repo

git filter-repo --force \
  --invert-paths \
  --path .claude/
```

Then verify:

```bash
git log --all -- .claude
```

Expected: no history entries.

## 3. Push Rewritten History

```bash
git push origin --force --all
git push origin --force --tags
```

After push:
- Ask collaborators to re-clone or hard reset their clones to the rewritten history.
- In GitHub UI, confirm `.claude/` paths are no longer accessible in commit history.

## 4. GitHub Security Settings (Manual)

Enable in repository settings:
- Private vulnerability reporting
- Secret scanning
- Secret scanning push protection
- Dependabot alerts
- Branch protection on `main` requiring CODEOWNERS review

## 5. First Stable Release

```bash
git tag -a v1.1.0 -m "Reggie v1.1.0"
git push origin v1.1.0
```

Create GitHub Release from `v1.1.0` and mark it as the default stable install target in docs.

## 6. Post-Release Verification

- Follow stable install docs from a fresh environment.
- Run `/reggie-find-tools --check` and `/reggie-refresh-capabilities --check` to confirm expected local file behavior.
- Verify CI workflows are green on the release tag.
