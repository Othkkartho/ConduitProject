use crate::backend::SessionError;
use ptyloom_protocol::SftpEntry;
use russh_sftp::client::SftpSession;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub struct SftpClient {
    session: SftpSession,
}

impl SftpClient {
    pub fn new(session: SftpSession) -> Self {
        Self { session }
    }

    pub async fn list_dir(&self, path: &str) -> Result<Vec<SftpEntry>, SessionError> {
        let target = if path.trim().is_empty() { "." } else { path };
        let read_dir = self
            .session
            .read_dir(target)
            .await
            .map_err(|e| SessionError::Sftp(e.to_string()))?;

        let base = if target == "." { "" } else { target.trim_end_matches('/') };
        let mut entries = Vec::new();
        for item in read_dir {
            let name = item.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let meta = item.metadata();
            let full_path = if base.is_empty() {
                name.clone()
            } else {
                format!("{base}/{name}")
            };
            entries.push(SftpEntry {
                name,
                path: full_path,
                is_dir: meta.is_dir(),
                size: meta.size.unwrap_or(0),
                modified: meta.mtime.map(|m| m as u64),
                permissions: meta.permissions,
            });
        }

        entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
        Ok(entries)
    }

    pub async fn read_file(&self, path: &str) -> Result<Vec<u8>, SessionError> {
        let mut file = self
            .session
            .open(path)
            .await
            .map_err(|e| SessionError::Sftp(e.to_string()))?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)
            .await
            .map_err(|e| SessionError::Sftp(e.to_string()))?;
        Ok(buf)
    }

    pub async fn write_file(&self, path: &str, data: &[u8]) -> Result<(), SessionError> {
        let mut file = self
            .session
            .create(path)
            .await
            .map_err(|e| SessionError::Sftp(e.to_string()))?;
        file.write_all(data)
            .await
            .map_err(|e| SessionError::Sftp(e.to_string()))?;
        file.shutdown()
            .await
            .map_err(|e| SessionError::Sftp(e.to_string()))?;
        Ok(())
    }

    pub async fn mkdir(&self, path: &str) -> Result<(), SessionError> {
        self.session
            .create_dir(path)
            .await
            .map_err(|e| SessionError::Sftp(e.to_string()))
    }

    pub async fn remove(&self, path: &str, is_dir: bool) -> Result<(), SessionError> {
        if is_dir {
            self.session
                .remove_dir(path)
                .await
                .map_err(|e| SessionError::Sftp(e.to_string()))
        } else {
            self.session
                .remove_file(path)
                .await
                .map_err(|e| SessionError::Sftp(e.to_string()))
        }
    }

    pub async fn rename(&self, from: &str, to: &str) -> Result<(), SessionError> {
        self.session
            .rename(from, to)
            .await
            .map_err(|e| SessionError::Sftp(e.to_string()))
    }
}
