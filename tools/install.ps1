[CmdletBinding()]
param(
    [string]$InstallHome = [Environment]::GetFolderPath('UserProfile'),
    [string[]]$SkillName = @()
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$skillsDir = Join-Path $repoRoot 'skills'
$targetRelatives = @(
    '.claude\skills',
    '.codex\skills',
    '.agents\skills',
    '.codebuddy\skills'
)

if (-not (Test-Path -LiteralPath $skillsDir -PathType Container)) {
    throw "找不到 $skillsDir"
}

$skills = @(Get-ChildItem -LiteralPath $skillsDir -Directory | Where-Object {
    Test-Path -LiteralPath (Join-Path $_.FullName 'SKILL.md') -PathType Leaf
})

if ($SkillName.Count -gt 0) {
    $known = @{}
    foreach ($skill in $skills) {
        $known[$skill.Name] = $skill
    }
    $selected = @()
    foreach ($name in $SkillName) {
        if (-not $known.ContainsKey($name)) {
            throw "找不到 Skill：$name"
        }
        $selected += $known[$name]
    }
    $skills = $selected
}

$installed = 0
$skipped = 0
$failed = 0

foreach ($skill in $skills) {
    foreach ($relative in $targetRelatives) {
        $targetRoot = Join-Path $InstallHome $relative
        if (-not (Test-Path -LiteralPath $targetRoot -PathType Container)) {
            New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
        }
        $linkPath = Join-Path $targetRoot $skill.Name

        $existing = Get-Item -LiteralPath $linkPath -Force -ErrorAction SilentlyContinue
        if ($null -ne $existing) {
            Write-Host "跳过（已存在，不覆盖）：$linkPath"
            $skipped += 1
            continue
        }

        try {
            New-Item -ItemType Junction -Path $linkPath -Target $skill.FullName | Out-Null
            Write-Host "已链接：$linkPath -> $($skill.FullName)"
            $installed += 1
        }
        catch {
            Write-Warning "链接失败：$linkPath；$($_.Exception.Message)"
            $failed += 1
        }
    }
}

Write-Host "完成：新装 $installed 个，跳过 $skipped 个，失败 $failed 个。"
Write-Host '重启或重载 Agent 的 Skills，然后直接说触发词，例如“反推这个视频”。'

if ($failed -gt 0) {
    exit 1
}
