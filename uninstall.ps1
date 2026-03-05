# uninstall.ps1 — Remove Reggie from ~/.claude/ (Windows)
$ErrorActionPreference = "Stop"

$ClaudeDir = Join-Path $env:USERPROFILE ".claude"

Write-Host "Uninstalling Reggie..."
Write-Host ""

# 1. Remove symlinks — directories
foreach ($item in @("agents", "commands", "hooks")) {
    $target = Join-Path $ClaudeDir $item
    if ((Test-Path $target) -and ((Get-Item $target).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        Remove-Item -Force $target
        Write-Host "Removed $item symlink"
    }
}

# 2. Remove symlinks — files
foreach ($item in @("REGGIE.md", "PORTABLE-PACKAGE.md", "agents-is-all-you-need.md", "reggie-quickstart.md", "mcp-registry.yaml", "skills-registry.yaml")) {
    $target = Join-Path $ClaudeDir $item
    if ((Test-Path $target) -and ((Get-Item $target).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        Remove-Item -Force $target
        Write-Host "Removed $item symlink"
    }
}
# Legacy cleanup: old installs symlinked this file. Keep regular files untouched.
$LegacyManifest = Join-Path $ClaudeDir "capability-manifest.yaml"
if ((Test-Path $LegacyManifest) -and ((Get-Item $LegacyManifest).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    Remove-Item -Force $LegacyManifest
    Write-Host "Removed legacy capability-manifest.yaml symlink"
}

# 3. Restore from backup if available
$LatestBackup = Get-ChildItem -Path (Join-Path $ClaudeDir "backups") -Directory -Filter "pre-reggie-*" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($LatestBackup) {
    Write-Host ""
    Write-Host "Restoring from backup: $($LatestBackup.FullName)"
    foreach ($item in @("agents", "commands", "hooks")) {
        $src = Join-Path $LatestBackup.FullName $item
        if (Test-Path $src) {
            Copy-Item -Recurse -Path $src -Destination (Join-Path $ClaudeDir $item) -ErrorAction SilentlyContinue
        }
    }
    foreach ($item in @("REGGIE.md", "PORTABLE-PACKAGE.md", "agents-is-all-you-need.md", "reggie-quickstart.md", "mcp-registry.yaml", "skills-registry.yaml")) {
        $src = Join-Path $LatestBackup.FullName $item
        if (Test-Path $src) {
            Copy-Item -Path $src -Destination (Join-Path $ClaudeDir $item) -ErrorAction SilentlyContinue
        }
    }
} else {
    Write-Host ""
    Write-Host "No backup found. Creating empty directories."
    New-Item -ItemType Directory -Path (Join-Path $ClaudeDir "agents") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $ClaudeDir "commands") -Force | Out-Null
}

# 4. Remove stats hooks from settings.json
$SettingsFile = Join-Path $ClaudeDir "settings.json"
$HookCmd = "`$HOME/.claude/hooks/track-stats.sh"

if (Test-Path $SettingsFile) {
    $settings = Get-Content -Raw $SettingsFile | ConvertFrom-Json

    if ($settings.hooks -and $settings.hooks.PostToolUse) {
        $filtered = @($settings.hooks.PostToolUse | Where-Object {
            $dominated = $false
            foreach ($h in @($_.hooks)) {
                if ($h.command -eq $HookCmd) { $dominated = $true }
            }
            -not $dominated
        })

        if ($filtered.Count -eq 0) {
            $settings.hooks.PSObject.Properties.Remove("PostToolUse")
        } else {
            $settings.hooks.PostToolUse = $filtered
        }

        # Clean up empty hooks object
        if (($settings.hooks.PSObject.Properties | Measure-Object).Count -eq 0) {
            $settings.PSObject.Properties.Remove("hooks")
        }

        $settings | ConvertTo-Json -Depth 10 | Set-Content -Path $SettingsFile -Encoding UTF8
        Write-Host "Removed stats hooks from settings.json"
    }
}

# 5. Remove ENABLE_TOOL_SEARCH from PowerShell profile
$PsProfile = $PROFILE
if ($PsProfile -and (Test-Path $PsProfile)) {
    $content = Get-Content $PsProfile
    $filtered = $content | Where-Object {
        $_ -notmatch 'ENABLE_TOOL_SEARCH' -and $_ -notmatch '# Reggie: defer MCP tool schemas'
    }
    if ($filtered.Count -ne $content.Count) {
        $filtered | Set-Content -Path $PsProfile -Encoding UTF8
        Write-Host "Removed ENABLE_TOOL_SEARCH from PowerShell profile"
    }
}

Write-Host ""
Write-Host "Reggie uninstalled."
