use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha512};
use std::{
    collections::HashMap,
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard,
    },
    time::Duration,
};
use tauri::Manager;

mod java_runtime;
mod minecraft;
mod version_catalog;

#[cfg(desktop)]
mod discord_presence;

const MICROSOFT_CLIENT_ID: &str = "00000000402b5328";
const MICROSOFT_SCOPE: &str = "XboxLive.signin offline_access";
static CONTENT_FILES_LOCK: Mutex<()> = Mutex::new(());
static CONTENT_TRANSACTION_ID: AtomicU64 = AtomicU64::new(1);
const MAX_CONTENT_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;
const CONTENT_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(90);

fn lock_content_files() -> Result<MutexGuard<'static, ()>, String> {
    CONTENT_FILES_LOCK
        .lock()
        .map_err(|_| "콘텐츠 파일 잠금이 손상되었습니다.".to_string())
}

#[cfg(windows)]
fn refresh_shell_icon_cache_after_update(app: &tauri::AppHandle) {
    use windows_sys::Win32::UI::Shell::{
        SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_FLUSHNOWAIT, SHCNF_IDLIST,
    };

    let Ok(app_data) = app.path().app_data_dir() else {
        return;
    };
    let marker = app_data.join("shell-icon-version");
    let version = env!("CARGO_PKG_VERSION");
    if fs::read_to_string(&marker).ok().as_deref() == Some(version) {
        return;
    }

    unsafe {
        SHChangeNotify(
            SHCNE_ASSOCCHANGED as i32,
            SHCNF_IDLIST | SHCNF_FLUSHNOWAIT,
            std::ptr::null(),
            std::ptr::null(),
        );
    }
    if fs::create_dir_all(&app_data).is_ok() {
        let _ = fs::write(marker, version);
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
struct DeviceCode {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct MicrosoftToken {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LauncherAccount {
    id: String,
    name: String,
    skin_url: Option<String>,
    kind: String,
    minecraft_access_token: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthSession {
    refresh_token: String,
    account: LauncherAccount,
}

const AUTH_SERVICE: &str = "zzapchoLauncher";
const REFRESH_TOKEN_KEY: &str = "microsoft-refresh-token";
const ACCOUNT_CACHE_KEY: &str = "minecraft-account-cache";

fn keyring_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(AUTH_SERVICE, key).map_err(|error| error.to_string())
}

fn auth_session_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("auth-session.json"))
}

fn load_file_session(app: &tauri::AppHandle) -> Option<AuthSession> {
    fs::read_to_string(auth_session_path(app).ok()?)
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
}

fn load_refresh_token(app: &tauri::AppHandle) -> Option<String> {
    keyring_entry(REFRESH_TOKEN_KEY)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|value| !value.is_empty())
        .or_else(|| load_file_session(app).map(|session| session.refresh_token))
}

fn load_cached_account(app: &tauri::AppHandle) -> Option<LauncherAccount> {
    keyring_entry(ACCOUNT_CACHE_KEY)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .and_then(|value| serde_json::from_str(&value).ok())
        .or_else(|| load_file_session(app).map(|session| session.account))
}

fn store_auth_session(
    app: &tauri::AppHandle,
    refresh_token: &str,
    account: &LauncherAccount,
) -> Result<(), String> {
    let path = auth_session_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let session = AuthSession {
        refresh_token: refresh_token.to_string(),
        account: account.clone(),
    };
    let value = serde_json::to_vec(&session).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, value).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, &path).map_err(|error| error.to_string())?;

    let _ = keyring_entry(REFRESH_TOKEN_KEY).and_then(|entry| {
        entry
            .set_password(refresh_token)
            .map_err(|error| error.to_string())
    });
    if let Ok(account_json) = serde_json::to_string(account) {
        let _ = keyring_entry(ACCOUNT_CACHE_KEY).and_then(|entry| {
            entry
                .set_password(&account_json)
                .map_err(|error| error.to_string())
        });
    }
    Ok(())
}

fn auth_error(payload: &serde_json::Value, fallback: &str) -> String {
    payload
        .get("error_description")
        .or_else(|| payload.get("error"))
        .and_then(|value| value.as_str())
        .unwrap_or(fallback)
        .to_string()
}

async fn microsoft_token(
    params: &[(&str, &str)],
) -> Result<(reqwest::StatusCode, serde_json::Value), String> {
    let response = reqwest::Client::new()
        .post("https://login.live.com/oauth20_token.srf")
        .form(params)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;
    Ok((status, payload))
}

async fn exchange_for_minecraft(
    app: &tauri::AppHandle,
    token: MicrosoftToken,
    previous_refresh: Option<String>,
) -> Result<LauncherAccount, String> {
    let client = reqwest::Client::new();
    let xbox_response = client.post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&serde_json::json!({
            "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={}", token.access_token) },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }))
        .send().await.map_err(|error| error.to_string())?;
    if !xbox_response.status().is_success() {
        return Err("Xbox Live 인증에 실패했습니다.".into());
    }
    let xbox = xbox_response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;
    let xbox_token = xbox
        .get("Token")
        .and_then(|value| value.as_str())
        .ok_or("Xbox Live 토큰을 확인하지 못했습니다.")?;
    let user_hash = xbox
        .pointer("/DisplayClaims/xui/0/uhs")
        .and_then(|value| value.as_str())
        .ok_or("Xbox 사용자 정보를 확인하지 못했습니다.")?;

    let xsts_response = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&serde_json::json!({
            "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbox_token] },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !xsts_response.status().is_success() {
        return Err("Xbox 계정 권한을 확인하지 못했습니다.".into());
    }
    let xsts = xsts_response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;
    let xsts_token = xsts
        .get("Token")
        .and_then(|value| value.as_str())
        .ok_or("Xbox XSTS 토큰을 확인하지 못했습니다.")?;

    let minecraft_response = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&serde_json::json!({ "identityToken": format!("XBL3.0 x={user_hash};{xsts_token}") }))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !minecraft_response.status().is_success() {
        return Err("Minecraft 서비스 로그인에 실패했습니다.".into());
    }
    let minecraft = minecraft_response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;
    let minecraft_access_token = minecraft
        .get("access_token")
        .and_then(|value| value.as_str())
        .ok_or("Minecraft 접근 토큰을 확인하지 못했습니다.")?
        .to_string();

    let profile_response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&minecraft_access_token)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !profile_response.status().is_success() {
        return Err("Minecraft Java Edition 프로필을 찾지 못했습니다.".into());
    }
    let profile = profile_response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;
    let id = profile
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or("Minecraft 프로필 ID를 확인하지 못했습니다.")?
        .to_string();
    let name = profile
        .get("name")
        .and_then(|value| value.as_str())
        .ok_or("Minecraft 프로필 이름을 확인하지 못했습니다.")?
        .to_string();
    let skin_url = profile
        .pointer("/skins/0/url")
        .and_then(|value| value.as_str())
        .map(str::to_string);

    let refresh_token = token
        .refresh_token
        .or(previous_refresh)
        .ok_or("Microsoft 재로그인 토큰을 받지 못했습니다.")?;
    let account = LauncherAccount {
        id,
        name,
        skin_url,
        kind: "microsoft".into(),
        minecraft_access_token,
    };
    store_auth_session(app, &refresh_token, &account)?;
    Ok(account)
}

pub(crate) fn safe_segment(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

pub(crate) fn default_minecraft_dir() -> Result<PathBuf, String> {
    let app_data = std::env::var_os("APPDATA").ok_or("Windows APPDATA 경로를 찾을 수 없습니다.")?;
    Ok(PathBuf::from(app_data).join(".minecraft"))
}

fn content_folder(
    _app: &tauri::AppHandle,
    _profile_id: &str,
    kind: &str,
) -> Result<PathBuf, String> {
    let folder = match kind {
        "mods" => "mods",
        "resourcePacks" => "resourcepacks",
        "shaders" => "shaderpacks",
        _ => return Err("지원하지 않는 콘텐츠 종류입니다.".into()),
    };
    let path = default_minecraft_dir()?.join(folder);
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn profile_content_folder(
    app: &tauri::AppHandle,
    profile_id: &str,
    kind: &str,
) -> Result<PathBuf, String> {
    if profile_id.trim().is_empty() {
        return Err("프로필 ID가 비어 있습니다.".into());
    }
    let folder = match kind {
        "mods" => "mods",
        "resourcePacks" => "resourcepacks",
        "shaders" => "shaderpacks",
        _ => return Err("지원하지 않는 콘텐츠 종류입니다.".into()),
    };
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("profile-content")
        .join(safe_segment(profile_id))
        .join(folder);
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn normalized_content_file_name(value: &str) -> Result<String, String> {
    let name = Path::new(value)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty() && *name != "." && *name != "..")
        .ok_or("콘텐츠 파일 이름을 확인할 수 없습니다.")?;
    Ok(name.to_string())
}

fn normalized_content_identity(kind: &str, file_name: &str) -> Result<(String, String), String> {
    content_kind_label(kind)?;
    Ok((
        kind.to_string(),
        normalized_content_file_name(file_name)?.to_ascii_lowercase(),
    ))
}

fn profile_content_path(
    app: &tauri::AppHandle,
    profile_id: &str,
    kind: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    Ok(profile_content_folder(app, profile_id, kind)?
        .join(normalized_content_file_name(file_name)?))
}

fn active_content_paths(
    app: &tauri::AppHandle,
    profile_id: &str,
    kind: &str,
    file_name: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let active =
        content_folder(app, profile_id, kind)?.join(normalized_content_file_name(file_name)?);
    let disabled = PathBuf::from(format!("{}.disabled", active.display()));
    Ok((active, disabled))
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn temporary_content_path(destination: &Path, purpose: &str) -> Result<PathBuf, String> {
    let parent = destination
        .parent()
        .ok_or("콘텐츠 파일의 상위 폴더를 확인할 수 없습니다.")?;
    let stem = destination
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("content");
    let extension = destination
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    let id = CONTENT_TRANSACTION_ID.fetch_add(1, Ordering::Relaxed);
    Ok(parent.join(format!(
        ".{stem}.zzapcho-{purpose}-{}-{id}{extension}",
        std::process::id()
    )))
}

fn restore_backups(backups: &[(PathBuf, PathBuf)]) {
    for (original, backup) in backups.iter().rev() {
        let _ = remove_file_if_exists(original);
        if backup.exists() {
            let _ = fs::rename(backup, original);
        }
    }
}

fn remove_files_transactionally(paths: &[PathBuf]) -> Result<(), String> {
    let mut backups = Vec::new();
    for original in paths {
        if !original.exists() {
            continue;
        }
        let backup = match temporary_content_path(original, "delete") {
            Ok(path) => path,
            Err(error) => {
                restore_backups(&backups);
                return Err(error);
            }
        };
        if let Err(error) = fs::rename(original, &backup) {
            restore_backups(&backups);
            return Err(error.to_string());
        }
        backups.push((original.clone(), backup));
    }
    for (_, backup) in backups {
        let _ = remove_file_if_exists(&backup);
    }
    Ok(())
}

fn commit_staged_file(staged: &Path, destination: &Path) -> Result<(), String> {
    let backup = if destination.exists() {
        let backup = temporary_content_path(destination, "backup")?;
        fs::rename(destination, &backup).map_err(|error| error.to_string())?;
        Some(backup)
    } else {
        None
    };

    if let Err(error) = fs::rename(staged, destination) {
        if let Some(backup) = backup.as_ref() {
            let _ = fs::rename(backup, destination);
        }
        let _ = remove_file_if_exists(staged);
        return Err(error.to_string());
    }
    if let Some(backup) = backup {
        let _ = remove_file_if_exists(&backup);
    }
    Ok(())
}

fn copy_file_atomically(source: &Path, destination: &Path) -> Result<(), String> {
    if source == destination {
        return Ok(());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let staged = temporary_content_path(destination, "stage")?;
    if let Err(error) = fs::copy(source, &staged) {
        let _ = remove_file_if_exists(&staged);
        return Err(error.to_string());
    }
    commit_staged_file(&staged, destination)
}

fn ensure_content_changes_allowed() -> Result<(), String> {
    if minecraft::game_process_running() {
        Err("Minecraft 실행 중에는 프로필 콘텐츠를 바꿀 수 없습니다.".into())
    } else {
        Ok(())
    }
}

fn open_in_explorer(path: &Path) -> Result<String, String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_content_folder(
    app: tauri::AppHandle,
    profile_id: String,
    kind: String,
) -> Result<String, String> {
    open_in_explorer(&profile_content_folder(&app, &profile_id, &kind)?)
}

#[tauri::command]
fn open_game_folder() -> Result<String, String> {
    open_in_explorer(&default_minecraft_dir()?)
}

fn content_kind_label(kind: &str) -> Result<&'static str, String> {
    match kind {
        "mods" => Ok("모드"),
        "resourcePacks" => Ok("리소스팩"),
        "shaders" => Ok("셰이더"),
        _ => Err("지원하지 않는 콘텐츠 종류입니다.".into()),
    }
}

fn validate_content_archive_entries(kind: &str, entries: &[String]) -> Result<(), String> {
    let has_entry = |expected: &str| entries.iter().any(|entry| entry == expected);
    let has_directory = |directory: &str| {
        let prefix = format!("{directory}/");
        entries
            .iter()
            .any(|entry| entry == directory || entry.starts_with(&prefix))
    };

    let valid = match kind {
        "mods" => {
            has_entry("fabric.mod.json")
                || has_entry("quilt.mod.json")
                || has_entry("mcmod.info")
                || has_entry("meta-inf/mods.toml")
                || has_entry("meta-inf/neoforge.mods.toml")
                || has_directory("optifine")
        }
        "resourcePacks" => has_entry("pack.mcmeta"),
        "shaders" => has_directory("shaders") && !has_entry("pack.mcmeta"),
        _ => return Err("지원하지 않는 콘텐츠 종류입니다.".into()),
    };

    if valid {
        return Ok(());
    }

    let requirement = match kind {
        "mods" => "모드 정보가 들어 있는 .jar 파일",
        "resourcePacks" => "최상위에 pack.mcmeta가 들어 있는 .zip 파일",
        "shaders" => "최상위에 shaders 폴더가 들어 있는 .zip 파일",
        _ => unreachable!(),
    };
    Err(format!(
        "이 파일은 올바른 {}이 아닙니다. {}만 추가할 수 있습니다.",
        content_kind_label(kind)?,
        requirement
    ))
}

fn validate_content_file(kind: &str, source: &Path) -> Result<(), String> {
    let label = content_kind_label(kind)?;
    if !source.is_file() {
        return Err(format!(
            "폴더는 추가할 수 없습니다. {label} 파일을 선택해 주세요."
        ));
    }

    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let expected_extension = if kind == "mods" { "jar" } else { "zip" };
    if extension != expected_extension {
        return Err(format!(
            "{label}에는 .{expected_extension} 파일만 추가할 수 있습니다."
        ));
    }

    let file = fs::File::open(source).map_err(|_| {
        format!(
            "{} 파일을 열 수 없습니다.",
            source.file_name().unwrap_or_default().to_string_lossy()
        )
    })?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| format!("손상되었거나 읽을 수 없는 {label} 파일입니다."))?;
    let mut entries = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| format!("손상되었거나 읽을 수 없는 {label} 파일입니다."))?;
        let Some(path) = entry.enclosed_name() else {
            continue;
        };
        let normalized = path
            .to_string_lossy()
            .replace('\\', "/")
            .trim_start_matches("./")
            .trim_end_matches('/')
            .to_ascii_lowercase();
        if !normalized.is_empty() {
            entries.push(normalized);
        }
    }
    validate_content_archive_entries(kind, &entries)
}

fn validate_content_checksum(source: &Path, expected_sha512: Option<&str>) -> Result<(), String> {
    let Some(expected) = expected_sha512.filter(|value| !value.trim().is_empty()) else {
        return Ok(());
    };
    let mut file = fs::File::open(source).map_err(|error| error.to_string())?;
    let mut hasher = Sha512::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual.eq_ignore_ascii_case(expected.trim()) {
        Ok(())
    } else {
        Err(format!(
            "{} 파일의 SHA-512 검증에 실패했습니다.",
            source.file_name().unwrap_or_default().to_string_lossy()
        ))
    }
}

fn validate_stored_content(
    kind: &str,
    source: &Path,
    expected_sha512: Option<&str>,
) -> Result<(), String> {
    validate_content_file(kind, source)?;
    validate_content_checksum(source, expected_sha512)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfileContentItem {
    kind: String,
    file_name: String,
    enabled: bool,
    url: Option<String>,
    sha512: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ManagedProfileContentFile {
    profile_id: String,
    kind: String,
    file_name: String,
    url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveContentManifestItem {
    kind: String,
    file_name: String,
}

fn active_content_manifest_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("profile-content");
    fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    Ok(folder.join("active-manifest.json"))
}

fn load_active_content_manifest(
    app: &tauri::AppHandle,
) -> Result<Vec<ActiveContentManifestItem>, String> {
    let path = active_content_manifest_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(serde_json::from_slice(&bytes).unwrap_or_default())
}

fn save_active_content_manifest(
    app: &tauri::AppHandle,
    items: &[ActiveContentManifestItem],
) -> Result<(), String> {
    let path = active_content_manifest_path(app)?;
    let bytes = serde_json::to_vec_pretty(items).map_err(|error| error.to_string())?;
    let staged = temporary_content_path(&path, "manifest")?;
    if let Err(error) = fs::write(&staged, bytes) {
        let _ = remove_file_if_exists(&staged);
        return Err(error.to_string());
    }
    commit_staged_file(&staged, &path)
}

fn change_active_content_manifest(
    app: &tauri::AppHandle,
    kind: &str,
    remove_names: &[&str],
    active_name: Option<&str>,
) -> Result<Vec<ActiveContentManifestItem>, String> {
    content_kind_label(kind)?;
    let remove_names = remove_names
        .iter()
        .map(|name| normalized_content_file_name(name).map(|name| name.to_ascii_lowercase()))
        .collect::<Result<Vec<_>, _>>()?;
    let mut items = load_active_content_manifest(app)?;
    let previous = items.clone();
    items.retain(|item| {
        item.kind != kind
            || !remove_names
                .iter()
                .any(|name| item.file_name.eq_ignore_ascii_case(name))
    });
    if let Some(active_name) = active_name {
        items.push(ActiveContentManifestItem {
            kind: kind.to_string(),
            file_name: normalized_content_file_name(active_name)?,
        });
    }
    save_active_content_manifest(app, &items)?;
    Ok(previous)
}

fn copy_into_profile_store(
    app: &tauri::AppHandle,
    profile_id: &str,
    kind: &str,
    file_name: &str,
    source: &Path,
) -> Result<PathBuf, String> {
    let destination = profile_content_path(app, profile_id, kind, file_name)?;
    copy_file_atomically(source, &destination)?;
    Ok(destination)
}

fn download_profile_content(
    app: &tauri::AppHandle,
    profile_id: &str,
    kind: &str,
    file_name: &str,
    url: &str,
    sha512: Option<&str>,
) -> Result<PathBuf, String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| error.to_string())?;
    if parsed.scheme() != "https" {
        return Err("콘텐츠 다운로드 주소는 HTTPS여야 합니다.".into());
    }
    let destination = profile_content_path(app, profile_id, kind, file_name)?;
    let staged = temporary_content_path(&destination, "download")?;
    let client = reqwest::blocking::Client::builder()
        .timeout(CONTENT_DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(parsed)
        .send()
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_CONTENT_DOWNLOAD_BYTES)
    {
        return Err("콘텐츠 파일이 허용 크기(512 MB)를 초과합니다.".into());
    }
    let mut output = fs::File::create(&staged).map_err(|error| error.to_string())?;
    let mut limited = response.take(MAX_CONTENT_DOWNLOAD_BYTES + 1);
    let copied = match io::copy(&mut limited, &mut output) {
        Ok(copied) => copied,
        Err(error) => {
            let _ = fs::remove_file(&staged);
            return Err(error.to_string());
        }
    };
    if copied > MAX_CONTENT_DOWNLOAD_BYTES {
        let _ = fs::remove_file(&staged);
        return Err("콘텐츠 파일이 허용 크기(512 MB)를 초과합니다.".into());
    }
    drop(output);
    if let Err(error) = validate_stored_content(kind, &staged, sha512) {
        let _ = fs::remove_file(&staged);
        return Err(error);
    }
    commit_staged_file(&staged, &destination)?;
    Ok(destination)
}

fn ensure_profile_content_file(
    app: &tauri::AppHandle,
    profile_id: &str,
    item: &ProfileContentItem,
) -> Result<PathBuf, String> {
    let stored = profile_content_path(app, profile_id, &item.kind, &item.file_name)?;
    if stored.exists() {
        match validate_stored_content(&item.kind, &stored, item.sha512.as_deref()) {
            Ok(()) => return Ok(stored),
            Err(error) if item.url.as_deref().is_none_or(|url| url.trim().is_empty()) => {
                return Err(error);
            }
            Err(_) => {}
        }
    }

    if let Some(url) = item.url.as_deref().filter(|url| !url.trim().is_empty()) {
        return download_profile_content(
            app,
            profile_id,
            &item.kind,
            &item.file_name,
            url,
            item.sha512.as_deref(),
        );
    }

    let (active, disabled) = active_content_paths(app, profile_id, &item.kind, &item.file_name)?;
    let source = if active.is_file() {
        active
    } else if disabled.is_file() {
        disabled
    } else {
        return Err(format!(
            "{} 파일을 찾을 수 없습니다. 다시 추가해 주세요.",
            item.file_name
        ));
    };
    let stored = copy_into_profile_store(app, profile_id, &item.kind, &item.file_name, &source)?;
    validate_stored_content(&item.kind, &stored, item.sha512.as_deref())?;
    Ok(stored)
}

fn replace_active_content(
    managed_paths: &[(PathBuf, PathBuf)],
    desired_files: &[(PathBuf, PathBuf)],
) -> Result<(), String> {
    let mut staged_files: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (stored, active) in desired_files {
        if let Some(parent) = active.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let staged = temporary_content_path(active, "activate")?;
        if let Err(error) = fs::copy(stored, &staged) {
            for (staged, _) in &staged_files {
                let _ = remove_file_if_exists(staged);
            }
            let _ = remove_file_if_exists(&staged);
            return Err(error.to_string());
        }
        staged_files.push((staged, active.clone()));
    }

    let mut backups = Vec::new();
    for original in managed_paths
        .iter()
        .flat_map(|(active, disabled)| [active, disabled])
    {
        if !original.exists() {
            continue;
        }
        let backup = match temporary_content_path(original, "backup") {
            Ok(path) => path,
            Err(error) => {
                restore_backups(&backups);
                for (staged, _) in &staged_files {
                    let _ = remove_file_if_exists(staged);
                }
                return Err(error);
            }
        };
        if let Err(error) = fs::rename(original, &backup) {
            restore_backups(&backups);
            for (staged, _) in &staged_files {
                let _ = remove_file_if_exists(staged);
            }
            return Err(error.to_string());
        }
        backups.push((original.clone(), backup));
    }

    let mut activated: Vec<PathBuf> = Vec::new();
    for (staged, active) in &staged_files {
        if let Err(error) = fs::rename(staged, active) {
            for path in activated.iter().rev() {
                let _ = remove_file_if_exists(path);
            }
            restore_backups(&backups);
            for (pending, _) in &staged_files {
                let _ = remove_file_if_exists(pending);
            }
            return Err(error.to_string());
        }
        activated.push(active.clone());
    }

    for (_, backup) in backups {
        let _ = remove_file_if_exists(&backup);
    }
    Ok(())
}

fn sync_profile_content_files_unlocked(
    app: &tauri::AppHandle,
    profile_id: &str,
    content: &[ProfileContentItem],
    managed_files: &[ManagedProfileContentFile],
) -> Result<(), String> {
    if profile_id.trim().is_empty() {
        return Err("프로필 ID가 비어 있습니다.".into());
    }
    let mut selected_content = HashMap::new();
    for item in content {
        let identity = normalized_content_identity(&item.kind, &item.file_name)?;
        if selected_content.insert(identity, ()).is_some() {
            return Err(format!(
                "같은 이름의 콘텐츠 파일이 중복되어 있습니다: {}",
                item.file_name
            ));
        }
    }

    // Preserve existing user-added files from older launcher versions before cleanup.
    for managed in managed_files {
        if managed
            .url
            .as_deref()
            .is_some_and(|url| !url.trim().is_empty())
        {
            continue;
        }
        let stored =
            profile_content_path(app, &managed.profile_id, &managed.kind, &managed.file_name)?;
        if stored.exists() {
            continue;
        }
        let (active, disabled) =
            active_content_paths(app, &managed.profile_id, &managed.kind, &managed.file_name)?;
        if active.is_file() {
            copy_into_profile_store(
                app,
                &managed.profile_id,
                &managed.kind,
                &managed.file_name,
                &active,
            )?;
        } else if disabled.is_file() {
            copy_into_profile_store(
                app,
                &managed.profile_id,
                &managed.kind,
                &managed.file_name,
                &disabled,
            )?;
        }
    }

    // Prepare every enabled file for the selected profile before touching .minecraft.
    for item in content.iter().filter(|item| item.enabled) {
        ensure_profile_content_file(app, profile_id, item)?;
    }

    // Only remove files known to this launcher. Files copied manually by the user stay untouched.
    let mut managed_content = HashMap::new();
    for item in load_active_content_manifest(app)? {
        if let Ok(identity) = normalized_content_identity(&item.kind, &item.file_name) {
            managed_content.insert(identity, (item.kind, item.file_name));
        }
    }
    for item in managed_files {
        let identity = normalized_content_identity(&item.kind, &item.file_name)?;
        managed_content
            .entry(identity)
            .or_insert_with(|| (item.kind.clone(), item.file_name.clone()));
    }
    for item in content {
        let identity = normalized_content_identity(&item.kind, &item.file_name)?;
        managed_content.insert(identity, (item.kind.clone(), item.file_name.clone()));
    }
    let managed_paths = managed_content
        .into_values()
        .map(|(kind, file_name)| active_content_paths(app, profile_id, &kind, &file_name))
        .collect::<Result<Vec<_>, _>>()?;
    let mut desired_files = Vec::new();
    for item in content.iter().filter(|item| item.enabled) {
        let stored = profile_content_path(app, profile_id, &item.kind, &item.file_name)?;
        let (active, _) = active_content_paths(app, profile_id, &item.kind, &item.file_name)?;
        desired_files.push((stored, active));
    }
    replace_active_content(&managed_paths, &desired_files)?;
    let active_manifest = content
        .iter()
        .filter(|item| item.enabled)
        .map(|item| {
            Ok(ActiveContentManifestItem {
                kind: item.kind.clone(),
                file_name: normalized_content_file_name(&item.file_name)?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    save_active_content_manifest(app, &active_manifest)
}

pub(crate) fn sync_profile_content_files(
    app: &tauri::AppHandle,
    profile_id: &str,
    content: &[ProfileContentItem],
    managed_files: &[ManagedProfileContentFile],
) -> Result<(), String> {
    let _content_lock = lock_content_files()?;
    sync_profile_content_files_unlocked(app, profile_id, content, managed_files)
}

#[tauri::command]
async fn sync_profile_content(
    app: tauri::AppHandle,
    profile_id: String,
    content: Vec<ProfileContentItem>,
    managed_files: Vec<ManagedProfileContentFile>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _content_lock = lock_content_files()?;
        ensure_content_changes_allowed()?;
        sync_profile_content_files_unlocked(&app, &profile_id, &content, &managed_files)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod content_file_validation_tests {
    use super::{
        normalized_content_identity, remove_files_transactionally, replace_active_content,
        validate_content_archive_entries, validate_content_checksum,
    };
    use std::{fs, path::PathBuf, time::SystemTime};

    fn entries(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    #[test]
    fn accepts_each_supported_content_structure() {
        assert!(validate_content_archive_entries(
            "mods",
            &entries(&["meta-inf/mods.toml", "example/mod.class"]),
        )
        .is_ok());
        assert!(validate_content_archive_entries(
            "resourcePacks",
            &entries(&["pack.mcmeta", "assets/example/texture.png"]),
        )
        .is_ok());
        assert!(validate_content_archive_entries(
            "shaders",
            &entries(&["shaders/program/basic.fsh"]),
        )
        .is_ok());
    }

    #[test]
    fn does_not_mix_resource_packs_and_shaders() {
        let resource_pack = entries(&["pack.mcmeta", "assets/example/texture.png"]);
        let shader_pack = entries(&["shaders/program/basic.fsh"]);

        assert!(validate_content_archive_entries("shaders", &resource_pack).is_err());
        assert!(validate_content_archive_entries("resourcePacks", &shader_pack).is_err());
    }

    #[test]
    fn rejects_archives_without_expected_metadata() {
        let unrelated_archive = entries(&["readme.txt", "images/preview.png"]);
        for kind in ["mods", "resourcePacks", "shaders"] {
            assert!(validate_content_archive_entries(kind, &unrelated_archive).is_err());
        }
    }

    #[test]
    fn profile_switch_replaces_only_launcher_managed_files() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock must be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "zzapcho-profile-content-test-{}-{unique}",
            std::process::id()
        ));
        let active_folder = root.join("minecraft").join("mods");
        let store_folder = root.join("profile-content").join("next").join("mods");
        fs::create_dir_all(&active_folder).expect("create active folder");
        fs::create_dir_all(&store_folder).expect("create store folder");

        let old_active = active_folder.join("old.jar");
        let old_disabled = PathBuf::from(format!("{}.disabled", old_active.display()));
        let next_active = active_folder.join("next.jar");
        let next_disabled = PathBuf::from(format!("{}.disabled", next_active.display()));
        let manual_file = active_folder.join("manual.jar");
        let stored_next = store_folder.join("next.jar");
        fs::write(&old_active, b"old profile").expect("write old file");
        fs::write(&old_disabled, b"old disabled profile").expect("write disabled file");
        fs::write(&manual_file, b"manual file").expect("write manual file");
        fs::write(&stored_next, b"next profile").expect("write stored file");

        replace_active_content(
            &[
                (old_active.clone(), old_disabled.clone()),
                (next_active.clone(), next_disabled),
            ],
            &[(stored_next, next_active.clone())],
        )
        .expect("replace active profile content");

        assert!(!old_active.exists());
        assert!(!old_disabled.exists());
        assert_eq!(
            fs::read(&next_active).expect("read next file"),
            b"next profile"
        );
        assert_eq!(
            fs::read(&manual_file).expect("read manual file"),
            b"manual file"
        );
        fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn failed_profile_switch_keeps_the_previous_active_files() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock must be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "zzapcho-profile-rollback-test-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create test folder");
        let old_active = root.join("old.jar");
        let old_disabled = root.join("old.jar.disabled");
        let next_active = root.join("next.jar");
        fs::write(&old_active, b"keep me").expect("write old file");

        let result = replace_active_content(
            &[(old_active.clone(), old_disabled)],
            &[(root.join("missing.jar"), next_active.clone())],
        );

        assert!(result.is_err());
        assert_eq!(fs::read(&old_active).expect("read old file"), b"keep me");
        assert!(!next_active.exists());
        fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn transactional_delete_removes_all_requested_files() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock must be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "zzapcho-content-delete-test-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create test folder");
        let stored = root.join("stored.zip");
        let active = root.join("active.zip");
        fs::write(&stored, b"stored").expect("write stored file");
        fs::write(&active, b"active").expect("write active file");

        remove_files_transactionally(&[stored.clone(), active.clone()])
            .expect("delete content files");

        assert!(!stored.exists());
        assert!(!active.exists());
        fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn content_identity_is_case_insensitive_on_windows() {
        assert_eq!(
            normalized_content_identity("mods", "Example.JAR").expect("first identity"),
            normalized_content_identity("mods", "example.jar").expect("second identity")
        );
    }

    #[test]
    fn validates_server_sha512_before_activation() {
        let unique = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock must be after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "zzapcho-checksum-test-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create test folder");
        let file = root.join("content.jar");
        fs::write(&file, b"abc").expect("write checksum input");
        let expected = concat!(
            "ddaf35a193617abacc417349ae204131",
            "12e6fa4e89a97ea20a9eeee64b55d39a",
            "2192992a274fc1a836ba3c23a3feebbd",
            "454d4423643ce80e2a9ac94fa54ca49f"
        );

        assert!(validate_content_checksum(&file, Some(expected)).is_ok());
        assert!(validate_content_checksum(&file, Some("wrong")).is_err());
        fs::remove_dir_all(&root).expect("remove test directory");
    }
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
    let allowed = parsed.scheme() == "https"
        && matches!(
            parsed.host_str(),
            Some("modrinth.com")
                | Some("www.modrinth.com")
                | Some("login.microsoftonline.com")
                | Some("microsoft.com")
                | Some("www.microsoft.com")
        );
    if !allowed {
        return Err("허용되지 않은 외부 주소입니다.".into());
    }
    Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler")
        .arg(parsed.as_str())
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn begin_microsoft_device_login() -> Result<DeviceCode, String> {
    let response = reqwest::Client::new()
        .post("https://login.live.com/oauth20_connect.srf")
        .form(&[
            ("client_id", MICROSOFT_CLIENT_ID),
            ("scope", MICROSOFT_SCOPE),
            ("response_type", "device_code"),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(auth_error(
            &payload,
            "Microsoft 로그인 코드를 만들지 못했습니다.",
        ));
    }
    serde_json::from_value(payload).map_err(|error| error.to_string())
}

#[tauri::command]
async fn poll_microsoft_device_login(
    app: tauri::AppHandle,
    device_code: String,
) -> Result<Option<LauncherAccount>, String> {
    let (status, payload) = microsoft_token(&[
        ("client_id", MICROSOFT_CLIENT_ID),
        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ("device_code", &device_code),
    ])
    .await?;
    if status.is_success() {
        let token =
            serde_json::from_value::<MicrosoftToken>(payload).map_err(|error| error.to_string())?;
        return exchange_for_minecraft(&app, token, None).await.map(Some);
    }
    match payload.get("error").and_then(|value| value.as_str()) {
        Some("authorization_pending") | Some("slow_down") => Ok(None),
        _ => Err(auth_error(
            &payload,
            "Microsoft 로그인이 취소되었거나 만료됐습니다.",
        )),
    }
}

#[tauri::command]
async fn restore_microsoft_account(
    app: tauri::AppHandle,
) -> Result<Option<LauncherAccount>, String> {
    let refresh_token = match load_refresh_token(&app) {
        Some(value) => value,
        None => return Ok(load_cached_account(&app)),
    };
    let refresh_result = microsoft_token(&[
        ("client_id", MICROSOFT_CLIENT_ID),
        ("grant_type", "refresh_token"),
        ("refresh_token", &refresh_token),
        ("scope", MICROSOFT_SCOPE),
    ])
    .await;
    let (status, payload) = match refresh_result {
        Ok(result) => result,
        Err(error) => return load_cached_account(&app).map(Some).ok_or(error),
    };
    if !status.is_success() {
        if let Some(account) = load_cached_account(&app) {
            return Ok(Some(account));
        }
    }
    if !status.is_success() {
        return Err(auth_error(
            &payload,
            "Microsoft 자동 로그인에 실패했습니다.",
        ));
    }
    let token = match serde_json::from_value::<MicrosoftToken>(payload) {
        Ok(token) => token,
        Err(error) => return load_cached_account(&app).map(Some).ok_or(error.to_string()),
    };
    match exchange_for_minecraft(&app, token, Some(refresh_token)).await {
        Ok(account) => Ok(Some(account)),
        Err(error) => load_cached_account(&app).map(Some).ok_or(error),
    }
}

#[tauri::command]
fn store_auth_secret(value: String) -> Result<(), String> {
    keyring_entry(REFRESH_TOKEN_KEY)?
        .set_password(&value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_auth_secret(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(load_refresh_token(&app))
}

#[tauri::command]
fn delete_auth_secret(app: tauri::AppHandle) -> Result<(), String> {
    for key in [REFRESH_TOKEN_KEY, ACCOUNT_CACHE_KEY] {
        match keyring_entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    let path = auth_session_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn install_content_file(
    app: tauri::AppHandle,
    profile_id: String,
    kind: String,
    source_path: String,
) -> Result<String, String> {
    let _content_lock = lock_content_files()?;
    ensure_content_changes_allowed()?;
    let source = PathBuf::from(source_path);
    validate_content_file(&kind, &source)?;
    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("파일 이름을 확인할 수 없습니다.")?;
    let stored = profile_content_path(&app, &profile_id, &kind, file_name)?;
    copy_file_atomically(&source, &stored)?;
    let (active, disabled) = active_content_paths(&app, &profile_id, &kind, file_name)?;
    let previous_manifest =
        change_active_content_manifest(&app, &kind, &[file_name], Some(file_name))?;
    if let Err(error) =
        replace_active_content(&[(active.clone(), disabled)], &[(stored.clone(), active)])
    {
        let _ = save_active_content_manifest(&app, &previous_manifest);
        return Err(error);
    }
    Ok(stored.to_string_lossy().into_owned())
}

#[tauri::command]
fn set_content_enabled(
    app: tauri::AppHandle,
    profile_id: String,
    kind: String,
    file_name: String,
    enabled: bool,
    url: Option<String>,
    sha512: Option<String>,
) -> Result<(), String> {
    let _content_lock = lock_content_files()?;
    ensure_content_changes_allowed()?;
    let file_name = normalized_content_file_name(&file_name)?;
    let stored = profile_content_path(&app, &profile_id, &kind, &file_name)?;
    let (active, disabled) = active_content_paths(&app, &profile_id, &kind, &file_name)?;
    if enabled && !stored.exists() {
        let item = ProfileContentItem {
            kind: kind.clone(),
            file_name: file_name.clone(),
            enabled: true,
            url,
            sha512,
        };
        ensure_profile_content_file(&app, &profile_id, &item)?;
    } else if !stored.exists() {
        let legacy = if active.is_file() {
            Some(active.as_path())
        } else if disabled.is_file() {
            Some(disabled.as_path())
        } else {
            None
        };
        if let Some(source) = legacy {
            copy_file_atomically(source, &stored)?;
        }
    }
    if enabled && stored.exists() {
        validate_content_file(&kind, &stored)?;
    }
    let previous_manifest = change_active_content_manifest(
        &app,
        &kind,
        &[&file_name],
        enabled.then_some(file_name.as_str()),
    )?;
    let result = if enabled {
        replace_active_content(&[(active.clone(), disabled.clone())], &[(stored, active)])
    } else {
        replace_active_content(&[(active, disabled)], &[])
    };
    if let Err(error) = result {
        let _ = save_active_content_manifest(&app, &previous_manifest);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
fn remove_content_file(
    app: tauri::AppHandle,
    profile_id: String,
    kind: String,
    file_name: String,
) -> Result<(), String> {
    let _content_lock = lock_content_files()?;
    ensure_content_changes_allowed()?;
    let file_name = normalized_content_file_name(&file_name)?;
    let stored = profile_content_path(&app, &profile_id, &kind, &file_name)?;
    let (active, disabled) = active_content_paths(&app, &profile_id, &kind, &file_name)?;
    let previous_manifest = change_active_content_manifest(&app, &kind, &[&file_name], None)?;
    if let Err(error) = remove_files_transactionally(&[stored, active, disabled]) {
        let _ = save_active_content_manifest(&app, &previous_manifest);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
async fn download_content_file(
    app: tauri::AppHandle,
    profile_id: String,
    kind: String,
    url: String,
    file_name: String,
    previous_file_name: Option<String>,
    sha512: Option<String>,
) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("cdn.modrinth.com") {
        return Err("허용되지 않은 다운로드 주소입니다.".into());
    }
    let response = reqwest::Client::builder()
        .timeout(CONTENT_DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?
        .get(parsed)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("다운로드 실패: {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_CONTENT_DOWNLOAD_BYTES)
    {
        return Err("콘텐츠 파일이 허용 크기(512 MB)를 초과합니다.".into());
    }
    let file_name = normalized_content_file_name(&file_name)?;
    let destination = profile_content_path(&app, &profile_id, &kind, &file_name)?;
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_CONTENT_DOWNLOAD_BYTES {
        return Err("콘텐츠 파일이 허용 크기(512 MB)를 초과합니다.".into());
    }
    let _content_lock = lock_content_files()?;
    ensure_content_changes_allowed()?;
    let staged = temporary_content_path(&destination, "download")?;
    if let Err(error) = fs::write(&staged, bytes) {
        let _ = remove_file_if_exists(&staged);
        return Err(error.to_string());
    }
    if let Err(error) = validate_stored_content(&kind, &staged, sha512.as_deref()) {
        let _ = fs::remove_file(&staged);
        return Err(error);
    }
    commit_staged_file(&staged, &destination)?;
    let (active, disabled) = active_content_paths(&app, &profile_id, &kind, &file_name)?;
    let mut managed_paths = vec![(active.clone(), disabled)];
    let mut previous_stored = None;
    let mut previous_name = None;
    if let Some(previous) = previous_file_name.filter(|previous| previous != &file_name) {
        let previous = normalized_content_file_name(&previous)?;
        previous_stored = Some(profile_content_path(&app, &profile_id, &kind, &previous)?);
        managed_paths.push(active_content_paths(&app, &profile_id, &kind, &previous)?);
        previous_name = Some(previous);
    }
    let mut removed_names = vec![file_name.as_str()];
    if let Some(previous) = previous_name.as_deref() {
        removed_names.push(previous);
    }
    let previous_manifest =
        change_active_content_manifest(&app, &kind, &removed_names, Some(&file_name))?;
    if let Err(error) = replace_active_content(&managed_paths, &[(destination.clone(), active)]) {
        let _ = save_active_content_manifest(&app, &previous_manifest);
        return Err(error);
    }
    if let Some(previous_stored) = previous_stored {
        let _ = remove_file_if_exists(&previous_stored);
    }
    Ok(destination.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    let _discord_presence = discord_presence::DiscordPresence::start();

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .setup(|app| {
            #[cfg(windows)]
            refresh_shell_icon_cache_after_update(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_content_folder,
            open_game_folder,
            open_external_url,
            begin_microsoft_device_login,
            poll_microsoft_device_login,
            restore_microsoft_account,
            store_auth_secret,
            load_auth_secret,
            delete_auth_secret,
            sync_profile_content,
            install_content_file,
            set_content_enabled,
            remove_content_file,
            download_content_file,
            java_runtime::ensure_java_runtime,
            java_runtime::discover_java_runtimes,
            minecraft::launch_minecraft,
            minecraft::minecraft_running,
            minecraft::force_stop_minecraft,
            version_catalog::minecraft_versions,
            version_catalog::loader_versions
        ])
        .run(tauri::generate_context!())
        .expect("error while running zzapcho Launcher");
}
