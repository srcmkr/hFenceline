use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

const SERVICE: &str = "hfenceline";
const FILE: &str = "tokens.json";

type FileStore = BTreeMap<String, String>;

fn entry(key: &str) -> keyring::Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, key)
}

fn unavailable(e: &keyring::Error) -> bool {
    matches!(
        e,
        keyring::Error::NoStorageAccess(_) | keyring::Error::PlatformFailure(_)
    )
}

fn keyring_usable() -> bool {
    match entry("__probe__").and_then(|e| e.get_password()) {
        Ok(_) | Err(keyring::Error::NoEntry) => true,
        Err(e) => !unavailable(&e),
    }
}

fn file_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("hfenceline").join(FILE))
}

fn read_file<R: Runtime>(app: &AppHandle<R>) -> Result<FileStore, String> {
    let path = file_path(app)?;
    if !path.exists() {
        return Ok(FileStore::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

fn write_file<R: Runtime>(app: &AppHandle<R>, store: &FileStore) -> Result<(), String> {
    let path = file_path(app)?;
    if store.is_empty() {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let dir = path.parent().ok_or("kein Ordner")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    {
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut f = opts.open(&tmp).map_err(|e| e.to_string())?;
        f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_get<R: Runtime>(app: AppHandle<R>, key: String) -> Result<Option<String>, String> {
    match entry(&key).and_then(|e| e.get_password()) {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(read_file(&app)?.get(&key).cloned()),
        Err(e) if unavailable(&e) => Ok(read_file(&app)?.get(&key).cloned()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_set<R: Runtime>(
    app: AppHandle<R>,
    key: String,
    value: String,
    allow_file: bool,
) -> Result<(), String> {
    match entry(&key).and_then(|e| e.set_password(&value)) {
        Ok(()) => {
            let mut store = read_file(&app)?;
            if store.remove(&key).is_some() {
                write_file(&app, &store)?;
            }
            Ok(())
        }
        Err(e) if unavailable(&e) => {
            if !allow_file {
                return Err(format!("no-keyring: {e}"));
            }
            let mut store = read_file(&app)?;
            store.insert(key, value);
            write_file(&app, &store)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn secret_delete<R: Runtime>(app: AppHandle<R>, key: String) -> Result<(), String> {
    match entry(&key).and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) if unavailable(&e) => {}
        Err(e) => return Err(e.to_string()),
    }
    let mut store = read_file(&app)?;
    if store.remove(&key).is_some() {
        write_file(&app, &store)?;
    }
    Ok(())
}

#[tauri::command]
pub fn secret_backend() -> String {
    if keyring_usable() { "keyring" } else { "file" }.into()
}
