# JeffCode build environment (Windows).
# Dot-source before building:  . .\scripts\jeffcode-env.ps1
# Puts the Node and pnpm versions required by this repo first on PATH for the
# current shell only, leaving the machine-wide Node/pnpm untouched.
$NodeDir = if ($env:JEFFCODE_NODE_DIR) { $env:JEFFCODE_NODE_DIR } else { 'C:\tools\node-v24.22.1-win-x64' }
$PnpmDir = if ($env:JEFFCODE_PNPM_DIR) { $env:JEFFCODE_PNPM_DIR } else { 'C:\tools\pnpm-12' }
$env:Path = "$PnpmDir;$NodeDir;" + $env:Path
# Terminals inside VS Code/Cursor inherit ELECTRON_RUN_AS_NODE=1 and VSCODE_* variables,
# which make Electron start as plain Node and crash JeffCode at launch. Clear them.
Get-ChildItem env: | Where-Object Name -match '^(ELECTRON_RUN_AS_NODE|VSCODE_)' | ForEach-Object { Remove-Item "env:$($_.Name)" }
Write-Host "node $(node --version) | pnpm $(pnpm --version)"
