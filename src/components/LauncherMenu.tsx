import { useEffect, useRef, useState } from "react";

const MENU_ITEMS = ["모드", "리소스팩", "쉐이더", "로그", "설정"];

export function LauncherMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className={`launcher-menu${open ? " is-open" : ""}`} ref={menuRef}>
      <div className="launcher-menu-panel" aria-hidden={!open}>
        <nav aria-label="런처 메뉴">
          {MENU_ITEMS.map((item) => (
            <button key={item} type="button" tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}>
              {item}
            </button>
          ))}
        </nav>
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
  );
}
