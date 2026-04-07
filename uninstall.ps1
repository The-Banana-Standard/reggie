# uninstall.ps1 — Remove Reggie from ~/.claude/ (only removes Reggie-owned symlinks, Windows)
$ErrorActionPreference = "Stop"

$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = Join-Path $env:USERPROFILE ".claude"
$Removed = 0

Write-Host "Uninstalling Reggie..."
Write-Host ""

# Helper: remove a file only if it's a symlink pointing into the reggie repo
function Remove-IfReggieSymlink {
    param([string]$FilePath)

    if (-not (Test-Path $FilePath)) { return }

    $item = Get-Item $FilePath -ErrorAction SilentlyContinue
    if (-not $item) { return }

    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        $target = $item.Target
        if ($target -match [regex]::Escape($RepoDir) -or $target -match "reggie[/\\](agents|commands|hooks|docs)[/\\]" -or $target -match "reggie[/\\](REGGIE\.md|mcp-registry\.yaml|skills-registry\.yaml)") {
            Remove-Item -Force $FilePath
            Write-Host "  Removed: $(Split-Path -Leaf $FilePath)"
            $script:Removed++
        }
    }
}

# 1. Remove individual agent symlinks
Write-Host "Checking agents/..."
$agentsDir = Join-Path $ClaudeDir "agents"
if ((Test-Path $agentsDir) -and ((Get-Item $agentsDir).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    # Old directory-level symlink
    Remove-Item -Force $agentsDir
    New-Item -ItemType Directory -Path $agentsDir -Force | Out-Null
    Write-Host "  Removed old directory-level symlink: agents/"
    $Removed++
} elseif (Test-Path $agentsDir) {
    foreach ($file in Get-ChildItem -Path $agentsDir -File) {
        Remove-IfReggieSymlink -FilePath $file.FullName
    }
}

# 2. Remove individual command symlinks
Write-Host "Checking commands/..."
$commandsDir = Join-Path $ClaudeDir "commands"
if ((Test-Path $commandsDir) -and ((Get-Item $commandsDir).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    Remove-Item -Force $commandsDir
    New-Item -ItemType Directory -Path $commandsDir -Force | Out-Null
    Write-Host "  Removed old directory-level symlink: commands/"
    $Removed++
} elseif (Test-Path $commandsDir) {
    foreach ($file in Get-ChildItem -Path $commandsDir -File) {
        Remove-IfReggieSymlink -FilePath $file.FullName
    }
}

# 3. Remove individual hook symlinks
Write-Host "Checking hooks/..."
$hooksDir = Join-Path $ClaudeDir "hooks"
if ((Test-Path $hooksDir) -and ((Get-Item $hooksDir).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    Remove-Item -Force $hooksDir
    New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null
    Write-Host "  Removed old directory-level symlink: hooks/"
    $Removed++
} elseif (Test-Path $hooksDir) {
    foreach ($file in Get-ChildItem -Path $hooksDir -File) {
        Remove-IfReggieSymlink -FilePath $file.FullName
    }
}

# 4. Remove standalone file symlinks
Write-Host "Checking standalone files..."
foreach ($item in @("REGGIE.md", "PORTABLE-PACKAGE.md", "agents-is-all-you-need.md", "reggie-quickstart.md", "mcp-registry.yaml", "skills-registry.yaml")) {
    Remove-IfReggieSymlink -FilePath (Join-Path $ClaudeDir $item)
}

# Legacy cleanup
$LegacyManifest = Join-Path $ClaudeDir "capability-manifest.yaml"
if ((Test-Path $LegacyManifest) -and ((Get-Item $LegacyManifest).Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
    $target = (Get-Item $LegacyManifest).Target
    if ($target -match "reggie") {
        Remove-Item -Force $LegacyManifest
        Write-Host "  Removed legacy capability-manifest.yaml symlink"
        $Removed++
    }
}

# 5. Remove stats hooks from settings.json
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

        if (($settings.hooks.PSObject.Properties | Measure-Object).Count -eq 0) {
            $settings.PSObject.Properties.Remove("hooks")
        }

        $settings | ConvertTo-Json -Depth 10 | Set-Content -Path $SettingsFile -Encoding UTF8
        Write-Host "Removed stats hooks from settings.json"
    }
}

# 6. Remove ENABLE_TOOL_SEARCH from PowerShell profile
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
Write-Host "Reggie uninstalled. Removed $Removed Reggie-owned files."
Write-Host "User-created files in ~/.claude/ were preserved."
