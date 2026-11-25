use crate::backend::{SessionBackend, SessionError};
use async_trait::async_trait;
use bytes::{BufMut, Bytes, BytesMut};
use conduit_protocol::{TelnetConfig, TerminalSize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;

const IAC: u8 = 255;
const DONT: u8 = 254;
const DO: u8 = 253;
const WONT: u8 = 252;
const WILL: u8 = 251;
const SB: u8 = 250;
const SE: u8 = 240;
const OPT_SGA: u8 = 3;
const OPT_NAWS: u8 = 31;

enum TelnetCtrl {
    Write(Bytes),
    Resize(TerminalSize),
    Close,
}

pub struct TelnetBackend {
    ctrl_tx: mpsc::Sender<TelnetCtrl>,
}

impl TelnetBackend {
    pub async fn connect(
        cfg: TelnetConfig,
        output_tx: mpsc::Sender<Bytes>,
    ) -> Result<Self, SessionError> {
        let stream = TcpStream::connect((cfg.host.as_str(), cfg.port))
            .await
            .map_err(|e| SessionError::Telnet(e.to_string()))?;
        let (mut reader, mut writer) = stream.into_split();
        let (ctrl_tx, mut ctrl_rx) = mpsc::channel::<TelnetCtrl>(256);

        tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            let mut clean = BytesMut::with_capacity(4096);
            let mut replies = BytesMut::with_capacity(64);
            let mut state = ParseState::Normal;

            loop {
                tokio::select! {
                    biased;
                    ctrl = ctrl_rx.recv() => {
                        match ctrl {
                            Some(TelnetCtrl::Write(data)) => {
                                if writer.write_all(&data).await.is_err() {
                                    break;
                                }
                            }
                            Some(TelnetCtrl::Resize(sz)) => {
                                let naws = [
                                    IAC, SB, OPT_NAWS,
                                    (sz.cols >> 8) as u8, (sz.cols & 0xff) as u8,
                                    (sz.rows >> 8) as u8, (sz.rows & 0xff) as u8,
                                    IAC, SE,
                                ];
                                let _ = writer.write_all(&naws).await;
                            }
                            Some(TelnetCtrl::Close) | None => break,
                        }
                    }
                    res = reader.read(&mut buf) => {
                        match res {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                parse_telnet_bytes(&buf[..n], &mut state, &mut clean, &mut replies);
                                if !replies.is_empty() {
                                    let _ = writer.write_all(&replies.split()).await;
                                }
                                if !clean.is_empty()
                                    && output_tx.send(clean.split().freeze()).await.is_err()
                                {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        });

        Ok(Self { ctrl_tx })
    }
}

enum ParseState {
    Normal,
    Iac,
    Negotiate(u8),
    Subnegotiate,
    SubIac,
}

fn parse_telnet_bytes(
    input: &[u8],
    state: &mut ParseState,
    clean: &mut BytesMut,
    replies: &mut BytesMut,
) {
    for &b in input {
        match *state {
            ParseState::Normal => {
                if b == IAC {
                    *state = ParseState::Iac;
                } else {
                    clean.put_u8(b);
                }
            }
            ParseState::Iac => match b {
                IAC => {
                    clean.put_u8(IAC);
                    *state = ParseState::Normal;
                }
                WILL | WONT | DO | DONT => *state = ParseState::Negotiate(b),
                SB => *state = ParseState::Subnegotiate,
                _ => *state = ParseState::Normal,
            },
            ParseState::Negotiate(cmd) => {
                match cmd {
                    DO => {
                        let resp = if b == OPT_NAWS || b == OPT_SGA { WILL } else { WONT };
                        replies.put_slice(&[IAC, resp, b]);
                    }
                    WILL => {
                        let resp = if b == OPT_SGA { DO } else { DONT };
                        replies.put_slice(&[IAC, resp, b]);
                    }
                    _ => {}
                }
                *state = ParseState::Normal;
            }
            ParseState::Subnegotiate => {
                if b == IAC {
                    *state = ParseState::SubIac;
                }
            }
            ParseState::SubIac => {
                if b == SE {
                    *state = ParseState::Normal;
                } else if b != IAC {
                    *state = ParseState::Subnegotiate;
                }
            }
        }
    }
}

#[async_trait]
impl SessionBackend for TelnetBackend {
    async fn write(&self, data: Bytes) -> Result<(), SessionError> {
        self.ctrl_tx
            .send(TelnetCtrl::Write(data))
            .await
            .map_err(|_| SessionError::Closed)
    }

    async fn resize(&self, size: TerminalSize) -> Result<(), SessionError> {
        self.ctrl_tx
            .send(TelnetCtrl::Resize(size))
            .await
            .map_err(|_| SessionError::Closed)
    }

    async fn close(&self) -> Result<(), SessionError> {
        let _ = self.ctrl_tx.send(TelnetCtrl::Close).await;
        Ok(())
    }
}
