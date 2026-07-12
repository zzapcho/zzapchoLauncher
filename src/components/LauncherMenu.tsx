import { useEffect, useRef, useState } from "react";
import { LAUNCHER_NAV_ITEMS, type LauncherSection } from "../types/navigation";
import type { LauncherProfile } from "../types/profile";

interface LauncherMenuProps {
  activeSection: LauncherSection;
  onNavigate: (section: LauncherSection) => void;
  profile?: LauncherProfile;
  updateAvailable?: boolean;
}

function NavIcon({ section }: { section: LauncherSection }) {
  const paths: Record<LauncherSection, React.ReactNode> = {
    home: <><path d="M4.5 11.2 12 5l7.5 6.2" /><path d="M6.5 10.4v8.1h4.1v-4.2h2.8v4.2h4.1v-8.1" /></>,
    mods: <><path d="M8 4.5h8M8 19.5h8M4.5 8v8M19.5 8v8" /><rect x="6.5" y="6.5" width="11" height="11" rx="3" /><path d="M10 10h4v4h-4z" /></>,
    "resource-packs": <><path d="M5.5 7.5 12 4.8l6.5 2.7v8.8L12 19.2l-6.5-2.9Z" /><path d="m5.8 7.8 6.2 2.7 6.2-2.7M12 10.5v8.2" /></>,
    shaders: <><circle cx="12" cy="12" r="7.2" /><path d="M12 4.8c3.9 2.6 3.9 11.8 0 14.4" /><path d="M12 4.8c-3.9 2.6-3.9 11.8 0 14.4" /></>,
    logs: <><path d="M7 5.5h8l2 2v11H7z" /><path d="M15 5.5v3h3M9.5 11.5h5M9.5 14.5h5M9.5 17.5h3" /></>,
    settings: <><path d="M12 8.7a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 0 1 0-6.6Z" /><path d="M12 3.8v2.1m0 12.2v2.1M4.9 7l1.8 1.1m10.6 7.8 1.8 1.1m0-10-1.8 1.1M6.7 15.9 4.9 17M3.8 12h2.1m12.2 0h2.1" /></>,
  };
  return <svg className={`nav-icon nav-icon-${section}`} viewBox="0 0 24 24" aria-hidden="true">{paths[section]}</svg>;
}

function NavigationList({ activeSection, onNavigate, profile, updateAvailable, tabIndex }: LauncherMenuProps & { tabIndex?: number }) {
  const navItems = LAUNCHER_NAV_ITEMS.filter((item) => profile?.modLoader === "vanilla" ? item.id !== "mods" && item.id !== "shaders" : true);
  return (
    <nav aria-label="런처 메뉴">
      {navItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`${activeSection === item.id ? "active" : ""}${updateAvailable && item.id === "settings" ? " has-update" : ""}`}
          tabIndex={tabIndex}
          onClick={() => onNavigate(item.id)}
        >
          <NavIcon section={item.id} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function LauncherMenu({ activeSection, onNavigate, profile, updateAvailable }: LauncherMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const navItems = LAUNCHER_NAV_ITEMS.filter((item) => profile?.modLoader === "vanilla" ? item.id !== "mods" && item.id !== "shaders" : true);
    const index = Math.max(0, navItems.findIndex((item) => item.id === activeSection));
    requestAnimationFrame(() => panelRef.current?.querySelectorAll<HTMLButtonElement>("nav button")[index]?.focus());
  }, [open, activeSection, profile?.modLoader]);

  const navigate = (section: LauncherSection) => {
    onNavigate(section);
    setOpen(false);
  };

  const moveFocus = (direction: number) => {
    const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("nav button") ?? []);
    const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    buttons[(current + direction + buttons.length) % buttons.length]?.focus();
  };

  return (
    <>
      <div className={`launcher-menu${open ? " is-open" : ""}${updateAvailable ? " has-update" : ""}`} ref={menuRef}>
        <div className="launcher-menu-panel" aria-hidden={!open} ref={panelRef} onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(1); }
          if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(-1); }
        }}>
          <NavigationList activeSection={activeSection} onNavigate={navigate} profile={profile} updateAvailable={updateAvailable} tabIndex={open ? 0 : -1} />
        </div>
        <button
          type="button"
          className="floating-control menu-control"
          aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span /><span /><span />
        </button>
      </div>
      <aside className="desktop-sidebar">
        <NavigationList activeSection={activeSection} onNavigate={navigate} profile={profile} updateAvailable={updateAvailable} />
      </aside>
    </>
  );
}
