use std::{fs, path::{Path, PathBuf}, process::Command};
use tauri::Manager;

fn safe_segment(value: &str) -> String {
    value.chars().map(|character| {
        if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') { character } else { '_' }
    }).collect()
}

fn content_folder(app: &tauri::AppHandle, profile_id: &str, kind: &str) -> Result<PathBuf, String> {
    let folder = match kind {
        "mods" => "mods",
        "resourcePacks" => "resourcepacks",
        "shaders" => "shaderpacks",
        _ => return Err("지원하지 않는 콘텐츠 종류입니다.".into()),
    };
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?
        .join("profiles").join(safe_segment(profile_id)).join(folder);
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn open_in_explorer(path: &Path) -> Result<String, String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    Command::new("explorer.exe").arg(path).spawn().map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_content_folder(app: tauri::AppHandle, profile_id: String, kind: String) -> Result<String, String> {
    open_in_explorer(&content_folder(&app, &profile_id, &kind)?)
}

#[tauri::command]
fn open_game_folder() -> Result<String, String> {
    let app_data = std::env::var("APPDATA").map_err(|error| error.to_string())?;
    open_in_explorer(&PathBuf::from(app_data).join(".minecraft"))
}

#[tauri::command]
fn install_content_file(app: tauri::AppHandle, profile_id: String, kind: String, source_path: String) -> Result<String, String> {
    let source = PathBuf::from(source_path);
    let file_name = source.file_name().ok_or("파일 이름을 확인할 수 없습니다.")?;
    let destination = content_folder(&app, &profile_id, &kind)?.join(file_name);
    fs::copy(&source, &destination).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
async fn download_content_file(app: tauri::AppHandle, profile_id: String, kind: String, url: String, file_name: String) -> Result<String, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("cdn.modrinth.com") {
        return Err("허용되지 않은 다운로드 주소입니다.".into());
    }
    let response = reqwest::get(parsed).await.map_err(|error| error.to_string())?;
    if !response.status().is_success() { return Err(format!("다운로드 실패: {}", response.status())); }
    let destination = content_folder(&app, &profile_id, &kind)?.join(safe_segment(&file_name));
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    fs::write(&destination, bytes).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![open_content_folder, open_game_folder, install_content_file, download_content_file])
        .run(tauri::generate_context!())
        .expect("error while running zzapcho Launcher");
}
