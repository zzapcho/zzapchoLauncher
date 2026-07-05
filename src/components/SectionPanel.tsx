import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useProfileContent } from "../hooks/useProfileContent";
import { useUserSettings } from "../hooks/useUserSettings";
import { createUserContent } from "../services/contentService";
import { getInstallableVersion, searchModrinth, type ModrinthProject } from "../services/modrinthService";
import { getLogs, subscribeLogs, type LogSource } from "../services/logService";
import type { ContentKind } from "../types/content";
import type { LauncherProfile } from "../types/profile";
import type { LauncherSection } from "../types/navigation";
import type { LauncherAccount } from "../types/auth";
import type { AppUpdateState } from "../hooks/useAppUpdate";

interface SectionPanelProps {
  profile: LauncherProfile;
  section: Exclude<LauncherSection, "home">;
  account: LauncherAccount;
  onLogout: () => Promise<void>;
  appUpdate: AppUpdateState;
}

const isTauri = () => "__TAURI_INTERNALS__" in window;

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
  const [dragging, setDragging] = useState(false);
  const managerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const editable = profile.editableFields[kind];
  const entries = content.state[kind];
  const title = sectionCopy[kind === "resourcePacks" ? "resource-packs" : kind].title;

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
    for (const path of paths) {
      const fileName = path.split(/[\\/]/).pop() ?? path;
      try {
        if (isTauri()) await invoke("install_content_file", { profileId: profile.id, kind, sourcePath: path });
        content.add(kind, createUserContent(fileName.replace(/\.(jar|zip)$/i, ""), fileName));
      } catch (error) { console.error(error); }
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

  const openFolder = () => {
    if (isTauri()) void invoke("open_content_folder", { profileId: profile.id, kind });
  };

  const installProject = async (project: ModrinthProject) => {
    if (!editable || installing) return;
    setInstalling(project.project_id);
    try {
      const file = await getInstallableVersion(project.project_id, kind, profile);
      if (isTauri()) await invoke("download_content_file", { profileId: profile.id, kind, url: file.url, fileName: file.fileName });
      content.add(kind, createUserContent(project.title, file.fileName, project.project_id, file.version));
    } catch (error) { console.error(error); }
    finally { setInstalling(null); }
  };

  const openProject = (project: ModrinthProject) => {
    const url = `https://modrinth.com/${project.project_type}/${project.slug}`;
    if (isTauri()) void invoke("open_external_url", { url });
    else window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="content-manager" ref={managerRef}>
      <div className="content-list">
        {entries.length ? entries.map((entry) => (
          <div className={`content-row${entry.enabled ? "" : " is-disabled"}`} key={entry.id}>
            <span className="content-indicator" />
            <div className="content-name"><strong>{entry.name}</strong><small>{entry.version} · {entry.source === "server" ? "서버 관리" : "사용자 추가"}</small></div>
            {entry.source === "server" ? <span className="managed-badge">잠김</span> : <>
              <button className={`toggle${entry.enabled ? " is-on" : ""}`} type="button" onClick={() => content.toggle(kind, entry.id)} disabled={!editable} aria-label={`${entry.name} ${entry.enabled ? "끄기" : "켜기"}`}><span /></button>
              <button className="remove-content" type="button" onClick={() => content.remove(kind, entry.id)} disabled={!editable} aria-label={`${entry.name} 제거`}>×</button>
            </>}
          </div>
        )) : <div className="section-empty">등록된 {title}가 없습니다.</div>}
      </div>

      {editable ? <>
        <div className={`drop-zone${dragging ? " is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const files = Array.from(event.dataTransfer.files) as Array<File & { path?: string }>; void installPaths(files.map((file) => file.path ?? file.name)); }}>
          파일을 여기에 끌어다 놓으세요
        </div>
        <div className="content-toolbar">
          <button className="section-action" type="button" onClick={openFolder}>폴더에서 추가</button>
          <form onSubmit={(event) => { event.preventDefault(); setHasMore(true); void loadProjects(query, true); }}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Modrinth 검색" aria-label="Modrinth 검색" />
            <button type="submit">검색</button>
          </form>
        </div>
        <div className="modrinth-section">
          <div className="modrinth-heading"><strong>Modrinth</strong><span>{query ? "검색 결과" : "인기순"}</span></div>
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
      </> : <div className="locked-panel">이 프로필에서는 {title} 추가·토글·삭제가 허용되지 않습니다. 서버 관리 항목은 항상 잠겨 있습니다.</div>}
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
      <div className="log-segmented" role="tablist">
        <button className={source === "game" ? "active" : ""} type="button" role="tab" onClick={() => setSource("game")}>게임</button>
        <button className={source === "launcher" ? "active" : ""} type="button" role="tab" onClick={() => setSource("launcher")}>런처</button>
      </div>
      <button className={`scroll-bottom${atBottom ? " is-hidden" : ""}`} type="button" onClick={() => { setAtBottom(true); scrollToBottom(); }} aria-label="로그 맨 아래로 이동">↓</button>
    </div>
    <div className="log-view" ref={viewport} onScroll={(event) => { const element = event.currentTarget; setAtBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 18); }}>
      {lines.length ? lines.map((line, index) => <p key={`${source}-${index}`}>{line}</p>) : <p className="empty-log">아직 {source === "game" ? "게임" : "런처"} 로그가 없습니다.</p>}
    </div>
  </div>;
}

function SettingsPanel({ account, onLogout, appUpdate }: { account: LauncherAccount; onLogout: () => Promise<void>; appUpdate: AppUpdateState }) {
  const { settings, setMemoryGb } = useUserSettings();
  const [editingMemory, setEditingMemory] = useState(false);
  return <div className="settings-grid">
    <article className="account-setting">
      <div className="skin-head" style={account.skinUrl ? { backgroundImage: `url("${account.skinUrl}")` } : undefined}>{!account.skinUrl && account.name.slice(0, 1).toUpperCase()}</div>
      <div><span>Microsoft 계정</span><strong>{account.name}</strong></div>
      <button type="button" onClick={() => void onLogout()}>로그아웃</button>
    </article>
    <article className="memory-setting">
      <div><span>게임 메모리</span>{editingMemory ? <input autoFocus type="number" min="0.5" max="32" step="0.5" value={settings.memoryGb} onChange={(event) => setMemoryGb(Number(event.target.value))} onBlur={() => setEditingMemory(false)} onKeyDown={(event) => event.key === "Enter" && setEditingMemory(false)} /> : <button type="button" onClick={() => setEditingMemory(true)}>{settings.memoryGb.toFixed(1)} GB</button>}</div>
      <input className="memory-slider" type="range" min="0.5" max="32" step="0.5" value={settings.memoryGb} onChange={(event) => setMemoryGb(Number(event.target.value))} />
    </article>
    <article><span>게임 폴더</span><strong>.minecraft</strong><button className="settings-button" type="button" onClick={() => { if (isTauri()) void invoke("open_game_folder"); }}>폴더 열기</button></article>
    <article className={`update-setting${appUpdate.available ? " is-available" : ""}`}>
      <span>업데이트</span>
      <strong>{appUpdate.available ? `버전 ${appUpdate.version} 사용 가능` : "최신 버전"}</strong>
      <small>{appUpdate.error || appUpdate.notes || "GitHub에서 새 버전을 자동으로 확인합니다."}</small>
      <button className="settings-button update-button" type="button" disabled={appUpdate.checking} onClick={() => void (appUpdate.available ? appUpdate.install() : appUpdate.checkNow())}>{appUpdate.available ? "업데이트" : appUpdate.checking ? "확인 중..." : "업데이트 확인"}</button>
    </article>
    <article><span>정보</span><strong>zzapcho Launcher 0.3.1</strong><small>Tauri · React · Minecraft custom launcher</small></article>
    <footer>made by zzapcho</footer>
  </div>;
}

export function SectionPanel({ profile, section, account, onLogout, appUpdate }: SectionPanelProps) {
  const copy = sectionCopy[section];
  const contentKind: ContentKind | null = section === "mods" ? "mods" : section === "resource-packs" ? "resourcePacks" : section === "shaders" ? "shaders" : null;
  return (
    <section className="section-panel" aria-label={copy.title}>
      <header><h2>{copy.title}</h2></header>
      {contentKind && <ContentManager key={`${profile.id}-${contentKind}`} profile={profile} kind={contentKind} />}
      {section === "logs" && <LogsPanel />}
      {section === "settings" && <SettingsPanel account={account} onLogout={onLogout} appUpdate={appUpdate} />}
    </section>
  );
}
