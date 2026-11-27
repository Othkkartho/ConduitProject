use serde::Deserialize;
use std::fs;
use std::io::{self, Write};
#[cfg(unix)]
use std::os::unix::fs as unix_fs;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

const APP_IDENTIFIER: &str = "dev.ptyloom.terminal";
const KEYRING_SERVICE: &str = "ptyloom-terminal";
const KEYRING_ACCOUNT: &str = "master-key";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const RELEASES_LATEST_API: &str =
    "https://api.github.com/repos/Othkkartho/PtyloomProject/releases/latest";

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct GithubAsset {
    pub name: String,
    pub browser_download_url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GithubRelease {
    pub tag_name: String,
    #[serde(default)]
    pub html_url: String,
    #[serde(default)]
    pub assets: Vec<GithubAsset>,
}

pub fn parse_release_version(raw: &str) -> Result<semver::Version, String> {
    let trimmed = raw.trim();
    let normalized = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    semver::Version::parse(normalized)
        .map_err(|e| format!("버전 형식이 올바르지 않습니다 ({raw}): {e}"))
}

pub fn is_newer_version(current: &str, latest_tag: &str) -> Result<bool, String> {
    let cur = parse_release_version(current)?;
    let latest = parse_release_version(latest_tag)?;
    Ok(latest > cur)
}

fn arch_matches(asset_name_lower: &str, target_arch: &str) -> bool {
    match target_arch {
        "x86_64" => asset_name_lower.contains("x86_64") || asset_name_lower.contains("amd64"),
        "aarch64" => asset_name_lower.contains("arm64") || asset_name_lower.contains("aarch64"),
        other => asset_name_lower.contains(other),
    }
}

pub fn select_release_asset<'a>(
    assets: &'a [GithubAsset],
    target_os: &str,
    target_arch: &str,
) -> Option<&'a GithubAsset> {
    match target_os {
        "windows" => {
            let candidates: Vec<&GithubAsset> = assets
                .iter()
                .filter(|a| {
                    let n = a.name.to_ascii_lowercase();
                    n.contains("windows") && n.ends_with(".zip")
                })
                .collect();
            candidates
                .iter()
                .copied()
                .find(|a| arch_matches(&a.name.to_ascii_lowercase(), target_arch))
                .or_else(|| candidates.first().copied())
        }
        "macos" => {
            let candidates: Vec<&GithubAsset> = assets
                .iter()
                .filter(|a| {
                    let n = a.name.to_ascii_lowercase();
                    n.contains("macos") || n.contains("darwin")
                })
                .collect();
            let tar_arch = candidates.iter().copied().find(|a| {
                let n = a.name.to_ascii_lowercase();
                (n.ends_with(".tar.gz") || n.ends_with(".tgz")) && arch_matches(&n, target_arch)
            });
            let tar_any = candidates.iter().copied().find(|a| {
                let n = a.name.to_ascii_lowercase();
                n.ends_with(".tar.gz") || n.ends_with(".tgz")
            });
            let zip_arch = candidates.iter().copied().find(|a| {
                let n = a.name.to_ascii_lowercase();
                n.ends_with(".zip") && arch_matches(&n, target_arch)
            });
            let zip_any = candidates
                .iter()
                .copied()
                .find(|a| a.name.to_ascii_lowercase().ends_with(".zip"));
            tar_arch.or(tar_any).or(zip_arch).or(zip_any)
        }
        "linux" => {
            let candidates: Vec<&GithubAsset> = assets
                .iter()
                .filter(|a| {
                    let n = a.name.to_ascii_lowercase();
                    n.contains("linux") && (n.ends_with(".tar.gz") || n.ends_with(".tgz"))
                })
                .collect();
            candidates
                .iter()
                .copied()
                .find(|a| arch_matches(&a.name.to_ascii_lowercase(), target_arch))
                .or_else(|| candidates.first().copied())
        }
        _ => None,
    }
}

pub fn is_confirm_yes(input: &str) -> bool {
    matches!(input.trim(), "y" | "Y")
}

pub fn resolve_app_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        return std::env::var_os("APPDATA")
            .filter(|s| !s.is_empty())
            .map(|p| PathBuf::from(p).join(APP_IDENTIFIER));
    }
    #[cfg(target_os = "macos")]
    {
        return std::env::var_os("HOME")
            .filter(|s| !s.is_empty())
            .map(|p| {
                PathBuf::from(p)
                    .join("Library")
                    .join("Application Support")
                    .join(APP_IDENTIFIER)
            });
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME").filter(|s| !s.is_empty()) {
            return Some(PathBuf::from(xdg).join(APP_IDENTIFIER));
        }
        std::env::var_os("HOME")
            .filter(|s| !s.is_empty())
            .map(|p| PathBuf::from(p).join(".local").join("share").join(APP_IDENTIFIER))
    }
}

pub fn remove_sqlite_and_data(app_data_dir: Option<&Path>, install_dir: Option<&Path>) -> Vec<String> {
    let mut errors = Vec::new();
    let db_files = [
        "ptyloom.db",
        "ptyloom.db-wal",
        "ptyloom.db-shm",
        ".ptyloom-master.key",
    ];

    if let Some(dir) = install_dir {
        for file in db_files {
            let candidate = dir.join(file);
            if candidate.exists() {
                if let Err(e) = fs::remove_file(&candidate) {
                    errors.push(format!("{}: {e}", candidate.display()));
                }
            }
        }
    }

    if let Some(data_dir) = app_data_dir {
        if data_dir.exists() {
            for file in db_files {
                let candidate = data_dir.join(file);
                if candidate.exists() {
                    if let Err(e) = fs::remove_file(&candidate) {
                        errors.push(format!("{}: {e}", candidate.display()));
                    }
                }
            }
            if let Err(e) = fs::remove_dir_all(data_dir) {
                errors.push(format!("{}: {e}", data_dir.display()));
            }
        }
    }

    errors
}

pub fn is_safe_install_dir(dir: &Path) -> bool {
    let normal_count = dir
        .components()
        .filter(|c| matches!(c, Component::Normal(_)))
        .count();
    if normal_count < 2 {
        return false;
    }

    let Some(name) = dir.file_name().and_then(|s| s.to_str()) else {
        return false;
    };
    let lower_name = name.to_ascii_lowercase();
    let blocked_names = [
        "windows",
        "system32",
        "program files",
        "program files (x86)",
        "users",
        "desktop",
        "downloads",
        "documents",
        "appdata",
        "roaming",
        "local",
        "temp",
        "applications",
        "home",
        "usr",
        "bin",
        "opt",
        "var",
        "etc",
        "tmp",
    ];
    if blocked_names.contains(&lower_name.as_str()) {
        return false;
    }

    for env_var in [
        "USERPROFILE",
        "HOME",
        "APPDATA",
        "LOCALAPPDATA",
        "XDG_DATA_HOME",
        "TEMP",
        "TMP",
        "WINDIR",
    ] {
        if let Some(val) = std::env::var_os(env_var) {
            if PathBuf::from(val) == dir {
                return false;
            }
        }
    }

    dir.join("ptyloom.exe").exists()
        || dir.join("ptyloom-desktop.exe").exists()
        || dir.join("ptyloom").exists()
        || dir.join("Ptyloom Terminal.app").exists()
        || lower_name.contains("ptyloom")
}

pub fn find_extracted_package_root(extract_dir: &Path) -> PathBuf {
    let Ok(entries) = fs::read_dir(extract_dir) else {
        return extract_dir.to_path_buf();
    };
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            dirs.push(p);
        } else {
            files.push(p);
        }
    }
    if dirs.len() == 1 && files.is_empty() {
        dirs.into_iter().next().unwrap()
    } else {
        extract_dir.to_path_buf()
    }
}

pub fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let meta = fs::symlink_metadata(&src_path)?;

        #[cfg(unix)]
        if meta.file_type().is_symlink() {
            let target = fs::read_link(&src_path)?;
            unix_fs::symlink(target, &dst_path)?;
            continue;
        }

        if meta.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
            fs::set_permissions(&dst_path, meta.permissions())?;
        }
    }
    Ok(())
}

pub fn apply_update_from_dir(
    package_root: &Path,
    install_dir: &Path,
    current_exe: Option<&Path>,
) -> Result<Option<PathBuf>, String> {
    let mut scheduled_old_exe = None;
    let entries = fs::read_dir(package_root)
        .map_err(|e| format!("패키지 디렉토리를 읽지 못했습니다 ({}): {e}", package_root.display()))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("패키지 항목 읽기 오류: {e}"))?;
        let src = entry.path();
        let dest = install_dir.join(entry.file_name());
        let meta = fs::symlink_metadata(&src)
            .map_err(|e| format!("메타데이터 조회 실패 ({}): {e}", src.display()))?;

        if meta.is_dir() {
            if dest.exists() {
                fs::remove_dir_all(&dest)
                    .map_err(|e| format!("기존 디렉토리 제거 실패 ({}): {e}", dest.display()))?;
            }
            copy_dir_recursive(&src, &dest)
                .map_err(|e| format!("디렉토리 복사 실패 ({}): {e}", dest.display()))?;
            continue;
        }

        let is_self = current_exe.is_some_and(|exe| exe == dest);
        if is_self {
            #[cfg(target_os = "windows")]
            {
                let old_path = dest.with_extension("exe.old");
                if old_path.exists() {
                    let _ = fs::remove_file(&old_path);
                }
                fs::rename(&dest, &old_path)
                    .map_err(|e| format!("실행 중인 파일 이름 변경 실패 ({}): {e}", dest.display()))?;
                fs::copy(&src, &dest)
                    .map_err(|e| format!("새 바이너리 복사 실패 ({}): {e}", dest.display()))?;
                let _ = fs::set_permissions(&dest, meta.permissions());
                scheduled_old_exe = Some(old_path);
                continue;
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = fs::remove_file(&dest);
            }
        }

        fs::copy(&src, &dest)
            .map_err(|e| format!("파일 교체 실패 ({}): {e}", dest.display()))?;
        let _ = fs::set_permissions(&dest, meta.permissions());
    }

    Ok(scheduled_old_exe)
}

fn http_get_text(url: &str) -> Result<String, String> {
    let curl_bin = if cfg!(target_os = "windows") {
        "curl.exe"
    } else {
        "curl"
    };

    if let Ok(output) = Command::new(curl_bin)
        .args([
            "-fsSL",
            "-H",
            "Accept: application/vnd.github+json",
            "-H",
            "User-Agent: ptyloom-manager",
            url,
        ])
        .output()
    {
        if output.status.success() {
            return String::from_utf8(output.stdout)
                .map_err(|e| format!("응답 인코딩 오류: {e}"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let escaped = url.replace('\'', "''");
        let ps = format!(
            "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; \
             (Invoke-RestMethod -Uri '{escaped}' -Headers @{{'User-Agent'='ptyloom-manager';'Accept'='application/vnd.github+json'}} | ConvertTo-Json -Depth 12)"
        );
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", &ps])
            .output()
            .map_err(|e| format!("네트워크 요청 실행 실패: {e}"))?;
        if output.status.success() {
            return String::from_utf8(output.stdout)
                .map_err(|e| format!("응답 인코딩 오류: {e}"));
        }
        return Err(format!(
            "GitHub API 조회 실패: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("wget")
            .args([
                "-qO-",
                "--header=Accept: application/vnd.github+json",
                "--header=User-Agent: ptyloom-manager",
                url,
            ])
            .output()
            .map_err(|e| format!("curl/wget 실행 실패: {e}"))?;
        if output.status.success() {
            return String::from_utf8(output.stdout)
                .map_err(|e| format!("응답 인코딩 오류: {e}"));
        }
        Err(format!(
            "GitHub API 조회 실패: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn http_download_file(url: &str, dest: &Path) -> Result<(), String> {
    let curl_bin = if cfg!(target_os = "windows") {
        "curl.exe"
    } else {
        "curl"
    };

    if let Ok(output) = Command::new(curl_bin)
        .args([
            "-fsSL",
            "-L",
            "-H",
            "User-Agent: ptyloom-manager",
            "-o",
            &dest.to_string_lossy(),
            url,
        ])
        .output()
    {
        if output.status.success() {
            return Ok(());
        }
    }

    #[cfg(target_os = "windows")]
    {
        let u = url.replace('\'', "''");
        let d = dest.to_string_lossy().replace('\'', "''");
        let ps = format!(
            "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; \
             Invoke-WebRequest -Uri '{u}' -OutFile '{d}' -Headers @{{'User-Agent'='ptyloom-manager'}}"
        );
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", &ps])
            .output()
            .map_err(|e| format!("다운로드 실행 실패: {e}"))?;
        if output.status.success() {
            return Ok(());
        }
        return Err(format!(
            "파일 다운로드 실패: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("wget")
            .args(["-q", "--user-agent=ptyloom-manager", "-O", &dest.to_string_lossy(), url])
            .output()
            .map_err(|e| format!("다운로드 실행 실패 (curl/wget): {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "파일 다운로드 실패: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ))
        }
    }
}

fn extract_archive(archive: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest)
        .map_err(|e| format!("임시 압축 해제 폴더 생성 실패: {e}"))?;

    let lower = archive
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        let tar_bin = if cfg!(target_os = "windows") {
            "tar.exe"
        } else {
            "tar"
        };
        let status = Command::new(tar_bin)
            .args(["-xzf", &archive.to_string_lossy(), "-C", &dest.to_string_lossy()])
            .status()
            .map_err(|e| format!("tar 실행 실패: {e}"))?;
        if status.success() {
            return Ok(());
        }
        return Err("tar.gz 압축 해제에 실패했습니다.".into());
    }

    if lower.ends_with(".zip") {
        #[cfg(target_os = "windows")]
        {
            if let Ok(status) = Command::new("tar.exe")
                .args(["-xf", &archive.to_string_lossy(), "-C", &dest.to_string_lossy()])
                .status()
            {
                if status.success() {
                    return Ok(());
                }
            }
            let a = archive.to_string_lossy().replace('\'', "''");
            let d = dest.to_string_lossy().replace('\'', "''");
            let status = Command::new("powershell.exe")
                .args([
                    "-NoProfile",
                    "-Command",
                    &format!("Expand-Archive -LiteralPath '{a}' -DestinationPath '{d}' -Force"),
                ])
                .status()
                .map_err(|e| format!("PowerShell Expand-Archive 실행 실패: {e}"))?;
            if status.success() {
                return Ok(());
            }
            return Err("zip 압축 해제에 실패했습니다.".into());
        }

        #[cfg(not(target_os = "windows"))]
        {
            if let Ok(status) = Command::new("unzip")
                .args(["-oq", &archive.to_string_lossy(), "-d", &dest.to_string_lossy()])
                .status()
            {
                if status.success() {
                    return Ok(());
                }
            }
            let status = Command::new("tar")
                .args(["-xf", &archive.to_string_lossy(), "-C", &dest.to_string_lossy()])
                .status()
                .map_err(|e| format!("unzip/tar 실행 실패: {e}"))?;
            if status.success() {
                return Ok(());
            }
            return Err("zip 압축 해제에 실패했습니다.".into());
        }
    }

    Err(format!("지원하지 않는 아카이브 형식입니다: {}", archive.display()))
}

fn kill_running_ptyloom() {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        for exe in ["ptyloom.exe", "ptyloom-desktop.exe"] {
            let _ = Command::new("taskkill")
                .args(["/F", "/IM", exe])
                .creation_flags(CREATE_NO_WINDOW)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        for name in ["ptyloom-desktop", "ptyloom"] {
            let _ = Command::new("pkill")
                .args(["-x", name])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}

fn delete_keyring_master_key() {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
        let _ = entry.delete_credential();
    }
}

fn spawn_self_delete_folder(install_dir: &Path) {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let escaped = install_dir.to_string_lossy().replace('"', "");
        let script = format!("timeout /t 2 /nobreak > NUL & rmdir /S /Q \"{escaped}\"");
        let _ = Command::new("cmd.exe")
            .args(["/C", &script])
            .current_dir(std::env::temp_dir())
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("sh")
            .args(["-c", "sleep 1; rm -rf \"$1\"", "_", &install_dir.to_string_lossy()])
            .current_dir(std::env::temp_dir())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
}

fn spawn_self_delete_file(file_path: &Path) {
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let escaped = file_path.to_string_lossy().replace('"', "");
        let script = format!("timeout /t 2 /nobreak > NUL & del /F /Q \"{escaped}\"");
        let _ = Command::new("cmd.exe")
            .args(["/C", &script])
            .current_dir(std::env::temp_dir())
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = fs::remove_file(file_path);
    }
}

fn read_line_trimmed(prompt: &str) -> io::Result<String> {
    print!("{prompt}");
    io::stdout().flush()?;
    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    Ok(input.trim().to_string())
}

fn wait_enter() {
    let _ = read_line_trimmed("\n종료하려면 Enter 키를 누르세요...");
}

fn run_update(install_dir: &Path, exe_path: &Path) -> Result<(), String> {
    println!("\n[업데이트] GitHub Releases 최신 버전을 확인 중입니다...");
    let json = http_get_text(RELEASES_LATEST_API)?;
    let release: GithubRelease =
        serde_json::from_str(&json).map_err(|e| format!("릴리즈 정보 파싱 실패: {e}"))?;

    let latest_ver = parse_release_version(&release.tag_name)?;
    let current_ver = parse_release_version(CURRENT_VERSION)?;
    println!("현재 버전: v{current_ver} / 최신 버전: v{latest_ver}");

    if !is_newer_version(CURRENT_VERSION, &release.tag_name)? {
        println!("이미 최신 버전(v{current_ver})을 사용 중입니다.");
        return Ok(());
    }

    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let asset = select_release_asset(&release.assets, os, arch).ok_or_else(|| {
        format!(
            "현재 OS({os}/{arch})에 맞는 릴리즈 에셋을 찾을 수 없습니다. ({})",
            release.html_url
        )
    })?;

    println!("다운로드 대상: {}", asset.name);
    let temp_root = std::env::temp_dir().join(format!("ptyloom_update_{}", std::process::id()));
    let _ = fs::remove_dir_all(&temp_root);
    fs::create_dir_all(&temp_root)
        .map_err(|e| format!("임시 폴더 생성 실패: {e}"))?;

    let archive_path = temp_root.join(&asset.name);
    let extract_dir = temp_root.join("extracted");

    let result = (|| -> Result<(), String> {
        http_download_file(&asset.browser_download_url, &archive_path)?;
        println!("다운로드 완료. 압축을 해제하는 중입니다...");
        extract_archive(&archive_path, &extract_dir)?;

        let pkg_root = find_extracted_package_root(&extract_dir);
        println!("실행 중인 Ptyloom 프로세스를 정리하고 파일을 교체합니다...");
        kill_running_ptyloom();

        let old_self = apply_update_from_dir(&pkg_root, install_dir, Some(exe_path))?;
        if let Some(old_path) = old_self {
            spawn_self_delete_file(&old_path);
        }
        Ok(())
    })();

    let _ = fs::remove_dir_all(&temp_root);
    result?;

    println!("\n업데이트가 완료되었습니다! (v{current_ver} -> v{latest_ver})");
    println!("설치 경로: {}", install_dir.display());
    Ok(())
}

fn run_uninstall(install_dir: &Path, exe_path: &Path, app_data_dir: Option<&Path>) -> Result<(), String> {
    let data_desc = app_data_dir
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "(사용자 앱 데이터 폴더)".into());

    println!("\n[삭제 경고]");
    println!("- SQLite DB 및 설정: {data_desc}");
    println!("- 설치 폴더: {}", install_dir.display());
    println!("실행 중인 Ptyloom이 강제 종료되며, 저장된 모든 북마크와 자격 증명이 영구 삭제됩니다.");

    let answer = read_line_trimmed("\n정말로 Ptyloom을 완전히 삭제하시겠습니까? (y/N): ")
        .map_err(|e| format!("입력 읽기 실패: {e}"))?;
    if !is_confirm_yes(&answer) {
        println!("삭제를 취소했습니다.");
        return Ok(());
    }

    println!("\nPtyloom 프로세스 종료 및 데이터를 삭제하는 중입니다...");
    kill_running_ptyloom();
    delete_keyring_master_key();

    let errors = remove_sqlite_and_data(app_data_dir, Some(install_dir));
    if !errors.is_empty() {
        for err in &errors {
            eprintln!("[경고] 일부 파일 삭제 실패: {err}");
        }
    }

    if is_safe_install_dir(install_dir) {
        println!("SQLite DB 및 사용자 데이터 삭제를 완료했습니다.");
        println!("설치 폴더({})를 정리한 뒤 종료합니다.", install_dir.display());
        wait_enter();
        spawn_self_delete_folder(install_dir);
    } else {
        for fname in [
            "ptyloom.exe",
            "ptyloom-desktop.exe",
            "ptyloom",
            "uninstall.exe",
            "README.md",
            "LICENSE",
        ] {
            let p = install_dir.join(fname);
            if p.exists() {
                let _ = fs::remove_file(p);
            }
        }
        let app_bundle = install_dir.join("Ptyloom Terminal.app");
        if app_bundle.exists() {
            let _ = fs::remove_dir_all(app_bundle);
        }
        println!("SQLite DB 및 Ptyloom 실행 파일 삭제를 완료했습니다.");
        println!("현재 폴더는 공용 폴더일 수 있어 안전을 위해 유지하고 manager 실행 파일만 제거합니다.");
        wait_enter();
        spawn_self_delete_file(exe_path);
    }

    Ok(())
}

fn main() {
    let Ok(exe_path) = std::env::current_exe() else {
        eprintln!("실행 파일 경로를 확인할 수 없습니다.");
        std::process::exit(1);
    };
    let Some(install_dir) = exe_path.parent().map(Path::to_path_buf) else {
        eprintln!("설치 디렉토리를 확인할 수 없습니다.");
        std::process::exit(1);
    };
    let app_data_dir = resolve_app_data_dir();

    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(flag) = args.first() {
        if flag == "--update" {
            if let Err(e) = run_update(&install_dir, &exe_path) {
                eprintln!("[오류] {e}");
                std::process::exit(1);
            }
            return;
        }
        if flag == "--uninstall" {
            if let Err(e) = run_uninstall(&install_dir, &exe_path, app_data_dir.as_deref()) {
                eprintln!("[오류] {e}");
                std::process::exit(1);
            }
            return;
        }
    }

    println!("========================================");
    println!("  Ptyloom Manager (v{CURRENT_VERSION})");
    println!("========================================");
    println!("설치 폴더: {}", install_dir.display());
    if let Some(ref data_dir) = app_data_dir {
        println!("데이터 폴더: {}", data_dir.display());
    }
    println!();
    println!("1. 업데이트 (GitHub Releases 최신 버전 확인 및 파일 교체)");
    println!("2. 삭제 (Ptyloom 앱, SQLite DB 및 설정 완전 제거)");
    println!("0. 종료");

    match read_line_trimmed("\n원하는 작업 번호를 입력하세요 [1/2/0]: ") {
        Ok(choice) if choice == "1" => {
            if let Err(e) = run_update(&install_dir, &exe_path) {
                eprintln!("\n[업데이트 실패] {e}");
            }
            wait_enter();
        }
        Ok(choice) if choice == "2" => {
            if let Err(e) = run_uninstall(&install_dir, &exe_path, app_data_dir.as_deref()) {
                eprintln!("\n[삭제 실패] {e}");
                wait_enter();
            }
        }
        Ok(choice) if choice == "0" || choice.is_empty() => {
            println!("종료합니다.");
        }
        Ok(other) => {
            println!("잘못된 입력입니다 ({other}). 1, 2 또는 0을 입력해 주세요.");
            wait_enter();
        }
        Err(e) => {
            eprintln!("입력을 읽지 못했습니다: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ptyloom_mgr_{label}_{}_{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn version_comparison_detects_newer_release() {
        assert!(is_newer_version("0.3.0", "v0.3.1").unwrap());
        assert!(is_newer_version("0.3.0", "0.4.0").unwrap());
        assert!(!is_newer_version("0.3.0", "v0.3.0").unwrap());
        assert!(!is_newer_version("0.3.0", "v0.2.0").unwrap());
    }

    #[test]
    fn select_release_asset_matches_os_and_arch() {
        let assets = vec![
            GithubAsset {
                name: "ptyloom-v0.4.0-windows-x86_64.zip".into(),
                browser_download_url: "https://example.com/win.zip".into(),
            },
            GithubAsset {
                name: "ptyloom-v0.4.0-macos-arm64.tar.gz".into(),
                browser_download_url: "https://example.com/mac.tar.gz".into(),
            },
            GithubAsset {
                name: "ptyloom-v0.4.0-macos-arm64.zip".into(),
                browser_download_url: "https://example.com/mac.zip".into(),
            },
            GithubAsset {
                name: "ptyloom-v0.4.0-linux-x86_64.tar.gz".into(),
                browser_download_url: "https://example.com/linux.tar.gz".into(),
            },
        ];

        assert_eq!(
            select_release_asset(&assets, "windows", "x86_64").unwrap().name,
            "ptyloom-v0.4.0-windows-x86_64.zip"
        );
        assert_eq!(
            select_release_asset(&assets, "macos", "aarch64").unwrap().name,
            "ptyloom-v0.4.0-macos-arm64.tar.gz"
        );
        assert_eq!(
            select_release_asset(&assets, "linux", "x86_64").unwrap().name,
            "ptyloom-v0.4.0-linux-x86_64.tar.gz"
        );
    }

    #[test]
    fn confirm_uninstall_accepts_only_y_or_upper_y() {
        assert!(is_confirm_yes("y"));
        assert!(is_confirm_yes("Y"));
        assert!(is_confirm_yes("  Y \n"));
        assert!(!is_confirm_yes(""));
        assert!(!is_confirm_yes("n"));
        assert!(!is_confirm_yes("yes"));
    }

    #[test]
    fn find_extracted_package_root_unwraps_single_subdir() {
        let dir = test_temp_dir("unwrap");
        let nested = dir.join("ptyloom-v0.4.0-linux-x86_64");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("ptyloom"), b"bin").unwrap();

        assert_eq!(find_extracted_package_root(&dir), nested);

        fs::write(dir.join("extra.txt"), b"x").unwrap();
        assert_eq!(find_extracted_package_root(&dir), dir);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_update_replaces_files_and_nested_directories() {
        let base = test_temp_dir("apply_update");
        let pkg = base.join("pkg");
        let install = base.join("install");
        fs::create_dir_all(pkg.join("Ptyloom Terminal.app/Contents/MacOS")).unwrap();
        fs::create_dir_all(install.join("Ptyloom Terminal.app/Contents/MacOS")).unwrap();

        fs::write(pkg.join("ptyloom"), b"new-bin").unwrap();
        fs::write(
            pkg.join("Ptyloom Terminal.app/Contents/MacOS/ptyloom-desktop"),
            b"new-app",
        )
        .unwrap();
        fs::write(install.join("ptyloom"), b"old-bin").unwrap();
        fs::write(
            install.join("Ptyloom Terminal.app/Contents/MacOS/ptyloom-desktop"),
            b"old-app",
        )
        .unwrap();

        let mgr_src = pkg.join(if cfg!(target_os = "windows") {
            "ptyloom-manager.exe"
        } else {
            "ptyloom-manager"
        });
        let mgr_dst = install.join(if cfg!(target_os = "windows") {
            "ptyloom-manager.exe"
        } else {
            "ptyloom-manager"
        });
        fs::write(&mgr_src, b"new-mgr").unwrap();
        fs::write(&mgr_dst, b"old-mgr").unwrap();

        let old_self = apply_update_from_dir(&pkg, &install, Some(&mgr_dst)).unwrap();
        assert_eq!(fs::read(install.join("ptyloom")).unwrap(), b"new-bin");
        assert_eq!(
            fs::read(install.join("Ptyloom Terminal.app/Contents/MacOS/ptyloom-desktop")).unwrap(),
            b"new-app"
        );
        assert_eq!(fs::read(&mgr_dst).unwrap(), b"new-mgr");

        #[cfg(target_os = "windows")]
        assert!(old_self.is_some());
        #[cfg(not(target_os = "windows"))]
        assert!(old_self.is_none());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn safe_install_dir_rejects_system_and_user_roots() {
        #[cfg(target_os = "windows")]
        let root_path = Path::new("C:\\");
        #[cfg(not(target_os = "windows"))]
        let root_path = Path::new("/");

        let desktop_dir = PathBuf::from("Users").join("Alice").join("Desktop");
        let program_files_dir = PathBuf::from("System").join("Program Files");
        let safe_install_dir = PathBuf::from("Apps").join("ptyloom-v0.3.0-windows-x86_64");

        assert!(!is_safe_install_dir(root_path));
        assert!(!is_safe_install_dir(Path::new("ptyloom")));
        assert!(!is_safe_install_dir(&desktop_dir));
        assert!(!is_safe_install_dir(&program_files_dir));
        assert!(is_safe_install_dir(&safe_install_dir));
    }

    #[test]
    fn remove_sqlite_and_data_cleans_all_db_artifacts() {
        let base = test_temp_dir("cleanup");
        let data_dir = base.join("appdata").join(APP_IDENTIFIER);
        let install_dir = base.join("ptyloom-v0.3.0-windows-x86_64");
        fs::create_dir_all(&data_dir).unwrap();
        fs::create_dir_all(&install_dir).unwrap();
        fs::write(data_dir.join("ptyloom.db"), b"db").unwrap();
        fs::write(data_dir.join("ptyloom.db-wal"), b"wal").unwrap();
        fs::write(data_dir.join(".ptyloom-master.key"), b"key").unwrap();
        fs::write(install_dir.join("ptyloom.db"), b"local").unwrap();

        let errs = remove_sqlite_and_data(Some(&data_dir), Some(&install_dir));
        assert!(errs.is_empty(), "Unexpected errors: {errs:?}");
        assert!(!data_dir.exists());
        assert!(!install_dir.join("ptyloom.db").exists());

        let _ = fs::remove_dir_all(&base);
    }
}
