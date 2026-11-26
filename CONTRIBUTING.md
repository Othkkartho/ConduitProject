# Contributing to Conduit

Thank you for your interest in contributing to **Conduit**!  
Whether you are reporting a bug, suggesting a feature, improving documentation, or submitting a pull request, your contributions help make Conduit better for everyone.

Please take a moment to review these guidelines before making your first contribution.

> **Key Reference Documents**
> - [README.md](README.md) — Project overview and quick start
> - [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — Community standards (Contributor Covenant v3.0)
> - [01. System Architecture](docs/01-architecture.md)
> - [02. Dataflow and Streaming](docs/02-dataflow-and-streaming.md)
> - [03. Storage and Security](docs/03-storage-and-security.md)
> - [04. User Manual](docs/04-user-manual.md)
> - [CHANGELOG.md](CHANGELOG.md)

---

## Table of Contents

1. [Code of Conduct](#1-code-of-conduct)
2. [Reporting Issues & Security Concerns](#2-reporting-issues--security-concerns)
3. [Development Environment Setup](#3-development-environment-setup)
4. [Workspace Structure](#4-workspace-structure)
5. [Code Style & Cross-Platform Guidelines](#5-code-style--cross-platform-guidelines)
6. [Testing & Local Verification](#6-testing--local-verification)
7. [Git Workflow, Commits & Pull Requests](#7-git-workflow-commits--pull-requests)
8. [Versioning & Release Policy](#8-versioning--release-policy)
9. [License](#9-license)

---

## 1. Code of Conduct

All contributors and maintainers are expected to abide by our [Code of Conduct](CODE_OF_CONDUCT.md) (adapted from the Contributor Covenant v3.0) across all project spaces. Please review it before participating in discussions, issues, or pull requests.

---

## 2. Reporting Issues & Security Concerns

Before opening a new issue, please search existing issues to check whether the problem or suggestion has already been reported.

- **Bug Reports (`[BUG]`)**: Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.md).
  - Include your OS/architecture (Windows / macOS / Linux), Conduit version, protocol involved (`Local PTY`, `SSH`, `SFTP`, `Serial`, `Telnet`), reproduction steps, expected vs. actual behavior, and error logs.
  - **Important**: Always redact passwords, passphrases, private keys, and sensitive hostnames before attaching logs or screenshots.
- **Feature Requests (`[FEAT]`)**: Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.md).
  - Clearly describe the motivation, proposed solution, alternatives considered, and acceptance criteria.
- **Security Issues**: Please **do not** open public GitHub issues with exploit details for vulnerabilities affecting credential storage (`AES-256-GCM`, OS keyring integration, Master Password hashing), SSH host key verification, or memory safety. Instead, report them privately to the repository maintainer (`@Othkkartho`) via GitHub.

---

## 3. Development Environment Setup

### Prerequisites

| Tool | Minimum Version | Purpose |
|---|---|---|
| **Rust** (`rustup`, `cargo`) | `1.80+` | Workspace compilation, core engine, and unit tests |
| **Node.js** (`npm`) | `22+` | Icon generation and frontend (`frontend/`) build |

**OS-Specific Tauri v2 Dependencies:**
- **Windows**: Microsoft Edge WebView2 Runtime, Visual Studio Build Tools (Desktop development with C++)
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Linux (Ubuntu/Debian)**:
  ```bash
  sudo apt-get update
  sudo apt-get install -y \
    build-essential pkg-config libssl-dev libgtk-3-dev libxdo-dev \
    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
    patchelf libsecret-1-dev libudev-dev
  ```

### Local Build & Run

`conduit-desktop` embeds desktop icons and the built static assets from `frontend/dist`, so build those before launching the Rust desktop app:

```bash
# 1. Generate Tauri desktop icons from the workspace root
node scripts/generate-icons.mjs

# 2. Install frontend dependencies and build static assets
cd frontend
npm install
npm run build
cd ..

# 3. Launch the Tauri v2 desktop application
cargo run -p conduit-desktop

# (Optional) Launch the cross-platform update/uninstall CLI manager
cargo run -p conduit-manager
```

---

## 4. Workspace Structure

```text
conduit/
├── Cargo.toml                  # Cargo workspace root and shared version
├── .github/
│   ├── ISSUE_TEMPLATE/         # Bug report and feature request templates
│   ├── pull_request_template.md
│   └── workflows/
│       ├── ci.yml              # Frontend + Windows/macOS/Linux Rust CI on PRs
│       └── release.yml         # Portable archive builds on main push / v* tags
├── scripts/
│   └── generate-icons.mjs      # Generates desktop icons for Tauri
├── crates/
│   ├── conduit-protocol/       # Shared DTOs, session, bookmark, SFTP & settings models
│   ├── conduit-core/           # SessionManager, Adaptive Coalescer, PTY/SSH/SFTP/Serial/Telnet, encoding
│   └── conduit-storage/        # SQLite persistence, Envelope Encryption vault, Master Password auth
├── apps/
│   ├── desktop/                # Tauri v2 desktop host, native menus, and binary IPC channels
│   └── manager/                # Cross-platform CLI manager (update & uninstall)
├── frontend/                   # React + TypeScript + Zustand + xterm.js UI
└── docs/                       # Architecture, streaming, storage/security & user manual docs
```

---

## 5. Code Style & Cross-Platform Guidelines

- **Follow Google Style Guides**: All code (Rust, TypeScript/JavaScript, HTML/CSS, etc.) must follow the naming, formatting, and comment conventions in the [Google Style Guides](https://google.github.io/styleguide/).
- **Write Cross-Platform Code (Windows / macOS / Linux)**:
  - Never hardcode OS-specific path separators (`\\` or `/`) when joining paths or writing path unit tests; use `PathBuf::from(...).join(...)` or `Path::join`.
  - When guarding code or dependencies with `#[cfg(target_os = "...")]`, ensure other OS targets compile cleanly without `dead_code` or unused-variable warnings.
- **Preserve Existing Documentation**: Keep unrelated comments and docstrings intact.
- **Keep User Documentation in Sync**: If your change alters shortcuts, settings, or user-facing workflows, update [docs/04-user-manual.md](docs/04-user-manual.md) and the built-in manual ([manualContent.ts](frontend/src/manual/manualContent.ts)).

---

## 6. Testing & Local Verification

- **Unit Tests Required**: When adding new features or modifying existing behavior, include unit tests covering the new or updated logic.
- Before opening a Pull Request, verify locally that all checks pass without errors:

```bash
# 1. Generate icons, typecheck TypeScript, and build frontend bundle
node scripts/generate-icons.mjs
npm --prefix frontend run build

# 2. Run all Rust workspace unit tests
cargo test --workspace

# 3. Verify clean compilation across the entire workspace
cargo check --workspace
```

---

## 7. Git Workflow, Commits & Pull Requests

### Branching Rules
- **Direct pushes to `main` are strictly forbidden.**
- Create a dedicated feature or fix branch from `main` for every change and submit a Pull Request back to `main`.
  - Examples: `feat/sftp-progress-indicator`, `fix/euc-kr-split-decoder`, `docs/contributing-guide`

### Commit Messages ([Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/))
Format every commit message as `<type>(<optional scope>): <description>`:

| Type | Purpose | Example |
|---|---|---|
| `feat` | New user-facing feature | `feat(core): add per-session encoding transcoding` |
| `fix` | Bug fix | `fix(manager): make path safety test cross-platform` |
| `docs` | Documentation changes | `docs: translate CONTRIBUTING.md to English` |
| `refactor` | Code restructuring without behavior change | `refactor(storage): extract credential lookup helper` |
| `test` | Adding or updating tests | `test(core): cover chunk boundary transcoding` |
| `chore` | Build, CI/CD, tooling, dependencies | `chore(ci): ignore docs-only changes in workflows` |

- **Batch Your Pushes**: Avoid pushing after every individual commit. Organize your work into clean, logical commits locally and push once when the unit of work is complete.

### Pull Requests & Automated CI
1. Fill out all applicable sections in the [Pull Request template](.github/pull_request_template.md).
2. Whenever a PR modifies code or configuration, the [CI workflow](.github/workflows/ci.yml) runs automatically across:
   - `Frontend Typecheck & Build` (`ubuntu-latest`)
   - `Rust Workspace Test & Check` (`ubuntu-latest`, `windows-latest`, `macos-latest`)
3. Documentation-only changes (`**.md`, `docs/**`, `LICENSE`, `.github/ISSUE_TEMPLATE/**`, `.github/pull_request_template.md`) automatically skip CI and Release runs via `paths-ignore`.
4. All required CI checks must pass before merging.

---

## 8. Versioning & Release Policy

- Conduit follows [Semantic Versioning 2.0.0 (SemVer)](https://semver.org/) (`MAJOR.MINOR.PATCH`):
  - **`MAJOR`**: Incremented **only when explicitly requested by the project owner**, even for breaking changes.
  - **`MINOR`**: Backward-compatible feature additions.
  - **`PATCH`**: Bug fixes, refactoring, or documentation updates.
- When bumping the application version, update all of the following files consistently alongside [CHANGELOG.md](CHANGELOG.md):
  - [Cargo.toml](Cargo.toml) (`[workspace.package].version`)
  - [apps/desktop/src-tauri/tauri.conf.json](apps/desktop/src-tauri/tauri.conf.json) (`version`)
  - [frontend/package.json](frontend/package.json) (`version`)
  - [frontend/src/components/UserManualModal.tsx](frontend/src/components/UserManualModal.tsx) (version badge)
- When changes to code/config/manifests reach `main`, the [Release workflow](.github/workflows/release.yml) reads the version from `Cargo.toml` and—if `v<VERSION>` does not yet exist—builds portable archives for Windows (`.zip`), macOS (`.tar.gz` & `.zip`), and Linux (`.tar.gz`) and attaches them to a GitHub Release.

---

## 9. License

By contributing to Conduit, you agree that your contributions will be licensed under the [MIT License](LICENSE).
