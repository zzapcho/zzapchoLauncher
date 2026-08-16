use std::{
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
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
static GAME_VERSION: Mutex<Option<String>> = Mutex::new(None);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GameProcessLock {
    process_id: u32,
    minecraft_version: String,
}

fn game_process_lock_path() -> Option<PathBuf> {
    super::default_minecraft_dir()
        .ok()
        .map(|path| path.join(".zzapcho-game-process.json"))
}

#[cfg(windows)]
fn process_is_running(process_id: u32) -> bool {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    };

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if handle.is_null() {
        return false;
    }
    let mut exit_code = 0u32;
    let success = unsafe { GetExitCodeProcess(handle, &mut exit_code) } != 0;
    unsafe { CloseHandle(handle) };
    success && exit_code == 259
}

#[cfg(not(windows))]
fn process_is_running(process_id: u32) -> bool {
    Command::new("kill")
        .args(["-0", &process_id.to_string()])
        .status()
        .is_ok_and(|status| status.success())
}

fn read_live_game_process_lock() -> Option<GameProcessLock> {
    let path = game_process_lock_path()?;
    let lock = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<GameProcessLock>(&bytes).ok());
    match lock {
        Some(lock) if process_is_running(lock.process_id) => Some(lock),
        _ => {
            let _ = fs::remove_file(path);
            None
        }
    }
}

fn write_game_process_lock(process_id: u32, minecraft_version: &str) -> Result<(), String> {
    let path =
        game_process_lock_path().ok_or("Minecraft 프로세스 잠금 경로를 찾을 수 없습니다.")?;
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(&GameProcessLock {
        process_id,
        minecraft_version: minecraft_version.to_string(),
    })
    .map_err(|error| error.to_string())?;
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    if path.exists() {
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

fn clear_game_process_lock(process_id: u32) {
    let Some(path) = game_process_lock_path() else {
        return;
    };
    let matches = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<GameProcessLock>(&bytes).ok())
        .is_some_and(|lock| lock.process_id == process_id);
    if matches {
        let _ = fs::remove_file(path);
    }
}

pub(crate) fn game_process_running() -> bool {
    GAME_RUNNING.load(Ordering::SeqCst) || read_live_game_process_lock().is_some()
}

pub(crate) fn running_game_version() -> Option<String> {
    if !game_process_running() {
        return None;
    }
    GAME_VERSION
        .lock()
        .ok()
        .and_then(|version| version.clone())
        .or_else(|| read_live_game_process_lock().map(|lock| lock.minecraft_version))
}

#[cfg(windows)]
fn keep_minecraft_window_title(process_id: u32, minecraft_version: String) {
    use std::{os::windows::ffi::OsStrExt, time::Duration};
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM},
        UI::WindowsAndMessaging::{
            EnumWindows, GetWindowThreadProcessId, IsWindowVisible, SetWindowTextW,
        },
    };

    struct WindowSearch {
        process_id: u32,
        title: Vec<u16>,
        updated: bool,
    }

    unsafe extern "system" fn update_owned_window(window: HWND, data: LPARAM) -> i32 {
        let search = unsafe { &mut *(data as *mut WindowSearch) };
        let mut owner_process_id = 0;
        unsafe { GetWindowThreadProcessId(window, &mut owner_process_id) };
        if owner_process_id == search.process_id
            && unsafe { IsWindowVisible(window) } != 0
            && unsafe { SetWindowTextW(window, search.title.as_ptr()) } != 0
        {
            search.updated = true;
            return 0;
        }
        1
    }

    thread::spawn(move || {
        let title =
            std::ffi::OsStr::new(&format!("zzapchoLauncher - Minecraft {minecraft_version}"))
                .encode_wide()
                .chain(Some(0))
                .collect::<Vec<_>>();

        while GAME_PROCESS_ID.load(Ordering::SeqCst) == process_id {
            let mut search = WindowSearch {
                process_id,
                title: title.clone(),
                updated: false,
            };
            unsafe {
                EnumWindows(
                    Some(update_owned_window),
                    &mut search as *mut WindowSearch as LPARAM,
                );
            }
            thread::sleep(if search.updated {
                Duration::from_secs(2)
            } else {
                Duration::from_millis(250)
            });
        }
    });
}

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
    content: Vec<super::ProfileContentItem>,
    managed_files: Vec<super::ManagedProfileContentFile>,
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

fn read_game_output<R: Read + Send + 'static>(reader: R, app: tauri::AppHandle) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            let _ = app.emit_to("main", "game-log", line);
        }
    });
}

fn copy_if_present(source: &Path, destination: &Path) -> Result<bool, String> {
    if !source.is_file() {
        return Ok(false);
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(source, destination).map_err(|error| error.to_string())?;
    Ok(true)
}

fn file_missing_or_empty(path: &Path) -> bool {
    match fs::metadata(path) {
        Ok(metadata) => !metadata.is_file() || metadata.len() == 0,
        Err(_) => true,
    }
}

fn restore_missing_game_data(
    snapshot: &Path,
    minecraft_dir: &Path,
) -> Result<Vec<PathBuf>, String> {
    let mut restored = Vec::new();
    for name in ["options.txt", "servers.dat", "servers.dat_old"] {
        let source = snapshot.join(name);
        let destination = minecraft_dir.join(name);
        if source.is_file() && file_missing_or_empty(&destination) {
            copy_if_present(&source, &destination)?;
            restored.push(destination);
        }
    }

    let snapshot_saves = snapshot.join("saves");
    if snapshot_saves.is_dir() {
        for world in fs::read_dir(snapshot_saves).map_err(|error| error.to_string())? {
            let world = world.map_err(|error| error.to_string())?;
            if !world.path().is_dir() {
                continue;
            }
            let destination_world = minecraft_dir.join("saves").join(world.file_name());
            if !destination_world.is_dir() {
                continue;
            }
            for name in ["level.dat", "level.dat_old"] {
                let source = world.path().join(name);
                let destination = destination_world.join(name);
                if source.is_file() && file_missing_or_empty(&destination) {
                    copy_if_present(&source, &destination)?;
                    restored.push(destination);
                }
            }
        }
    }
    Ok(restored)
}

fn create_game_data_snapshot(snapshot: &Path, minecraft_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(snapshot).map_err(|error| error.to_string())?;
    for name in ["options.txt", "servers.dat", "servers.dat_old"] {
        copy_if_present(&minecraft_dir.join(name), &snapshot.join(name))?;
    }

    let saves = minecraft_dir.join("saves");
    if saves.is_dir() {
        for world in fs::read_dir(saves).map_err(|error| error.to_string())? {
            let world = world.map_err(|error| error.to_string())?;
            if !world.path().is_dir() {
                continue;
            }
            for name in ["level.dat", "level.dat_old"] {
                copy_if_present(
                    &world.path().join(name),
                    &snapshot.join("saves").join(world.file_name()).join(name),
                )?;
            }
        }
    }
    Ok(())
}

fn protect_game_data(app: &tauri::AppHandle, minecraft_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let backup_root = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("game-data-safety");
    fs::create_dir_all(&backup_root).map_err(|error| error.to_string())?;
    let mut snapshots = fs::read_dir(&backup_root)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    snapshots.sort();

    let restored = if let Some(latest) = snapshots.last() {
        restore_missing_game_data(latest, minecraft_dir)?
    } else {
        Vec::new()
    };

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let snapshot = backup_root.join(format!("{timestamp:020}"));
    create_game_data_snapshot(&snapshot, minecraft_dir)?;
    snapshots.push(snapshot);
    if snapshots.len() > 5 {
        let remove_count = snapshots.len() - 5;
        for old in snapshots.into_iter().take(remove_count) {
            let _ = fs::remove_dir_all(old);
        }
    }
    Ok(restored)
}

fn prepare_and_launch(
    app: tauri::AppHandle,
    request: LaunchMinecraftRequest,
) -> Result<LaunchStarted, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let minecraft_dir = super::default_minecraft_dir()?;
    fs::create_dir_all(&minecraft_dir).map_err(|error| error.to_string())?;
    match protect_game_data(&app, &minecraft_dir) {
        Ok(restored) => {
            for path in restored {
                emit_launcher(
                    &app,
                    format!(
                        "손상되거나 누락된 게임 데이터를 복구했습니다: {}",
                        path.display()
                    ),
                );
            }
        }
        Err(error) => emit_launcher(&app, format!("게임 데이터 안전 백업 실패: {error}")),
    }
    emit_launcher(
        &app,
        format!(
            "프로필 {} · 기본 Minecraft 폴더 사용: {}",
            request.profile_id,
            minecraft_dir.display()
        ),
    );
    emit_progress(&app, "모드 확인 중", 12);
    super::sync_profile_content_files(
        &app,
        &request.profile_id,
        &request.content,
        &request.managed_files,
    )?;

    let java_major = request
        .java_version
        .unwrap_or_else(|| super::java_runtime::recommended_major(&request.minecraft_version));
    emit_progress(&app, format!("Java {java_major} 확인 중"), 16);
    let java = if let Some(path) = request.java_path.filter(|path| !path.trim().is_empty()) {
        let path = PathBuf::from(path);
        let use_selected = if !path.is_file() {
            emit_launcher(
                &app,
                "선택한 Java를 찾지 못해서 자동 설치 Java로 전환합니다.",
            );
            false
        } else if let Some(detected) = super::java_runtime::java_major(&path) {
            if detected == java_major {
                true
            } else {
                emit_launcher(
                    &app,
                    format!(
                        "선택한 Java는 {detected}이고 필요한 버전은 {java_major}이라 자동 설치 Java로 전환합니다."
                    ),
                );
                false
            }
        } else {
            emit_launcher(
                &app,
                "선택한 Java 버전을 확인하지 못해서 자동 설치 Java로 전환합니다.",
            );
            false
        };
        if use_selected {
            path
        } else {
            emit_progress(&app, format!("Java {java_major} 자동 설치 중"), 18);
            super::java_runtime::ensure_java(&app, &app_data, java_major)?
        }
    } else {
        emit_progress(&app, format!("Java {java_major} 자동 설치 중"), 18);
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
                game_directory: Some(minecraft_dir.clone()),
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
    let minecraft_version = request.minecraft_version.clone();
    if let Ok(mut running_version) = GAME_VERSION.lock() {
        *running_version = Some(minecraft_version.clone());
    }
    GAME_PROCESS_ID.store(process_id, Ordering::SeqCst);
    if let Err(error) = write_game_process_lock(process_id, &minecraft_version) {
        emit_launcher(
            &app,
            format!("Minecraft 실행 상태 저장에 실패했습니다: {error}"),
        );
    }
    #[cfg(windows)]
    keep_minecraft_window_title(process_id, minecraft_version);
    if let Some(stdout) = child.stdout.take() {
        read_game_output(stdout, app.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        read_game_output(stderr, app.clone());
    }
    thread::spawn(move || {
        let status = child.wait();
        clear_game_process_lock(process_id);
        GAME_RUNNING.store(false, Ordering::SeqCst);
        GAME_PROCESS_ID.store(0, Ordering::SeqCst);
        if let Ok(mut running_version) = GAME_VERSION.lock() {
            *running_version = None;
        }
        let code = status.ok().and_then(|value| value.code());
        let _ = app.emit_to(
            "main",
            "game-exited",
            serde_json::json!({ "code": code, "forced": false }),
        );
    });
    Ok(LaunchStarted { process_id })
}

fn adopt_running_game(app: tauri::AppHandle, lock: GameProcessLock) {
    if GAME_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let process_id = lock.process_id;
    GAME_PROCESS_ID.store(process_id, Ordering::SeqCst);
    if let Ok(mut running_version) = GAME_VERSION.lock() {
        *running_version = Some(lock.minecraft_version.clone());
    }
    #[cfg(windows)]
    keep_minecraft_window_title(process_id, lock.minecraft_version);

    thread::spawn(move || {
        while process_is_running(process_id) {
            thread::sleep(Duration::from_millis(500));
        }
        clear_game_process_lock(process_id);
        GAME_RUNNING.store(false, Ordering::SeqCst);
        GAME_PROCESS_ID.store(0, Ordering::SeqCst);
        if let Ok(mut running_version) = GAME_VERSION.lock() {
            *running_version = None;
        }
        let _ = app.emit_to(
            "main",
            "game-exited",
            serde_json::json!({ "code": null, "forced": false }),
        );
    });
}

#[tauri::command]
pub fn minecraft_running(app: tauri::AppHandle) -> bool {
    if GAME_RUNNING.load(Ordering::SeqCst) {
        return true;
    }
    let Some(lock) = read_live_game_process_lock() else {
        return false;
    };
    adopt_running_game(app, lock);
    true
}

#[cfg(windows)]
fn request_minecraft_window_close(process_id: u32) -> bool {
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, WPARAM},
        UI::WindowsAndMessaging::{
            EnumWindows, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_CLOSE,
        },
    };

    struct CloseRequest {
        process_id: u32,
        requested: bool,
    }

    unsafe extern "system" fn close_owned_window(window: HWND, data: LPARAM) -> i32 {
        let request = unsafe { &mut *(data as *mut CloseRequest) };
        let mut owner_process_id = 0;
        unsafe { GetWindowThreadProcessId(window, &mut owner_process_id) };
        if owner_process_id == request.process_id && unsafe { IsWindowVisible(window) } != 0 {
            request.requested |=
                unsafe { PostMessageW(window, WM_CLOSE, WPARAM::default(), LPARAM::default()) }
                    != 0;
        }
        1
    }

    let mut request = CloseRequest {
        process_id,
        requested: false,
    };
    unsafe {
        EnumWindows(
            Some(close_owned_window),
            &mut request as *mut CloseRequest as LPARAM,
        );
    }
    request.requested
}

fn stop_minecraft_process(process_id: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut close_requested = false;
        for _ in 0..80 {
            if !process_is_running(process_id) {
                return Ok(());
            }
            if !close_requested {
                close_requested = request_minecraft_window_close(process_id);
            }
            thread::sleep(Duration::from_millis(250));
        }
    }

    #[cfg(not(windows))]
    {
        let status = Command::new("kill")
            .arg(process_id.to_string())
            .status()
            .map_err(|error| error.to_string())?;
        if status.success() {
            for _ in 0..80 {
                if !process_is_running(process_id) {
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(250));
            }
        }
    }

    Err(
        "Minecraft에 정상 종료를 요청했지만 아직 실행 중입니다. 저장 중일 수 있어 강제 종료하지 않았습니다. 잠시 기다린 뒤 게임 창에서 종료해 주세요."
            .into(),
    )
}

#[tauri::command]
pub async fn stop_minecraft() -> Result<(), String> {
    let process_id = match GAME_PROCESS_ID.load(Ordering::SeqCst) {
        0 => read_live_game_process_lock().map_or(0, |lock| lock.process_id),
        process_id => process_id,
    };
    if process_id == 0 || !process_is_running(process_id) {
        return Err("실행 중인 Minecraft가 없습니다.".into());
    }
    tauri::async_runtime::spawn_blocking(move || stop_minecraft_process(process_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn launch_minecraft(
    app: tauri::AppHandle,
    request: LaunchMinecraftRequest,
) -> Result<LaunchStarted, String> {
    if read_live_game_process_lock().is_some() {
        return Err("Minecraft가 이미 실행 중입니다.".into());
    }
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

#[cfg(test)]
mod tests {
    use super::{create_game_data_snapshot, restore_missing_game_data};
    use std::{fs, path::PathBuf};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should be after epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "zzapcho-launcher-{name}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("test directory should be created");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn snapshot_restores_missing_critical_game_data_without_recreating_deleted_worlds() {
        let test = TestDirectory::new("game-data-safety");
        let minecraft = test.0.join("minecraft");
        let snapshot = test.0.join("snapshot");
        let existing_world = minecraft.join("saves").join("existing-world");
        let removed_world = minecraft.join("saves").join("removed-world");
        fs::create_dir_all(&existing_world).expect("existing world should be created");
        fs::create_dir_all(&removed_world).expect("removed world should be created");
        fs::write(
            minecraft.join("options.txt"),
            b"key_key.forward:key.keyboard.w",
        )
        .expect("options should be written");
        fs::write(minecraft.join("servers.dat"), b"server-list")
            .expect("server list should be written");
        fs::write(existing_world.join("level.dat"), b"existing-level")
            .expect("existing level should be written");
        fs::write(removed_world.join("level.dat"), b"removed-level")
            .expect("removed level should be written");

        create_game_data_snapshot(&snapshot, &minecraft).expect("snapshot should succeed");
        fs::remove_file(minecraft.join("options.txt")).expect("options should be removed");
        fs::write(minecraft.join("servers.dat"), []).expect("server list should be emptied");
        fs::remove_file(existing_world.join("level.dat")).expect("level should be removed");
        fs::remove_dir_all(&removed_world).expect("world should be removed");

        let restored = restore_missing_game_data(&snapshot, &minecraft)
            .expect("critical game data should restore");

        assert_eq!(
            fs::read(minecraft.join("options.txt")).expect("options should exist"),
            b"key_key.forward:key.keyboard.w"
        );
        assert_eq!(
            fs::read(minecraft.join("servers.dat")).expect("server list should exist"),
            b"server-list"
        );
        assert_eq!(
            fs::read(existing_world.join("level.dat")).expect("level should exist"),
            b"existing-level"
        );
        assert!(!removed_world.exists());
        assert_eq!(restored.len(), 3);
    }
}
