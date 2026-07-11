import { useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import type { ProfileConfiguration } from "../hooks/useProfileConfiguration";
import { getLoaderVersions, getMinecraftVersions } from "../services/versionCatalogService";
import type { LauncherProfile, ModLoader } from "../types/profile";

const LOADERS: Array<{ id: ModLoader; label: string }> = [
  { id: "vanilla", label: "Vanilla" },
  { id: "fabric", label: "Fabric" },
  { id: "quilt", label: "Quilt" },
  { id: "forge", label: "Forge" },
];

const loaderDescription: Record<ModLoader, string> = {
  vanilla: "모드 없음",
  fabric: "가볍고 빠름",
  quilt: "Fabric 계열",
  forge: "대형 모드",
};

const loaderLabel = (loader: ModLoader) => LOADERS.find((item) => item.id === loader)?.label ?? loader;

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
  const minecraftQuery = minecraftDraft.trim().toLowerCase();
  const loaderVersionQuery = loaderDraft.trim().toLowerCase();
  const filteredMinecraftVersions = useMemo(() => {
    const versions = minecraftQuery
      ? minecraftVersions.filter((version) => version.toLowerCase().includes(minecraftQuery))
      : minecraftVersions;
    return versions.slice(0, 80);
  }, [minecraftQuery, minecraftVersions]);
  const filteredLoaderVersions = useMemo(() => {
    const versions = loaderVersionQuery
      ? loaderVersions.filter((version) => version.toLowerCase().includes(loaderVersionQuery))
      : loaderVersions;
    return versions.slice(0, 48);
  }, [loaderVersionQuery, loaderVersions]);

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
  const selectMinecraftVersion = (version: string) => {
    setMinecraftDraft(version);
    configuration.setMinecraftVersion(version);
  };
  const selectLoaderVersion = (version: string) => {
    setLoaderDraft(version);
    configuration.setModLoaderVersion(version);
  };
  const handleVersionWheel = (event: WheelEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const list = target?.closest<HTMLElement>(".version-choice-list");
    if (!list || list.scrollHeight <= list.clientHeight) return;

    const before = list.scrollTop;
    list.scrollTop += event.deltaY;
    if (before !== list.scrollTop) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return <div className="version-editor" onWheel={handleVersionWheel}>
    <section className={`version-editor-card${!canEditMinecraft ? " is-locked" : ""}`}>
      <div className="version-card-heading">
        <span>게임 버전</span>
        <strong>{profile.minecraftVersion}</strong>
      </div>
      <label className="version-field" htmlFor={`minecraft-version-${profile.id}`}>
        <span>직접 입력 / 검색</span>
        <input id={`minecraft-version-${profile.id}`} value={minecraftDraft} disabled={!canEditMinecraft} onChange={(event) => setMinecraftDraft(event.target.value)} onBlur={commitMinecraft} onKeyDown={(event) => { if (event.key === "Enter") { commitMinecraft(); event.currentTarget.blur(); } }} inputMode="decimal" placeholder="예: 1.21.8" />
      </label>
      <div className="version-choice-list">
        {loadingMinecraft ? <small>버전 불러오는 중...</small> : filteredMinecraftVersions.length ? filteredMinecraftVersions.map((version) => <button className={version === profile.minecraftVersion ? "selected" : ""} type="button" key={version} disabled={!canEditMinecraft} onClick={() => selectMinecraftVersion(version)}>{version}</button>) : <small>검색 결과가 없습니다.</small>}
      </div>
    </section>
    <section className={`version-editor-card${!canEditLoader ? " is-locked" : ""}`}>
      <div className="version-card-heading">
        <span>로더</span>
        <strong>{loaderLabel(profile.modLoader)}</strong>
      </div>
      <div className="loader-choice-list">
        {LOADERS.map((loader) => <button className={loader.id === profile.modLoader ? "selected" : ""} type="button" key={loader.id} disabled={!canEditLoader} onClick={() => configuration.setModLoader(loader.id)}>
          <strong>{loader.label}</strong>
          <small>{loaderDescription[loader.id]}</small>
        </button>)}
      </div>
      {profile.modLoader !== "vanilla" && <>
        <label className="version-field" htmlFor={`loader-version-${profile.id}`}>
          <span>로더 버전 검색 / 직접 입력</span>
          <input id={`loader-version-${profile.id}`} value={loaderDraft} disabled={!canEditLoader} onChange={(event) => setLoaderDraft(event.target.value)} onBlur={commitLoader} onKeyDown={(event) => { if (event.key === "Enter") { commitLoader(); event.currentTarget.blur(); } }} inputMode="decimal" placeholder={loadingLoader ? "최신 버전 확인 중..." : "버전 직접 입력"} />
        </label>
        <div className="version-choice-list loader-versions">
          {loadingLoader ? <small>로더 버전 불러오는 중...</small> : filteredLoaderVersions.length ? filteredLoaderVersions.map((version) => <button className={version === profile.modLoaderVersion ? "selected" : ""} type="button" key={version} disabled={!canEditLoader} onClick={() => selectLoaderVersion(version)}>{version}</button>) : <small>호환 버전이 없습니다.</small>}
        </div>
      </>}
      {profile.modLoader === "vanilla" && <p className="vanilla-loader-note">바닐라는 로더 버전 없이 실행됩니다.</p>}
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

  return <div className={`version-config${open ? " is-open" : ""}${closing ? " is-closing" : ""}${editable ? " is-editable" : ""}`} ref={root}>
    <button className="version-badge" type="button" disabled={!editable} aria-expanded={open} onClick={() => { if (open) close(); else { setClosing(false); setOpen(true); } }}>
      Minecraft {profile.minecraftVersion}<span>·</span>{loaderLabel(profile.modLoader)}
    </button>
    {(open || closing) && <div className="version-config-panel" aria-hidden={!open}><VersionEditor profile={profile} configuration={configuration} /></div>}
  </div>;
}
