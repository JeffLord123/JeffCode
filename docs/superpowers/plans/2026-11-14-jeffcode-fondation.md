# JeffCode Fondation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a branded, runnable JeffCode build (Windows + macOS) from Code-OSS 1.146.0 with Open VSX and a Claude Code install prompt.

**Architecture:** Fork of microsoft/vscode on branch `jeffcode`. Branding and gallery via `product.json`; two default-value changes in upstream settings registrations; one new contrib folder `src/vs/workbench/contrib/jeffcode/`; one GitHub Actions workflow for packaging.

**Tech Stack:** TypeScript, Electron, gulp, pnpm 12.16.0, Node 24.22.1, GitHub Actions.

Spec: [../specs/2026-11-14-jeffcode-fondation-design.md](../specs/2026-11-14-jeffcode-fondation-design.md)

## Global Constraints

- Node 24.22.1 (`.nvmrc`), pnpm 12.16.0 (`packageManager`). On the Windows dev PC they live in `C:\tools` and are put on PATH by `scripts/jeffcode-env.ps1`; the machine-wide Node 22 must stay untouched.
- `package.json` version stays `1.146.0` (extension compatibility).
- Data folder `.jeffcode`; app name `JeffCode`; bundle id `com.jefflord.jeffcode`.
- Upstream file edits are minimal and carry a `JeffCode:` comment.

---

### Task 1: Branding and gallery (`product.json`)

**Files:** Modify `product.json`

- [x] Replace Code-OSS identity fields with the values in the spec table (new GUIDs for the four `win32*AppId` and the two `darwinProfile*UUID`).
- [x] Add `extensionsGallery` (Open VSX: `serviceUrl`, `itemUrl`, `latestUrlTemplate`, `controlUrl`) and `linkProtectionTrustedDomains: ["https://open-vsx.org"]`, matching VSCodium's `prepare_vscode.sh`.
- [x] Validate: `python -c "import json;json.load(open('product.json',encoding='utf-8'))"` prints nothing and exits 0.

### Task 2: Defaults

**Files:** Modify `src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts` (`chat.disableAIFeatures` default `true`), `src/vs/platform/telemetry/common/telemetryService.ts` (`telemetry.telemetryLevel` default `off`).

- [x] Change the two `default:` values, each with a `// JeffCode:` comment.

### Task 3: Claude Code onboarding

**Files:**
- Create: `src/vs/workbench/contrib/jeffcode/browser/claudeCodeOnboarding.ts`
- Create: `src/vs/workbench/contrib/jeffcode/browser/jeffcode.contribution.ts`
- Create: `src/vs/workbench/contrib/jeffcode/test/browser/claudeCodeOnboarding.test.ts`
- Modify: `src/vs/workbench/workbench.common.main.ts` (import the contribution)

**Interfaces — Produces:** `CLAUDE_CODE_EXTENSION_ID = 'anthropic.claude-code'`, `isClaudeCodeInstalled(installedIds: readonly string[]): boolean`, `ClaudeCodeOnboardingContribution` (registered at `WorkbenchPhase.Eventually`).

- [x] Write tests: id constant; empty/other ids → false; matching id (any case) → true.
- [x] Implement: on startup `queryLocal()`; if missing, `notificationService.prompt` with Install / Later and built-in `neverShowAgain` (application scope). Install failure → error prompt with "Open Extension Page" (`extension.open`).
- [ ] Run: `.\scripts\test.bat --run src/vs/workbench/contrib/jeffcode/test/browser/claudeCodeOnboarding.test.ts` → 3 passing.

### Task 4: CI packaging

**Files:** Delete `.github/workflows/*` and `.github/dependabot.yml`; create `.github/workflows/jeffcode-release.yml`.

- [x] Jobs: Windows x64 (`vscode-win32-x64-min`, `-inno-updater`, `-user-setup`), macOS arm64 (`macos-15`) and x64 (`macos-15-intel`) with `vscode-darwin-<arch>-min`, ad-hoc `codesign`, `ditto` zip. Release job on `jeffcode-*` tags only, after all builds succeed.
- [ ] Trigger manually (`gh workflow run jeffcode-release.yml --ref jeffcode`) and confirm three artifacts.

### Task 5: Docs and dev env

**Files:** Create `README.md` (upstream moved to `README.vscode.md`), `scripts/jeffcode-env.ps1`.

- [x] README: what JeffCode is, install (Windows/macOS incl. `xattr -cr`), Claude Code, build, upstream update.

### Task 6: Local run and manual verification

- [ ] `pnpm run compile`, then `.\scripts\code.bat`.
- [ ] Manual checks 1–6 from the spec on Windows; then tag `jeffcode-0.1.0` and run check 7 + Mac checks.
