use crate::backends::sftp::SftpClient;
use async_trait::async_trait;
use bytes::Bytes;
use ptyloom_protocol::TerminalSize;
use std::sync::Arc;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SessionError {
    #[error("Session not found: {0}")]
    NotFound(u32),
    #[error("PTY error: {0}")]
    Pty(String),
    #[error("SSH error: {0}")]
    Ssh(String),
    #[error("SFTP error: {0}")]
    Sftp(String),
    #[error("Serial error: {0}")]
    Serial(String),
    #[error("Telnet error: {0}")]
    Telnet(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Session already closed")]
    Closed,
    #[error("Operation unsupported for this protocol")]
    Unsupported,
}

#[async_trait]
pub trait SessionBackend: Send + Sync {
    async fn write(&self, data: Bytes) -> Result<(), SessionError>;
    async fn resize(&self, size: TerminalSize) -> Result<(), SessionError>;
    async fn close(&self) -> Result<(), SessionError>;

    /// Returns a multiplexed SFTP client if the session supports SFTP (e.g., SSH).
    async fn sftp(&self) -> Result<Arc<SftpClient>, SessionError> {
        Err(SessionError::Unsupported)
    }
}
