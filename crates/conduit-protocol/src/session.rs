use serde::{Deserialize, Serialize};

pub type SessionId = u32;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct TerminalSize {
    pub cols: u16,
    pub rows: u16,
}

impl Default for TerminalSize {
    fn default() -> Self {
        Self { cols: 100, rows: 30 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "auth_type", rename_all = "snake_case")]
pub enum SshAuth {
    Password {
        password: String,
    },
    PrivateKey {
        key_path: String,
        passphrase: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SerialParity {
    None,
    Odd,
    Even,
}

impl Default for SerialParity {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialConfig {
    pub port_name: String,
    pub baud_rate: u32,
    #[serde(default = "default_data_bits")]
    pub data_bits: u8,
    #[serde(default)]
    pub parity: SerialParity,
    #[serde(default = "default_stop_bits")]
    pub stop_bits: u8,
}

fn default_data_bits() -> u8 {
    8
}

fn default_stop_bits() -> u8 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelnetConfig {
    pub host: String,
    pub port: u16,
    pub size: TerminalSize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "protocol", rename_all = "snake_case")]
pub enum SessionConfig {
    LocalPty {
        shell: Option<String>,
        cwd: Option<String>,
        size: TerminalSize,
    },
    Ssh {
        host: String,
        port: u16,
        username: String,
        auth: SshAuth,
        size: TerminalSize,
    },
    Serial(SerialConfig),
    Telnet(TelnetConfig),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: SessionId,
    pub protocol: String,
    pub label: String,
}
