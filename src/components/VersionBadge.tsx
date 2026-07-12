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
  const [minecraftDraft, setMinecraftDraft] = useState(profile.minecraftVersion);
  const [loaderDraft, setLoaderDraft] = useState(profile.modLoaderVersion);
  const [loadingMinecraft, setLoadingMinecraft] = useState(true);
  const [loadingLoader, setLoadingLoader] = useState(false);
  const canEditMinecraft = profile.editableFields.minecraftVersion;
  const canEditLoader = profile.editableFields.modLoader;
  const visibleMinecraftVersions = useMemo(() => searchVersions(minecraftVersions, minecraftDraft, profile.minecraftVersion, 80), [minecraftDraft, minecraftVersions, profile.minecraftVersion]);
  const visibleLoaderVersions = useMemo(() => searchVersions(loaderVersions, loaderDraft, profile.modLoaderVersion, 48), [loaderDraft, loaderVersions, profile.modLoaderVersion]);

  useEffect(() => setMinecraftDraft(profile.minecraftVersion), [profile.minecraftVersion]);
  useEffect(() => setLoaderDraft(profile.modLoaderVersion), [profile.modLoaderVersion]);
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
    if (profile.modLoader === "vanilla") return;
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

  const commitMinecraft = () => {
    if (canEditMinecraft && minecraftDraft.trim()) configuration.setMinecraftVersion(minecraftDraft);
    else setMinecraftDraft(profile.minecraftVersion);
  };
  const commitLoader = () => {
    if (canEditLoader && loaderDraft.trim()) configuration.setModLoaderVersion(loaderDraft);
    else setLoaderDraft(profile.modLoaderVersion);
  };

  return <div className="version-editor">
    <section className={!canEditMinecraft ? "is-locked" : ""}>
      <label htmlFor={`minecraft-version-${profile.id}`}>Minecraft 버전</label>
      <input id={`minecraft-version-${profile.id}`} value={minecraftDraft} disabled={!canEditMinecraft} onChange={(event) => setMinecraftDraft(event.target.value)} onBlur={commitMinecraft} onKeyDown={(event) => { if (event.key === "Enter") { commitMinecraft(); event.currentTarget.blur(); } }} inputMode="decimal" />
      <div className="version-choice-list">
        {loadingMinecraft ? <small>버전 불러오는 중...</small> : visibleMinecraftVersions.length ? visibleMinecraftVersions.map((version) => <button className={version === profile.minecraftVersion ? "selected" : ""} type="button" key={version} disabled={!canEditMinecraft} onClick={() => configuration.setMinecraftVersion(version)}>{version}</button>) : <small>검색 결과 없음 · Enter로 직접 적용</small>}
      </div>
    </section>
    <section className={!canEditLoader ? "is-locked" : ""}>
      <span>로더</span>
      <div className="loader-choice-list">
        {LOADERS.map((loader) => <button className={loader.id === profile.modLoader ? "selected" : ""} type="button" key={loader.id} disabled={!canEditLoader} onClick={() => configuration.setModLoader(loader.id)}>{loader.label}</button>)}
      </div>
      {profile.modLoader !== "vanilla" && <>
        <label htmlFor={`loader-version-${profile.id}`}>로더 버전</label>
        <input id={`loader-version-${profile.id}`} value={loaderDraft} disabled={!canEditLoader} onChange={(event) => setLoaderDraft(event.target.value)} onBlur={commitLoader} onKeyDown={(event) => { if (event.key === "Enter") { commitLoader(); event.currentTarget.blur(); } }} inputMode="decimal" placeholder={loadingLoader ? "최신 버전 확인 중..." : "버전 직접 입력"} />
        <div className="version-choice-list loader-versions">
          {loadingLoader ? <small>로더 버전 불러오는 중...</small> : visibleLoaderVersions.length ? visibleLoaderVersions.map((version) => <button className={version === profile.modLoaderVersion ? "selected" : ""} type="button" key={version} disabled={!canEditLoader} onClick={() => configuration.setModLoaderVersion(version)}>{version}</button>) : <small>검색 결과 없음 · Enter로 직접 적용</small>}
        </div>
      </>}
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

  return <div className={`version-config${open ? " is-open" : ""}${closing ? " is-closing" : ""}${editable ? " is-editable" : ""}${profile.modLoader === "vanilla" ? " is-vanilla" : " has-loader-version"}`} ref={root}>
    <button className="version-badge" type="button" disabled={!editable} aria-expanded={open} onClick={() => { if (open) close(); else { setClosing(false); setOpen(true); } }}>
      Minecraft {profile.minecraftVersion}<span>·</span>{loaderLabel(profile.modLoader)}
    </button>
    {(open || closing) && <div className="version-config-panel" aria-hidden={!open}><VersionEditor profile={profile} configuration={configuration} /></div>}
  </div>;
}
