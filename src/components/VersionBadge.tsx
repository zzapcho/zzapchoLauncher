import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ProfileConfiguration } from "../hooks/useProfileConfiguration";
import { getLoaderVersions, getMinecraftVersions } from "../services/versionCatalogService";
import type { LauncherProfile, ModLoader } from "../types/profile";

const LOADERS: Array<{ id: ModLoader; label: string }> = [
  { id: "vanilla", label: "Vanilla" },
  { id: "fabric", label: "Fabric" },
  { id: "quilt", label: "Quilt" },
  { id: "forge", label: "Forge" },
];

export const loaderLabel = (loader: ModLoader) => LOADERS.find((item) => item.id === loader)?.label ?? loader;

const normalizeVersionQuery = (value: string) => value.trim().toLowerCase().replace(/^v/, "").replace(/[^a-z0-9]/g, "");

function searchVersions(versions: string[], query: string, current: string, limit: number) {
  const normalizedQuery = normalizeVersionQuery(query);
  const textQuery = query.trim().toLowerCase().replace(/^v/, "");
  if (!normalizedQuery) return versions.slice(0, limit);

  return versions
    .map((version) => {
      const normalizedVersion = normalizeVersionQuery(version);
      const textVersion = version.toLowerCase();
      if (normalizedVersion === normalizedQuery || textVersion === textQuery) return { version, score: 0 };
      if (normalizedVersion.startsWith(normalizedQuery) || textVersion.startsWith(textQuery)) return { version, score: 1 };
      if (textVersion.includes(textQuery)) return { version, score: 2 };
      if (normalizedVersion.includes(normalizedQuery)) return { version, score: 3 };
      const queryParts = textQuery.split(/[\s,./_-]+/).filter(Boolean);
      if (queryParts.length && queryParts.every((part) => textVersion.includes(part))) return { version, score: 4 };
      return null;
    })
    .filter((result): result is { version: string; score: number } => Boolean(result))
    .sort((left, right) => left.score - right.score || Number(right.version === current) - Number(left.version === current))
    .map((result) => result.version)
    .slice(0, limit);
}

type VersionEditorSection = "minecraft" | "loader";

interface VersionEditorProps {
  profile: LauncherProfile;
  configuration: ProfileConfiguration;
  initialSection?: VersionEditorSection | null;
}

function Chevron({ open, className = "" }: { open: boolean; className?: string }) {
  return <span className={`accordion-chevron${open ? " is-open" : ""}${className ? ` ${className}` : ""}`} aria-hidden="true">
    <svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" /></svg>
  </span>;
}

export function VersionEditor({ profile, configuration, initialSection = "minecraft" }: VersionEditorProps) {
  const canEditMinecraft = profile.editableFields.minecraftVersion;
  const canEditLoader = profile.editableFields.modLoader;
  const resolveInitialSection = (): VersionEditorSection | null => {
    if (initialSection === null) return null;
    if (initialSection === "minecraft" && canEditMinecraft) return "minecraft";
    if (initialSection === "loader" && canEditLoader) return "loader";
    return canEditMinecraft ? "minecraft" : canEditLoader ? "loader" : null;
  };
  const [minecraftVersions, setMinecraftVersions] = useState<string[]>([]);
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [minecraftQuery, setMinecraftQuery] = useState("");
  const [loaderQuery, setLoaderQuery] = useState("");
  const [loadingMinecraft, setLoadingMinecraft] = useState(true);
  const [loadingLoader, setLoadingLoader] = useState(false);
  const [openSection, setOpenSection] = useState<VersionEditorSection | null>(resolveInitialSection);
  const editorId = useId();
  const visibleMinecraftVersions = useMemo(() => searchVersions(minecraftVersions, minecraftQuery, profile.minecraftVersion, 80), [minecraftQuery, minecraftVersions, profile.minecraftVersion]);
  const visibleLoaderVersions = useMemo(() => searchVersions(loaderVersions, loaderQuery, profile.modLoaderVersion, 48), [loaderQuery, loaderVersions, profile.modLoaderVersion]);

  useEffect(() => {
    setMinecraftQuery("");
    setLoaderQuery("");
    setOpenSection(resolveInitialSection());
  }, [profile.id, initialSection, canEditMinecraft, canEditLoader]);
  useEffect(() => {
    let cancelled = false;
    setLoadingMinecraft(true);
    void getMinecraftVersions()
      .then((versions) => { if (!cancelled) setMinecraftVersions(versions); })
      .catch((error) => console.warn(error))
      .finally(() => { if (!cancelled) setLoadingMinecraft(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoaderVersions([]);
    setLoaderQuery("");
    if (profile.modLoader === "vanilla") { setLoadingLoader(false); return; }
    setLoadingLoader(true);
    void getLoaderVersions(profile.modLoader, profile.minecraftVersion)
      .then((versions) => {
        if (cancelled) return;
        setLoaderVersions(versions);
        if (canEditLoader && !profile.modLoaderVersion && versions[0]) configuration.setModLoaderVersion(versions[0]);
      })
      .catch((error) => console.warn(error))
      .finally(() => { if (!cancelled) setLoadingLoader(false); });
    return () => { cancelled = true; };
  }, [profile.minecraftVersion, profile.modLoader, canEditLoader]);

  const applyMinecraftVersion = (version: string) => {
    if (!canEditMinecraft || !version.trim()) return;
    configuration.setMinecraftVersion(version.trim());
    setMinecraftQuery("");
  };
  const applyLoaderVersion = (version: string) => {
    if (!canEditLoader || !version.trim()) return;
    configuration.setModLoaderVersion(version.trim());
    setLoaderQuery("");
  };
  const toggleSection = (section: VersionEditorSection) => {
    if ((section === "minecraft" && !canEditMinecraft) || (section === "loader" && !canEditLoader)) return;
    setOpenSection((current) => current === section ? null : section);
  };
  const minecraftOpen = canEditMinecraft && openSection === "minecraft";
  const loaderOpen = canEditLoader && openSection === "loader";
  const minecraftPanelId = `${editorId}-minecraft`;
  const loaderPanelId = `${editorId}-loader`;

  return <div className="version-editor">
    <section className={`version-editor-card${minecraftOpen ? " is-expanded" : ""}${!canEditMinecraft ? " is-locked" : ""}`}>
      <button className={`version-editor-toggle${canEditMinecraft ? "" : " is-static"}`} type="button" disabled={!canEditMinecraft} aria-expanded={canEditMinecraft ? minecraftOpen : undefined} aria-controls={canEditMinecraft ? minecraftPanelId : undefined} onClick={() => toggleSection("minecraft")}>
        <span className="version-editor-toggle-copy"><span>게임 버전</span><strong>Minecraft {profile.minecraftVersion}</strong></span>
        {canEditMinecraft && <Chevron open={minecraftOpen} />}
      </button>
      <div className="version-editor-collapse" id={minecraftPanelId} aria-hidden={!minecraftOpen}>
        <div className="version-editor-collapse-inner">
          <div className="version-editor-card-body">
            <div className="version-field">
              <label htmlFor={`minecraft-version-${editorId}`}>버전 검색 또는 직접 입력</label>
              <input id={`minecraft-version-${editorId}`} value={minecraftQuery} disabled={!canEditMinecraft} onChange={(event) => setMinecraftQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyMinecraftVersion(minecraftQuery); }} inputMode="decimal" placeholder={`현재 ${profile.minecraftVersion} · 예: 1.21.5`} />
            </div>
            <div className="version-choice-list" role="listbox" aria-label="Minecraft 버전 목록">
              {loadingMinecraft ? <small>버전을 불러오는 중...</small> : visibleMinecraftVersions.length ? visibleMinecraftVersions.map((version) => <button className={version === profile.minecraftVersion ? "selected" : ""} type="button" key={version} disabled={!canEditMinecraft} aria-selected={version === profile.minecraftVersion} onClick={() => applyMinecraftVersion(version)}>{version}</button>) : <small>검색 결과가 없습니다. Enter를 누르면 직접 적용됩니다.</small>}
            </div>
          </div>
        </div>
      </div>
    </section>

    <section className={`version-editor-card${loaderOpen ? " is-expanded" : ""}${!canEditLoader ? " is-locked" : ""}`}>
      <button className={`version-editor-toggle${canEditLoader ? "" : " is-static"}`} type="button" disabled={!canEditLoader} aria-expanded={canEditLoader ? loaderOpen : undefined} aria-controls={canEditLoader ? loaderPanelId : undefined} onClick={() => toggleSection("loader")}>
        <span className="version-editor-toggle-copy"><span>모드 로더</span><strong>{loaderLabel(profile.modLoader)}{profile.modLoaderVersion ? ` ${profile.modLoaderVersion}` : ""}</strong></span>
        {canEditLoader && <Chevron open={loaderOpen} />}
      </button>
      <div className="version-editor-collapse" id={loaderPanelId} aria-hidden={!loaderOpen}>
        <div className="version-editor-collapse-inner">
          <div className="version-editor-card-body">
            <div className="loader-choice-list">
              {LOADERS.map((loader) => <button className={loader.id === profile.modLoader ? "selected" : ""} type="button" key={loader.id} disabled={!canEditLoader} aria-pressed={loader.id === profile.modLoader} onClick={() => configuration.setModLoader(loader.id)}><strong>{loader.label}</strong><small>{loader.id === "vanilla" ? "기본 게임" : "모드 사용"}</small></button>)}
            </div>
            {profile.modLoader !== "vanilla" && <>
              <div className="version-field">
                <label htmlFor={`loader-version-${editorId}`}>로더 버전 검색 또는 직접 입력</label>
                <input id={`loader-version-${editorId}`} value={loaderQuery} disabled={!canEditLoader} onChange={(event) => setLoaderQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyLoaderVersion(loaderQuery); }} inputMode="decimal" placeholder={loadingLoader ? "최신 버전 확인 중..." : profile.modLoaderVersion ? `현재 ${profile.modLoaderVersion}` : "버전 검색"} />
              </div>
              <div className="version-choice-list loader-versions" role="listbox" aria-label={`${loaderLabel(profile.modLoader)} 버전 목록`}>
                {loadingLoader ? <small>로더 버전을 불러오는 중...</small> : visibleLoaderVersions.length ? visibleLoaderVersions.map((version) => <button className={version === profile.modLoaderVersion ? "selected" : ""} type="button" key={version} disabled={!canEditLoader} aria-selected={version === profile.modLoaderVersion} onClick={() => applyLoaderVersion(version)}>{version}</button>) : <small>검색 결과가 없습니다. Enter를 누르면 직접 적용됩니다.</small>}
              </div>
            </>}
            {profile.modLoader === "vanilla" && <p className="vanilla-loader-note">Vanilla는 별도의 로더 버전이 필요하지 않습니다.</p>}
          </div>
        </div>
      </div>
    </section>
  </div>;
}

export function VersionBadge({ profile, configuration }: VersionEditorProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const closeTimer = useRef(0);
  const editable = profile.editableFields.minecraftVersion || profile.editableFields.modLoader;

  const close = () => {
    if (!open) return;
    setOpen(false);
    setClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setClosing(false), 260);
  };
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  return <div className={`version-config${open ? " is-open" : ""}${closing ? " is-closing" : ""}${editable ? " is-editable" : ""}${profile.modLoader === "vanilla" ? " is-vanilla" : " has-loader-version"}`} ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}>
    <button className={`version-badge${editable ? " has-chevron" : ""}`} type="button" disabled={!editable} aria-expanded={editable ? open : undefined} onClick={() => { if (open) close(); else { setClosing(false); setOpen(true); } }}>
      <span className="version-badge-copy">Minecraft {profile.minecraftVersion}<i>·</i>{loaderLabel(profile.modLoader)}</span>
      {editable && <Chevron open={open} className="version-badge-chevron" />}
    </button>
    {(open || closing) && <div className="version-config-panel" role="dialog" aria-label="게임 버전 및 로더 선택" aria-hidden={!open}>
      <div className="version-config-compact-header">
        <span><strong>게임 버전 및 로더</strong><small>항목을 펼쳐 원하는 버전을 선택하세요.</small></span>
        <button type="button" aria-label="버전 선택 닫기" onClick={close}>×</button>
      </div>
      <VersionEditor profile={profile} configuration={configuration} initialSection="minecraft" />
    </div>}
  </div>;
}
