use std::{fs, io::Write, path::{Path, PathBuf}};

use tauri::{Emitter, Manager};

fn emit(app: &tauri::AppHandle, message: impl Into<String>) {
    let _ = app.emit_to("main", "launcher-log", message.into());
}

pub fn recommended_major(minecraft_version: &str) -> u32 {
    let parts = minecraft_version.split('.').take(3).map(|part| part.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>();
    let major = *parts.first().unwrap_or(&1);
    let minor = *parts.get(1).unwrap_or(&0);
    let patch = *parts.get(2).unwrap_or(&0);
    if major > 1 || minor > 20 || (minor == 20 && patch >= 5) { 21 }
    else if minor >= 17 { 17 }
    else { 8 }
}

fn find_java(directory: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(directory).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_java(&path) { return Some(found); }
        } else if path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.eq_ignore_ascii_case("java.exe"))
            && path.parent().and_then(Path::file_name).and_then(|name| name.to_str()).is_some_and(|name| name.eq_ignore_ascii_case("bin"))
        {
            return Some(path);
        }
    }
    None
}

pub fn ensure_java(app: &tauri::AppHandle, app_data: &Path, major: u32) -> Result<PathBuf, String> {
    if !matches!(major, 8 | 17 | 21 | 25) { return Err(format!("지원하지 않는 Java 버전입니다: {major}")); }
    let runtime_dir = app_data.join("runtime").join(format!("temurin-{major}"));
    if let Some(java) = find_java(&runtime_dir) { return Ok(java); }

    emit(app, format!("Java {major} 런타임 다운로드 중..."));
    fs::create_dir_all(app_data.join("runtime")).map_err(|error| error.to_string())?;
    if runtime_dir.exists() { fs::remove_dir_all(&runtime_dir).map_err(|error| error.to_string())?; }
    fs::create_dir_all(&runtime_dir).map_err(|error| error.to_string())?;
    let archive_path = app_data.join("runtime").join(format!("temurin-{major}.zip"));
    let arch = if cfg!(target_arch = "aarch64") { "aarch64" } else { "x64" };
    let url = format!("https://api.adoptium.net/v3/binary/latest/{major}/ga/windows/{arch}/jre/hotspot/normal/eclipse");
    let mut response = reqwest::blocking::Client::builder()
        .user_agent("zzapchoLauncher/0.1.0")
        .build().map_err(|error| error.to_string())?
        .get(url).send().map_err(|error| error.to_string())?
        .error_for_status().map_err(|error| error.to_string())?;
    let mut archive = fs::File::create(&archive_path).map_err(|error| error.to_string())?;
    response.copy_to(&mut archive).map_err(|error| error.to_string())?;
    archive.flush().map_err(|error| error.to_string())?;
    drop(archive);

    emit(app, format!("Java {major} 런타임 설치 중..."));
    let archive = fs::File::open(&archive_path).map_err(|error| error.to_string())?;
    let mut zip = zip::ZipArchive::new(archive).map_err(|error| error.to_string())?;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|error| error.to_string())?;
        let Some(relative) = entry.enclosed_name() else { continue };
        let destination = runtime_dir.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = destination.parent() { fs::create_dir_all(parent).map_err(|error| error.to_string())?; }
            let mut output = fs::File::create(&destination).map_err(|error| error.to_string())?;
            std::io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
        }
    }
    let _ = fs::remove_file(&archive_path);
    find_java(&runtime_dir).ok_or_else(|| format!("설치한 Java {major} 실행 파일을 찾지 못했습니다."))
}

#[tauri::command]
pub async fn ensure_java_runtime(app: tauri::AppHandle, major: u32) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || ensure_java(&app, &app_data, major).map(|path| path.to_string_lossy().into_owned()))
        .await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::recommended_major;

    #[test]
    fn selects_minecraft_java_generation() {
        assert_eq!(recommended_major("1.16.5"), 8);
        assert_eq!(recommended_major("1.20.1"), 17);
        assert_eq!(recommended_major("1.20.5"), 21);
        assert_eq!(recommended_major("1.21.1"), 21);
    }
}
