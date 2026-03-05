# install.ps1 — Install Reggie into ~/.claude/ (Windows)
$ErrorActionPreference = "Stop"

$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = Join-Path $env:USERPROFILE ".claude"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $ClaudeDir "backups\pre-reggie-$Timestamp"

Write-Host "Installing Reggie from $RepoDir"
Write-Host ""

# 1. Ensure ~/.claude/ exists
if (-not (Test-Path $ClaudeDir)) {
    New-Item -ItemType Directory -Path $ClaudeDir -Force | Out-Null
}

# 2. Back up existing content if it exists (and isn't already a symlink to this repo)
$NeedsBackup = $false
foreach ($item in @("agents", "commands", "hooks", "REGGIE.md")) {
    $target = Join-Path $ClaudeDir $item
    if ((Test-Path $target) -and -not ((Get-Item $target).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        $NeedsBackup = $true
        break
    }
}

if ($NeedsBackup) {
    Write-Host "Backing up existing files to $BackupDir"
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    foreach ($item in @("agents", "commands", "hooks")) {
        $src = Join-Path $ClaudeDir $item
        if ((Test-Path $src) -and -not ((Get-Item $src).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            Copy-Item -Recurse -Path $src -Destination (Join-Path $BackupDir $item) -ErrorAction SilentlyContinue
        }
    }
    foreach ($item in @("REGGIE.md", "PORTABLE-PACKAGE.md", "agents-is-all-you-need.md", "reggie-quickstart.md", "mcp-registry.yaml", "skills-registry.yaml")) {
        $src = Join-Path $ClaudeDir $item
        if ((Test-Path $src) -and -not ((Get-Item $src).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
            Copy-Item -Path $src -Destination (Join-Path $BackupDir $item) -ErrorAction SilentlyContinue
        }
    }
}

# 3. Remove existing dirs/files or symlinks
foreach ($item in @("agents", "commands", "hooks")) {
    $target = Join-Path $ClaudeDir $item
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
}
foreach ($item in @("REGGIE.md", "PORTABLE-PACKAGE.md", "agents-is-all-you-need.md", "reggie-quickstart.md", "mcp-registry.yaml", "skills-registry.yaml")) {
    $target = Join-Path $ClaudeDir $item
    if (Test-Path $target) { Remove-Item -Force $target }
}
# Legacy cleanup: old installs symlinked this file. Keep regular files untouched.
$LegacyManifest = Join-Path $ClaudeDir "capability-manifest.yaml"
if ((Test-Path $LegacyManifest) -and ((Get-Item $LegacyManifest).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    Remove-Item -Force $LegacyManifest
}

# 4. Create symlinks — directories
New-Item -ItemType SymbolicLink -Path (Join-Path $ClaudeDir "agents") -Target (Join-Path $RepoDir "agents") | Out-Null
New-Item -ItemType SymbolicLink -Path (Join-Path $ClaudeDir "commands") -Target (Join-Path $RepoDir "commands") | Out-Null
New-Item -ItemType SymbolicLink -Path (Join-Path $ClaudeDir "hooks") -Target (Join-Path $RepoDir "hooks") | Out-Null

# 5. Create symlinks — files
New-Item -ItemType SymbolicLink -Path (Join-Path $ClaudeDir "REGGIE.md") -Target (Join-Path $RepoDir "REGGIE.md") | Out-Null
New-Item -ItemType SymbolicLink -Path (Join-Path $ClaudeDir "PORTABLE-PACKAGE.md") -Target (Join-Path $RepoDir "docs\PORTABLE-PACKAGE.md") | Out-Null
New-Item -ItemType SymbolicLink -Path (Join-Path $ClaudeDir "agents-is-all-you-need.md") -Target (Join-Path $RepoDir "docs\agents-is-all-you-need.md") | Out-Null
New-Item -ItemType SymbolicLink -Path (Join-Path $ClaudeDir "reggie-quickstart.md") -Target (Join-Path $RepoDir "docs\reggie-quickstart.md") | Out-Null
New-Item -ItemType SymbolicLink -Path (Join-Path $ClaudeDir "mcp-registry.yaml") -Target (Join-Path $RepoDir "mcp-registry.yaml") | Out-Null
New-Item -ItemType SymbolicLink -Path (Join-Path $ClaudeDir "skills-registry.yaml") -Target (Join-Path $RepoDir "skills-registry.yaml") | Out-Null

Write-Host ""
Write-Host "Reggie installed successfully."
Write-Host ""
Write-Host "  Symlinked directories:"
Write-Host "    agents/   -> $RepoDir\agents"
Write-Host "    commands/ -> $RepoDir\commands"
Write-Host "    hooks/    -> $RepoDir\hooks"
Write-Host ""
Write-Host "  Symlinked files:"
Write-Host "    REGGIE.md              -> $RepoDir\REGGIE.md"
Write-Host "    PORTABLE-PACKAGE.md    -> $RepoDir\docs\PORTABLE-PACKAGE.md"
Write-Host "    agents-is-all-you-need.md -> $RepoDir\docs\agents-is-all-you-need.md"
Write-Host "    reggie-quickstart.md   -> $RepoDir\docs\reggie-quickstart.md"
Write-Host "    mcp-registry.yaml      -> $RepoDir\mcp-registry.yaml"
Write-Host "    skills-registry.yaml   -> $RepoDir\skills-registry.yaml"
Write-Host ""
Write-Host "  Local generated file:"
Write-Host "    capability-manifest.yaml (created/updated by /refresh-capabilities)"
Write-Host ""

# 6. Optional local overlay files for user-specific additions
$McpOverlay = Join-Path $ClaudeDir "mcp-registry.local.yaml"
if (-not (Test-Path $McpOverlay)) {
    @'
# Optional local MCP server overrides.
# This file is local-only and should not be committed.
servers: {}
'@ | Set-Content -Path $McpOverlay -Encoding UTF8
    Write-Host "  Created $McpOverlay"
}

$SkillsOverlay = Join-Path $ClaudeDir "skills-registry.local.yaml"
if (-not (Test-Path $SkillsOverlay)) {
    @'
# Optional local community skill overrides.
# This file is local-only and should not be committed.
skills: {}
'@ | Set-Content -Path $SkillsOverlay -Encoding UTF8
    Write-Host "  Created $SkillsOverlay"
}
Write-Host ""

# 7. Add stats hooks to settings.json
$SettingsFile = Join-Path $ClaudeDir "settings.json"
$HookCmd = "`$HOME/.claude/hooks/track-stats.sh"

if (-not (Test-Path $SettingsFile)) {
    # No settings file — create one with just the hooks
    $settings = @{
        hooks = @{
            PostToolUse = @(
                @{
                    matcher = "Task"
                    hooks = @(@{ type = "command"; command = $HookCmd; timeout = 10 })
                },
                @{
                    matcher = "Skill"
                    hooks = @(@{ type = "command"; command = $HookCmd; timeout = 10 })
                },
                @{
                    matcher = "ToolSearch"
                    hooks = @(@{ type = "command"; command = $HookCmd; timeout = 10 })
                }
            )
        }
    }
    $settings | ConvertTo-Json -Depth 10 | Set-Content -Path $SettingsFile -Encoding UTF8
    Write-Host "  Created settings.json with stats hooks"
} else {
    # Settings file exists — merge hooks (idempotent)
    $settings = Get-Content -Raw $SettingsFile | ConvertFrom-Json

    if (-not $settings.hooks) {
        $settings | Add-Member -NotePropertyName "hooks" -NotePropertyValue ([PSCustomObject]@{})
    }
    if (-not $settings.hooks.PostToolUse) {
        $settings.hooks | Add-Member -NotePropertyName "PostToolUse" -NotePropertyValue @()
    }

    $existing = @($settings.hooks.PostToolUse)

    function Test-HookExists($matcher) {
        foreach ($entry in $existing) {
            if ($entry.matcher -eq $matcher) {
                foreach ($h in @($entry.hooks)) {
                    if ($h.command -eq $HookCmd) { return $true }
                }
            }
        }
        return $false
    }

    if (-not (Test-HookExists "Task")) {
        $existing += [PSCustomObject]@{
            matcher = "Task"
            hooks = @([PSCustomObject]@{ type = "command"; command = $HookCmd; timeout = 10 })
        }
    }
    if (-not (Test-HookExists "Skill")) {
        $existing += [PSCustomObject]@{
            matcher = "Skill"
            hooks = @([PSCustomObject]@{ type = "command"; command = $HookCmd; timeout = 10 })
        }
    }
    if (-not (Test-HookExists "ToolSearch")) {
        $existing += [PSCustomObject]@{
            matcher = "ToolSearch"
            hooks = @([PSCustomObject]@{ type = "command"; command = $HookCmd; timeout = 10 })
        }
    }

    $settings.hooks.PostToolUse = $existing
    $settings | ConvertTo-Json -Depth 10 | Set-Content -Path $SettingsFile -Encoding UTF8
    Write-Host "  Added stats hooks to settings.json"
}

# 8. Configure ENABLE_TOOL_SEARCH in PowerShell profile
$PsProfile = $PROFILE
if ($PsProfile -and (Test-Path (Split-Path $PsProfile -Parent))) {
    if (-not (Test-Path $PsProfile)) {
        New-Item -ItemType File -Path $PsProfile -Force | Out-Null
    }
    $profileContent = Get-Content -Raw $PsProfile -ErrorAction SilentlyContinue
    if ($profileContent -notmatch 'ENABLE_TOOL_SEARCH') {
        Add-Content -Path $PsProfile -Value ""
        Add-Content -Path $PsProfile -Value "# Reggie: defer MCP tool schemas for efficiency"
        Add-Content -Path $PsProfile -Value '$env:ENABLE_TOOL_SEARCH = "auto:5"'
        Write-Host "  Added ENABLE_TOOL_SEARCH=auto:5 to $PsProfile"
    } else {
        Write-Host "  ENABLE_TOOL_SEARCH already configured in $PsProfile"
    }
} else {
    Write-Host ""
    Write-Host "  Could not find PowerShell profile path."
    Write-Host "  Manually add to your profile:"
    Write-Host '    $env:ENABLE_TOOL_SEARCH = "auto:5"'
}

Write-Host ""
Write-Host "Reggie installed successfully. Restart Claude Code, then run:"
Write-Host ""
Write-Host "  /reggie-guide I just ran install.sh what do I do now?"
Write-Host ""
