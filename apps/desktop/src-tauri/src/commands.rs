use bytes::Bytes;
use ptyloom_core::SessionManager;
use ptyloom_protocol::{
    AppSettings, BookmarkExportBundle, BookmarkImportRequest, BookmarkImportResult, BookmarkTree,
    BookmarkUpsertRequest, Folder, MasterPasswordStatus, SessionConfig, SessionId, SftpEntry,
    SshAuth, TerminalSize, TreeReorderRequest,
};
use ptyloom_storage::StorageRepository;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

pub struct AppState {
    pub sessions: Arc<SessionManager>,
    pub storage: Arc<StorageRepository>,
    pub unlocked: AtomicBool,
}

fn ensure_unlocked(state: &AppState) -> Result<(), String> {
    if state.unlocked.load(Ordering::Acquire) {
        Ok(())
    } else {
        Err("마스터 패스워드 잠금 해제가 필요합니다.".into())
    }
}

#[tauri::command]
pub async fn create_session(
    state: State<'_, AppState>,
    config: SessionConfig,
    on_data: Channel<InvokeResponseBody>,
) -> Result<SessionId, String> {
    ensure_unlocked(&state)?;
    state
        .sessions
        .create_session(config, move |chunk: Bytes| {
            on_data.send(InvokeResponseBody::Raw(chunk.to_vec())).is_ok()
        })
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_session(
    state: State<'_, AppState>,
    session_id: SessionId,
    data: Vec<u8>,
) -> Result<(), String> {
    state
        .sessions
        .write(session_id, Bytes::from(data))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn broadcast_sessions(
    state: State<'_, AppState>,
    session_ids: Vec<SessionId>,
    data: Vec<u8>,
) -> Result<(), String> {
    state
        .sessions
        .broadcast(&session_ids, Bytes::from(data))
        .await;
    Ok(())
}

#[tauri::command]
pub async fn resize_session(
    state: State<'_, AppState>,
    session_id: SessionId,
    size: TerminalSize,
) -> Result<(), String> {
    state
        .sessions
        .resize(session_id, size)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ack_session(state: State<'_, AppState>, session_id: SessionId, bytes: usize) {
    state.sessions.ack(session_id, bytes);
}

#[tauri::command]
pub async fn close_session(
    state: State<'_, AppState>,
    session_id: SessionId,
) -> Result<(), String> {
    state
        .sessions
        .close(session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_session_encoding(
    state: State<'_, AppState>,
    session_id: SessionId,
    encoding: String,
) -> Result<(), String> {
    state
        .sessions
        .set_encoding(session_id, &encoding)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_session_connection(
    state: State<'_, AppState>,
    mut config: SessionConfig,
    fallback_bookmark_id: Option<String>,
) -> Result<(), String> {
    if let (SessionConfig::Ssh { auth, .. }, Some(bm_id)) = (&mut config, fallback_bookmark_id) {
        match auth {
            SshAuth::Password { password } if password.is_empty() => {
                if let Ok(Some(saved)) = state.storage.load_bookmark_secret(&bm_id) {
                    *password = saved;
                }
            }
            SshAuth::PrivateKey { passphrase, .. } if passphrase.is_none() => {
                if let Ok(Some(saved)) = state.storage.load_bookmark_secret(&bm_id) {
                    *passphrase = Some(saved);
                }
            }
            _ => {}
        }
    }
    SessionManager::test_connection(config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reset_saved_sessions(state: State<'_, AppState>) -> Result<(), String> {
    ensure_unlocked(&state)?;
    state
        .storage
        .reset_saved_sessions()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_bookmark_tree(state: State<'_, AppState>) -> Result<BookmarkTree, String> {
    ensure_unlocked(&state)?;
    state.storage.list_tree().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn upsert_folder(state: State<'_, AppState>, folder: Folder) -> Result<(), String> {
    ensure_unlocked(&state)?;
    state
        .storage
        .upsert_folder(&folder)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_folder(state: State<'_, AppState>, id: String) -> Result<(), String> {
    ensure_unlocked(&state)?;
    state.storage.delete_folder(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn upsert_bookmark(
    state: State<'_, AppState>,
    req: BookmarkUpsertRequest,
) -> Result<(), String> {
    ensure_unlocked(&state)?;
    state
        .storage
        .upsert_bookmark(&req.bookmark, req.secret.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_bookmark(state: State<'_, AppState>, id: String) -> Result<(), String> {
    ensure_unlocked(&state)?;
    state
        .storage
        .delete_bookmark(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reorder_bookmark_tree(
    state: State<'_, AppState>,
    req: TreeReorderRequest,
) -> Result<(), String> {
    ensure_unlocked(&state)?;
    state.storage.reorder_tree(&req).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_bookmarks(
    state: State<'_, AppState>,
    include_secrets: bool,
) -> Result<BookmarkExportBundle, String> {
    ensure_unlocked(&state)?;
    state
        .storage
        .export_bookmarks(include_secrets)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_bookmarks(
    state: State<'_, AppState>,
    req: BookmarkImportRequest,
) -> Result<BookmarkImportResult, String> {
    ensure_unlocked(&state)?;
    state
        .storage
        .import_bookmarks(&req)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn build_config_from_bookmark(
    state: State<'_, AppState>,
    bookmark_id: String,
    size: TerminalSize,
) -> Result<SessionConfig, String> {
    ensure_unlocked(&state)?;
    state
        .storage
        .build_session_config(&bookmark_id, size)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state.storage.get_settings().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<(), String> {
    ensure_unlocked(&state)?;
    state
        .storage
        .save_settings(&settings)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_master_password_status(
    state: State<'_, AppState>,
) -> Result<MasterPasswordStatus, String> {
    let mut status = state
        .storage
        .get_master_password_status()
        .map_err(|e| e.to_string())?;
    status.unlocked = state.unlocked.load(Ordering::Acquire);
    Ok(status)
}

#[tauri::command]
pub fn verify_master_password(state: State<'_, AppState>, password: String) -> Result<bool, String> {
    let ok = state
        .storage
        .verify_master_password(&password)
        .map_err(|e| e.to_string())?;
    if ok {
        state.unlocked.store(true, Ordering::Release);
    }
    Ok(ok)
}

#[tauri::command]
pub fn set_master_password(
    state: State<'_, AppState>,
    new_password: String,
    current_password: Option<String>,
) -> Result<(), String> {
    ensure_unlocked(&state)?;
    state
        .storage
        .set_master_password(&new_password, current_password.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn disable_master_password(
    state: State<'_, AppState>,
    current_password: String,
) -> Result<(), String> {
    ensure_unlocked(&state)?;
    state
        .storage
        .disable_master_password(&current_password)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_serial_ports(state: State<'_, AppState>) -> Vec<String> {
    state.sessions.list_serial_ports()
}

#[tauri::command]
pub async fn sftp_list_dir(
    state: State<'_, AppState>,
    session_id: SessionId,
    path: String,
) -> Result<Vec<SftpEntry>, String> {
    state
        .sessions
        .sftp_list_dir(session_id, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_download(
    state: State<'_, AppState>,
    session_id: SessionId,
    path: String,
) -> Result<Vec<u8>, String> {
    state
        .sessions
        .sftp_read_file(session_id, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    session_id: SessionId,
    path: String,
    data: Vec<u8>,
) -> Result<(), String> {
    state
        .sessions
        .sftp_write_file(session_id, &path, &data)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: SessionId,
    path: String,
) -> Result<(), String> {
    state
        .sessions
        .sftp_mkdir(session_id, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_remove(
    state: State<'_, AppState>,
    session_id: SessionId,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    state
        .sessions
        .sftp_remove(session_id, &path, is_dir)
        .await
        .map_err(|e| e.to_string())
}
