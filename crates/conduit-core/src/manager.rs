use crate::backend::{SessionBackend, SessionError};
use crate::backends::{
    pty::PtyBackend,
    serial::{list_serial_ports, SerialBackend},
    sftp::SftpClient,
    ssh::SshBackend,
    telnet::TelnetBackend,
};
use crate::stream::{run_output_pump, FlowController};
use bytes::Bytes;
use conduit_protocol::{SessionConfig, SessionId, SessionInfo, SftpEntry, TerminalSize};
use dashmap::DashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

struct SessionEntry {
    info: SessionInfo,
    backend: Arc<dyn SessionBackend>,
    flow: Arc<FlowController>,
}

pub struct SessionManager {
    next_id: AtomicU32,
    sessions: DashMap<SessionId, SessionEntry>,
}

impl SessionManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            next_id: AtomicU32::new(1),
            sessions: DashMap::new(),
        })
    }

    pub async fn create_session<F>(
        &self,
        config: SessionConfig,
        on_output: F,
    ) -> Result<SessionId, SessionError>
    where
        F: FnMut(Bytes) -> bool + Send + 'static,
    {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (raw_tx, raw_rx) = mpsc::channel::<Bytes>(128);
        let flow = FlowController::new();

        let (protocol, label, backend): (String, String, Arc<dyn SessionBackend>) = match config {
            SessionConfig::LocalPty { shell, cwd, size } => {
                let lbl = shell
                    .clone()
                    .unwrap_or_else(|| if cfg!(windows) { "PowerShell" } else { "Local Shell" }.into());
                let b = PtyBackend::spawn(shell, cwd, size, raw_tx)?;
                ("local_pty".into(), lbl, Arc::new(b))
            }
            SessionConfig::Ssh {
                host,
                port,
                username,
                auth,
                size,
            } => {
                let lbl = format!("{username}@{host}:{port}");
                let b = SshBackend::connect(host, port, username, auth, size, raw_tx).await?;
                ("ssh".into(), lbl, Arc::new(b))
            }
            SessionConfig::Serial(cfg) => {
                let lbl = format!("{} ({})", cfg.port_name, cfg.baud_rate);
                let b = SerialBackend::open(cfg, raw_tx)?;
                ("serial".into(), lbl, Arc::new(b))
            }
            SessionConfig::Telnet(cfg) => {
                let lbl = format!("{}:{}", cfg.host, cfg.port);
                let b = TelnetBackend::connect(cfg, raw_tx).await?;
                ("telnet".into(), lbl, Arc::new(b))
            }
        };

        self.sessions.insert(
            id,
            SessionEntry {
                info: SessionInfo {
                    id,
                    protocol,
                    label,
                },
                backend,
                flow: Arc::clone(&flow),
            },
        );

        tokio::spawn(run_output_pump(raw_rx, flow, on_output));
        Ok(id)
    }

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions.iter().map(|e| e.info.clone()).collect()
    }

    pub fn list_serial_ports(&self) -> Vec<String> {
        list_serial_ports()
    }

    pub async fn write(&self, id: SessionId, data: Bytes) -> Result<(), SessionError> {
        let backend = self
            .sessions
            .get(&id)
            .map(|e| Arc::clone(&e.backend))
            .ok_or(SessionError::NotFound(id))?;
        backend.write(data).await
    }

    /// Zero-copy broadcast fan-out using `Bytes::clone`
    pub async fn broadcast(&self, ids: &[SessionId], data: Bytes) {
        for &id in ids {
            if let Some(entry) = self.sessions.get(&id) {
                let backend = Arc::clone(&entry.backend);
                let payload = data.clone();
                tokio::spawn(async move {
                    let _ = backend.write(payload).await;
                });
            }
        }
    }

    pub async fn resize(&self, id: SessionId, size: TerminalSize) -> Result<(), SessionError> {
        let backend = self
            .sessions
            .get(&id)
            .map(|e| Arc::clone(&e.backend))
            .ok_or(SessionError::NotFound(id))?;
        backend.resize(size).await
    }

    pub fn ack(&self, id: SessionId, bytes: usize) {
        if let Some(entry) = self.sessions.get(&id) {
            entry.flow.ack(bytes);
        }
    }

    pub async fn close(&self, id: SessionId) -> Result<(), SessionError> {
        if let Some((_, entry)) = self.sessions.remove(&id) {
            entry.backend.close().await?;
        }
        Ok(())
    }

    async fn get_sftp(&self, id: SessionId) -> Result<Arc<SftpClient>, SessionError> {
        let backend = self
            .sessions
            .get(&id)
            .map(|e| Arc::clone(&e.backend))
            .ok_or(SessionError::NotFound(id))?;
        backend.sftp().await
    }

    pub async fn sftp_list_dir(&self, id: SessionId, path: &str) -> Result<Vec<SftpEntry>, SessionError> {
        self.get_sftp(id).await?.list_dir(path).await
    }

    pub async fn sftp_read_file(&self, id: SessionId, path: &str) -> Result<Vec<u8>, SessionError> {
        self.get_sftp(id).await?.read_file(path).await
    }

    pub async fn sftp_write_file(
        &self,
        id: SessionId,
        path: &str,
        data: &[u8],
    ) -> Result<(), SessionError> {
        self.get_sftp(id).await?.write_file(path, data).await
    }

    pub async fn sftp_mkdir(&self, id: SessionId, path: &str) -> Result<(), SessionError> {
        self.get_sftp(id).await?.mkdir(path).await
    }

    pub async fn sftp_remove(
        &self,
        id: SessionId,
        path: &str,
        is_dir: bool,
    ) -> Result<(), SessionError> {
        self.get_sftp(id).await?.remove(path, is_dir).await
    }
}
