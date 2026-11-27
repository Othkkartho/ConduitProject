use crate::backend::{SessionBackend, SessionError};
use async_trait::async_trait;
use bytes::Bytes;
use ptyloom_protocol::{SerialConfig, SerialParity, TerminalSize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio_serial::{DataBits, Parity, SerialPortBuilderExt, StopBits};

pub fn list_serial_ports() -> Vec<String> {
    tokio_serial::available_ports()
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.port_name)
        .collect()
}

pub struct SerialBackend {
    input_tx: mpsc::Sender<Bytes>,
}

impl SerialBackend {
    pub fn open(
        cfg: SerialConfig,
        output_tx: mpsc::Sender<Bytes>,
    ) -> Result<Self, SessionError> {
        let data_bits = match cfg.data_bits {
            5 => DataBits::Five,
            6 => DataBits::Six,
            7 => DataBits::Seven,
            _ => DataBits::Eight,
        };
        let parity = match cfg.parity {
            SerialParity::None => Parity::None,
            SerialParity::Odd => Parity::Odd,
            SerialParity::Even => Parity::Even,
        };
        let stop_bits = match cfg.stop_bits {
            2 => StopBits::Two,
            _ => StopBits::One,
        };

        let stream = tokio_serial::new(&cfg.port_name, cfg.baud_rate)
            .data_bits(data_bits)
            .parity(parity)
            .stop_bits(stop_bits)
            .open_native_async()
            .map_err(|e| SessionError::Serial(e.to_string()))?;

        let (mut reader, mut writer) = tokio::io::split(stream);
        let (input_tx, mut input_rx) = mpsc::channel::<Bytes>(256);

        tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            loop {
                tokio::select! {
                    biased;
                    Some(data) = input_rx.recv() => {
                        if writer.write_all(&data).await.is_err() {
                            break;
                        }
                    }
                    res = reader.read(&mut buf) => {
                        match res {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                if output_tx.send(Bytes::copy_from_slice(&buf[..n])).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        });

        Ok(Self { input_tx })
    }
}

#[async_trait]
impl SessionBackend for SerialBackend {
    async fn write(&self, data: Bytes) -> Result<(), SessionError> {
        self.input_tx
            .send(data)
            .await
            .map_err(|_| SessionError::Closed)
    }

    async fn resize(&self, _size: TerminalSize) -> Result<(), SessionError> {
        Ok(())
    }

    async fn close(&self) -> Result<(), SessionError> {
        Ok(())
    }
}
