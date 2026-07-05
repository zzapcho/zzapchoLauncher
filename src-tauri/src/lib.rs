use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::Manager;

mod java_runtime;
mod minecraft;

const MICROSOFT_CLIENT_ID: &str = "00000000402b5328";
const MICROSOFT_SCOPE: &str = "XboxLive.signin offline_access";

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

const AUTH_SERVICE: &str = "zzapchoLauncher";
const REFRESH_TOKEN_KEY: &str = "microsoft-refresh-token";
const ACCOUNT_CACHE_KEY: &str = "minecraft-account-cache";

fn keyring_entry(key: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(AUTH_SERVICE, key).map_err(|error| error.to_string())
}

fn load_cached_account() -> Option<LauncherAccount> {
    keyring_entry(ACCOUNT_CACHE_KEY)
        .ok()?
        .get_password()
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
}

fn store_cached_account(account: &LauncherAccount) -> Result<(), String> {
    let value = serde_json::to_string(account).map_err(|error| error.to_string())?;
    keyring_entry(ACCOUNT_CACHE_KEY)?
        .set_password(&value)
        .map_err(|error| error.to_string())
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
    keyring_entry(REFRESH_TOKEN_KEY)?
        .set_password(&refresh_token)
        .map_err(|error| error.to_string())?;

    let account = LauncherAccount {
        id,
        name,
        skin_url,
        kind: "microsoft".into(),
        minecraft_access_token,
    };
    store_cached_account(&account)?;
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

fn content_folder(app: &tauri::AppHandle, profile_id: &str, kind: &str) -> Result<PathBuf, String> {
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
        .join("profiles")
        .join(safe_segment(profile_id))
        .join(folder);
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
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
    open_in_explorer(&content_folder(&app, &profile_id, &kind)?)
}

#[tauri::command]
fn open_game_folder() -> Result<String, String> {
    let app_data = std::env::var("APPDATA").map_err(|error| error.to_string())?;
    open_in_explorer(&PathBuf::from(app_data).join(".minecraft"))
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
        return exchange_for_minecraft(token, None).await.map(Some);
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
async fn restore_microsoft_account() -> Result<Option<LauncherAccount>, String> {
    let entry = keyring_entry(REFRESH_TOKEN_KEY)?;
    let refresh_token = match entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(load_cached_account()),
        Err(error) => return Err(error.to_string()),
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
        Err(error) => return load_cached_account().map(Some).ok_or(error),
    };
    if !status.is_success() {
        if let Some(account) = load_cached_account() {
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
        Err(error) => return load_cached_account().map(Some).ok_or(error.to_string()),
    };
    match exchange_for_minecraft(token, Some(refresh_token)).await {
        Ok(account) => Ok(Some(account)),
        Err(error) => load_cached_account().map(Some).ok_or(error),
    }
}

#[tauri::command]
fn store_auth_secret(value: String) -> Result<(), String> {
    keyring_entry(REFRESH_TOKEN_KEY)?
        .set_password(&value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_auth_secret() -> Result<Option<String>, String> {
    let entry = keyring_entry(REFRESH_TOKEN_KEY)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn delete_auth_secret() -> Result<(), String> {
    for key in [REFRESH_TOKEN_KEY, ACCOUNT_CACHE_KEY] {
        match keyring_entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(error.to_string()),
        }
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
    let source = PathBuf::from(source_path);
    let file_name = source
        .file_name()
        .ok_or("파일 이름을 확인할 수 없습니다.")?;
    let destination = content_folder(&app, &profile_id, &kind)?.join(file_name);
    fs::copy(&source, &destination).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
async fn download_content_file(
    app: tauri::AppHandle,
    profile_id: String,
    kind: String,
    url: String,
    file_name: String,
) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("cdn.modrinth.com") {
        return Err("허용되지 않은 다운로드 주소입니다.".into());
    }
    let response = reqwest::get(parsed)
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("다운로드 실패: {}", response.status()));
    }
    let destination = content_folder(&app, &profile_id, &kind)?.join(safe_segment(&file_name));
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    fs::write(&destination, bytes).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            install_content_file,
            download_content_file,
            java_runtime::ensure_java_runtime,
            minecraft::launch_minecraft
        ])
        .run(tauri::generate_context!())
        .expect("error while running zzapcho Launcher");
}
