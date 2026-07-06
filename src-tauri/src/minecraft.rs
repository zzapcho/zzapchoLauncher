use std::{
    collections::HashSet,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, AtomicU32, Ordering},
    thread,
};

use mc_launcher_core::prelude::{
    Account, InstallRequest, JavaInstallPolicy, LaunchOptions, Launcher, LoaderSpec, LoaderVersion,
    ProgressEvent,
};
use mc_launcher_core::{
    core::{
        maven::MavenCoordinate,
        rules::{evaluate_rules, FeatureSet},
        version::VersionJson,
    },
    platform::Platform,
};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

static GAME_RUNNING: AtomicBool = AtomicBool::new(false);
static GAME_PROCESS_ID: AtomicU32 = AtomicU32::new(0);
static FORCE_STOP_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchAccount {
    id: String,
    name: String,
    kind: String,
    minecraft_access_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentToggle {
    kind: String,
    file_name: String,
    enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchMinecraftRequest {
    profile_id: String,
    minecraft_version: String,
    mod_loader: String,
    mod_loader_version: String,
    min_memory_mb: u32,
    max_memory_mb: u32,
    java_args: Vec<String>,
    java_version: Option<u32>,
    java_path: Option<String>,
    content: Vec<ContentToggle>,
    account: LaunchAccount,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchStarted {
    process_id: u32,
}

fn emit_launcher(app: &tauri::AppHandle, message: impl Into<String>) {
    let _ = app.emit_to("main", "launcher-log", message.into());
}

fn emit_progress(app: &tauri::AppHandle, message: impl Into<String>, progress: u8) {
    let _ = app.emit_to(
        "main",
        "launch-progress",
        serde_json::json!({
            "status": "preparing",
            "message": message.into(),
            "progress": progress
        }),
    );
}

fn loader_spec(loader: &str, version: &str) -> Result<Option<LoaderSpec>, String> {
    let version = if version.trim().is_empty() {
        LoaderVersion::LatestStable
    } else {
        LoaderVersion::Exact(version.to_string())
    };
    match loader {
        "vanilla" => Ok(None),
        "fabric" => Ok(Some(LoaderSpec::Fabric { version })),
        "quilt" => Ok(Some(LoaderSpec::Quilt { version })),
        "forge" => Ok(Some(LoaderSpec::Forge { version })),
        other => Err(format!("지원하지 않는 모드 로더입니다: {other}")),
    }
}

fn install_fallback_maven_libraries(
    app: &tauri::AppHandle,
    minecraft_dir: &Path,
    version: &VersionJson,
) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("zzapchoLauncher/0.1.0")
        .build()
        .map_err(|error| error.to_string())?;
    for library in &version.libraries {
        if !evaluate_rules(&library.rules, Platform::current(), &FeatureSet::default()) {
            continue;
        }
        if library
            .downloads
            .as_ref()
            .and_then(|downloads| downloads.artifact.as_ref())
            .is_some()
            || library.natives.is_some()
        {
            continue;
        }
        let Some(repository) = library.url.as_deref() else {
            continue;
        };
        let coordinate =
            MavenCoordinate::parse(&library.name).map_err(|error| error.to_string())?;
        let relative = coordinate.artifact_path();
        let destination = minecraft_dir.join("libraries").join(&relative);
        if destination.exists() {
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let url = format!(
            "{}/{}",
            repository.trim_end_matches('/'),
            relative.to_string_lossy().replace('\\', "/")
        );
        emit_launcher(app, format!("로더 라이브러리 다운로드: {}", library.name));
        let mut response = client
            .get(url)
            .send()
            .map_err(|error| error.to_string())?
            .error_for_status()
            .map_err(|error| error.to_string())?;
        let mut output = fs::File::create(&destination).map_err(|error| error.to_string())?;
        response
            .copy_to(&mut output)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn sync_content(profile_dir: &Path, content: &[ContentToggle]) -> Result<(), String> {
    let valid_kinds: HashSet<&str> = ["mods", "resourcePacks", "shaders"].into_iter().collect();
    for item in content {
        if !valid_kinds.contains(item.kind.as_str()) {
            continue;
        }
        let folder = match item.kind.as_str() {
            "resourcePacks" => "resourcepacks",
            "shaders" => "shaderpacks",
            _ => "mods",
        };
        let Some(file_name) = Path::new(&item.file_name).file_name() else {
            continue;
        };
        let enabled_path = profile_dir.join(folder).join(file_name);
        let disabled_path = PathBuf::from(format!("{}.disabled", enabled_path.display()));
        if item.enabled && disabled_path.exists() && !enabled_path.exists() {
            fs::rename(disabled_path, enabled_path).map_err(|error| error.to_string())?;
        } else if !item.enabled && enabled_path.exists() && !disabled_path.exists() {
            fs::rename(enabled_path, disabled_path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn read_game_output<R: Read + Send + 'static>(reader: R, app: tauri::AppHandle) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            let _ = app.emit_to("main", "game-log", line);
        }
    });
}

fn prepare_and_launch(
    app: tauri::AppHandle,
    request: LaunchMinecraftRequest,
) -> Result<LaunchStarted, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let minecraft_dir = app_data.join("minecraft");
    let profile_dir = app_data
        .join("profiles")
        .join(super::safe_segment(&request.profile_id));
    fs::create_dir_all(&profile_dir).map_err(|error| error.to_string())?;
    emit_progress(&app, "모드 확인 중", 12);
    sync_content(&profile_dir, &request.content)?;

    let java_major = request
        .java_version
        .unwrap_or_else(|| super::java_runtime::recommended_major(&request.minecraft_version));
    emit_progress(&app, format!("Java {java_major} 확인 중"), 16);
    let java = if let Some(path) = request.java_path.filter(|path| !path.trim().is_empty()) {
        let path = PathBuf::from(path);
        if !path.is_file() {
            return Err("선택한 Java 실행 파일을 찾을 수 없습니다.".into());
        }
        let detected = super::java_runtime::java_major(&path)
            .ok_or("선택한 파일의 Java 버전을 확인할 수 없습니다.")?;
        if detected != java_major {
            return Err(format!(
                "이 프로필에는 Java {java_major}이 필요하지만 선택한 Java는 {detected}입니다."
            ));
        }
        path
    } else {
        super::java_runtime::ensure_java(&app, &app_data, java_major)?
    };
    if let Some(java_bin) = java.parent() {
        let current_path = std::env::var_os("PATH").unwrap_or_default();
        let mut paths = vec![java_bin.to_path_buf()];
        paths.extend(std::env::split_paths(&current_path));
        if let Ok(joined) = std::env::join_paths(paths) {
            std::env::set_var("PATH", joined);
        }
    }

    emit_launcher(
        &app,
        format!("Minecraft {} 파일 확인 중...", request.minecraft_version),
    );
    let launcher = Launcher::new(&minecraft_dir);
    let install_request = InstallRequest {
        minecraft_version: request.minecraft_version.clone(),
        loader: loader_spec(&request.mod_loader, &request.mod_loader_version)?,
        java: JavaInstallPolicy::Auto,
    };
    let progress_app = app.clone();
    let mut reported_progress = 20u8;
    let mut stage_progress = 20u8;
    let mut progress = move |event: ProgressEvent| match event {
        ProgressEvent::StageStarted { stage } => {
            let (message, percent) = match stage {
                mc_launcher_core::progress::InstallStage::ResolveVersion => {
                    ("게임 정보 확인 중", 22)
                }
                mc_launcher_core::progress::InstallStage::DownloadLibraries => {
                    ("라이브러리 다운로드 중", 34)
                }
                mc_launcher_core::progress::InstallStage::DownloadAssets => {
                    ("게임 파일 다운로드 중", 58)
                }
                mc_launcher_core::progress::InstallStage::InstallRuntime => {
                    ("Java 다운로드 중", 72)
                }
                mc_launcher_core::progress::InstallStage::ExtractNatives => {
                    ("게임 파일 설치 중", 84)
                }
                mc_launcher_core::progress::InstallStage::LoaderInstall => {
                    ("모드 로더 설치 중", 90)
                }
                mc_launcher_core::progress::InstallStage::Verify => ("파일 검증 중", 96),
            };
            stage_progress = percent;
            reported_progress = reported_progress.max(percent);
            emit_progress(&progress_app, message, reported_progress);
            emit_launcher(&progress_app, format!("설치 단계: {stage:?}"));
        }
        ProgressEvent::TaskStarted { label, .. } => {
            emit_launcher(&progress_app, format!("다운로드: {label}"));
        }
        ProgressEvent::BytesReceived {
            received,
            total: Some(total),
            ..
        } if total > 0 => {
            let task_progress = ((received.saturating_mul(8) / total).min(8)) as u8;
            let next = stage_progress.saturating_add(task_progress).min(95);
            reported_progress = reported_progress.max(next);
            emit_progress(&progress_app, "게임 파일 다운로드 중", reported_progress);
        }
        _ => {}
    };
    let installed = launcher
        .install_with_progress(install_request, &mut progress)
        .map_err(|error| error.to_string())?;
    let version = launcher
        .load_version(&installed.version_id)
        .map_err(|error| error.to_string())?;
    install_fallback_maven_libraries(&app, &minecraft_dir, &version)?;
    emit_progress(&app, "게임 실행 준비 중", 98);

    let account = if request.account.kind == "microsoft" {
        Account::Microsoft {
            username: request.account.name,
            uuid: request.account.id,
            access_token: request
                .account
                .minecraft_access_token
                .ok_or("Minecraft 로그인 토큰이 없습니다. 다시 로그인해 주세요.")?,
        }
    } else {
        Account::offline(request.account.name)
    };
    let command = launcher
        .build_launch_command_from_version(
            &version,
            LaunchOptions {
                account,
                java_executable: Some(java),
                game_directory: Some(profile_dir.clone()),
                launcher_name: "zzapchoLauncher".to_string(),
                launcher_version: "0.1.0".to_string(),
                ..Default::default()
            },
        )
        .map_err(|error| error.to_string())?;

    let mut args = vec![
        format!("-Xms{}M", request.min_memory_mb),
        format!("-Xmx{}M", request.max_memory_mb),
    ];
    args.extend(request.java_args);
    args.extend(command.args);
    emit_launcher(&app, format!("{} 실행 중...", installed.version_id));
    let mut process = Command::new(command.executable);
    process
        .args(args)
        .envs(command.env)
        .current_dir(command.working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x08000000);
    }
    let mut child = process.spawn().map_err(|error| error.to_string())?;
    let process_id = child.id();
    GAME_PROCESS_ID.store(process_id, Ordering::SeqCst);
    FORCE_STOP_REQUESTED.store(false, Ordering::SeqCst);
    if let Some(stdout) = child.stdout.take() {
        read_game_output(stdout, app.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        read_game_output(stderr, app.clone());
    }
    thread::spawn(move || {
        let status = child.wait();
        GAME_RUNNING.store(false, Ordering::SeqCst);
        GAME_PROCESS_ID.store(0, Ordering::SeqCst);
        let forced = FORCE_STOP_REQUESTED.swap(false, Ordering::SeqCst);
        let code = status.ok().and_then(|value| value.code());
        let _ = app.emit_to(
            "main",
            "game-exited",
            serde_json::json!({ "code": code, "forced": forced }),
        );
    });
    Ok(LaunchStarted { process_id })
}

#[tauri::command]
pub fn minecraft_running() -> bool {
    GAME_RUNNING.load(Ordering::SeqCst)
}

#[tauri::command]
pub fn force_stop_minecraft() -> Result<(), String> {
    let process_id = GAME_PROCESS_ID.load(Ordering::SeqCst);
    if !GAME_RUNNING.load(Ordering::SeqCst) || process_id == 0 {
        return Err("실행 중인 Minecraft가 없습니다.".into());
    }
    FORCE_STOP_REQUESTED.store(true, Ordering::SeqCst);

    #[cfg(windows)]
    let status = {
        use std::os::windows::process::CommandExt;
        Command::new("taskkill.exe")
            .args(["/PID", &process_id.to_string(), "/T", "/F"])
            .creation_flags(0x08000000)
            .status()
    };
    #[cfg(not(windows))]
    let status = Command::new("kill")
        .args(["-9", &process_id.to_string()])
        .status();

    match status {
        Ok(result) if result.success() => Ok(()),
        Ok(result) => {
            FORCE_STOP_REQUESTED.store(false, Ordering::SeqCst);
            Err(format!("Minecraft 종료 명령이 실패했습니다: {result}"))
        }
        Err(error) => {
            FORCE_STOP_REQUESTED.store(false, Ordering::SeqCst);
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub async fn launch_minecraft(
    app: tauri::AppHandle,
    request: LaunchMinecraftRequest,
) -> Result<LaunchStarted, String> {
    if GAME_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("Minecraft가 이미 실행 중입니다.".into());
    }
    let result = match tauri::async_runtime::spawn_blocking(move || {
        prepare_and_launch(app, request)
    })
    .await
    {
        Ok(result) => result,
        Err(error) => {
            GAME_RUNNING.store(false, Ordering::SeqCst);
            return Err(error.to_string());
        }
    };
    if result.is_err() {
        GAME_RUNNING.store(false, Ordering::SeqCst);
    }
    result
}
