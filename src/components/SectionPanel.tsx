import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { useProfileContent } from "../hooks/useProfileContent";
import { useUserSettings } from "../hooks/useUserSettings";
import { createUserContent } from "../services/contentService";
import { getInstallableVersion, getInstallableVersions, getProjectIcon, searchModrinth, type ModrinthProject, type ModrinthVersionOption } from "../services/modrinthService";
import { getLogs, subscribeLogs, type LogSource } from "../services/logService";
import type { ContentKind, ManagedContentEntry } from "../types/content";
import type { LauncherProfile } from "../types/profile";
import type { LauncherSection } from "../types/navigation";
import type { LauncherAccount } from "../types/auth";
import type { AppUpdateState } from "../hooks/useAppUpdate";
import { discoverJavaRuntimes, downloadJavaRuntime, recommendedJavaMajor, type JavaRuntimeInfo } from "../services/javaService";
import type { ProfileConfiguration } from "../hooks/useProfileConfiguration";
import { loaderLabel, VersionEditor } from "./VersionBadge";

interface SectionPanelProps {
  profile: LauncherProfile;
  configuration: ProfileConfiguration;
  section: Exclude<LauncherSection, "home">;
  account: LauncherAccount;
  onLogout: () => Promise<void>;
  appUpdate: AppUpdateState;
}

const isTauri = () => "__TAURI_INTERNALS__" in window;

const contentImportRules: Record<ContentKind, { label: string; extensions: string[]; hint: string }> = {
  mods: { label: "Minecraft 모드", extensions: ["jar"], hint: "모드 .jar 파일만 놓아주세요" },
  resourcePacks: { label: "Minecraft 리소스팩", extensions: ["zip"], hint: "리소스팩 .zip 파일만 놓아주세요" },
  shaders: { label: "Minecraft 셰이더", extensions: ["zip"], hint: "셰이더 .zip 파일만 놓아주세요" },
};

function hasAllowedContentExtension(path: string, kind: ContentKind): boolean {
  const extension = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
  return contentImportRules[kind].extensions.includes(extension);
}

const sectionCopy = {
  mods: { title: "모드" },
  "resource-packs": { title: "리소스팩" },
  shaders: { title: "쉐이더" },
  logs: { title: "로그" },
  settings: { title: "설정" },
} as const;

function ContentManager({ profile, kind }: { profile: LauncherProfile; kind: ContentKind }) {
  const content = useProfileContent(profile);
  const [projects, setProjects] = useState<ModrinthProject[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importMessage, setImportMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [versionTarget, setVersionTarget] = useState<string | null>(null);
  const [versionOptions, setVersionOptions] = useState<ModrinthVersionOption[]>([]);
  const [versionBusy, setVersionBusy] = useState(false);
  const managerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const editable = profile.editableFields[kind];
  const entries = content.state[kind];
  const title = sectionCopy[kind === "resourcePacks" ? "resource-packs" : kind].title;
  const importRule = contentImportRules[kind];

  useEffect(() => {
    setImportMessage(null);
  }, [kind, profile.id]);

  useEffect(() => {
    if (!importMessage) return;
    const timeout = window.setTimeout(() => setImportMessage(null), 5200);
    return () => window.clearTimeout(timeout);
  }, [importMessage]);

  useEffect(() => {
    let cancelled = false;
    const missing = entries.filter((entry) => entry.source === "user" && entry.projectId && !entry.iconUrl);
    for (const entry of missing) {
      void getProjectIcon(entry.projectId!).then((iconUrl) => {
        if (!cancelled && iconUrl) content.patch(kind, entry.id, { iconUrl });
      });
    }
    return () => { cancelled = true; };
  }, [kind, profile.id, entries.map((entry) => `${entry.id}:${entry.iconUrl ?? ""}`).join("|")]);

  const loadProjects = async (search = "", reset = true) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const offset = reset ? 0 : projects.length;
      const result = await searchModrinth(kind, profile, search, offset, 6);
      setProjects((current) => reset ? result.hits : [...current, ...result.hits.filter((hit) => !current.some((item) => item.project_id === hit.project_id))]);
      setHasMore(offset + result.hits.length < result.total);
    }
    catch (error) { console.warn(error); if (reset) setProjects([]); setHasMore(false); }
    finally { loadingRef.current = false; setLoading(false); }
  };

  useEffect(() => { setQuery(""); setHasMore(true); void loadProjects("", true); }, [kind, profile.id]);

  useEffect(() => {
    if (!versionTarget) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVersionTarget(null);
    };
    const closeOutside = (event: PointerEvent) => {
      const entry = (event.target as Element | null)?.closest<HTMLElement>("[data-version-entry]");
      if (entry?.dataset.versionEntry !== versionTarget) setVersionTarget(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [versionTarget]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && hasMore && !loading) void loadProjects(query, false);
    }, { root: managerRef.current, rootMargin: "100px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loading, projects.length, query, kind, profile.id]);

  const installPaths = async (paths: string[]) => {
    if (!editable) return;
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    const acceptedPaths = uniquePaths.filter((path) => hasAllowedContentExtension(path, kind));
    const rejectedNames = uniquePaths
      .filter((path) => !hasAllowedContentExtension(path, kind))
      .map((path) => path.split(/[\\/]/).pop() ?? path);
    const failures: string[] = [];
    let installedCount = 0;

    for (const path of acceptedPaths) {
      const fileName = path.split(/[\\/]/).pop() ?? path;
      try {
        if (isTauri()) await invoke("install_content_file", { profileId: profile.id, kind, sourcePath: path });
        content.add(kind, createUserContent(fileName.replace(/\.(jar|zip)$/i, ""), fileName));
        installedCount += 1;
      } catch (error) {
        failures.push(`${fileName}: ${String(error)}`);
        console.warn("콘텐츠 파일 추가 거부", error);
      }
    }

    if (failures.length) {
      const prefix = installedCount ? `${installedCount}개는 추가했습니다. ` : "";
      setImportMessage({ tone: "error", text: `${prefix}${failures[0]}${failures.length > 1 ? ` 외 ${failures.length - 1}개` : ""}` });
    } else if (rejectedNames.length) {
      const expected = importRule.extensions.map((extension) => `.${extension}`).join(", ");
      const prefix = installedCount ? `${installedCount}개는 추가했습니다. ` : "";
      setImportMessage({ tone: "error", text: `${prefix}${title}에는 ${expected} 파일만 추가할 수 있습니다. (${rejectedNames.slice(0, 2).join(", ")}${rejectedNames.length > 2 ? " 외" : ""})` });
    } else if (installedCount) {
      setImportMessage({ tone: "success", text: `${title} ${installedCount}개를 추가했습니다.` });
    }
  };

  useEffect(() => {
    if (!isTauri() || !editable) return;
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") setDragging(true);
      if (event.payload.type === "leave") setDragging(false);
      if (event.payload.type === "drop") { setDragging(false); void installPaths(event.payload.paths); }
    });
    return () => { void unlisten.then((dispose) => dispose()); };
  }, [editable, kind, profile.id]);

  useEffect(() => {
    if (isTauri() || !editable) return;
    const over = (event: DragEvent) => {
      event.preventDefault();
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []) as Array<File & { path?: string }>;
      void installPaths(files.map((file) => file.path ?? file.name));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [editable, kind, profile.id]);

  const chooseContentFiles = async () => {
    if (!editable) return;
    if (!isTauri()) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        title: `${title} 파일 추가`,
        filters: [{ name: importRule.label, extensions: importRule.extensions }],
      });
      if (!selected) return;
      await installPaths(Array.isArray(selected) ? selected : [selected]);
    } catch (error) {
      console.warn("콘텐츠 파일 선택 실패", error);
      setImportMessage({ tone: "error", text: "파일 선택창을 열지 못했습니다. 잠시 후 다시 시도해 주세요." });
    }
  };

  const installProject = async (project: ModrinthProject) => {
    if (!editable || installing) return;
    setInstalling(project.project_id);
    try {
      const file = await getInstallableVersion(project.project_id, kind, profile);
      if (isTauri()) await invoke("download_content_file", { profileId: profile.id, kind, url: file.url, fileName: file.fileName, previousFileName: null });
      content.add(kind, createUserContent(project.title, file.fileName, project.project_id, file.version, project.icon_url ?? undefined, file.gameVersions));
    } catch (error) { console.error(error); }
    finally { setInstalling(null); }
  };

  const openVersionPicker = async (entry: ManagedContentEntry) => {
    if (!editable || entry.required || entry.source !== "user" || !entry.projectId) return;
    if (versionTarget === entry.id) { setVersionTarget(null); return; }
    setVersionTarget(entry.id); setVersionOptions([]); setVersionBusy(true);
    try { setVersionOptions(await getInstallableVersions(entry.projectId, kind, profile)); }
    catch (error) { console.error(error); }
    finally { setVersionBusy(false); }
  };

  const changeVersion = async (entry: ManagedContentEntry, option: ModrinthVersionOption) => {
    if (!editable || entry.required || entry.source !== "user" || !entry.projectId || versionBusy) return;
    setVersionBusy(true);
    try {
      if (isTauri()) await invoke("download_content_file", { profileId: profile.id, kind, url: option.url, fileName: option.fileName, previousFileName: entry.fileName ?? null });
      content.patch(kind, entry.id, { version: option.version, fileName: option.fileName, url: option.url, gameVersions: option.gameVersions });
      setVersionTarget(null);
    } catch (error) { console.error(error); }
    finally { setVersionBusy(false); }
  };

  const openProject = (project: ModrinthProject) => {
    const url = `https://modrinth.com/${project.project_type}/${project.slug}`;
    if (isTauri()) void invoke("open_external_url", { url });
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  const toggleEntry = async (entry: ManagedContentEntry) => {
    if (!editable || entry.required || toggling) return;
    setToggling(entry.id);
    try {
      if (isTauri() && entry.fileName) {
        await invoke("set_content_enabled", {
          profileId: profile.id,
          kind,
          fileName: entry.fileName,
          enabled: !entry.enabled,
        });
      }
      content.toggle(kind, entry.id);
    } catch (error) {
      console.error(error);
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="content-manager" ref={managerRef}>
      {dragging && <div className="drop-overlay" aria-hidden="true"><span>{importRule.hint}</span></div>}
      <section className="content-installed-pane" aria-label={`설치된 ${title}`}>
        <div className="content-list">
          {entries.length ? entries.map((entry) => {
            const canChangeVersion = editable && !entry.required && entry.source === "user" && Boolean(entry.projectId);
            const canToggle = editable && !entry.required;
            const canRemove = editable && !entry.required && entry.source === "user";
            const supportedVersions = entry.gameVersions ?? [];
            const versionMismatch = (kind === "resourcePacks" || kind === "shaders") && supportedVersions.length > 0 && !supportedVersions.includes(profile.minecraftVersion);
            const versionHint = supportedVersions.slice(0, 4).join(", ") + (supportedVersions.length > 4 ? "..." : "");
            return <div className="content-entry" data-version-entry={entry.id} key={entry.id} onBlur={(event) => {
              if (versionTarget === entry.id && !event.currentTarget.contains(event.relatedTarget as Node | null)) setVersionTarget(null);
            }}>
              <div className={`content-row${entry.enabled ? "" : " is-disabled"}`}>
                {entry.iconUrl ? <img className="content-icon" src={entry.iconUrl} alt="" loading="lazy" decoding="async" /> : <span className={`content-icon content-icon-fallback is-${kind}`} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 13h5m-5 3h5"/></svg></span>}
                <div className="content-name"><strong>{entry.name}</strong><small><button className="content-version" type="button" disabled={!canChangeVersion} aria-expanded={versionTarget === entry.id} onClick={() => void openVersionPicker(entry)}>{entry.version}</button><span> · {entry.source === "server" ? "서버 관리" : entry.required ? "필수" : "사용자 추가"}</span></small>{versionMismatch && <small className="content-warning">지원 버전 {versionHint} · 현재 버전과 달라도 설치 가능</small>}</div>
                {entry.source === "server" && entry.required ? <span className="managed-badge">필수</span> : <>
                  <button className={`toggle${entry.enabled ? " is-on" : ""}`} type="button" onClick={() => void toggleEntry(entry)} disabled={!canToggle || toggling !== null} aria-label={`${entry.name} ${entry.enabled ? "끄기" : "켜기"}`} aria-pressed={entry.enabled}><span /></button>
                  {entry.source === "server" ? <span className="managed-badge">서버</span> : <button className="remove-content" type="button" onClick={() => content.remove(kind, entry.id)} disabled={!canRemove} aria-label={`${entry.name} 제거`}>×</button>}
                </>}
              </div>
              {versionTarget === entry.id && <div className="version-picker" role="dialog" aria-label={`${entry.name} 버전 선택`}>
                {versionBusy && !versionOptions.length ? <span>버전 불러오는 중...</span> : versionOptions.length ? versionOptions.map((option) => <button className={option.version === entry.version ? "selected" : ""} type="button" key={option.id} disabled={versionBusy || option.version === entry.version} onClick={() => void changeVersion(entry, option)}><strong>{option.version}</strong><small>{option.fileName}{option.gameVersions.length ? ` · ${option.gameVersions.slice(0, 3).join(", ")}` : ""}</small></button>) : <span>선택 가능한 버전이 없습니다.</span>}
              </div>}
            </div>;
          }) : <div className="section-empty">등록된 {title}가 없습니다.</div>}
        </div>
      </section>

      <section className={`content-available-pane${editable ? "" : " is-locked"}`} aria-label={`설치 가능한 ${title}`}>
        {editable ? <>
          <div className="content-toolbar">
            <input className="content-file-input" ref={fileInputRef} type="file" multiple accept={importRule.extensions.map((extension) => `.${extension}`).join(",")} tabIndex={-1} aria-hidden="true" onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []) as Array<File & { path?: string }>;
              void installPaths(files.map((file) => file.path ?? file.name));
              event.currentTarget.value = "";
            }} />
            <button className="section-action" type="button" onClick={() => void chooseContentFiles()}>폴더에서 추가</button>
            <form onSubmit={(event) => { event.preventDefault(); setHasMore(true); void loadProjects(query, true); }}>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Modrinth 검색" aria-label="Modrinth 검색" />
              <button type="submit">검색</button>
            </form>
          </div>
          {importMessage && <div className={`content-import-message is-${importMessage.tone}`} role="status">{importMessage.text}</div>}
          <div className="modrinth-section">
            <div className="modrinth-heading"><strong>Modrinth</strong><span>{kind === "mods" ? `${profile.minecraftVersion} 호환` : "모든 게임 버전 설치 가능"}</span></div>
            <div className="modrinth-results">
              {!projects.length && loading ? <div className="inline-loading">불러오는 중...</div> : projects.map((project) => {
                const installed = entries.some((entry) => entry.projectId === project.project_id);
                return <article key={project.project_id}>
                  {project.icon_url ? <img src={project.icon_url} alt="" loading="lazy" decoding="async" onDoubleClick={() => openProject(project)} title="더블클릭하여 Modrinth 페이지 열기" /> : <span className="project-placeholder" onDoubleClick={() => openProject(project)} title="더블클릭하여 Modrinth 페이지 열기" />}
                  <div><strong>{project.title}</strong><small>{project.author} · {Intl.NumberFormat("ko-KR", { notation: "compact" }).format(project.downloads)} 다운로드</small></div>
                  <button type="button" disabled={installed || installing === project.project_id} onClick={() => void installProject(project)}>{installed ? "설치됨" : installing === project.project_id ? "설치 중" : "설치"}</button>
                </article>;
              })}
              <div className="load-more-sentinel" ref={loadMoreRef}>{loading && projects.length ? "더 불러오는 중..." : hasMore ? "" : projects.length ? "모두 불러왔습니다." : ""}</div>
            </div>
          </div>
        </> : <div className="locked-panel">이 프로필에서는 {title} 추가·토글·삭제가 허용되지 않습니다.</div>}
      </section>
    </div>
  );
}

function LogsPanel() {
  const [source, setSource] = useState<LogSource>("game");
  const [lines, setLines] = useState(() => getLogs("game"));
  const [atBottom, setAtBottom] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLines(getLogs(source));
    return subscribeLogs(() => setLines([...getLogs(source)]));
  }, [source]);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const element = viewport.current;
    if (!element) return;
    if (behavior === "auto") element.scrollTop = element.scrollHeight;
    else element.scrollTo({ top: element.scrollHeight, behavior });
  };
  useEffect(() => {
    if (!atBottom) return;
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom("auto")));
    return () => cancelAnimationFrame(frame);
  }, [source, lines.length, atBottom]);

  return <div className="logs-panel">
    <div className="log-controls">
      <div className={`log-segmented${source === "launcher" ? " is-launcher" : ""}`} role="tablist">
        <button className={source === "game" ? "active" : ""} type="button" role="tab" onClick={() => setSource("game")}>게임</button>
        <button className={source === "launcher" ? "active" : ""} type="button" role="tab" onClick={() => setSource("launcher")}>런처</button>
      </div>
    </div>
    <div className="log-view-wrap">
      <div className="log-view" ref={viewport} tabIndex={0} onScroll={(event) => { const element = event.currentTarget; setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 18); }}>
        {lines.length ? lines.map((line, index) => <p key={`${source}-${index}`}>{line}</p>) : <p className="empty-log">아직 {source === "game" ? "게임" : "런처"} 로그가 없습니다.</p>}
      </div>
      <button className={`scroll-bottom${atBottom ? " is-hidden" : ""}`} type="button" onClick={() => { setAtBottom(true); scrollToBottom(); }} aria-label="로그 맨 아래로 이동">↓</button>
    </div>
  </div>;
}

function JavaSetting({ profile }: { profile: LauncherProfile }) {
  const { settings, setJavaPath, setJavaVersion } = useUserSettings();
  const automaticMajor = profile.javaVersion ?? recommendedJavaMajor(profile.minecraftVersion);
  const requiredMajor = settings.javaVersions[profile.id] ?? automaticMajor;
  const javaPath = settings.javaPaths[profile.id] ?? "";
  const [runtimes, setRuntimes] = useState<JavaRuntimeInfo[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState<"search" | "download" | null>(null);
  const [error, setError] = useState("");
  const findInstalled = async () => {
    setBusy("search"); setError("");
    try {
      const found = await discoverJavaRuntimes(requiredMajor);
      setRuntimes(found); setSearched(true);
      if (found.filter((runtime) => runtime.compatible).length === 1) setJavaPath(profile.id, found.find((runtime) => runtime.compatible)!.path);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Java 검색에 실패했습니다."); }
    finally { setBusy(null); }
  };

  const download = async () => {
    setBusy("download"); setError("");
    try {
      const path = await downloadJavaRuntime(requiredMajor);
      setJavaPath(profile.id, path);
      setRuntimes([{ path, major: requiredMajor, source: "런처", compatible: true }]);
      setSearched(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Java 다운로드에 실패했습니다."); }
    finally { setBusy(null); }
  };

  return <article className="java-setting">
    <div className="java-setting-heading"><span>Java 경로 · 현재 프로필</span><strong>Java {requiredMajor}</strong></div>
    <div className="java-version-choice" aria-label="Java 버전 선택">
      <button className={settings.javaVersions[profile.id] === undefined ? "selected" : ""} type="button" onClick={() => { setJavaVersion(profile.id, null); setRuntimes([]); setSearched(false); }}>자동 · {automaticMajor}</button>
      {[8, 17, 21, 25, 26].map((major) => <button className={settings.javaVersions[profile.id] === major ? "selected" : ""} type="button" key={major} onClick={() => { setJavaVersion(profile.id, major); setRuntimes([]); setSearched(false); }}>{major}</button>)}
    </div>
    <div className="java-path-row">
      <input value={javaPath} onChange={(event) => setJavaPath(profile.id, event.target.value)} placeholder={`Java ${requiredMajor} java.exe 경로`} aria-label="Java 실행 파일 경로" />
      <button type="button" disabled={busy !== null} onClick={() => void findInstalled()}>{busy === "search" ? "찾는 중..." : "설치된 Java 찾기"}</button>
      <button type="button" disabled={busy !== null} onClick={() => void download()}>{busy === "download" ? "다운로드 중..." : `Java ${requiredMajor} 다운로드`}</button>
    </div>
    {searched && runtimes.length > 0 && <div className="java-runtime-list">{runtimes.map((runtime) => <button className={javaPath === runtime.path ? "selected" : ""} type="button" key={runtime.path} onClick={() => setJavaPath(profile.id, runtime.path)}><strong>Java {runtime.major}{runtime.compatible ? "" : " · 버전 다름"}</strong><span>{runtime.source} · {runtime.path}</span></button>)}</div>}
    {searched && runtimes.length === 0 && <div className="java-missing"><span>설치된 Java를 찾지 못했습니다.</span><button type="button" disabled={busy !== null} onClick={() => void download()}>{busy === "download" ? "다운로드 중..." : `Java ${requiredMajor} 자동 다운로드`}</button></div>}
    {!searched && <small>경로를 직접 입력하거나 설치된 Java를 검색할 수 있습니다.</small>}
    {error && <small className="java-error">{error}</small>}
  </article>;
}

function SettingsPanel({ profile, configuration, account, onLogout, appUpdate }: { profile: LauncherProfile; configuration: ProfileConfiguration; account: LauncherAccount; onLogout: () => Promise<void>; appUpdate: AppUpdateState }) {
  const { settings, setMemoryGb } = useUserSettings();
  const [editingMemory, setEditingMemory] = useState(false);
  const [versionSettingsOpen, setVersionSettingsOpen] = useState(false);
  const versionSettingsEditable = profile.editableFields.minecraftVersion || profile.editableFields.modLoader;
  useEffect(() => setVersionSettingsOpen(false), [profile.id]);
  return <div className="settings-grid">
    <article className="account-setting">
      <div className="skin-head" style={account.skinUrl ? { backgroundImage: `url("${account.skinUrl}")` } : undefined}>{!account.skinUrl && account.name.slice(0, 1).toUpperCase()}</div>
      <div><span>Microsoft 계정</span><strong>{account.name}</strong></div>
      <button type="button" onClick={() => void onLogout()}>로그아웃</button>
    </article>
    <article className={`update-setting${appUpdate.available ? " is-available" : ""}`}>
      <span>업데이트</span>
      <strong>{appUpdate.available ? `버전 ${appUpdate.version} 사용 가능` : "최신 버전"}</strong>
      <small>{appUpdate.error || appUpdate.notes || "GitHub에서 새 버전을 자동으로 확인합니다."}</small>
      <button className="settings-button update-button" type="button" disabled={appUpdate.checking} onClick={() => void (appUpdate.available ? appUpdate.install() : appUpdate.checkNow())}>{appUpdate.available ? "업데이트" : appUpdate.checking ? "확인 중..." : "업데이트 확인"}</button>
    </article>
    <article className={`version-setting${versionSettingsOpen ? " is-expanded" : ""}${versionSettingsEditable ? "" : " is-locked"}`}>
      <button className={`version-setting-toggle${versionSettingsEditable ? "" : " is-static"}`} type="button" disabled={!versionSettingsEditable} aria-expanded={versionSettingsEditable ? versionSettingsOpen : undefined} aria-controls={versionSettingsEditable ? `settings-version-${profile.id}` : undefined} onClick={() => setVersionSettingsOpen((current) => !current)}>
        <span className="version-setting-toggle-copy"><span>게임 버전 및 로더</span><strong>Minecraft {profile.minecraftVersion} · {loaderLabel(profile.modLoader)}</strong></span>
        {versionSettingsEditable && <span className={`accordion-chevron${versionSettingsOpen ? " is-open" : ""}`} aria-hidden="true"><svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" /></svg></span>}
      </button>
      {versionSettingsEditable && <div className="version-setting-collapse" id={`settings-version-${profile.id}`} aria-hidden={!versionSettingsOpen}>
        <div className="version-setting-collapse-inner"><VersionEditor profile={profile} configuration={configuration} initialSection="minecraft" /></div>
      </div>}
    </article>
    <JavaSetting profile={profile} />
    <article className="memory-setting">
      <div><span>게임 메모리</span>{editingMemory ? <input autoFocus type="number" min="0.5" max="32" step="0.5" value={settings.memoryGb} onChange={(event) => setMemoryGb(Number(event.target.value))} onBlur={() => setEditingMemory(false)} onKeyDown={(event) => event.key === "Enter" && setEditingMemory(false)} /> : <button type="button" onClick={() => setEditingMemory(true)}>{settings.memoryGb.toFixed(1)} GB</button>}</div>
      <input className="memory-slider" type="range" min="0.5" max="32" step="0.5" value={settings.memoryGb} onChange={(event) => setMemoryGb(Number(event.target.value))} />
    </article>
    <article><span>게임 폴더</span><strong>.minecraft</strong><button className="settings-button" type="button" onClick={() => { if (isTauri()) void invoke("open_game_folder"); }}>폴더 열기</button></article>
    <article className="info-setting"><span>정보</span><strong>zzapcho Launcher 0.7.1</strong><small>Tauri · React · Minecraft custom launcher</small></article>
    <footer>made by zzapcho</footer>
  </div>;
}

export function SectionPanel({ profile, configuration, section, account, onLogout, appUpdate }: SectionPanelProps) {
  const copy = sectionCopy[section];
  const contentKind: ContentKind | null = section === "mods" ? "mods" : section === "resource-packs" ? "resourcePacks" : section === "shaders" ? "shaders" : null;
  return (
    <section className={`section-panel section-${section}`} aria-label={copy.title}>
      <header><h2>{copy.title}</h2></header>
      {contentKind && <ContentManager key={`${profile.id}-${contentKind}`} profile={profile} kind={contentKind} />}
      {section === "logs" && <LogsPanel />}
      {section === "settings" && <SettingsPanel profile={profile} configuration={configuration} account={account} onLogout={onLogout} appUpdate={appUpdate} />}
    </section>
  );
}
