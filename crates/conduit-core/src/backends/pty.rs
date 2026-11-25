use crate::backend::{SessionBackend, SessionError};
use async_trait::async_trait;
use bytes::Bytes;
use conduit_protocol::TerminalSize;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::Mutex;
use tokio::sync::mpsc;

pub struct PtyBackend {
    master: Mutex<Box<dyn MasterPty + Send>>,
    input_tx: mpsc::Sender<Bytes>,
}

impl PtyBackend {
    pub fn spawn(
        shell: Option<String>,
        cwd: Option<String>,
        size: TerminalSize,
        output_tx: mpsc::Sender<Bytes>,
    ) -> Result<Self, SessionError> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: size.rows.max(2),
                cols: size.cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| SessionError::Pty(e.to_string()))?;

        let default_shell = if cfg!(windows) {
            "powershell.exe".to_string()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
        };

        let target_shell = shell
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(default_shell);

        let mut cmd = CommandBuilder::new(&target_shell);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        if let Some(dir) = cwd.filter(|d| !d.trim().is_empty()) {
            cmd.cwd(dir);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| SessionError::Pty(e.to_string()))?;

        // Drop slave immediately so EOF is delivered cleanly when child exits
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| SessionError::Pty(e.to_string()))?;
        let mut writer = pair
            .master
            .take_writer()
            .map_err(|e| SessionError::Pty(e.to_string()))?;

        tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = Bytes::copy_from_slice(&buf[..n]);
                        if output_tx.blocking_send(data).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = child.wait();
        });

        let (input_tx, mut input_rx) = mpsc::channel::<Bytes>(256);
        tokio::task::spawn_blocking(move || {
            while let Some(data) = input_rx.blocking_recv() {
                if writer.write_all(&data).is_err() || writer.flush().is_err() {
                    break;
                }
            }
        });

        Ok(Self {
            master: Mutex::new(pair.master),
            input_tx,
        })
    }
}

#[async_trait]
impl SessionBackend for PtyBackend {
    async fn write(&self, data: Bytes) -> Result<(), SessionError> {
        self.input_tx
            .send(data)
            .await
            .map_err(|_| SessionError::Closed)
    }

    async fn resize(&self, size: TerminalSize) -> Result<(), SessionError> {
        let master = self.master.lock().map_err(|_| SessionError::Closed)?;
        master
            .resize(PtySize {
                rows: size.rows.max(2),
                cols: size.cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| SessionError::Pty(e.to_string()))
    }

    async fn close(&self) -> Result<(), SessionError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn pty_spawns_and_echoes_output() {
        let (tx, mut rx) = mpsc::channel(32);
        let shell = if cfg!(windows) {
            Some("cmd.exe".to_string())
        } else {
            Some("/bin/sh".to_string())
        };

        let pty = PtyBackend::spawn(shell, None, TerminalSize { cols: 80, rows: 24 }, tx)
            .expect("pty should spawn");

        pty.write(Bytes::from_static(b"echo conduit_pty_ok\r\nexit\r\n"))
            .await
            .unwrap();

        let mut collected = Vec::new();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv()).await {
                Ok(Some(chunk)) => {
                    collected.extend_from_slice(&chunk);
                    if String::from_utf8_lossy(&collected).contains("conduit_pty_ok") {
                        break;
                    }
                }
                Ok(None) => break,
                Err(_) => {}
            }
        }

        let output = String::from_utf8_lossy(&collected);
        assert!(
            output.contains("conduit_pty_ok"),
            "Expected PTY output to contain marker, got: {output}"
        );
    }
}
