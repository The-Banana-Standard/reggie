# Security Review

Run a security-focused audit on the current task's changes.

## Context

```bash
echo "=== Current Task ==="
if [ -f "TASKS.md" ]; then
  cat TASKS.md
fi

echo ""
echo "=== Changed Files ==="
git diff --name-only HEAD~1 2>/dev/null || git diff --name-only --cached 2>/dev/null || echo "No changes detected"

echo ""
echo "=== Security-Relevant Files ==="
git diff --name-only HEAD~1 2>/dev/null | grep -iE "(auth|security|rules|config|env|api|route|middleware|handler)" || echo "None detected"

echo ""
echo "=== Dependency Changes ==="
git diff HEAD~1 -- package.json go.mod requirements.txt Podfile 2>/dev/null | head -30 || echo "No dependency changes"
```

## Instructions

Use the **security-reviewer** agent to audit the current task's changes for security vulnerabilities.

This runs **after the code review passes** (`/code-review` → PASS → `/review-security`).

### What Gets Audited

- **Secrets**: API keys, tokens, passwords, credentials in code or config
- **Injection**: SQL, XSS, command injection, path traversal on all input paths
- **Auth/Authz**: Authentication enforced, authorization checked, proper token handling
- **Data handling**: PII in logs, encryption, secure cookies, CORS
- **Dependencies**: Known CVEs in new or updated packages
- **Infrastructure**: Security rules, headers, CSP, HTTPS

### Process

1. Identify security-relevant files in the diff
2. Scan for hardcoded secrets
3. Trace every user input to its destination (injection analysis)
4. Verify auth/authz on all protected routes
5. Check new dependencies for known vulnerabilities
6. Produce structured security report

### Quality Gate

The review is scored by the judge agent (9.0/10 to advance). If it fails:
- CRITICAL and HIGH findings must be fixed
- Review runs again after fixes
- Standard escalation: iterate → researcher → auto-tournament → user

### Verdict

- **PASS**: No critical or high findings. Advances to SYNC-DOCS.
- **FAIL**: Critical/high findings listed with exploit examples and specific fixes. Goes back to IMPLEMENT.

### Usage

```
/review-security                # Security audit current task's changes
/review-security $ARGUMENTS     # Audit with specific focus
```

### After Review

If PASS:
```
Security review passed. Proceeding to documentation sync.
Run: /sync-docs to continue pipeline
```

If FAIL:
```
Security review found [N] critical/high issues:
- [file:line]: [vulnerability] — [exploit example]

Fix these and re-run /review-security.
```

