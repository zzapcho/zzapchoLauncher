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
  const [focusedIndex, setFocusedIndex] = useState(0);
  const selectorRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

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

  useEffect(() => {
    if (!open) return;
    const index = Math.max(0, profiles.findIndex((profile) => profile.id === selectedProfile.id));
    setFocusedIndex(index);
    requestAnimationFrame(() => optionRefs.current[index]?.focus());
  }, [open, profiles, selectedProfile.id]);

  const focusOption = (index: number) => {
    const next = (index + profiles.length) % profiles.length;
    setFocusedIndex(next);
    optionRefs.current[next]?.focus();
    optionRefs.current[next]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  return (
    <div className="profile-selector" ref={selectorRef}>
        <div className={`profile-menu${open ? " is-open" : ""}${profiles.length > 3 ? " has-overflow" : ""}`} role="listbox" aria-label="프로필 목록" aria-hidden={!open}>
          <p className="profile-menu-label">프로필 선택</p>
          <div className="profile-options" onWheel={(event) => { event.preventDefault(); focusOption(focusedIndex + (event.deltaY > 0 ? 1 : -1)); }} onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); focusOption(focusedIndex + 1); }
            if (event.key === "ArrowUp") { event.preventDefault(); focusOption(focusedIndex - 1); }
          }}>
          {profiles.map((profile, index) => (
            <button
              type="button"
              role="option"
              aria-selected={profile.id === selectedProfile.id}
              className={profile.id === selectedProfile.id ? "selected" : ""}
              key={profile.id}
              ref={(element) => { optionRefs.current[index] = element; }}
              tabIndex={open ? 0 : -1}
              onFocus={() => setFocusedIndex(index)}
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
