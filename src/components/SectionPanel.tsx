import type { LauncherProfile } from "../types/profile";
import type { LauncherSection } from "../types/navigation";

interface SectionPanelProps {
  profile: LauncherProfile;
  section: Exclude<LauncherSection, "home">;
}

const sectionCopy = {
  mods: { title: "모드", description: "이 프로필에 포함된 모드입니다." },
  "resource-packs": { title: "리소스팩", description: "프로필에서 사용할 리소스팩을 관리합니다." },
  shaders: { title: "쉐이더", description: "프로필에서 사용할 쉐이더를 관리합니다." },
  logs: { title: "로그", description: "런처의 최근 동작을 확인합니다." },
  settings: { title: "설정", description: "실행 옵션과 런처 정보를 관리합니다." },
} as const;

export function SectionPanel({ profile, section }: SectionPanelProps) {
  const copy = sectionCopy[section];

  const renderContentList = () => {
    const entries = section === "mods" ? profile.mods : section === "resource-packs" ? profile.resourcePacks : profile.shaders;
    const editable = section === "mods" ? profile.editableFields.mods : section === "resource-packs" ? profile.editableFields.resourcePacks : profile.editableFields.shaders;

    return (
      <div className="content-list">
        {entries.length ? entries.map((entry) => (
          <div className="content-row" key={entry.id}>
            <span className="content-indicator" />
            <div><strong>{entry.name}</strong><small>{entry.version}</small></div>
            <span className="content-state">{entry.required ? "필수" : "선택"}</span>
          </div>
        )) : <div className="section-empty">등록된 {copy.title}가 없습니다.</div>}
        {editable && <button className="section-action" type="button">{copy.title} 추가</button>}
        {!editable && <p className="locked-note">이 항목은 프로필 관리자가 관리합니다.</p>}
      </div>
    );
  };

  return (
    <section className="section-panel" aria-label={copy.title}>
      <header><p>{profile.name}</p><h2>{copy.title}</h2><span>{copy.description}</span></header>
      {(section === "mods" || section === "resource-packs" || section === "shaders") && renderContentList()}
      {section === "logs" && (
        <div className="log-view" role="log">
          <p><time>10:09:18</time> 프로필 manifest를 불러왔습니다.</p>
          <p><time>10:09:19</time> {profile.name} 선택됨</p>
          <p><time>10:09:19</time> Minecraft {profile.minecraftVersion} · {profile.modLoader}</p>
          <p><time>10:09:20</time> 런처 대기 중</p>
        </div>
      )}
      {section === "settings" && (
        <div className="settings-grid">
          <article><span>메모리</span><strong>{profile.launchOptions.minMemoryMb}–{profile.launchOptions.maxMemoryMb} MB</strong></article>
          <article><span>기본 서버</span><strong>{profile.defaultServer.address}</strong></article>
          <article><span>업데이트</span><strong>최신 버전</strong><small>manifest 자동 업데이트 준비됨</small></article>
          <article><span>정보</span><strong>zzapcho Launcher 0.1.0</strong><small>Tauri · React · Minecraft custom launcher</small></article>
        </div>
      )}
    </section>
  );
}
