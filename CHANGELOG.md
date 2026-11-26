# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html),
and commit messages follow [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

> **Versioning Policy**: Initial development begins at `0.1.0`. Major version increments (e.g., `1.0.0`) occur only upon explicit project owner approval.

## [0.3.0] - 2026-11-26

### Added
- **Per-Session Character Encoding**: Added encoding selection (`utf-8`, `euc-kr`, `shift_jis`, `euc-jp`, `gbk`, `gb18030`, `big5`, `windows-1252`, `iso-8859-2`, `windows-1251`, `koi8-r`) per bookmark and live per-pane switching in `TerminalPane` backed by stateful `encoding_rs` transcoding in `conduit-core`.
- **Master Password Lock**: Added optional startup Master Password protection (default `false`) in `SettingsModal` using salted PBKDF2-HMAC-SHA256 (`100,000` iterations) and constant-time comparison, gating backend session/bookmark commands behind an unlock guard and a lock screen on startup.
- **Cross-Platform `conduit-manager` (`apps/manager`) & Session Reset**: Added `conduit-manager` bundled across Windows, macOS, and Linux release archives providing interactive **1. Update** (checks GitHub Releases `latest` via SemVer and replaces OS-matched files in-place) and **2. Uninstall** (confirms with `y`/`Y` and deletes OS keyring master key, app data SQLite DB, and installation folder); added a **저장된 세션 초기화** Danger Zone in `SettingsModal` requiring typing `초기화` to confirm.
- **Light Color Schemes**: Added 3 pure-white (`#ffffff`) Light themes (`GitHub Light`, `Pure White`, `Catppuccin Latte White`) alongside `Solarized Light`.
- **Bookmark Context Menu**: Right-clicking a saved session in `Sidebar` now opens a dedicated `세션 편집` / `세션 삭제` context menu.

### Changed
- **Bookmark Hover Tooltip**: Hovering over saved sessions/folders in the sidebar now displays the full session/folder name instead of static hint text.
- **Duplicate Session Name Guard & Connection Verification**: Rejects duplicate session names on save (both frontend and SQLite layer), tests real connectivity before saving, and when clicking `저장만 하기` asks *"연결되지 않습니다. 그래도 저장하시겠습니까?"* before allowing force-save on connection failure.

## [0.2.0] - 2026-11-26

### Added
- **Tab Cycling Shortcuts**: Added `Ctrl+Tab` (forward circular switching) and `Ctrl+Shift+Tab` (reverse circular switching) across open session tabs even when `xterm.js` is focused.

### Changed
- **Close Confirmation Default**: Changed `confirm_on_close` default from `false` to `true` across Rust settings defaults (`conduit-protocol`) and frontend store initialization.
- **CI & Release Workflows**:
  - Updated `.github/workflows/ci.yml` to run only on `pull_request` (and `workflow_dispatch`), avoiding duplicate test runs on `main` merges.
  - Updated `.github/workflows/release.yml` asset packaging per OS: Windows (`.zip`), macOS (`.tar.gz` & `.zip`), and Linux (`.tar.gz`).

### Fixed
- **Tauri v2 Desktop Drag-and-Drop**: Set `"dragDropEnabled": false` in `tauri.conf.json` (disabling WebView2 native file-drop interception that blocked HTML5 DnD), disabled pointer interception on `.pane-xterm` during active drags, and improved drop target calculation in `Sidebar` and `TerminalPane` for folder/bookmark moving, same-folder priority reordering, and automatic 2×2 drag-to-split.

## [0.1.0] - 2026-11-26

### Added
- **Rust Workspace Core (`crates/`)**:
  - `conduit-protocol`: Shared session, bookmark, SFTP, and settings DTOs.
  - `conduit-core`: `SessionManager` with Adaptive Output Coalescing (4ms/64KB), Watermark Flow Control (512KB/128KB), Zero-Copy Broadcast fan-out, and protocol backends for Local PTY (`portable-pty` on dedicated OS threads with `ChildKiller` cleanup), SSH/SFTP (`russh`, `russh-keys`, `russh-sftp`), Serial (`tokio-serial`), and Telnet (`tokio::net`).
  - `conduit-storage`: SQLite storage for nested folder trees, bookmarks, settings, `known_hosts` TOFU verification, JSON import/export, and Envelope Encryption (`keyring` master key + `AES-256-GCM`).
- **Tauri v2 Desktop Application (`apps/desktop`)**:
  - `conduit-desktop`: Standalone cross-platform desktop app with raw binary IPC channels and native menus (`보기`, `도움말`) loading built static assets from `frontend/dist`.
- **Frontend (`frontend/`)**:
  - React + TypeScript + Zustand + `xterm.js` (WebGL, Fit, Search, WebLinks addons).
  - VS Code-style Activity Bars (left/right/bottom icon rails with drag-and-drop relocation), layout toggles, and resizable panels.
  - Drag-to-split terminal panes (up to 2×2), Quick SSH connect (`Ctrl+Shift+E`) with dedicated password prompt, save-session-to-bookmark (`Ctrl+Shift+D`), bottom Broadcast input (`all` / `visible` / `selected`), SFTP drag-and-drop explorer, delete & close confirmations, bookmark tree drag-reorder & JSON import/export, 5 themes, and built-in User Manual (`F1`).
- **Documentation, CI & Automated Releases**:
  - Architecture, dataflow/streaming, storage/security, and user manual docs in `docs/`.
  - GitHub Actions CI (`actions/checkout@v6`, `actions/setup-node@v6`, `Swatinem/rust-cache@v2`) running cleanly on Node 24 without deprecation warnings.
  - Automated GitHub Release workflow building portable `.zip` and `.tar.gz` runnable archives for Windows, macOS, and Linux.
