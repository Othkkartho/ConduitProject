use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PortForwardKind {
    Local,
    Remote,
    Dynamic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForwardRule {
    pub id: String,
    pub kind: PortForwardKind,
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: Option<String>,
    pub target_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: String,
    pub folder_id: Option<String>,
    pub name: String,
    pub protocol: String, // "local_pty" | "ssh" | "serial" | "telnet"
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub shell: Option<String>,
    pub cwd: Option<String>,
    pub serial_port: Option<String>,
    pub baud_rate: Option<u32>,
    pub auth_type: Option<String>, // "password" | "private_key"
    pub key_path: Option<String>,
    pub credential_id: Option<String>,
    #[serde(default)]
    pub sort_order: i32,
    #[serde(default)]
    pub port_forwards: Vec<PortForwardRule>,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderPosition {
    pub id: String,
    pub parent_id: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkPosition {
    pub id: String,
    pub folder_id: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeReorderRequest {
    pub folders: Vec<FolderPosition>,
    pub bookmarks: Vec<BookmarkPosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportedBookmark {
    #[serde(flatten)]
    pub bookmark: Bookmark,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkExportBundle {
    pub version: u32,
    pub exported_at: String,
    pub folders: Vec<Folder>,
    pub bookmarks: Vec<ExportedBookmark>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ImportMode {
    #[default]
    Merge,
    Replace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkImportRequest {
    pub bundle: BookmarkExportBundle,
    #[serde(default)]
    pub mode: ImportMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkImportResult {
    pub folders_imported: usize,
    pub bookmarks_imported: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkUpsertRequest {
    pub bookmark: Bookmark,
    /// Optional plaintext password or private-key passphrase to encrypt into vault
    pub secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookmarkTree {
    pub folders: Vec<Folder>,
    pub bookmarks: Vec<Bookmark>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub theme: String,
    pub font_family: String,
    pub font_size: u16,
    pub ligatures: bool,
    pub cursor_style: String, // "block" | "underline" | "bar"
    pub cursor_blink: bool,
    pub scrollback: u32,
    #[serde(default)]
    pub confirm_on_close: bool,
    pub shortcuts: HashMap<String, String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        let mut shortcuts = HashMap::new();
        shortcuts.insert("manual".into(), "F1".into());
        shortcuts.insert("new_tab".into(), "Ctrl+Shift+T".into());
        shortcuts.insert("quick_connect".into(), "Ctrl+Shift+E".into());
        shortcuts.insert("save_bookmark".into(), "Ctrl+Shift+D".into());
        shortcuts.insert("toggle_bookmarks".into(), "Ctrl+Shift+B".into());
        shortcuts.insert("toggle_broadcast".into(), "Ctrl+Shift+M".into());
        shortcuts.insert("toggle_sftp".into(), "Ctrl+Shift+S".into());
        shortcuts.insert("toggle_left_sidebar".into(), "Ctrl+B".into());
        shortcuts.insert("toggle_bottom_panel".into(), "Ctrl+J".into());
        shortcuts.insert("toggle_right_sidebar".into(), "Ctrl+Alt+B".into());
        shortcuts.insert("search_terminal".into(), "Ctrl+Shift+F".into());
        shortcuts.insert("open_settings".into(), "Ctrl+,".into());

        Self {
            theme: "catppuccin-mocha".into(),
            font_family: "\"JetBrainsMono Nerd Font\", \"Cascadia Code\", \"FiraCode Nerd Font\", monospace".into(),
            font_size: 14,
            ligatures: true,
            cursor_style: "block".into(),
            cursor_blink: true,
            scrollback: 10000,
            confirm_on_close: false,
            shortcuts,
        }
    }
}
