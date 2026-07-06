import { useEffect, useRef, useState } from "react";
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
        {loadingMinecraft ? <small>버전 불러오는 중...</small> : minecraftVersions.map((version) => <button className={version === profile.minecraftVersion ? "selected" : ""} type="button" key={version} disabled={!canEditMinecraft} onClick={() => configuration.setMinecraftVersion(version)}>{version}</button>)}
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
          {loadingLoader ? <small>로더 버전 불러오는 중...</small> : loaderVersions.map((version) => <button className={version === profile.modLoaderVersion ? "selected" : ""} type="button" key={version} disabled={!canEditLoader} onClick={() => configuration.setModLoaderVersion(version)}>{version}</button>)}
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
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); window.clearTimeout(closeTimer.current); };
  }, [open]);

  return <div className={`version-config${open ? " is-open" : ""}${closing ? " is-closing" : ""}${editable ? " is-editable" : ""}`} ref={root}>
    <button className="version-badge" type="button" disabled={!editable} aria-expanded={open} onClick={() => { if (open) close(); else { setClosing(false); setOpen(true); } }}>
      Minecraft {profile.minecraftVersion}<span>·</span>{loaderLabel(profile.modLoader)}
    </button>
    {(open || closing) && <div className="version-config-panel" aria-hidden={!open}><VersionEditor profile={profile} configuration={configuration} /></div>}
  </div>;
}
