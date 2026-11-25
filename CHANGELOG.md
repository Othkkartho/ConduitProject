# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html),
and commit messages follow [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).

> **Versioning Policy**: Initial development begins at `0.1.0`. Major version increments (e.g., `1.0.0`) occur only upon explicit project owner approval.

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
