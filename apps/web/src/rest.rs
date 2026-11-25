use crate::WebState;
use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use conduit_protocol::{
    AppSettings, BookmarkExportBundle, BookmarkImportRequest, BookmarkImportResult, BookmarkTree,
    BookmarkUpsertRequest, Folder, SessionConfig, SessionId, SftpEntry, TerminalSize,
    TreeReorderRequest,
};
use serde::Deserialize;

type ApiErr = (StatusCode, String);

fn internal_err(err: impl ToString) -> ApiErr {
    (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
}

pub async fn health(State(state): State<WebState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "conduit-web",
        "access_control": state.access_control
    }))
}

pub async fn list_bookmarks(State(state): State<WebState>) -> Result<Json<BookmarkTree>, ApiErr> {
    state.storage.list_tree().map(Json).map_err(internal_err)
}

pub async fn upsert_bookmark(
    State(state): State<WebState>,
    Json(req): Json<BookmarkUpsertRequest>,
) -> Result<StatusCode, ApiErr> {
    state
        .storage
        .upsert_bookmark(&req.bookmark, req.secret.as_deref())
        .map_err(internal_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_bookmark(
    State(state): State<WebState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiErr> {
    state.storage.delete_bookmark(&id).map_err(internal_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn reorder_bookmarks(
    State(state): State<WebState>,
    Json(req): Json<TreeReorderRequest>,
) -> Result<StatusCode, ApiErr> {
    state
        .storage
        .reorder_tree(&req)
        .map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct ExportQuery {
    #[serde(default)]
    pub include_secrets: bool,
}

pub async fn export_bookmarks(
    State(state): State<WebState>,
    Query(query): Query<ExportQuery>,
) -> Result<Json<BookmarkExportBundle>, ApiErr> {
    state
        .storage
        .export_bookmarks(query.include_secrets)
        .map(Json)
        .map_err(internal_err)
}

pub async fn import_bookmarks(
    State(state): State<WebState>,
    Json(req): Json<BookmarkImportRequest>,
) -> Result<Json<BookmarkImportResult>, ApiErr> {
    state
        .storage
        .import_bookmarks(&req)
        .map(Json)
        .map_err(internal_err)
}

pub async fn connect_bookmark(
    State(state): State<WebState>,
    Path(id): Path<String>,
    Json(size): Json<TerminalSize>,
) -> Result<Json<SessionConfig>, ApiErr> {
    state
        .storage
        .build_session_config(&id, size)
        .map(Json)
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))
}

pub async fn upsert_folder(
    State(state): State<WebState>,
    Json(folder): Json<Folder>,
) -> Result<StatusCode, ApiErr> {
    state.storage.upsert_folder(&folder).map_err(internal_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_folder(
    State(state): State<WebState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiErr> {
    state.storage.delete_folder(&id).map_err(internal_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn get_settings(State(state): State<WebState>) -> Result<Json<AppSettings>, ApiErr> {
    state.storage.get_settings().map(Json).map_err(internal_err)
}

pub async fn save_settings(
    State(state): State<WebState>,
    Json(settings): Json<AppSettings>,
) -> Result<StatusCode, ApiErr> {
    state
        .storage
        .save_settings(&settings)
        .map_err(internal_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_serial_ports(State(state): State<WebState>) -> Json<Vec<String>> {
    Json(state.sessions.list_serial_ports())
}

#[derive(Deserialize)]
pub struct PathReq {
    pub path: String,
}

#[derive(Deserialize)]
pub struct RemoveReq {
    pub path: String,
    pub is_dir: bool,
}

pub async fn sftp_list(
    State(state): State<WebState>,
    Path(session_id): Path<SessionId>,
    Json(req): Json<PathReq>,
) -> Result<Json<Vec<SftpEntry>>, ApiErr> {
    state
        .sessions
        .sftp_list_dir(session_id, &req.path)
        .await
        .map(Json)
        .map_err(internal_err)
}

pub async fn sftp_download(
    State(state): State<WebState>,
    Path(session_id): Path<SessionId>,
    Json(req): Json<PathReq>,
) -> Result<Vec<u8>, ApiErr> {
    state
        .sessions
        .sftp_read_file(session_id, &req.path)
        .await
        .map_err(internal_err)
}

pub async fn sftp_upload(
    State(state): State<WebState>,
    Path(session_id): Path<SessionId>,
    Query(query): Query<PathReq>,
    body: Bytes,
) -> Result<StatusCode, ApiErr> {
    state
        .sessions
        .sftp_write_file(session_id, &query.path, &body)
        .await
        .map_err(internal_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn sftp_mkdir(
    State(state): State<WebState>,
    Path(session_id): Path<SessionId>,
    Json(req): Json<PathReq>,
) -> Result<StatusCode, ApiErr> {
    state
        .sessions
        .sftp_mkdir(session_id, &req.path)
        .await
        .map_err(internal_err)?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn sftp_remove(
    State(state): State<WebState>,
    Path(session_id): Path<SessionId>,
    Json(req): Json<RemoveReq>,
) -> Result<StatusCode, ApiErr> {
    state
        .sessions
        .sftp_remove(session_id, &req.path, req.is_dir)
        .await
        .map_err(internal_err)?;
    Ok(StatusCode::NO_CONTENT)
}
