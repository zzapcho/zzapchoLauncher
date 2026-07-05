import { useEffect, useRef, useState } from "react";
import { LAUNCHER_NAV_ITEMS, type LauncherSection } from "../types/navigation";

interface LauncherMenuProps {
  activeSection: LauncherSection;
  onNavigate: (section: LauncherSection) => void;
  updateAvailable?: boolean;
}

function NavIcon({ section }: { section: LauncherSection }) {
  const paths: Record<LauncherSection, React.ReactNode> = {
    home: <path d="m3 10 9-7 9 7v10h-6v-6H9v6H3Z" />,
    mods: <><rect x="5" y="6" width="14" height="14" rx="2" /><path d="M9 3v6m6-6v6M2 11h5m10 0h5" /></>,
    "resource-packs": <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8v6H8z" /></>,
    shaders: <><circle cx="12" cy="12" r="7" /><path d="M12 5a7 7 0 0 1 0 14Z" /></>,
    logs: <path d="M5 6h14M5 10h11M5 14h8M5 18h5" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" /></>,
  };
  return <svg className={`nav-icon nav-icon-${section}`} viewBox="0 0 24 24" aria-hidden="true">{paths[section]}</svg>;
}

function NavigationList({ activeSection, onNavigate, updateAvailable, tabIndex }: LauncherMenuProps & { tabIndex?: number }) {
  return (
    <nav aria-label="런처 메뉴">
      {LAUNCHER_NAV_ITEMS.map((item) => (
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

export function LauncherMenu({ activeSection, onNavigate, updateAvailable }: LauncherMenuProps) {
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
    const index = Math.max(0, LAUNCHER_NAV_ITEMS.findIndex((item) => item.id === activeSection));
    requestAnimationFrame(() => panelRef.current?.querySelectorAll<HTMLButtonElement>("nav button")[index]?.focus());
  }, [open, activeSection]);

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
          <NavigationList activeSection={activeSection} onNavigate={navigate} updateAvailable={updateAvailable} tabIndex={open ? 0 : -1} />
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
        <NavigationList activeSection={activeSection} onNavigate={navigate} updateAvailable={updateAvailable} />
      </aside>
    </>
  );
}
