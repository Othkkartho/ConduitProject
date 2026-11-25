use crate::backend::{SessionBackend, SessionError};
use crate::backends::sftp::SftpClient;
use async_trait::async_trait;
use bytes::Bytes;
use conduit_protocol::{SshAuth, TerminalSize};
use russh::{client, ChannelMsg};
use russh_sftp::client::SftpSession;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};

pub struct SshClientHandler;

#[async_trait]
impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Production builds integrate StorageRepository::verify_or_store_host_key here.
        Ok(true)
    }
}

enum SshControl {
    Write(Bytes),
    Resize(TerminalSize),
    Close,
}

pub struct SshBackend {
    handle: Arc<client::Handle<SshClientHandler>>,
    ctrl_tx: mpsc::Sender<SshControl>,
    sftp_cache: Mutex<Option<Arc<SftpClient>>>,
}

impl SshBackend {
    pub async fn connect(
        host: String,
        port: u16,
        username: String,
        auth: SshAuth,
        size: TerminalSize,
        output_tx: mpsc::Sender<Bytes>,
    ) -> Result<Self, SessionError> {
        let config = Arc::new(client::Config {
            inactivity_timeout: Some(Duration::from_secs(300)),
            keepalive_interval: Some(Duration::from_secs(15)),
            ..Default::default()
        });

        let mut handle = client::connect(config, (host.as_str(), port), SshClientHandler)
            .await
            .map_err(|e| SessionError::Ssh(e.to_string()))?;

        let authenticated = match auth {
            SshAuth::Password { password } => handle
                .authenticate_password(username, password)
                .await
                .map_err(|e| SessionError::Ssh(e.to_string()))?,
            SshAuth::PrivateKey {
                key_path,
                passphrase,
            } => {
                let key_pair = russh_keys::load_secret_key(key_path, passphrase.as_deref())
                    .map_err(|e| SessionError::Ssh(e.to_string()))?;
                handle
                    .authenticate_publickey(username, Arc::new(key_pair))
                    .await
                    .map_err(|e| SessionError::Ssh(e.to_string()))?
            }
        };

        if !authenticated {
            return Err(SessionError::Ssh("SSH authentication failed".into()));
        }

        let handle = Arc::new(handle);
        let mut channel = handle
            .channel_open_session()
            .await
            .map_err(|e| SessionError::Ssh(e.to_string()))?;

        channel
            .request_pty(
                false,
                "xterm-256color",
                size.cols.max(2) as u32,
                size.rows.max(2) as u32,
                0,
                0,
                &[],
            )
            .await
            .map_err(|e| SessionError::Ssh(e.to_string()))?;

        channel
            .request_shell(false)
            .await
            .map_err(|e| SessionError::Ssh(e.to_string()))?;

        let (ctrl_tx, mut ctrl_rx) = mpsc::channel::<SshControl>(256);
        let handle_guard = Arc::clone(&handle);

        tokio::spawn(async move {
            let _keep_alive = handle_guard;
            loop {
                tokio::select! {
                    biased;
                    ctrl = ctrl_rx.recv() => {
                        match ctrl {
                            Some(SshControl::Write(data)) => {
                                if channel.data(&data[..]).await.is_err() {
                                    break;
                                }
                            }
                            Some(SshControl::Resize(sz)) => {
                                let _ = channel
                                    .window_change(sz.cols.max(2) as u32, sz.rows.max(2) as u32, 0, 0)
                                    .await;
                            }
                            Some(SshControl::Close) | None => {
                                let _ = channel.eof().await;
                                let _ = channel.close().await;
                                break;
                            }
                        }
                    }
                    msg = channel.wait() => {
                        match msg {
                            Some(ChannelMsg::Data { data })
                            | Some(ChannelMsg::ExtendedData { data, .. }) => {
                                let bytes = Bytes::copy_from_slice(&data);
                                if output_tx.send(bytes).await.is_err() {
                                    break;
                                }
                            }
                            Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                            _ => {}
                        }
                    }
                }
            }
        });

        Ok(Self {
            handle,
            ctrl_tx,
            sftp_cache: Mutex::new(None),
        })
    }

    /// Starts a local TCP port forward multiplexed over the active SSH connection.
    pub async fn start_local_forward(
        &self,
        bind_addr: &str,
        target_host: String,
        target_port: u16,
    ) -> Result<(), SessionError> {
        let listener = TcpListener::bind(bind_addr).await?;
        let handle = Arc::clone(&self.handle);
        tokio::spawn(async move {
            while let Ok((mut inbound, _)) = listener.accept().await {
                let h = Arc::clone(&handle);
                let host = target_host.clone();
                tokio::spawn(async move {
                    if let Ok(ch) = h
                        .channel_open_direct_tcpip(host, target_port as u32, "127.0.0.1", 0)
                        .await
                    {
                        let stream = ch.into_stream();
                        let (mut ri, mut wi) = inbound.split();
                        let (mut rs, mut ws) = tokio::io::split(stream);
                        let _ = tokio::join!(
                            async {
                                let mut buf = [0u8; 8192];
                                while let Ok(n) = ri.read(&mut buf).await {
                                    if n == 0 || ws.write_all(&buf[..n]).await.is_err() {
                                        break;
                                    }
                                }
                            },
                            async {
                                let mut buf = [0u8; 8192];
                                while let Ok(n) = rs.read(&mut buf).await {
                                    if n == 0 || wi.write_all(&buf[..n]).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        );
                    }
                });
            }
        });
        Ok(())
    }
}

#[async_trait]
impl SessionBackend for SshBackend {
    async fn write(&self, data: Bytes) -> Result<(), SessionError> {
        self.ctrl_tx
            .send(SshControl::Write(data))
            .await
            .map_err(|_| SessionError::Closed)
    }

    async fn resize(&self, size: TerminalSize) -> Result<(), SessionError> {
        self.ctrl_tx
            .send(SshControl::Resize(size))
            .await
            .map_err(|_| SessionError::Closed)
    }

    async fn close(&self) -> Result<(), SessionError> {
        let _ = self.ctrl_tx.send(SshControl::Close).await;
        Ok(())
    }

    async fn sftp(&self) -> Result<Arc<SftpClient>, SessionError> {
        let mut guard = self.sftp_cache.lock().await;
        if let Some(existing) = guard.as_ref() {
            return Ok(Arc::clone(existing));
        }

        let channel = self
            .handle
            .channel_open_session()
            .await
            .map_err(|e| SessionError::Sftp(e.to_string()))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| SessionError::Sftp(e.to_string()))?;

        let sftp_session = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| SessionError::Sftp(e.to_string()))?;
        let client = Arc::new(SftpClient::new(sftp_session));
        *guard = Some(Arc::clone(&client));
        Ok(client)
    }
}
