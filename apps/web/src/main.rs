mod rest;
mod ws;

use axum::{
    routing::{delete, get, post},
    Router,
};
use conduit_core::SessionManager;
use conduit_storage::StorageRepository;
use std::path::PathBuf;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tracing::info;

#[derive(Clone)]
pub struct WebState {
    pub sessions: Arc<SessionManager>,
    pub storage: Arc<StorageRepository>,
    pub access_control: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "conduit_web=info,tower_http=info".into()),
        )
        .init();

    let bind_addr = std::env::var("CONDUIT_BIND").unwrap_or_else(|_| "127.0.0.1:3030".into());
    let db_path = PathBuf::from(
        std::env::var("CONDUIT_DB").unwrap_or_else(|_| "./conduit.db".into()),
    );
    let frontend_dir = PathBuf::from(
        std::env::var("CONDUIT_FRONTEND_DIR").unwrap_or_else(|_| "./frontend/dist".into()),
    );
    // Personal / local PC default: access control disabled (planned for future release)
    let access_control = std::env::var("CONDUIT_ACCESS_CONTROL")
        .map(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);

    let storage = Arc::new(StorageRepository::open(&db_path)?);
    let sessions = SessionManager::new();
    let state = WebState {
        sessions,
        storage,
        access_control,
    };

    let api_router = Router::new()
        .route("/api/health", get(rest::health))
        .route("/api/bookmarks", get(rest::list_bookmarks).post(rest::upsert_bookmark))
        .route("/api/bookmarks/reorder", post(rest::reorder_bookmarks))
        .route("/api/bookmarks/export", get(rest::export_bookmarks))
        .route("/api/bookmarks/import", post(rest::import_bookmarks))
        .route("/api/bookmarks/{id}", delete(rest::delete_bookmark))
        .route("/api/bookmarks/{id}/connect", post(rest::connect_bookmark))
        .route("/api/folders", post(rest::upsert_folder))
        .route("/api/folders/{id}", delete(rest::delete_folder))
        .route("/api/settings", get(rest::get_settings).put(rest::save_settings))
        .route("/api/serial/ports", get(rest::list_serial_ports))
        .route("/api/sftp/{session_id}/list", post(rest::sftp_list))
        .route("/api/sftp/{session_id}/download", post(rest::sftp_download))
        .route("/api/sftp/{session_id}/upload", post(rest::sftp_upload))
        .route("/api/sftp/{session_id}/mkdir", post(rest::sftp_mkdir))
        .route("/api/sftp/{session_id}/remove", post(rest::sftp_remove))
        .route("/ws/terminal", get(ws::ws_handler))
        .with_state(state);

    let index_html = frontend_dir.join("index.html");
    let static_service = ServeDir::new(&frontend_dir).not_found_service(ServeFile::new(index_html));

    let app = api_router
        .fallback_service(static_service)
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    info!("Conduit Web Server listening on http://{bind_addr} (access_control={access_control})");
    axum::serve(listener, app).await?;
    Ok(())
}
