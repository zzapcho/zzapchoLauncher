use serde_json::Value;
use std::collections::HashSet;

const MINECRAFT_MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

async fn json(url: &str) -> Result<Value, String> {
    reqwest::Client::builder()
        .user_agent("zzapchoLauncher/version-catalog")
        .build()
        .map_err(|error| error.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<Value>()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn minecraft_versions() -> Result<Vec<String>, String> {
    let manifest = json(MINECRAFT_MANIFEST).await?;
    Ok(manifest["versions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|version| version["type"].as_str() == Some("release"))
        .filter_map(|version| version["id"].as_str().map(str::to_string))
        .take(80)
        .collect())
}

#[tauri::command]
pub async fn loader_versions(
    loader: String,
    minecraft_version: String,
) -> Result<Vec<String>, String> {
    let values = match loader.as_str() {
        "vanilla" => return Ok(Vec::new()),
        "fabric" => {
            let url = format!(
                "https://meta.fabricmc.net/v2/versions/loader/{}",
                minecraft_version
            );
            json(&url)
                .await?
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|value| value.pointer("/loader/version").and_then(Value::as_str))
                .map(str::to_string)
                .collect::<Vec<_>>()
        }
        "quilt" => {
            let url = format!(
                "https://meta.quiltmc.org/v3/versions/loader/{}",
                minecraft_version
            );
            json(&url)
                .await?
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|value| value.pointer("/loader/version").and_then(Value::as_str))
                .map(str::to_string)
                .collect::<Vec<_>>()
        }
        "forge" => {
            let manifest = json(
                "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
            )
            .await?;
            let promos = manifest["promos"].as_object();
            ["latest", "recommended"]
                .into_iter()
                .filter_map(|channel| {
                    promos?
                        .get(&format!("{minecraft_version}-{channel}"))?
                        .as_str()
                        .map(str::to_string)
                })
                .collect::<Vec<_>>()
        }
        _ => return Err(format!("지원하지 않는 로더입니다: {loader}")),
    };
    let mut seen = HashSet::new();
    Ok(values
        .into_iter()
        .filter(|version| seen.insert(version.clone()))
        .collect())
}
