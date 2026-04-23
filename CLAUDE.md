# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Scope of this fork

**One purpose: let the desktop app connect to multiple self-hosted Stoat/Revolt servers via a simple switcher.** This is the *primary* use case for the fork. Web changes can wait — the existing `InstancePicker.tsx` in `for-web/` already covers the browser case.

Keep the delta vs. upstream (`stoatchat/for-desktop`) as small as possible. No rebrand, no UI redesign, no refactors unless they directly serve the multi-server story.

### Design direction (switcher, phase 1)

- **State:** a list of saved servers (label + base URL) stored in `electron-store` via `src/native/config.ts`, plus an `activeServerId`. Defaults to the historical `https://stoat.chat/app` entry so first-launch behavior is unchanged.
- **Navigation:** `src/native/window.ts` reads the active server from config at window-create time and points `BUILD_URL` at it. Switching server = update config + `mainWindow.loadURL(newUrl)`. No webapp changes required — each target URL is its own web client.
- **UI surface:** tray submenu (and/or a window menu item) listing servers + "Add server…" / "Edit…". `src/native/tray.ts` is the natural home.
- **CLI override:** keep `--force-server <url>` working; it should bypass the active-server config for that run only.
- **Security:** the existing `will-navigate` guard in `src/main.ts` pins navigation to `BUILD_URL.origin`. When we switch servers, that origin has to be refreshed — don't lose this guard, adapt it.

## Architecture reminders

Entry: `src/main.ts` — acquires single-instance lock, wires `update-electron-app`, creates the main window on `ready`, handles `second-instance` / `window-all-closed` / `activate`, and installs the `web-contents-created` handler that guards navigation and routes external URLs to `shell.openExternal`.

Native modules (main process, `src/native/`):
- `window.ts` — `mainWindow` singleton, `createMainWindow()`, `BUILD_URL` (currently hard-coded to `https://stoat.chat/app`, overridable via `--force-server`). Menu/IPC wiring lives here.
- `config.ts` — `electron-store` wrapper with a JSON schema. This is where server list + active server go.
- `tray.ts` — tray icon + context menu. Natural place for the server switcher UI.
- `autoLaunch.ts`, `discordRpc.ts`, `badges.ts` — feature modules, unrelated to scope.

Bridging: `src/preload.ts` (contextBridge), renderer-side helpers in `src/world/`.

Build: Electron Forge (`forge.config.ts`) with three Vite configs (`vite.main.config.ts`, `vite.preload.config.ts`, `vite.renderer.config.ts`). Makers: deb, flatpak, squirrel, zip, appx.

## Commands

Plain pnpm project (no `mise` here):

```bash
pnpm i --frozen-lockfile
pnpm start                                              # electron-forge start
pnpm start -- --force-server http://localhost:5173      # connect to local for-web dev
pnpm package                                            # app bundle
pnpm make                                               # all distributables
pnpm lint                                               # eslint .ts,.tsx

# Flatpak (after `pnpm make`):
pnpm install:flatpak && pnpm run:flatpak

# Nix helper:
pnpm package && pnpm run:nix
```

## Git workflow

- `origin` → `mornepousse/for-desktop` (user's fork; this is where we push).
- `upstream` → `stoatchat/for-desktop` (never push here).
- Keep fork commits on top of `upstream/main` with a rebase strategy — the `upstream-sync` agent handles this. See `.claude/agents/upstream-sync.md`.

## Code style

- Prettier with `@trivago/prettier-plugin-sort-imports`. Import order: third-party → `^electron` → `^\.\.` → `^[./]`. Don't break this ordering.
- `eslint --ext .ts,.tsx .` before any commit.
- TypeScript 4.5 (pinned — `"typescript": "~4.5.4"` in `package.json`). Don't use features that require a newer compiler.
- Comments above non-trivial functions; in-line comments when logic is surprising (especially for Electron lifecycle / IPC quirks).

## Project agents

Three agents live in `.claude/agents/`, loaded automatically when working in this directory:

- `stoat-desktop-architect` — knows the architecture, proposes minimal patches for the multi-server switcher.
- `electron-main-reviewer` — reviews Electron code for security (contextIsolation, URL origin guards, preload surface, IPC design).
- `upstream-sync` — fetches `stoatchat/for-desktop`, rebases our fork commits on top, flags conflicts around `src/native/{config,window,tray}.ts`.
