use crate::backend::{SessionBackend, SessionError};
use crate::backends::{
    pty::PtyBackend,
    serial::{list_serial_ports, SerialBackend},
    sftp::SftpClient,
    ssh::SshBackend,
    telnet::TelnetBackend,
};
use crate::encoding::{encode_input, resolve_encoding, StreamDecoder};
use crate::stream::{run_output_pump, FlowController};
use bytes::Bytes;
use ptyloom_protocol::{SessionConfig, SessionId, SessionInfo, SftpEntry, TerminalSize};
use dashmap::DashMap;
use encoding_rs::Encoding;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::sync::mpsc;

struct SessionEntry {
    info: SessionInfo,
    backend: Arc<dyn SessionBackend>,
    flow: Arc<FlowController>,
    encoding: Arc<RwLock<&'static Encoding>>,
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
        mut on_output: F,
    ) -> Result<SessionId, SessionError>
    where
        F: FnMut(Bytes) -> bool + Send + 'static,
    {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (raw_tx, raw_rx) = mpsc::channel::<Bytes>(128);
        let flow = FlowController::new();
        let initial_enc = resolve_encoding(config.encoding());
        let enc_state = Arc::new(RwLock::new(initial_enc));

        let (protocol, label, backend): (String, String, Arc<dyn SessionBackend>) = match config {
            SessionConfig::LocalPty { shell, cwd, size, .. } => {
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
                ..
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
                encoding: Arc::clone(&enc_state),
            },
        );

        let mut decoder = StreamDecoder::new(initial_enc);
        let enc_reader = Arc::clone(&enc_state);
        tokio::spawn(run_output_pump(raw_rx, flow, move |chunk| {
            let target_enc = *enc_reader.read().unwrap_or_else(|e| e.into_inner());
            decoder.set_encoding(target_enc);
            let decoded = decoder.decode_chunk(chunk);
            if decoded.is_empty() {
                return true;
            }
            on_output(decoded)
        }));
        Ok(id)
    }

    pub fn set_encoding(&self, id: SessionId, label: &str) -> Result<(), SessionError> {
        let entry = self.sessions.get(&id).ok_or(SessionError::NotFound(id))?;
        let enc = resolve_encoding(label);
        let mut guard = entry.encoding.write().unwrap_or_else(|e| e.into_inner());
        *guard = enc;
        Ok(())
    }

    /// Verifies that a session configuration can actually connect before saving or opening.
    pub async fn test_connection(config: SessionConfig) -> Result<(), SessionError> {
        tokio::time::timeout(Duration::from_secs(8), async move {
            match config {
                SessionConfig::Ssh {
                    host,
                    port,
                    username,
                    auth,
                    ..
                } => {
                    if host.trim().is_empty() {
                        return Err(SessionError::Ssh("호스트 주소를 입력해 주세요.".into()));
                    }
                    SshBackend::test_connect(host, port, username, auth).await
                }
                SessionConfig::Telnet(cfg) => {
                    if cfg.host.trim().is_empty() {
                        return Err(SessionError::Telnet("호스트 주소를 입력해 주세요.".into()));
                    }
                    tokio::net::TcpStream::connect((cfg.host.as_str(), cfg.port))
                        .await
                        .map(|_| ())
                        .map_err(|e| SessionError::Telnet(e.to_string()))
                }
                SessionConfig::Serial(cfg) => {
                    if cfg.port_name.trim().is_empty() {
                        return Err(SessionError::Serial("시리얼 포트를 입력해 주세요.".into()));
                    }
                    use tokio_serial::SerialPortBuilderExt;
                    let _stream = tokio_serial::new(&cfg.port_name, cfg.baud_rate)
                        .open_native_async()
                        .map_err(|e| SessionError::Serial(e.to_string()))?;
                    Ok(())
                }
                SessionConfig::LocalPty { shell, cwd, size, .. } => {
                    if let Some(ref dir) = cwd {
                        if !dir.trim().is_empty() && !std::path::Path::new(dir.trim()).is_dir() {
                            return Err(SessionError::Pty(format!(
                                "시작 디렉토리가 존재하지 않습니다: {dir}"
                            )));
                        }
                    }
                    let (tx, _rx) = mpsc::channel(4);
                    let backend = PtyBackend::spawn(shell, cwd, size, tx)?;
                    let _ = backend.close().await;
                    Ok(())
                }
            }
        })
        .await
        .map_err(|_| SessionError::Io(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "연결 확인 시간이 초과되었습니다 (8초).",
        )))?
    }

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions.iter().map(|e| e.info.clone()).collect()
    }

    pub fn list_serial_ports(&self) -> Vec<String> {
        list_serial_ports()
    }

    pub async fn write(&self, id: SessionId, data: Bytes) -> Result<(), SessionError> {
        let (backend, enc) = self
            .sessions
            .get(&id)
            .map(|e| {
                let enc = *e.encoding.read().unwrap_or_else(|err| err.into_inner());
                (Arc::clone(&e.backend), enc)
            })
            .ok_or(SessionError::NotFound(id))?;
        let wire = encode_input(enc, data);
        backend.write(wire).await
    }

    /// Zero-copy broadcast fan-out using `Bytes::clone`
    pub async fn broadcast(&self, ids: &[SessionId], data: Bytes) {
        for &id in ids {
            if let Some(entry) = self.sessions.get(&id) {
                let backend = Arc::clone(&entry.backend);
                let enc = *entry.encoding.read().unwrap_or_else(|err| err.into_inner());
                let payload = encode_input(enc, data.clone());
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
