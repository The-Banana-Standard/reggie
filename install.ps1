# install.ps1 — Install Reggie into ~/.claude/ (additive, per-file symlinks, Windows)
$ErrorActionPreference = "Stop"

$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = Join-Path $env:USERPROFILE ".claude"

Write-Host "Installing Reggie from $RepoDir"
Write-Host ""

# 1. Ensure target directories exist
foreach ($dir in @("agents", "commands", "hooks")) {
    $dirPath = Join-Path $ClaudeDir $dir
    if (-not (Test-Path $dirPath)) {
        New-Item -ItemType Directory -Path $dirPath -Force | Out-Null
    }
}

# 2. Migration: if agents/ or commands/ are directory-level symlinks (old install),
#    remove them and create fresh directories.
foreach ($dir in @("agents", "commands", "hooks")) {
    $dirPath = Join-Path $ClaudeDir $dir
    if ((Test-Path $dirPath) -and ((Get-Item $dirPath).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        Write-Host "Migrating from old directory-level symlink: $dir/"
        Remove-Item -Force $dirPath
        New-Item -ItemType Directory -Path $dirPath -Force | Out-Null
    }
}

# Helper: create a symlink, backing up existing non-symlink files
function Install-ReggieSymlink {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (Test-Path $Destination) {
        $item = Get-Item $Destination
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            $linkTarget = $item.Target
            if ($linkTarget -eq $Source) {
                return $true  # Already correct
            }
            Remove-Item -Force $Destination
        } else {
            # Regular file — back it up
            $backupPath = "$Destination.pre-reggie-backup"
            Write-Host "  Backing up existing $(Split-Path -Leaf $Destination) -> $(Split-Path -Leaf $backupPath)"
            Move-Item -Path $Destination -Destination $backupPath
        }
    }

    New-Item -ItemType SymbolicLink -Path $Destination -Target $Source | Out-Null
    return $true
}

# 3. Symlink individual agent files
$AgentCount = 0
foreach ($file in Get-ChildItem -Path (Join-Path $RepoDir "agents") -Filter "*.md") {
    $dest = Join-Path $ClaudeDir "agents" $file.Name
    if (Install-ReggieSymlink -Source $file.FullName -Destination $dest) {
        $AgentCount++
    }
}

# 4. Symlink individual command files
$CmdCount = 0
foreach ($file in Get-ChildItem -Path (Join-Path $RepoDir "commands") -Filter "*.md") {
    $dest = Join-Path $ClaudeDir "commands" $file.Name
    if (Install-ReggieSymlink -Source $file.FullName -Destination $dest) {
        $CmdCount++
    }
}

# 5. Symlink individual hook files
$HookCount = 0
foreach ($file in Get-ChildItem -Path (Join-Path $RepoDir "hooks") -File) {
    $dest = Join-Path $ClaudeDir "hooks" $file.Name
    if (Install-ReggieSymlink -Source $file.FullName -Destination $dest) {
        $HookCount++
    }
}

# 6. Symlink standalone files
$standaloneFiles = @{
    "REGGIE.md"              = Join-Path $RepoDir "REGGIE.md"
    "PORTABLE-PACKAGE.md"    = Join-Path $RepoDir "docs\PORTABLE-PACKAGE.md"
    "agents-is-all-you-need.md" = Join-Path $RepoDir "docs\agents-is-all-you-need.md"
    "reggie-quickstart.md"   = Join-Path $RepoDir "docs\reggie-quickstart.md"
    "mcp-registry.yaml"      = Join-Path $RepoDir "mcp-registry.yaml"
    "skills-registry.yaml"   = Join-Path $RepoDir "skills-registry.yaml"
}

foreach ($entry in $standaloneFiles.GetEnumerator()) {
    $dest = Join-Path $ClaudeDir $entry.Key
    Install-ReggieSymlink -Source $entry.Value -Destination $dest | Out-Null
}

# Legacy cleanup: old installs symlinked this file. Keep regular files untouched.
$LegacyManifest = Join-Path $ClaudeDir "capability-manifest.yaml"
if ((Test-Path $LegacyManifest) -and ((Get-Item $LegacyManifest).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    Remove-Item -Force $LegacyManifest
}

Write-Host ""
Write-Host "Reggie installed successfully (additive, per-file symlinks)."
Write-Host ""
Write-Host "  Agents:   $AgentCount files symlinked"
Write-Host "  Commands: $CmdCount files symlinked"
Write-Host "  Hooks:    $HookCount files symlinked"
Write-Host ""
Write-Host "  Standalone files:"
Write-Host "    REGGIE.md              -> $RepoDir\REGGIE.md"
Write-Host "    PORTABLE-PACKAGE.md    -> $RepoDir\docs\PORTABLE-PACKAGE.md"
Write-Host "    agents-is-all-you-need.md -> $RepoDir\docs\agents-is-all-you-need.md"
Write-Host "    reggie-quickstart.md   -> $RepoDir\docs\reggie-quickstart.md"
Write-Host "    mcp-registry.yaml      -> $RepoDir\mcp-registry.yaml"
Write-Host "    skills-registry.yaml   -> $RepoDir\skills-registry.yaml"
Write-Host ""
Write-Host "  Local generated file:"
Write-Host "    capability-manifest.yaml (created/updated by /reggie-refresh-capabilities)"
Write-Host ""
Write-Host "  User files in ~/.claude/agents/ and ~/.claude/commands/ are preserved."
Write-Host ""

# 7. Optional local overlay files for user-specific additions
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

# 8. Add stats hooks to settings.json
$SettingsFile = Join-Path $ClaudeDir "settings.json"
$HookCmd = "`$HOME/.claude/hooks/track-stats.sh"

if (-not (Test-Path $SettingsFile)) {
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

# 9. Configure ENABLE_TOOL_SEARCH in PowerShell profile
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
Write-Host "  /reggie-guide I just ran install.ps1 what do I do now?"
Write-Host ""
