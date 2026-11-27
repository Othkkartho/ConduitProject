use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::rngs::OsRng;
use rand::RngCore;
use std::fs;
use std::path::Path;
use thiserror::Error;
use tracing::{info, warn};
use zeroize::{Zeroize, Zeroizing};

const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("Keyring error: {0}")]
    Keyring(String),
    #[error("Encryption error")]
    Encrypt,
    #[error("Decryption error")]
    Decrypt,
    #[error("Invalid key or ciphertext encoding")]
    Encoding,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Envelope Encryption Vault:
/// Stores a single 256-bit Master Key in the OS Keychain (falling back to a
/// restricted local key file in headless/sandbox environments) and encrypts
/// individual secrets using AES-256-GCM with per-secret random nonces.
pub struct SecretVault {
    master_key: Zeroizing<[u8; KEY_LEN]>,
}

impl SecretVault {
    /// Creates an in-memory ephemeral vault (ideal for unit tests).
    pub fn ephemeral() -> Self {
        let mut key = [0u8; KEY_LEN];
        OsRng.fill_bytes(&mut key);
        Self {
            master_key: Zeroizing::new(key),
        }
    }

    /// Loads or initializes the 256-bit master key from the OS keyring,
    /// falling back to `fallback_key_path` if no OS keyring daemon is available.
    pub fn open(service: &str, account: &str, fallback_key_path: &Path) -> Result<Self, VaultError> {
        match Self::load_or_create_keyring(service, account) {
            Ok(key) => {
                info!("Initialized SecretVault using OS Keyring");
                Ok(Self { master_key: key })
            }
            Err(err) => {
                warn!("OS Keyring unavailable ({err}); using fallback master key file");
                let key = Self::load_or_create_file(fallback_key_path)?;
                Ok(Self { master_key: key })
            }
        }
    }

    fn load_or_create_keyring(
        service: &str,
        account: &str,
    ) -> Result<Zeroizing<[u8; KEY_LEN]>, VaultError> {
        let entry = keyring::Entry::new(service, account)
            .map_err(|e| VaultError::Keyring(e.to_string()))?;

        match entry.get_password() {
            Ok(encoded) => Self::decode_key(&encoded),
            Err(keyring::Error::NoEntry) => {
                let mut raw = [0u8; KEY_LEN];
                OsRng.fill_bytes(&mut raw);
                let mut encoded = B64.encode(raw);
                let res = entry.set_password(&encoded);
                encoded.zeroize();
                res.map_err(|e| VaultError::Keyring(e.to_string()))?;
                Ok(Zeroizing::new(raw))
            }
            Err(e) => Err(VaultError::Keyring(e.to_string())),
        }
    }

    fn load_or_create_file(path: &Path) -> Result<Zeroizing<[u8; KEY_LEN]>, VaultError> {
        if path.exists() {
            let content = Zeroizing::new(fs::read_to_string(path)?);
            return Self::decode_key(content.trim());
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut raw = [0u8; KEY_LEN];
        OsRng.fill_bytes(&mut raw);
        let mut encoded = B64.encode(raw);
        fs::write(path, encoded.as_bytes())?;
        encoded.zeroize();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
        }

        Ok(Zeroizing::new(raw))
    }

    fn decode_key(encoded: &str) -> Result<Zeroizing<[u8; KEY_LEN]>, VaultError> {
        let bytes = Zeroizing::new(B64.decode(encoded).map_err(|_| VaultError::Encoding)?);
        if bytes.len() != KEY_LEN {
            return Err(VaultError::Encoding);
        }
        let mut arr = [0u8; KEY_LEN];
        arr.copy_from_slice(&bytes);
        Ok(Zeroizing::new(arr))
    }

    pub fn encrypt(&self, plaintext: &str) -> Result<String, VaultError> {
        let cipher = Aes256Gcm::new_from_slice(&*self.master_key).map_err(|_| VaultError::Encrypt)?;
        let mut nonce_bytes = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|_| VaultError::Encrypt)?;

        let mut combined = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);
        Ok(B64.encode(combined))
    }

    pub fn decrypt(&self, encoded: &str) -> Result<String, VaultError> {
        let raw = B64.decode(encoded).map_err(|_| VaultError::Encoding)?;
        if raw.len() <= NONCE_LEN {
            return Err(VaultError::Decrypt);
        }
        let (nonce_bytes, ciphertext) = raw.split_at(NONCE_LEN);
        let cipher = Aes256Gcm::new_from_slice(&*self.master_key).map_err(|_| VaultError::Decrypt)?;
        let nonce = Nonce::from_slice(nonce_bytes);

        let plaintext_bytes = Zeroizing::new(
            cipher
                .decrypt(nonce, ciphertext)
                .map_err(|_| VaultError::Decrypt)?,
        );
        String::from_utf8(plaintext_bytes.to_vec()).map_err(|_| VaultError::Encoding)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_unique_nonces() {
        let vault = SecretVault::ephemeral();
        let c1 = vault.encrypt("super-secret-password").unwrap();
        let c2 = vault.encrypt("super-secret-password").unwrap();
        assert_ne!(c1, c2);
        assert_eq!(vault.decrypt(&c1).unwrap(), "super-secret-password");
        assert_eq!(vault.decrypt(&c2).unwrap(), "super-secret-password");
    }

    #[test]
    fn tampered_ciphertext_fails() {
        let vault = SecretVault::ephemeral();
        let mut raw = B64.decode(vault.encrypt("hello").unwrap()).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 0xff;
        let tampered = B64.encode(raw);
        assert!(vault.decrypt(&tampered).is_err());
    }
}
