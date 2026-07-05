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
  const [closing, setClosing] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number>(0);

  const closeMenu = () => {
    setOpen((current) => {
      if (current) {
        window.clearTimeout(closeTimer.current);
        setClosing(true);
        closeTimer.current = window.setTimeout(() => setClosing(false), 300);
      }
      return false;
    });
  };

  const toggleMenu = () => {
    if (open) return closeMenu();
    window.clearTimeout(closeTimer.current);
    setClosing(false);
    setOpen(true);
  };

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) closeMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.clearTimeout(closeTimer.current);
    };
  }, []);

  return <div className={`profile-selector${open ? " is-open" : ""}${closing ? " is-closing" : ""}`} ref={selectorRef}>
    <div className={`profile-menu${open ? " is-open" : ""}${closing ? " is-closing" : ""}${profiles.length > 4 ? " has-overflow" : ""}`} role="listbox" aria-label="프로필 목록" aria-hidden={!open}>
      <p className="profile-menu-label">프로필 선택</p>
      <div className="profile-options">
        {profiles.map((profile) => <button
          type="button"
          role="option"
          aria-selected={profile.id === selectedProfile.id}
          className={profile.id === selectedProfile.id ? "selected" : ""}
          key={profile.id}
          tabIndex={open ? 0 : -1}
          onClick={() => { onSelect(profile.id); closeMenu(); }}
        >
          <span className="profile-dot" style={{ backgroundColor: profile.accentColor }} />
          <strong>{profile.name}</strong>
          {profile.id === selectedProfile.id && <span className="check">✓</span>}
        </button>)}
      </div>
    </div>
    <button className="profile-trigger" type="button" onClick={toggleMenu} disabled={disabled} aria-expanded={open}>
      <strong>{selectedProfile.name}</strong>
    </button>
  </div>;
}
