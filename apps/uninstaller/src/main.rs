#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use std::fs;
use std::path::{Component, Path, PathBuf};

const APP_IDENTIFIER: &str = "dev.conduit.terminal";

#[cfg(target_os = "windows")]
const KEYRING_SERVICE: &str = "conduit-terminal";
#[cfg(target_os = "windows")]
const KEYRING_ACCOUNT: &str = "master-key";

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
        "conduit.db",
        "conduit.db-wal",
        "conduit.db-shm",
        ".conduit-master.key",
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
    ];
    if blocked_names.contains(&lower_name.as_str()) {
        return false;
    }

    for env_var in ["USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "WINDIR"] {
        if let Some(val) = std::env::var_os(env_var) {
            if PathBuf::from(val) == dir {
                return false;
            }
        }
    }

    dir.join("conduit.exe").exists()
        || dir.join("conduit-desktop.exe").exists()
        || lower_name.contains("conduit")
}

#[cfg(target_os = "windows")]
mod win_impl {
    use super::*;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    const MB_OK: u32 = 0x00000000;
    const MB_YESNO: u32 = 0x00000004;
    const MB_ICONWARNING: u32 = 0x00000030;
    const MB_ICONINFORMATION: u32 = 0x00000040;
    const MB_DEFBUTTON2: u32 = 0x00000100;
    const IDYES: i32 = 6;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: *mut core::ffi::c_void, text: *const u16, caption: *const u16, u_type: u32) -> i32;
    }

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    fn message_box(text: &str, caption: &str, flags: u32) -> i32 {
        let w_text = to_wide(text);
        let w_cap = to_wide(caption);
        unsafe { MessageBoxW(core::ptr::null_mut(), w_text.as_ptr(), w_cap.as_ptr(), flags) }
    }

    fn kill_running_conduit() {
        for exe in ["conduit.exe", "conduit-desktop.exe"] {
            let _ = Command::new("taskkill")
                .args(["/F", "/IM", exe])
                .creation_flags(CREATE_NO_WINDOW)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }

    fn delete_keyring_master_key() {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT) {
            let _ = entry.delete_credential();
        }
    }

    fn spawn_self_delete_folder(install_dir: &Path) {
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

    fn spawn_self_delete_exe(exe_path: &Path) {
        let escaped = exe_path.to_string_lossy().replace('"', "");
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

    pub fn run() {
        let Ok(exe_path) = std::env::current_exe() else {
            return;
        };
        let Some(install_dir) = exe_path.parent().map(Path::to_path_buf) else {
            return;
        };
        let app_data_dir = resolve_app_data_dir();
        let data_desc = app_data_dir
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "%APPDATA%\\dev.conduit.terminal".into());

        let prompt = format!(
            "Conduit Terminal을 완전히 삭제하시겠습니까?\n\n\
             삭제 대상:\n\
             - SQLite DB 및 설정: {data_desc}\n\
             - 설치 폴더: {}\n\n\
             실행 중인 Conduit이 있다면 강제 종료되며, 저장된 모든 북마크와 자격 증명이 영구 삭제됩니다.",
            install_dir.display()
        );

        let choice = message_box(
            &prompt,
            "Conduit Terminal 제거 (Uninstall)",
            MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2,
        );
        if choice != IDYES {
            return;
        }

        kill_running_conduit();
        delete_keyring_master_key();

        let _ = remove_sqlite_and_data(app_data_dir.as_deref(), Some(&install_dir));

        if is_safe_install_dir(&install_dir) {
            message_box(
                "SQLite DB 및 사용자 데이터 삭제를 완료했습니다.\n확인을 누르면 프로그램 폴더를 삭제하고 종료합니다.",
                "Conduit Terminal 제거 완료",
                MB_OK | MB_ICONINFORMATION,
            );
            spawn_self_delete_folder(&install_dir);
        } else {
            for fname in ["conduit.exe", "conduit-desktop.exe", "README.md", "LICENSE"] {
                let p = install_dir.join(fname);
                if p.exists() {
                    let _ = fs::remove_file(p);
                }
            }
            message_box(
                "SQLite DB 및 Conduit 실행 파일 삭제를 완료했습니다.\n현재 폴더는 공용 폴더일 수 있어 안전을 위해 유지하고 uninstall.exe만 제거합니다.",
                "Conduit Terminal 제거 완료",
                MB_OK | MB_ICONINFORMATION,
            );
            spawn_self_delete_exe(&exe_path);
        }
    }
}

fn main() {
    #[cfg(target_os = "windows")]
    win_impl::run();

    #[cfg(not(target_os = "windows"))]
    {
        eprintln!("Conduit uninstall.exe is designed for Windows portable builds.");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_install_dir_rejects_system_and_user_roots() {
        #[cfg(target_os = "windows")]
        let root_path = Path::new("C:\\");
        #[cfg(not(target_os = "windows"))]
        let root_path = Path::new("/");

        let desktop_dir = PathBuf::from("Users").join("Alice").join("Desktop");
        let program_files_dir = PathBuf::from("System").join("Program Files");
        let safe_install_dir = PathBuf::from("Apps").join("conduit-v0.3.0-windows-x86_64");

        assert!(!is_safe_install_dir(root_path));
        assert!(!is_safe_install_dir(Path::new("conduit")));
        assert!(!is_safe_install_dir(&desktop_dir));
        assert!(!is_safe_install_dir(&program_files_dir));
        assert!(is_safe_install_dir(&safe_install_dir));
    }

    #[test]
    fn remove_sqlite_and_data_cleans_all_db_artifacts() {
        let base = std::env::temp_dir().join(format!("conduit_uninst_test_{}", std::process::id()));
        let data_dir = base.join("appdata").join(APP_IDENTIFIER);
        let install_dir = base.join("conduit-v0.2.0-windows-x86_64");
        fs::create_dir_all(&data_dir).unwrap();
        fs::create_dir_all(&install_dir).unwrap();
        fs::write(data_dir.join("conduit.db"), b"db").unwrap();
        fs::write(data_dir.join("conduit.db-wal"), b"wal").unwrap();
        fs::write(data_dir.join(".conduit-master.key"), b"key").unwrap();
        fs::write(install_dir.join("conduit.db"), b"local").unwrap();

        let errs = remove_sqlite_and_data(Some(&data_dir), Some(&install_dir));
        assert!(errs.is_empty(), "Unexpected errors: {errs:?}");
        assert!(!data_dir.exists());
        assert!(!install_dir.join("conduit.db").exists());

        let _ = fs::remove_dir_all(&base);
    }
}
