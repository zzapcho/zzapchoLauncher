import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useProfileContent } from "../hooks/useProfileContent";
import { useUserSettings } from "../hooks/useUserSettings";
import { createUserContent } from "../services/contentService";
import { getInstallableVersion, searchModrinth, type ModrinthProject } from "../services/modrinthService";
import type { ContentKind } from "../types/content";
import type { LauncherProfile } from "../types/profile";
import type { LauncherSection } from "../types/navigation";

interface SectionPanelProps {
  profile: LauncherProfile;
  section: Exclude<LauncherSection, "home">;
}

const isTauri = () => "__TAURI_INTERNALS__" in window;

const sectionCopy = {
  mods: { title: "모드", description: "이 프로필에서 사용할 모드를 관리합니다." },
  "resource-packs": { title: "리소스팩", description: "이 프로필에서 사용할 리소스팩을 관리합니다." },
  shaders: { title: "쉐이더", description: "이 프로필에서 사용할 쉐이더를 관리합니다." },
  logs: { title: "로그", description: "게임과 런처 로그를 실시간으로 확인합니다." },
  settings: { title: "설정", description: "모든 프로필에 공통으로 적용되는 사용자 설정입니다." },
} as const;

function ContentManager({ profile, kind }: { profile: LauncherProfile; kind: ContentKind }) {
  const content = useProfileContent(profile);
  const [projects, setProjects] = useState<ModrinthProject[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const editable = profile.editableFields[kind];
  const entries = content.state[kind];
  const title = sectionCopy[kind === "resourcePacks" ? "resource-packs" : kind].title;

  const loadProjects = async (search = "") => {
    setLoading(true);
    try { setProjects(await searchModrinth(kind, profile, search)); }
    catch (error) { console.warn(error); setProjects([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadProjects(); }, [kind, profile.id]);

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

  return (
    <div className="content-manager">
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
          <form onSubmit={(event) => { event.preventDefault(); void loadProjects(query); }}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Modrinth 검색" aria-label="Modrinth 검색" />
            <button type="submit">검색</button>
          </form>
        </div>
        <div className="modrinth-section">
          <div className="modrinth-heading"><strong>Modrinth</strong><span>{query ? "검색 결과" : "인기순"}</span></div>
          <div className="modrinth-results">
            {loading ? <div className="inline-loading">불러오는 중...</div> : projects.map((project) => {
              const installed = entries.some((entry) => entry.projectId === project.project_id);
              return <article key={project.project_id}>
                {project.icon_url ? <img src={project.icon_url} alt="" /> : <span className="project-placeholder" />}
                <div><strong>{project.title}</strong><small>{project.author} · {Intl.NumberFormat("ko-KR", { notation: "compact" }).format(project.downloads)} 다운로드</small></div>
                <button type="button" disabled={installed || installing === project.project_id} onClick={() => void installProject(project)}>{installed ? "설치됨" : installing === project.project_id ? "설치 중" : "설치"}</button>
              </article>;
            })}
          </div>
        </div>
      </> : <div className="locked-panel">이 프로필에서는 {title} 추가·토글·삭제가 허용되지 않습니다. 서버 관리 항목은 항상 잠겨 있습니다.</div>}
    </div>
  );
}

const GAME_LOGS = Array.from({ length: 48 }, (_, index) => `[10:${String(index + 10).padStart(2, "0")}:24] [Client thread/INFO] 게임 로그 ${index + 1}`);
const LAUNCHER_LOGS = Array.from({ length: 32 }, (_, index) => `[10:${String(index + 20).padStart(2, "0")}:02] 런처 작업 ${index + 1} 완료`);

function LogsPanel() {
  const [source, setSource] = useState<"game" | "launcher">("game");
  const [atBottom, setAtBottom] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => source === "game" ? GAME_LOGS : LAUNCHER_LOGS, [source]);

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
      {lines.map((line, index) => <p key={`${source}-${index}`}>{line}</p>)}
    </div>
  </div>;
}

function SettingsPanel() {
  const { settings, setMemoryGb } = useUserSettings();
  const [editingMemory, setEditingMemory] = useState(false);
  return <div className="settings-grid">
    <article className="memory-setting">
      <div><span>게임 메모리</span>{editingMemory ? <input autoFocus type="number" min="0.5" max="32" step="0.5" value={settings.memoryGb} onChange={(event) => setMemoryGb(Number(event.target.value))} onBlur={() => setEditingMemory(false)} onKeyDown={(event) => event.key === "Enter" && setEditingMemory(false)} /> : <button type="button" onClick={() => setEditingMemory(true)}>{settings.memoryGb.toFixed(1)} GB</button>}</div>
      <input className="memory-slider" type="range" min="0.5" max="32" step="0.5" value={settings.memoryGb} onChange={(event) => setMemoryGb(Number(event.target.value))} />
    </article>
    <article><span>게임 폴더</span><strong>.minecraft</strong><button className="settings-button" type="button" onClick={() => { if (isTauri()) void invoke("open_game_folder"); }}>폴더 열기</button></article>
    <article><span>업데이트</span><strong>최신 버전</strong><small>manifest 자동 업데이트 준비됨</small></article>
    <article><span>정보</span><strong>zzapcho Launcher 0.1.0</strong><small>Tauri · React · Minecraft custom launcher</small></article>
  </div>;
}

export function SectionPanel({ profile, section }: SectionPanelProps) {
  const copy = sectionCopy[section];
  const contentKind: ContentKind | null = section === "mods" ? "mods" : section === "resource-packs" ? "resourcePacks" : section === "shaders" ? "shaders" : null;
  return (
    <section className="section-panel" aria-label={copy.title}>
      <header><h2>{copy.title}</h2><span>{copy.description}</span></header>
      {contentKind && <ContentManager key={`${profile.id}-${contentKind}`} profile={profile} kind={contentKind} />}
      {section === "logs" && <LogsPanel />}
      {section === "settings" && <SettingsPanel />}
    </section>
  );
}
