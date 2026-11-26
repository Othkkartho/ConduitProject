use crate::vault::{SecretVault, VaultError};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::Utc;
use conduit_protocol::{
    AppSettings, Bookmark, BookmarkExportBundle, BookmarkImportRequest, BookmarkImportResult,
    BookmarkTree, ExportedBookmark, Folder, ImportMode, MasterPasswordStatus, SerialConfig,
    SessionConfig, SshAuth, TelnetConfig, TerminalSize, TreeReorderRequest,
};
use pbkdf2::pbkdf2_hmac;
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use subtle::ConstantTimeEq;
use thiserror::Error;

const MASTER_PW_ITERATIONS: u32 = 100_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredMasterPassword {
    salt_b64: String,
    hash_b64: String,
    iterations: u32,
}

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Vault error: {0}")]
    Vault(#[from] VaultError),
    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("Bookmark not found: {0}")]
    NotFound(String),
    #[error("Invalid operation: {0}")]
    Invalid(String),
    #[error("Lock poisoned")]
    Lock,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyCheck {
    Trusted,
    NewlyAdded,
    Mismatch { expected: String, actual: String },
}

pub struct StorageRepository {
    conn: Mutex<Connection>,
    vault: SecretVault,
}

impl StorageRepository {
    pub fn open(db_path: &Path) -> Result<Self, StorageError> {
        if let Some(parent) = db_path.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).ok();
            }
        }
        let conn = Connection::open(db_path)?;
        let fallback_key = db_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(".conduit-master.key");
        let vault = SecretVault::open("conduit-terminal", "master-key", &fallback_key)?;
        let repo = Self {
            conn: Mutex::new(conn),
            vault,
        };
        repo.init_schema()?;
        Ok(repo)
    }

    pub fn open_in_memory() -> Result<Self, StorageError> {
        let conn = Connection::open_in_memory()?;
        let vault = SecretVault::ephemeral();
        let repo = Self {
            conn: Mutex::new(conn),
            vault,
        };
        repo.init_schema()?;
        Ok(repo)
    }

    fn init_schema(&self) -> Result<(), StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
        conn.execute_batch(
            "
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                parent_id TEXT NULL,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS bookmarks (
                id TEXT PRIMARY KEY,
                folder_id TEXT NULL,
                name TEXT NOT NULL,
                protocol TEXT NOT NULL,
                host TEXT NULL,
                port INTEGER NULL,
                username TEXT NULL,
                shell TEXT NULL,
                cwd TEXT NULL,
                serial_port TEXT NULL,
                baud_rate INTEGER NULL,
                auth_type TEXT NULL,
                key_path TEXT NULL,
                credential_id TEXT NULL,
                encoding TEXT NOT NULL DEFAULT 'utf-8',
                sort_order INTEGER NOT NULL DEFAULT 0,
                port_forwards_json TEXT NOT NULL DEFAULT '[]',
                notes TEXT NOT NULL DEFAULT '',
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS secrets (
                id TEXT PRIMARY KEY,
                ciphertext_b64 TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS known_hosts (
                host_port TEXT PRIMARY KEY,
                algorithm TEXT NOT NULL,
                fingerprint TEXT NOT NULL,
                first_seen_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL
            );
            ",
        )?;

        // Migrate existing databases created prior to `sort_order` / `encoding` on bookmarks
        let mut has_sort_order = false;
        let mut has_encoding = false;
        {
            let mut stmt = conn.prepare("PRAGMA table_info(bookmarks)")?;
            let cols = stmt.query_map([], |row| row.get::<_, String>(1))?;
            for col in cols {
                match col?.as_str() {
                    "sort_order" => has_sort_order = true,
                    "encoding" => has_encoding = true,
                    _ => {}
                }
            }
        }
        if !has_sort_order {
            conn.execute(
                "ALTER TABLE bookmarks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        if !has_encoding {
            conn.execute(
                "ALTER TABLE bookmarks ADD COLUMN encoding TEXT NOT NULL DEFAULT 'utf-8'",
                [],
            )?;
        }
        Ok(())
    }

    pub fn list_tree(&self) -> Result<BookmarkTree, StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;

        let mut f_stmt = conn.prepare(
            "SELECT id, parent_id, name, sort_order FROM folders ORDER BY sort_order ASC, name ASC",
        )?;
        let folders = f_stmt
            .query_map([], |row| {
                Ok(Folder {
                    id: row.get(0)?,
                    parent_id: row.get(1)?,
                    name: row.get(2)?,
                    sort_order: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut b_stmt = conn.prepare(
            "SELECT id, folder_id, name, protocol, host, port, username, shell, cwd,
                    serial_port, baud_rate, auth_type, key_path, credential_id,
                    encoding, sort_order, port_forwards_json, notes
             FROM bookmarks ORDER BY sort_order ASC, name ASC",
        )?;
        let bookmarks = b_stmt
            .query_map([], |row| {
                let pf_json: String = row.get(16)?;
                let port_forwards = serde_json::from_str(&pf_json).unwrap_or_default();
                Ok(Bookmark {
                    id: row.get(0)?,
                    folder_id: row.get(1)?,
                    name: row.get(2)?,
                    protocol: row.get(3)?,
                    host: row.get(4)?,
                    port: row.get::<_, Option<i64>>(5)?.map(|p| p as u16),
                    username: row.get(6)?,
                    shell: row.get(7)?,
                    cwd: row.get(8)?,
                    serial_port: row.get(9)?,
                    baud_rate: row.get::<_, Option<i64>>(10)?.map(|b| b as u32),
                    auth_type: row.get(11)?,
                    key_path: row.get(12)?,
                    credential_id: row.get(13)?,
                    encoding: row.get(14)?,
                    sort_order: row.get(15)?,
                    port_forwards,
                    notes: row.get(17)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(BookmarkTree { folders, bookmarks })
    }

    pub fn upsert_folder(&self, folder: &Folder) -> Result<(), StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
        conn.execute(
            "INSERT INTO folders (id, parent_id, name, sort_order)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET
               parent_id = excluded.parent_id,
               name = excluded.name,
               sort_order = excluded.sort_order",
            params![folder.id, folder.parent_id, folder.name, folder.sort_order],
        )?;
        Ok(())
    }

    pub fn delete_folder(&self, folder_id: &str) -> Result<(), StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
        let parent_id: Option<String> = conn
            .query_row(
                "SELECT parent_id FROM folders WHERE id = ?1",
                params![folder_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        conn.execute(
            "UPDATE bookmarks SET folder_id = ?1 WHERE folder_id = ?2",
            params![parent_id, folder_id],
        )?;
        conn.execute(
            "UPDATE folders SET parent_id = ?1 WHERE parent_id = ?2",
            params![parent_id, folder_id],
        )?;
        conn.execute("DELETE FROM folders WHERE id = ?1", params![folder_id])?;
        Ok(())
    }

    pub fn upsert_bookmark(
        &self,
        bookmark: &Bookmark,
        secret_plaintext: Option<&str>,
    ) -> Result<(), StorageError> {
        let mut bookmark_to_save = bookmark.clone();
        bookmark_to_save.name = bookmark_to_save.name.trim().to_string();
        if bookmark_to_save.name.is_empty() {
            return Err(StorageError::Invalid("세션 이름을 입력해 주세요.".into()));
        }
        if bookmark_to_save.encoding.trim().is_empty() {
            bookmark_to_save.encoding = "utf-8".into();
        }

        {
            let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
            let duplicate: Option<i64> = conn
                .query_row(
                    "SELECT 1 FROM bookmarks WHERE TRIM(name) = ?1 AND id != ?2 LIMIT 1",
                    params![bookmark_to_save.name, bookmark_to_save.id],
                    |row| row.get(0),
                )
                .optional()?;
            if duplicate.is_some() {
                return Err(StorageError::Invalid(format!(
                    "이미 '{}' 이름의 세션이 존재합니다. 다른 이름을 입력해 주세요.",
                    bookmark_to_save.name
                )));
            }
        }

        if let Some(secret) = secret_plaintext {
            if !secret.is_empty() {
                let cred_id = bookmark_to_save
                    .credential_id
                    .clone()
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                self.save_secret(&cred_id, secret)?;
                bookmark_to_save.credential_id = Some(cred_id);
            }
        }

        let pf_json = serde_json::to_string(&bookmark_to_save.port_forwards)?;
        let now = Utc::now().timestamp();
        let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
        conn.execute(
            "INSERT INTO bookmarks (
                id, folder_id, name, protocol, host, port, username, shell, cwd,
                serial_port, baud_rate, auth_type, key_path, credential_id,
                encoding, sort_order, port_forwards_json, notes, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
             ON CONFLICT(id) DO UPDATE SET
                folder_id = excluded.folder_id,
                name = excluded.name,
                protocol = excluded.protocol,
                host = excluded.host,
                port = excluded.port,
                username = excluded.username,
                shell = excluded.shell,
                cwd = excluded.cwd,
                serial_port = excluded.serial_port,
                baud_rate = excluded.baud_rate,
                auth_type = excluded.auth_type,
                key_path = excluded.key_path,
                credential_id = excluded.credential_id,
                encoding = excluded.encoding,
                sort_order = excluded.sort_order,
                port_forwards_json = excluded.port_forwards_json,
                notes = excluded.notes,
                updated_at = excluded.updated_at",
            params![
                bookmark_to_save.id,
                bookmark_to_save.folder_id,
                bookmark_to_save.name,
                bookmark_to_save.protocol,
                bookmark_to_save.host,
                bookmark_to_save.port.map(|p| p as i64),
                bookmark_to_save.username,
                bookmark_to_save.shell,
                bookmark_to_save.cwd,
                bookmark_to_save.serial_port,
                bookmark_to_save.baud_rate.map(|b| b as i64),
                bookmark_to_save.auth_type,
                bookmark_to_save.key_path,
                bookmark_to_save.credential_id,
                bookmark_to_save.encoding,
                bookmark_to_save.sort_order,
                pf_json,
                bookmark_to_save.notes,
                now
            ],
        )?;
        Ok(())
    }

    /// Updates folder parent/sort_order and bookmark folder_id/sort_order atomically,
    /// rejecting any folder hierarchy cycles.
    pub fn reorder_tree(&self, req: &TreeReorderRequest) -> Result<(), StorageError> {
        let mut conn = self.conn.lock().map_err(|_| StorageError::Lock)?;

        // Build full folder parent map after applying requested changes to validate cycles
        let mut parent_map: HashMap<String, Option<String>> = HashMap::new();
        {
            let mut stmt = conn.prepare("SELECT id, parent_id FROM folders")?;
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })?;
            for row in rows {
                let (id, pid) = row?;
                parent_map.insert(id, pid);
            }
        }
        for fp in &req.folders {
            if parent_map.contains_key(&fp.id) {
                if fp.parent_id.as_deref() == Some(fp.id.as_str()) {
                    return Err(StorageError::Invalid("Folder cannot be its own parent".into()));
                }
                parent_map.insert(fp.id.clone(), fp.parent_id.clone());
            }
        }
        for id in parent_map.keys() {
            let mut visited = HashSet::new();
            let mut cur = Some(id.as_str());
            while let Some(node_id) = cur {
                if !visited.insert(node_id) {
                    return Err(StorageError::Invalid("Folder hierarchy cycle detected".into()));
                }
                cur = parent_map.get(node_id).and_then(|p| p.as_deref());
            }
        }

        let tx = conn.transaction()?;
        for fp in &req.folders {
            tx.execute(
                "UPDATE folders SET parent_id = ?1, sort_order = ?2 WHERE id = ?3",
                params![fp.parent_id, fp.sort_order, fp.id],
            )?;
        }
        for bp in &req.bookmarks {
            tx.execute(
                "UPDATE bookmarks SET folder_id = ?1, sort_order = ?2 WHERE id = ?3",
                params![bp.folder_id, bp.sort_order, bp.id],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn export_bookmarks(&self, include_secrets: bool) -> Result<BookmarkExportBundle, StorageError> {
        let tree = self.list_tree()?;
        let mut exported = Vec::with_capacity(tree.bookmarks.len());
        for mut bm in tree.bookmarks {
            let secret = if include_secrets {
                match bm.credential_id.as_deref() {
                    Some(cid) => self.load_secret(cid)?,
                    None => None,
                }
            } else {
                bm.credential_id = None;
                None
            };
            exported.push(ExportedBookmark {
                bookmark: bm,
                secret,
            });
        }

        Ok(BookmarkExportBundle {
            version: 1,
            exported_at: Utc::now().to_rfc3339(),
            folders: tree.folders,
            bookmarks: exported,
        })
    }

    pub fn import_bookmarks(
        &self,
        req: &BookmarkImportRequest,
    ) -> Result<BookmarkImportResult, StorageError> {
        if req.mode == ImportMode::Replace {
            let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
            conn.execute_batch("DELETE FROM bookmarks; DELETE FROM folders; DELETE FROM secrets;")?;
        }

        let mut known_folders: HashSet<String> = self
            .list_tree()?
            .folders
            .into_iter()
            .map(|f| f.id)
            .collect();
        for f in &req.bundle.folders {
            known_folders.insert(f.id.clone());
        }

        let mut folders_imported = 0;
        for f in &req.bundle.folders {
            let mut folder = f.clone();
            if folder.parent_id.as_deref() == Some(folder.id.as_str())
                || folder
                    .parent_id
                    .as_ref()
                    .is_some_and(|pid| !known_folders.contains(pid))
            {
                folder.parent_id = None;
            }
            self.upsert_folder(&folder)?;
            folders_imported += 1;
        }

        let mut bookmarks_imported = 0;
        for item in &req.bundle.bookmarks {
            let mut bm = item.bookmark.clone();
            if bm
                .folder_id
                .as_ref()
                .is_some_and(|fid| !known_folders.contains(fid))
            {
                bm.folder_id = None;
            }
            if item.secret.is_none() {
                bm.credential_id = None;
            }
            self.upsert_bookmark(&bm, item.secret.as_deref())?;
            bookmarks_imported += 1;
        }

        Ok(BookmarkImportResult {
            folders_imported,
            bookmarks_imported,
        })
    }

    pub fn delete_bookmark(&self, id: &str) -> Result<(), StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
        let cred_id: Option<String> = conn
            .query_row(
                "SELECT credential_id FROM bookmarks WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])?;
        if let Some(cid) = cred_id {
            conn.execute("DELETE FROM secrets WHERE id = ?1", params![cid])?;
        }
        Ok(())
    }

    /// Removes all saved folders, bookmarks, and encrypted session secrets while preserving app settings.
    pub fn reset_saved_sessions(&self) -> Result<(), StorageError> {
        let mut conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
        let tx = conn.transaction()?;
        tx.execute_batch("DELETE FROM bookmarks; DELETE FROM folders; DELETE FROM secrets;")?;
        tx.commit()?;
        Ok(())
    }

    pub fn load_bookmark_secret(&self, bookmark_id: &str) -> Result<Option<String>, StorageError> {
        let cred_id: Option<String> = {
            let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
            conn.query_row(
                "SELECT credential_id FROM bookmarks WHERE id = ?1",
                params![bookmark_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten()
        };
        match cred_id {
            Some(cid) => self.load_secret(&cid),
            None => Ok(None),
        }
    }

    pub fn save_secret(&self, id: &str, plaintext: &str) -> Result<(), StorageError> {
        let encrypted = self.vault.encrypt(plaintext)?;
        let now = Utc::now().timestamp();
        let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
        conn.execute(
            "INSERT INTO secrets (id, ciphertext_b64, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET
               ciphertext_b64 = excluded.ciphertext_b64,
               updated_at = excluded.updated_at",
            params![id, encrypted, now],
        )?;
        Ok(())
    }

    pub fn load_secret(&self, id: &str) -> Result<Option<String>, StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
        let cipher: Option<String> = conn
            .query_row(
                "SELECT ciphertext_b64 FROM secrets WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        drop(conn);
        match cipher {
            Some(c) => Ok(Some(self.vault.decrypt(&c)?)),
            None => Ok(None),
        }
    }

    pub fn verify_or_store_host_key(
        &self,
        host_port: &str,
        algorithm: &str,
        fingerprint: &str,
    ) -> Result<HostKeyCheck, StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
        let existing: Option<String> = conn
            .query_row(
                "SELECT fingerprint FROM known_hosts WHERE host_port = ?1",
                params![host_port],
                |row| row.get(0),
            )
            .optional()?;

        match existing {
            Some(expected) if expected == fingerprint => Ok(HostKeyCheck::Trusted),
            Some(expected) => Ok(HostKeyCheck::Mismatch {
                expected,
                actual: fingerprint.to_string(),
            }),
            None => {
                let now = Utc::now().timestamp();
                conn.execute(
                    "INSERT INTO known_hosts (host_port, algorithm, fingerprint, first_seen_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![host_port, algorithm, fingerprint, now],
                )?;
                Ok(HostKeyCheck::NewlyAdded)
            }
        }
    }

    pub fn get_settings(&self) -> Result<AppSettings, StorageError> {
        let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT value_json FROM settings WHERE key = 'app_settings'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        match raw {
            Some(json) => Ok(serde_json::from_str(&json)?),
            None => Ok(AppSettings::default()),
        }
    }

    fn save_settings_raw(&self, settings: &AppSettings) -> Result<(), StorageError> {
        let json = serde_json::to_string(settings)?;
        let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
        conn.execute(
            "INSERT INTO settings (key, value_json) VALUES ('app_settings', ?1)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
            params![json],
        )?;
        Ok(())
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), StorageError> {
        let mut to_save = settings.clone();
        to_save.master_password_enabled = self.get_settings()?.master_password_enabled;
        self.save_settings_raw(&to_save)
    }

    pub fn get_master_password_status(&self) -> Result<MasterPasswordStatus, StorageError> {
        let enabled = self.get_settings()?.master_password_enabled;
        let configured = {
            let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
            let raw: Option<String> = conn
                .query_row(
                    "SELECT value_json FROM settings WHERE key = 'master_password_hash'",
                    [],
                    |row| row.get(0),
                )
                .optional()?;
            raw.is_some()
        };
        Ok(MasterPasswordStatus {
            enabled,
            configured,
            unlocked: !(enabled && configured),
        })
    }

    pub fn verify_master_password(&self, candidate: &str) -> Result<bool, StorageError> {
        let raw: Option<String> = {
            let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
            conn.query_row(
                "SELECT value_json FROM settings WHERE key = 'master_password_hash'",
                [],
                |row| row.get(0),
            )
            .optional()?
        };
        let Some(json) = raw else {
            return Ok(false);
        };
        let stored: StoredMasterPassword = serde_json::from_str(&json)?;
        let salt = B64
            .decode(stored.salt_b64)
            .map_err(|_| StorageError::Invalid("손상된 마스터 패스워드 데이터".into()))?;
        let expected = B64
            .decode(stored.hash_b64)
            .map_err(|_| StorageError::Invalid("손상된 마스터 패스워드 데이터".into()))?;
        if expected.len() != 32 {
            return Ok(false);
        }
        let mut derived = [0u8; 32];
        pbkdf2_hmac::<Sha256>(candidate.as_bytes(), &salt, stored.iterations, &mut derived);
        Ok(bool::from(derived.ct_eq(&expected)))
    }

    pub fn set_master_password(
        &self,
        new_password: &str,
        current_password: Option<&str>,
    ) -> Result<(), StorageError> {
        if new_password.is_empty() {
            return Err(StorageError::Invalid("마스터 패스워드를 입력해 주세요.".into()));
        }
        let status = self.get_master_password_status()?;
        if status.enabled && status.configured {
            let cur = current_password.unwrap_or("");
            if !self.verify_master_password(cur)? {
                return Err(StorageError::Invalid(
                    "현재 마스터 패스워드가 일치하지 않습니다.".into(),
                ));
            }
        }

        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);
        let mut derived = [0u8; 32];
        pbkdf2_hmac::<Sha256>(
            new_password.as_bytes(),
            &salt,
            MASTER_PW_ITERATIONS,
            &mut derived,
        );
        let stored = StoredMasterPassword {
            salt_b64: B64.encode(salt),
            hash_b64: B64.encode(derived),
            iterations: MASTER_PW_ITERATIONS,
        };
        let json = serde_json::to_string(&stored)?;
        {
            let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
            conn.execute(
                "INSERT INTO settings (key, value_json) VALUES ('master_password_hash', ?1)
                 ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
                params![json],
            )?;
        }

        let mut settings = self.get_settings()?;
        settings.master_password_enabled = true;
        self.save_settings_raw(&settings)
    }

    pub fn disable_master_password(&self, current_password: &str) -> Result<(), StorageError> {
        let status = self.get_master_password_status()?;
        if status.enabled && status.configured && !self.verify_master_password(current_password)? {
            return Err(StorageError::Invalid(
                "현재 마스터 패스워드가 일치하지 않습니다.".into(),
            ));
        }
        {
            let conn = self.conn.lock().map_err(|_| StorageError::Lock)?;
            conn.execute(
                "DELETE FROM settings WHERE key = 'master_password_hash'",
                [],
            )?;
        }
        let mut settings = self.get_settings()?;
        settings.master_password_enabled = false;
        self.save_settings_raw(&settings)
    }

    /// Resolves a stored bookmark and decrypts any associated secret into a runnable SessionConfig.
    pub fn build_session_config(
        &self,
        bookmark_id: &str,
        size: TerminalSize,
    ) -> Result<SessionConfig, StorageError> {
        let tree = self.list_tree()?;
        let bm = tree
            .bookmarks
            .into_iter()
            .find(|b| b.id == bookmark_id)
            .ok_or_else(|| StorageError::NotFound(bookmark_id.to_string()))?;

        let secret = match bm.credential_id.as_deref() {
            Some(cid) => self.load_secret(cid)?,
            None => None,
        };

        let encoding = if bm.encoding.trim().is_empty() {
            "utf-8".to_string()
        } else {
            bm.encoding
        };

        match bm.protocol.as_str() {
            "ssh" => {
                let auth = match bm.auth_type.as_deref() {
                    Some("private_key") => SshAuth::PrivateKey {
                        key_path: bm.key_path.unwrap_or_default(),
                        passphrase: secret,
                    },
                    _ => SshAuth::Password {
                        password: secret.unwrap_or_default(),
                    },
                };
                Ok(SessionConfig::Ssh {
                    host: bm.host.unwrap_or_else(|| "127.0.0.1".into()),
                    port: bm.port.unwrap_or(22),
                    username: bm.username.unwrap_or_else(|| "root".into()),
                    auth,
                    size,
                    encoding,
                })
            }
            "serial" => Ok(SessionConfig::Serial(SerialConfig {
                port_name: bm.serial_port.unwrap_or_default(),
                baud_rate: bm.baud_rate.unwrap_or(115200),
                data_bits: 8,
                parity: Default::default(),
                stop_bits: 1,
                encoding,
            })),
            "telnet" => Ok(SessionConfig::Telnet(TelnetConfig {
                host: bm.host.unwrap_or_else(|| "127.0.0.1".into()),
                port: bm.port.unwrap_or(23),
                size,
                encoding,
            })),
            _ => Ok(SessionConfig::LocalPty {
                shell: bm.shell,
                cwd: bm.cwd,
                size,
                encoding,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_bookmarks_and_secrets_crud() {
        let repo = StorageRepository::open_in_memory().unwrap();
        let folder = Folder {
            id: "f1".into(),
            parent_id: None,
            name: "Production".into(),
            sort_order: 0,
        };
        repo.upsert_folder(&folder).unwrap();

        let bm = Bookmark {
            id: "b1".into(),
            folder_id: Some("f1".into()),
            name: "Prod Web".into(),
            protocol: "ssh".into(),
            host: Some("10.0.0.10".into()),
            port: Some(22),
            username: Some("ubuntu".into()),
            shell: None,
            cwd: None,
            serial_port: None,
            baud_rate: None,
            auth_type: Some("password".into()),
            key_path: None,
            credential_id: Some("cred-1".into()),
            encoding: "utf-8".into(),
            sort_order: 0,
            port_forwards: vec![],
            notes: "Main node".into(),
        };
        repo.upsert_bookmark(&bm, Some("my-secret-pass")).unwrap();

        let tree = repo.list_tree().unwrap();
        assert_eq!(tree.folders.len(), 1);
        assert_eq!(tree.bookmarks.len(), 1);
        assert_eq!(tree.bookmarks[0].name, "Prod Web");

        let loaded = repo.load_secret("cred-1").unwrap().unwrap();
        assert_eq!(loaded, "my-secret-pass");

        repo.delete_bookmark("b1").unwrap();
        assert!(repo.load_secret("cred-1").unwrap().is_none());
    }

    #[test]
    fn host_key_tofu_and_settings() {
        let repo = StorageRepository::open_in_memory().unwrap();
        assert_eq!(
            repo.verify_or_store_host_key("example.com:22", "ssh-ed25519", "SHA256:abc")
                .unwrap(),
            HostKeyCheck::NewlyAdded
        );
        assert_eq!(
            repo.verify_or_store_host_key("example.com:22", "ssh-ed25519", "SHA256:abc")
                .unwrap(),
            HostKeyCheck::Trusted
        );
        assert_eq!(
            repo.verify_or_store_host_key("example.com:22", "ssh-ed25519", "SHA256:xyz")
                .unwrap(),
            HostKeyCheck::Mismatch {
                expected: "SHA256:abc".into(),
                actual: "SHA256:xyz".into(),
            }
        );

        let mut settings = repo.get_settings().unwrap();
        assert!(settings.confirm_on_close);
        settings.font_size = 16;
        settings.theme = "tokyo-night".into();
        settings.confirm_on_close = false;
        repo.save_settings(&settings).unwrap();

        let reloaded = repo.get_settings().unwrap();
        assert_eq!(reloaded.font_size, 16);
        assert_eq!(reloaded.theme, "tokyo-night");
        assert!(!reloaded.confirm_on_close);
    }

    #[test]
    fn nested_folders_crud_and_reparent_on_delete() {
        let repo = StorageRepository::open_in_memory().unwrap();
        repo.upsert_folder(&Folder {
            id: "root".into(),
            parent_id: None,
            name: "Root".into(),
            sort_order: 0,
        })
        .unwrap();
        repo.upsert_folder(&Folder {
            id: "child".into(),
            parent_id: Some("root".into()),
            name: "Child".into(),
            sort_order: 0,
        })
        .unwrap();
        repo.upsert_folder(&Folder {
            id: "grandchild".into(),
            parent_id: Some("child".into()),
            name: "Grandchild".into(),
            sort_order: 0,
        })
        .unwrap();
        repo.upsert_bookmark(
            &Bookmark {
                id: "bm-nested".into(),
                folder_id: Some("child".into()),
                name: "Nested SSH".into(),
                protocol: "ssh".into(),
                host: Some("192.168.0.10".into()),
                port: Some(22),
                username: Some("test".into()),
                shell: None,
                cwd: None,
                serial_port: None,
                baud_rate: None,
                auth_type: Some("password".into()),
                key_path: None,
                credential_id: None,
                encoding: "utf-8".into(),
                sort_order: 0,
                port_forwards: vec![],
                notes: String::new(),
            },
            None,
        )
        .unwrap();

        repo.delete_folder("child").unwrap();
        let tree = repo.list_tree().unwrap();
        let grandchild = tree.folders.iter().find(|f| f.id == "grandchild").unwrap();
        assert_eq!(grandchild.parent_id.as_deref(), Some("root"));
        let bm = tree.bookmarks.iter().find(|b| b.id == "bm-nested").unwrap();
        assert_eq!(bm.folder_id.as_deref(), Some("root"));
    }

    #[test]
    fn reorder_tree_moves_and_rejects_cycles() {
        use conduit_protocol::{BookmarkPosition, FolderPosition};

        let repo = StorageRepository::open_in_memory().unwrap();
        repo.upsert_folder(&Folder {
            id: "f1".into(),
            parent_id: None,
            name: "Alpha".into(),
            sort_order: 0,
        })
        .unwrap();
        repo.upsert_folder(&Folder {
            id: "f2".into(),
            parent_id: Some("f1".into()),
            name: "Beta".into(),
            sort_order: 0,
        })
        .unwrap();
        repo.upsert_bookmark(
            &Bookmark {
                id: "b1".into(),
                folder_id: Some("f1".into()),
                name: "S1".into(),
                protocol: "ssh".into(),
                host: Some("10.0.0.1".into()),
                port: Some(22),
                username: Some("root".into()),
                shell: None,
                cwd: None,
                serial_port: None,
                baud_rate: None,
                auth_type: Some("password".into()),
                key_path: None,
                credential_id: None,
                encoding: "utf-8".into(),
                sort_order: 1,
                port_forwards: vec![],
                notes: String::new(),
            },
            None,
        )
        .unwrap();

        // Cycle attempt: f1 -> child of f2
        let bad = repo.reorder_tree(&TreeReorderRequest {
            folders: vec![FolderPosition {
                id: "f1".into(),
                parent_id: Some("f2".into()),
                sort_order: 0,
            }],
            bookmarks: vec![],
        });
        assert!(bad.is_err());

        // Valid move: f2 -> root at sort_order 0, f1 -> sort_order 1, b1 -> f2 at sort_order 0
        repo.reorder_tree(&TreeReorderRequest {
            folders: vec![
                FolderPosition {
                    id: "f2".into(),
                    parent_id: None,
                    sort_order: 0,
                },
                FolderPosition {
                    id: "f1".into(),
                    parent_id: None,
                    sort_order: 1,
                },
            ],
            bookmarks: vec![BookmarkPosition {
                id: "b1".into(),
                folder_id: Some("f2".into()),
                sort_order: 0,
            }],
        })
        .unwrap();

        let tree = repo.list_tree().unwrap();
        assert_eq!(tree.folders[0].id, "f2");
        assert_eq!(tree.folders[0].parent_id, None);
        assert_eq!(tree.bookmarks[0].folder_id.as_deref(), Some("f2"));
    }

    #[test]
    fn export_and_import_bookmarks_merge_and_replace() {
        let src = StorageRepository::open_in_memory().unwrap();
        src.upsert_folder(&Folder {
            id: "f1".into(),
            parent_id: None,
            name: "Prod".into(),
            sort_order: 0,
        })
        .unwrap();
        src.upsert_bookmark(
            &Bookmark {
                id: "b1".into(),
                folder_id: Some("f1".into()),
                name: "Web1".into(),
                protocol: "ssh".into(),
                host: Some("10.0.0.2".into()),
                port: Some(22),
                username: Some("admin".into()),
                shell: None,
                cwd: None,
                serial_port: None,
                baud_rate: None,
                auth_type: Some("password".into()),
                key_path: None,
                credential_id: Some("c1".into()),
                encoding: "utf-8".into(),
                sort_order: 0,
                port_forwards: vec![],
                notes: String::new(),
            },
            Some("s3cr3t"),
        )
        .unwrap();

        let no_secret_bundle = src.export_bookmarks(false).unwrap();
        assert!(no_secret_bundle.bookmarks[0].secret.is_none());
        assert!(no_secret_bundle.bookmarks[0].bookmark.credential_id.is_none());

        let with_secret_bundle = src.export_bookmarks(true).unwrap();
        assert_eq!(
            with_secret_bundle.bookmarks[0].secret.as_deref(),
            Some("s3cr3t")
        );

        let dst = StorageRepository::open_in_memory().unwrap();
        dst.upsert_folder(&Folder {
            id: "existing".into(),
            parent_id: None,
            name: "Existing".into(),
            sort_order: 0,
        })
        .unwrap();

        let res_merge = dst
            .import_bookmarks(&BookmarkImportRequest {
                bundle: with_secret_bundle.clone(),
                mode: ImportMode::Merge,
            })
            .unwrap();
        assert_eq!(res_merge.folders_imported, 1);
        assert_eq!(res_merge.bookmarks_imported, 1);
        assert_eq!(dst.list_tree().unwrap().folders.len(), 2);

        let res_replace = dst
            .import_bookmarks(&BookmarkImportRequest {
                bundle: with_secret_bundle,
                mode: ImportMode::Replace,
            })
            .unwrap();
        assert_eq!(res_replace.folders_imported, 1);
        let after = dst.list_tree().unwrap();
        assert_eq!(after.folders.len(), 1);
        assert_eq!(
            dst.load_secret(after.bookmarks[0].credential_id.as_deref().unwrap())
                .unwrap()
                .as_deref(),
            Some("s3cr3t")
        );
    }

    #[test]
    fn encoding_persists_in_bookmark_and_session_config() {
        let repo = StorageRepository::open_in_memory().unwrap();
        let bm = Bookmark {
            id: "bm-kr".into(),
            folder_id: None,
            name: "Legacy EUC-KR".into(),
            protocol: "ssh".into(),
            host: Some("10.0.0.9".into()),
            port: Some(22),
            username: Some("legacy".into()),
            shell: None,
            cwd: None,
            serial_port: None,
            baud_rate: None,
            auth_type: Some("password".into()),
            key_path: None,
            credential_id: None,
            encoding: "euc-kr".into(),
            sort_order: 0,
            port_forwards: vec![],
            notes: String::new(),
        };
        repo.upsert_bookmark(&bm, Some("pw")).unwrap();
        let tree = repo.list_tree().unwrap();
        assert_eq!(tree.bookmarks[0].encoding, "euc-kr");

        let cfg = repo
            .build_session_config("bm-kr", TerminalSize::default())
            .unwrap();
        assert_eq!(cfg.encoding(), "euc-kr");
    }

    #[test]
    fn duplicate_bookmark_name_is_rejected_and_self_update_allowed() {
        let repo = StorageRepository::open_in_memory().unwrap();
        let make_bm = |id: &str, name: &str| Bookmark {
            id: id.into(),
            folder_id: None,
            name: name.into(),
            protocol: "local_pty".into(),
            host: None,
            port: None,
            username: None,
            shell: None,
            cwd: None,
            serial_port: None,
            baud_rate: None,
            auth_type: None,
            key_path: None,
            credential_id: None,
            encoding: "utf-8".into(),
            sort_order: 0,
            port_forwards: vec![],
            notes: String::new(),
        };

        repo.upsert_bookmark(&make_bm("b1", "Prod Server"), None).unwrap();
        // Same ID update should succeed
        repo.upsert_bookmark(&make_bm("b1", "Prod Server"), None).unwrap();
        // Different ID with same trimmed name should fail
        let dup = repo.upsert_bookmark(&make_bm("b2", "  Prod Server "), None);
        assert!(dup.is_err());
    }

    #[test]
    fn reset_saved_sessions_clears_tree_and_secrets_preserves_settings() {
        let repo = StorageRepository::open_in_memory().unwrap();
        repo.upsert_folder(&Folder {
            id: "f1".into(),
            parent_id: None,
            name: "F1".into(),
            sort_order: 0,
        })
        .unwrap();
        repo.upsert_bookmark(
            &Bookmark {
                id: "b1".into(),
                folder_id: Some("f1".into()),
                name: "S1".into(),
                protocol: "ssh".into(),
                host: Some("10.0.0.1".into()),
                port: Some(22),
                username: Some("root".into()),
                shell: None,
                cwd: None,
                serial_port: None,
                baud_rate: None,
                auth_type: Some("password".into()),
                key_path: None,
                credential_id: Some("sec-1".into()),
                encoding: "utf-8".into(),
                sort_order: 0,
                port_forwards: vec![],
                notes: String::new(),
            },
            Some("secret"),
        )
        .unwrap();

        let mut s = repo.get_settings().unwrap();
        s.theme = "github-light".into();
        repo.save_settings(&s).unwrap();

        repo.reset_saved_sessions().unwrap();
        let tree = repo.list_tree().unwrap();
        assert!(tree.folders.is_empty());
        assert!(tree.bookmarks.is_empty());
        assert!(repo.load_secret("sec-1").unwrap().is_none());
        assert_eq!(repo.get_settings().unwrap().theme, "github-light");
    }

    #[test]
    fn master_password_lifecycle_and_settings_preservation() {
        let repo = StorageRepository::open_in_memory().unwrap();
        let initial = repo.get_master_password_status().unwrap();
        assert!(!initial.enabled);
        assert!(!initial.configured);
        assert!(initial.unlocked);

        repo.set_master_password("s3cret-master", None).unwrap();
        let enabled = repo.get_master_password_status().unwrap();
        assert!(enabled.enabled);
        assert!(enabled.configured);
        assert!(!enabled.unlocked);

        assert!(repo.verify_master_password("s3cret-master").unwrap());
        assert!(!repo.verify_master_password("wrong").unwrap());

        // General save_settings must not overwrite master_password_enabled to false
        let mut settings = repo.get_settings().unwrap();
        settings.master_password_enabled = false;
        settings.theme = "pure-white".into();
        repo.save_settings(&settings).unwrap();
        assert!(repo.get_settings().unwrap().master_password_enabled);

        // Changing password requires valid current password
        assert!(repo.set_master_password("next-pw", Some("wrong")).is_err());
        repo.set_master_password("next-pw", Some("s3cret-master"))
            .unwrap();
        assert!(repo.verify_master_password("next-pw").unwrap());

        // Disabling requires valid current password
        assert!(repo.disable_master_password("wrong").is_err());
        repo.disable_master_password("next-pw").unwrap();
        let disabled = repo.get_master_password_status().unwrap();
        assert!(!disabled.enabled);
        assert!(!disabled.configured);
        assert!(disabled.unlocked);
    }
}
