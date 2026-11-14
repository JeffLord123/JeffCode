# JeffCode

JeffCode is a code editor for designers, built on [VS Code](https://github.com/microsoft/vscode) (Code - OSS, MIT).
It keeps everything VS Code does and focuses on visual front-end work:

- Integrated browser with element selection, DevTools and console
- Extensions from [Open VSX](https://open-vsx.org)
- [Claude Code](https://code.claude.com/docs/en/vs-code) as the agent (offered on first launch)
- Coming next: a Figma-like Design panel (Components tree, layout, spacing, typography, colors) with Apply-to-code

Upstream's original README is kept in [README.vscode.md](README.vscode.md).

## Install

Download the latest build from [Releases](https://github.com/JeffLord123/JeffCode/releases).

- **Windows:** run `JeffCode-Setup-win32-x64.exe`. SmartScreen may warn because the app is unsigned: "More info" then "Run anyway".
- **macOS:** unzip `JeffCode-darwin-arm64.zip` (Apple Silicon) or `JeffCode-darwin-x64.zip` (Intel), move `JeffCode.app` to Applications, then run once:

  ```sh
  xattr -cr /Applications/JeffCode.app
  ```

JeffCode stores its settings and extensions in `~/.jeffcode`, separate from VS Code and Cursor.

## Claude Code

On first launch JeffCode offers to install the Claude Code extension. You can also install it from the Extensions view (search "Claude Code", publisher Anthropic). Sign in with your Claude account.

## Build from source

Requirements: Node.js version from [.nvmrc](.nvmrc), pnpm version from `packageManager` in [package.json](package.json), Python 3, and on Windows Visual Studio Build Tools 2022 with the C++ workload and Spectre-mitigated libraries.

```powershell
# Windows: put the right Node/pnpm first on PATH for this shell
. .\scripts\jeffcode-env.ps1
pnpm install --frozen-lockfile
pnpm run compile
.\scripts\code.bat
```

```sh
# macOS
pnpm install --frozen-lockfile
pnpm run compile
./scripts/code.sh
```

Packaged builds for Windows and macOS are produced by [.github/workflows/jeffcode-release.yml](.github/workflows/jeffcode-release.yml) when a `jeffcode-*` tag is pushed.

## Updating to a new VS Code version

```sh
git fetch upstream tag <version> --no-tags
git merge <version>
```

JeffCode-specific code lives in `src/vs/workbench/contrib/jeffcode/`; changes to upstream files are kept minimal and marked with `JeffCode:` comments.
