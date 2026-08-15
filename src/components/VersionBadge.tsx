import { useEffect, useMemo, useRef, useState } from "react";
import type { ProfileConfiguration } from "../hooks/useProfileConfiguration";
import { getLoaderVersions, getMinecraftVersions } from "../services/versionCatalogService";
import type { LauncherProfile, ModLoader } from "../types/profile";

const LOADERS: Array<{ id: ModLoader; label: string }> = [
  { id: "vanilla", label: "Vanilla" },
  { id: "fabric", label: "Fabric" },
  { id: "quilt", label: "Quilt" },
  { id: "forge", label: "Forge" },
];

const loaderLabel = (loader: ModLoader) => LOADERS.find((item) => item.id === loader)?.label ?? loader;

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

interface VersionEditorProps {
  profile: LauncherProfile;
  configuration: ProfileConfiguration;
}

export function VersionEditor({ profile, configuration }: VersionEditorProps) {
  const [minecraftVersions, setMinecraftVersions] = useState<string[]>([]);
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [minecraftQuery, setMinecraftQuery] = useState("");
  const [loaderQuery, setLoaderQuery] = useState("");
  const [loadingMinecraft, setLoadingMinecraft] = useState(true);
  const [loadingLoader, setLoadingLoader] = useState(false);
  const canEditMinecraft = profile.editableFields.minecraftVersion;
  const canEditLoader = profile.editableFields.modLoader;
  const visibleMinecraftVersions = useMemo(() => searchVersions(minecraftVersions, minecraftQuery, profile.minecraftVersion, 80), [minecraftQuery, minecraftVersions, profile.minecraftVersion]);
  const visibleLoaderVersions = useMemo(() => searchVersions(loaderVersions, loaderQuery, profile.modLoaderVersion, 48), [loaderQuery, loaderVersions, profile.modLoaderVersion]);

  useEffect(() => { setMinecraftQuery(""); setLoaderQuery(""); }, [profile.id]);
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

  return <div className="version-editor">
    <section className={`version-editor-card${!canEditMinecraft ? " is-locked" : ""}`}>
      <div className="version-card-heading"><span>Minecraft 버전</span><strong>{profile.minecraftVersion}</strong></div>
      <div className="version-field">
        <label htmlFor={`minecraft-version-${profile.id}`}>버전 검색 또는 직접 입력</label>
        <input id={`minecraft-version-${profile.id}`} value={minecraftQuery} disabled={!canEditMinecraft} onChange={(event) => setMinecraftQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyMinecraftVersion(minecraftQuery); }} inputMode="decimal" placeholder={`현재 ${profile.minecraftVersion} · 예: 1.21.5`} />
      </div>
      <div className="version-choice-list" role="listbox" aria-label="Minecraft 버전 목록">
        {loadingMinecraft ? <small>버전 불러오는 중...</small> : visibleMinecraftVersions.length ? visibleMinecraftVersions.map((version) => <button className={version === profile.minecraftVersion ? "selected" : ""} type="button" key={version} disabled={!canEditMinecraft} aria-selected={version === profile.minecraftVersion} onClick={() => applyMinecraftVersion(version)}>{version}</button>) : <small>검색 결과 없음 · Enter를 누르면 직접 적용됩니다.</small>}
      </div>
    </section>
    <section className={`version-editor-card${!canEditLoader ? " is-locked" : ""}`}>
      <div className="version-card-heading"><span>모드 로더</span><strong>{loaderLabel(profile.modLoader)}{profile.modLoaderVersion ? ` ${profile.modLoaderVersion}` : ""}</strong></div>
      <div className="loader-choice-list">
        {LOADERS.map((loader) => <button className={loader.id === profile.modLoader ? "selected" : ""} type="button" key={loader.id} disabled={!canEditLoader} aria-pressed={loader.id === profile.modLoader} onClick={() => configuration.setModLoader(loader.id)}><strong>{loader.label}</strong><small>{loader.id === "vanilla" ? "기본 게임" : "모드 사용"}</small></button>)}
      </div>
      {profile.modLoader !== "vanilla" && <>
        <div className="version-field">
          <label htmlFor={`loader-version-${profile.id}`}>로더 버전 검색 또는 직접 입력</label>
          <input id={`loader-version-${profile.id}`} value={loaderQuery} disabled={!canEditLoader} onChange={(event) => setLoaderQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyLoaderVersion(loaderQuery); }} inputMode="decimal" placeholder={loadingLoader ? "최신 버전 확인 중..." : profile.modLoaderVersion ? `현재 ${profile.modLoaderVersion}` : "버전 검색"} />
        </div>
        <div className="version-choice-list loader-versions" role="listbox" aria-label={`${loaderLabel(profile.modLoader)} 버전 목록`}>
          {loadingLoader ? <small>로더 버전 불러오는 중...</small> : visibleLoaderVersions.length ? visibleLoaderVersions.map((version) => <button className={version === profile.modLoaderVersion ? "selected" : ""} type="button" key={version} disabled={!canEditLoader} aria-selected={version === profile.modLoaderVersion} onClick={() => applyLoaderVersion(version)}>{version}</button>) : <small>검색 결과 없음 · Enter를 누르면 직접 적용됩니다.</small>}
        </div>
      </>}
      {profile.modLoader === "vanilla" && <p className="vanilla-loader-note">바닐라는 별도의 로더 버전이 필요하지 않습니다.</p>}
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
    <button className="version-badge" type="button" disabled={!editable} aria-expanded={open} onClick={() => { if (open) close(); else { setClosing(false); setOpen(true); } }}>
      Minecraft {profile.minecraftVersion}<span>·</span>{loaderLabel(profile.modLoader)}
    </button>
    {(open || closing) && <div className="version-config-panel" role="dialog" aria-label="게임 버전 및 로더 선택" aria-hidden={!open}>
      <div className="version-config-compact-header">
        <strong>게임 버전 및 로더</strong>
        <button type="button" aria-label="버전 선택 닫기" onClick={close}>×</button>
      </div>
      <VersionEditor profile={profile} configuration={configuration} />
    </div>}
  </div>;
}
