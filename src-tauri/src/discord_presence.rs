use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

const DISCORD_APPLICATION_ID: &str = "1538072464704143420";
const RECONNECT_INTERVAL: Duration = Duration::from_secs(15);
const STOP_CHECK_INTERVAL: Duration = Duration::from_millis(250);

pub struct DiscordPresence {
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl DiscordPresence {
    pub fn start() -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let worker = thread::Builder::new()
            .name("discord-rich-presence".into())
            .spawn(move || run(worker_stop))
            .ok();

        Self { stop, worker }
    }
}

impl Drop for DiscordPresence {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn launcher_activity() -> activity::Activity<'static> {
    activity::Activity::new()
        .name("잡초 런처")
        .activity_type(activity::ActivityType::Playing)
        .details("잡초 런처 하는 중")
        .status_display_type(activity::StatusDisplayType::Details)
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum PresenceMode {
    Launcher,
    Minecraft(String),
}

fn current_mode() -> PresenceMode {
    crate::minecraft::running_game_version()
        .map(PresenceMode::Minecraft)
        .unwrap_or(PresenceMode::Launcher)
}

fn set_presence(client: &mut DiscordIpcClient, mode: &PresenceMode) -> bool {
    let result = match mode {
        PresenceMode::Launcher => client.set_activity(launcher_activity()),
        PresenceMode::Minecraft(version) => client.set_activity(
            activity::Activity::new()
                .name("Minecraft")
                .activity_type(activity::ActivityType::Playing)
                .details(format!("Minecraft {version} 플레이 중"))
                .state("zzapchoLauncher로 실행")
                .status_display_type(activity::StatusDisplayType::Details),
        ),
    };
    result.is_ok()
}

fn wait_tick(stop: &AtomicBool) -> bool {
    thread::sleep(STOP_CHECK_INTERVAL);
    stop.load(Ordering::Relaxed)
}

fn wait_until_retry_or_stop(stop: &AtomicBool) -> bool {
    let mut waited = Duration::ZERO;
    while waited < RECONNECT_INTERVAL {
        if wait_tick(stop) {
            return true;
        }
        waited += STOP_CHECK_INTERVAL;
    }
    stop.load(Ordering::Relaxed)
}

fn run(stop: Arc<AtomicBool>) {
    while !stop.load(Ordering::Relaxed) {
        let mut client = DiscordIpcClient::new(DISCORD_APPLICATION_ID);

        if client.connect().is_err() {
            if wait_until_retry_or_stop(&stop) {
                break;
            }
            continue;
        }

        let mut mode = current_mode();
        if !set_presence(&mut client, &mode) {
            let _ = client.close();
            if wait_until_retry_or_stop(&stop) {
                break;
            }
            continue;
        }

        #[cfg(debug_assertions)]
        eprintln!("Discord Rich Presence connected.");

        let mut since_refresh = Duration::ZERO;
        while !stop.load(Ordering::Relaxed) {
            if wait_tick(&stop) {
                break;
            }
            since_refresh += STOP_CHECK_INTERVAL;

            let next_mode = current_mode();
            if next_mode != mode || since_refresh >= RECONNECT_INTERVAL {
                if !set_presence(&mut client, &next_mode) {
                    break;
                }
                mode = next_mode;
                since_refresh = Duration::ZERO;
            }
        }

        let _ = client.clear_activity();
        let _ = client.close();
    }
}
