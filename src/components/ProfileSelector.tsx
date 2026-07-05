import { useEffect, useRef, useState } from "react";
import type { LauncherProfile } from "../types/profile";

interface ProfileSelectorProps {
  profiles: LauncherProfile[];
  selectedProfile: LauncherProfile;
  onSelect: (id: string) => void;
  disabled: boolean;
}

export function ProfileSelector({ profiles, selectedProfile, onSelect, disabled }: ProfileSelectorProps) {
  const [open, setOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  return (
    <div className={`profile-selector${open ? " is-open" : ""}`} ref={selectorRef}>
        <div className={`profile-menu${open ? " is-open" : ""}${profiles.length > 4 ? " has-overflow" : ""}`} role="listbox" aria-label="프로필 목록" aria-hidden={!open}>
          <p className="profile-menu-label">프로필 선택</p>
          <div className="profile-options">
          {profiles.map((profile) => (
            <button
              type="button"
              role="option"
              aria-selected={profile.id === selectedProfile.id}
              className={profile.id === selectedProfile.id ? "selected" : ""}
              key={profile.id}
              tabIndex={open ? 0 : -1}
              onClick={() => { onSelect(profile.id); setOpen(false); }}
            >
              <span className="profile-dot" style={{ backgroundColor: profile.accentColor }} />
              <strong>{profile.name}</strong>
              {profile.id === selectedProfile.id && <span className="check">✓</span>}
            </button>
          ))}
          </div>
        </div>
      <button className="profile-trigger" type="button" onClick={() => setOpen((value) => !value)} disabled={disabled} aria-expanded={open}>
        <strong>{selectedProfile.name}</strong>
      </button>
    </div>
  );
}
