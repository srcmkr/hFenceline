use std::fs;
use std::io::{Read, Write};
use std::iter;

use age::secrecy::SecretString;

// scrypt N=2^18 (256 MiB), owasp-minimum ist 2^17
const WORK_FACTOR: u8 = 18;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn write_private(path: &str, data: &[u8]) -> Result<(), String> {
    let tmp = format!("{path}.tmp");
    {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp).map_err(err)?;
        f.write_all(data).map_err(err)?;
        f.sync_all().map_err(err)?;
    }
    fs::rename(&tmp, path).map_err(err)
}

fn encrypt(payload: &str, passphrase: String, work_factor: u8) -> Result<Vec<u8>, String> {
    let mut recipient = age::scrypt::Recipient::new(SecretString::from(passphrase));
    recipient.set_work_factor(work_factor);
    let encryptor =
        age::Encryptor::with_recipients(iter::once(&recipient as &dyn age::Recipient)).map_err(err)?;
    let mut out = vec![];
    let mut writer = encryptor.wrap_output(&mut out).map_err(err)?;
    writer.write_all(payload.as_bytes()).map_err(err)?;
    writer.finish().map_err(err)?;
    Ok(out)
}

fn decrypt(data: &[u8], passphrase: String) -> Result<String, String> {
    let decryptor = age::Decryptor::new(data).map_err(|_| "invalid-file".to_string())?;
    let mut identity = age::scrypt::Identity::new(SecretString::from(passphrase));
    identity.set_max_work_factor(22);
    let mut reader = decryptor
        .decrypt(iter::once(&identity as &dyn age::Identity))
        .map_err(|e| match e {
            age::DecryptError::DecryptionFailed | age::DecryptError::NoMatchingKeys => {
                "wrong-passphrase".to_string()
            }
            other => other.to_string(),
        })?;
    let mut text = String::new();
    reader.read_to_string(&mut text).map_err(|_| "invalid-file".to_string())?;
    Ok(text)
}

#[tauri::command]
pub async fn backup_export(path: String, passphrase: String, payload: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || write_private(&path, &encrypt(&payload, passphrase, WORK_FACTOR)?))
        .await
        .map_err(err)?
}

#[tauri::command]
pub async fn backup_import(path: String, passphrase: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || decrypt(&fs::read(&path).map_err(err)?, passphrase))
        .await
        .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let data = encrypt("{\"a\":1}", "richtig lange passphrase".into(), 10).unwrap();
        assert!(data.starts_with(b"age-encryption.org/v1"));
        assert!(!String::from_utf8_lossy(&data).contains("\"a\""));
        assert_eq!(decrypt(&data, "richtig lange passphrase".into()).unwrap(), "{\"a\":1}");
    }

    #[test]
    fn falsche_passphrase() {
        let data = encrypt("x", "richtig lange passphrase".into(), 10).unwrap();
        assert_eq!(decrypt(&data, "falsch".into()).unwrap_err(), "wrong-passphrase");
    }

    #[test]
    fn manipuliert() {
        let mut data = encrypt("geheimer inhalt", "pw pw pw pw pw".into(), 10).unwrap();
        let n = data.len();
        data[n - 5] ^= 1;
        assert!(decrypt(&data, "pw pw pw pw pw".into()).is_err());
        assert_eq!(decrypt(b"kein age", "x".into()).unwrap_err(), "invalid-file");
    }

    #[test]
    fn work_factor_im_header() {
        let data = encrypt("x", "pw".into(), WORK_FACTOR).unwrap();
        let header = String::from_utf8_lossy(&data[..data.len().min(200)]).to_string();
        assert!(header.contains(&format!(" {WORK_FACTOR}\n")), "{header}");
    }
}
