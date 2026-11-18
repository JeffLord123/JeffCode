# JeffCode

JeffCode is a code editor for designers, built on [VS Code](https://github.com/microsoft/vscode) (Code - OSS, MIT).
It keeps everything VS Code does and focuses on visual front-end work:

- Integrated browser with element selection, DevTools and console
- Extensions from [Open VSX](https://open-vsx.org)
- [Claude Code](https://code.claude.com/docs/en/vs-code) as the agent (offered on first launch)
- Design panel beside the page: Components tree, Figma-like controls for layout, spacing, typography and colors, live preview, and an Apply button that hands the changes to Claude Code

Upstream's original README is kept in [README.vscode.md](README.vscode.md).

## Install

Download the latest build from [Releases](https://github.com/JeffLord123/JeffCode/releases).

- **Windows:** run `JeffCode-Setup-<version>-win32-x64.exe`. SmartScreen may warn because the app is unsigned: "More info" then "Run anyway".
- **macOS:** unzip `JeffCode-<version>-darwin-arm64.zip` (Apple Silicon) or `JeffCode-<version>-darwin-x64.zip` (Intel), move `JeffCode.app` to Applications, then run once:

  ```sh
  xattr -cr /Applications/JeffCode.app
  ```

JeffCode stores its settings and extensions in `~/.jeffcode`, separate from VS Code and Cursor.

## Design tools

Open the integrated browser with the globe button of the title bar, then open your site. The design tools are the buttons at the right of the address bar:

- **Open Integrated Browser** (globe) opens another browser tab.
- **Design Panel** opens the panel beside the page.
- **Select Element to Design** (`Ctrl+Shift+C`) lets you click an element in the page.
- **Rulers** shows graduated rulers along the top and left of the page, in pixels of the page. Drag from a ruler onto the page to add a guide. Drag a guide to move it, back onto its ruler to remove it, or hover it and press Delete. Right-click a ruler to clear the guides.
- **Measure** works like Figma's measure tool. Hover an element to see its size and its distances to its neighbours and its parent. The cursor snaps to the borders of elements: drag from a border to place a measurement, which stays and follows layout changes. Hover a placed measurement to move it or delete it. The arrow next to the button chooses what is shown on every element: gaps and padding (by default), margins, components and their size, font sizes. Escape leaves the tool.
- **Mirror Mode** shows your site as it is in the last commit on the left, and with your uncommitted changes on the right, side by side. The left side is the real site, not a picture: JeffCode copies the last commit to `~/.jeffcode/mirror` (a git worktree), installs its dependencies when they change, and starts it with the same command as your site on another port. On Linux, macOS and WSL, it loads nvm when installed and switches to the Node.js version of the project (`.nvmrc`, `.node-version`, or `engines.node` in `package.json`). A command you change from the arrow's menu is kept and wins over the one found in your terminals. Navigation and scrolling stay in sync. Without uncommitted changes, the right side says so. The arrow next to the button chooses another commit, branch or tag for the left side (it then stays on it instead of following new commits; pick "Last Commit" to follow them again), turns the scroll sync off, shows the terminal of the copy, or changes its start command.

Edit values in the **Design** or **CSS** tab: the page updates live. Drag a field's icon sideways to scrub a value, or use the arrow keys (Shift for steps of 10). The bar at the bottom counts your changes: **Reset** undoes them, **Copy CSS** copies them as CSS, **Apply** opens Claude Code with a ready-to-send prompt describing them so it can update the source code.

## Claude Code

On first launch JeffCode offers to install the Claude Code extension. You can also install it from the Extensions view (search "Claude Code", publisher Anthropic). Sign in with your Claude account.

## WSL and SSH

Microsoft's Remote extensions only run in Microsoft's VS Code. JeffCode supports their open-source counterparts from Open VSX instead:

- **WSL:** install "Open Remote - WSL" (`jeanp413.open-remote-wsl`), then click the remote button at the bottom left of the window and pick your distribution.
- **SSH:** install "Open Remote - SSH" (`jeanp413.open-remote-ssh`).

On first connection the extension downloads the JeffCode server (`jeffcode-reh-linux-x64.tar.gz`) from the GitHub release that matches the app, so the app and the server must come from the same release. The server is built on Ubuntu 24.04 and needs glibc 2.39 or later on the Linux side.

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
