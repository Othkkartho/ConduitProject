mod commands;

use commands::AppState;
use ptyloom_core::SessionManager;
use ptyloom_storage::StorageRepository;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ptyloom_desktop=info".into()),
        )
        .init();

    tauri::Builder::default()
        .setup(|app| {
            let db_path = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join("ptyloom.db");
            let storage = Arc::new(
                StorageRepository::open(&db_path)
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?,
            );
            let mp_status = storage
                .get_master_password_status()
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            let initially_unlocked = !(mp_status.enabled && mp_status.configured);
            let sessions = SessionManager::new();
            app.manage(AppState {
                sessions,
                storage,
                unlocked: AtomicBool::new(initially_unlocked),
            });

            let view_left = MenuItemBuilder::with_id("toggle_left_sidebar", "좌측 사이드바 토글")
                .accelerator("CmdOrCtrl+B")
                .build(app)?;
            let view_right = MenuItemBuilder::with_id("toggle_right_sidebar", "우측 사이드바 토글")
                .accelerator("CmdOrCtrl+Alt+B")
                .build(app)?;
            let view_bottom = MenuItemBuilder::with_id("toggle_bottom_panel", "하단 패널 토글")
                .accelerator("CmdOrCtrl+J")
                .build(app)?;
            let view_bookmarks = MenuItemBuilder::with_id("toggle_view_bookmarks", "세션 북마크")
                .accelerator("CmdOrCtrl+Shift+B")
                .build(app)?;
            let view_broadcast = MenuItemBuilder::with_id("toggle_view_broadcast", "Broadcast 입력")
                .accelerator("CmdOrCtrl+Shift+M")
                .build(app)?;
            let view_sftp = MenuItemBuilder::with_id("toggle_view_sftp", "SFTP 탐색기")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;
            let save_bookmark_item =
                MenuItemBuilder::with_id("save_bookmark", "현재 세션을 북마크에 저장")
                    .accelerator("CmdOrCtrl+Shift+D")
                    .build(app)?;
            let quick_ssh_item =
                MenuItemBuilder::with_id("open_quick_ssh", "간편 SSH 연결")
                    .accelerator("CmdOrCtrl+Shift+E")
                    .build(app)?;
            let view_menu = SubmenuBuilder::new(app, "보기")
                .item(&view_left)
                .item(&view_right)
                .item(&view_bottom)
                .separator()
                .item(&view_bookmarks)
                .item(&view_broadcast)
                .item(&view_sftp)
                .separator()
                .item(&quick_ssh_item)
                .item(&save_bookmark_item)
                .build()?;

            let manual_item = MenuItemBuilder::with_id("open_manual", "사용자 매뉴얼 (F1)")
                .accelerator("F1")
                .build(app)?;
            let settings_item = MenuItemBuilder::with_id("open_settings", "환경 설정")
                .accelerator("CmdOrCtrl+,")
                .build(app)?;
            let help_menu = SubmenuBuilder::new(app, "도움말")
                .item(&manual_item)
                .item(&settings_item)
                .build()?;
            let menu = MenuBuilder::new(app)
                .item(&view_menu)
                .item(&help_menu)
                .build()?;
            app.set_menu(menu)?;

            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open_manual" => {
                let _ = app.emit("open-user-manual", ());
            }
            "open_settings" => {
                let _ = app.emit("open-settings", ());
            }
            "open_quick_ssh" => {
                let _ = app.emit("open-quick-ssh", ());
            }
            "save_bookmark" => {
                let _ = app.emit("save-bookmark-from-pane", ());
            }
            "toggle_left_sidebar" => {
                let _ = app.emit("toggle-left-sidebar", ());
            }
            "toggle_right_sidebar" => {
                let _ = app.emit("toggle-right-sidebar", ());
            }
            "toggle_bottom_panel" => {
                let _ = app.emit("toggle-bottom-panel", ());
            }
            "toggle_view_bookmarks" => {
                let _ = app.emit("toggle-view-bookmarks", ());
            }
            "toggle_view_broadcast" => {
                let _ = app.emit("toggle-view-broadcast", ());
            }
            "toggle_view_sftp" => {
                let _ = app.emit("toggle-view-sftp", ());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_session,
            commands::write_session,
            commands::broadcast_sessions,
            commands::resize_session,
            commands::ack_session,
            commands::close_session,
            commands::set_session_encoding,
            commands::test_session_connection,
            commands::reset_saved_sessions,
            commands::list_bookmark_tree,
            commands::upsert_folder,
            commands::delete_folder,
            commands::upsert_bookmark,
            commands::delete_bookmark,
            commands::reorder_bookmark_tree,
            commands::export_bookmarks,
            commands::import_bookmarks,
            commands::build_config_from_bookmark,
            commands::get_settings,
            commands::save_settings,
            commands::get_master_password_status,
            commands::verify_master_password,
            commands::set_master_password,
            commands::disable_master_password,
            commands::list_serial_ports,
            commands::sftp_list_dir,
            commands::sftp_download,
            commands::sftp_upload,
            commands::sftp_mkdir,
            commands::sftp_remove,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ptyloom desktop application");
}
