import { useEffect, useMemo, useState } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

type ContextTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface MenuState {
  x: number;
  y: number;
  target: ContextTarget;
  editable: boolean;
}

const isTauri = () => "__TAURI_INTERNALS__" in window;

function isTextInput(element: Element): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return ["text", "search", "url", "email", "tel", "password"].includes(element.type);
}

function isEditableControl(element: Element): element is HTMLInputElement | HTMLTextAreaElement {
  return isTextInput(element) || (element instanceof HTMLInputElement && element.type === "number");
}

function selectedText(target: ContextTarget): string {
  if (isTextInput(target)) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? start;
    return target.value.slice(start, end);
  }
  if (target instanceof HTMLInputElement && target.type === "number") return target.value;
  return window.getSelection()?.toString() ?? "";
}

async function copyText(value: string): Promise<void> {
  if (!value) return;
  if (isTauri()) await writeText(value);
  else await navigator.clipboard.writeText(value);
}

async function clipboardText(): Promise<string> {
  if (isTauri()) return await readText();
  return await navigator.clipboard.readText();
}

function selectAll(target: ContextTarget): void {
  target.focus();
  if (isEditableControl(target)) {
    target.select();
    return;
  }
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(target);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function replaceSelection(target: ContextTarget, value: string): void {
  target.focus();
  if (isTextInput(target)) {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    target.setRangeText(value, start, end, "end");
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (target instanceof HTMLInputElement && target.type === "number") {
    target.value = value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  if (value) {
    const node = document.createTextNode(value);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  target.dispatchEvent(new Event("input", { bubbles: true }));
}

export function ContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const hasSelection = useMemo(() => menu ? Boolean(selectedText(menu.target)) : false, [menu]);

  useEffect(() => {
    const open = (event: MouseEvent) => {
      event.preventDefault();
      const origin = event.target as HTMLElement | null;
      if (!origin || origin.closest(".context-menu")) return;

      const input = origin.closest("input, textarea, [contenteditable='true']");
      const selectable = origin.closest(".log-view, .device-code");
      const target = input ?? selectable;
      if (!(target instanceof HTMLElement) || (target instanceof HTMLInputElement && target.type === "range")) {
        setMenu(null);
        return;
      }

      const editable = isEditableControl(target) || target.isContentEditable;
      const itemCount = editable ? 4 : 2;
      setMenu({
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - 166)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - itemCount * 34 - 16)),
        target,
        editable,
      });
    };
    const close = (event: Event) => {
      if ((event.target as HTMLElement | null)?.closest?.(".context-menu")) return;
      setMenu(null);
    };
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("contextmenu", open);
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    document.addEventListener("keydown", closeOnKey);
    return () => {
      document.removeEventListener("contextmenu", open);
      document.removeEventListener("pointerdown", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
      document.removeEventListener("keydown", closeOnKey);
    };
  }, []);

  if (!menu) return null;
  const run = (action: () => void | Promise<void>) => {
    void Promise.resolve(action()).catch((error) => console.warn("클립보드 작업에 실패했습니다.", error)).finally(() => setMenu(null));
  };

  return <div className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onContextMenu={(event) => event.preventDefault()}>
    {menu.editable && <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => run(async () => {
      const value = selectedText(menu.target);
      await copyText(value);
      replaceSelection(menu.target, "");
    })}><span>잘라내기</span><kbd>Ctrl+X</kbd></button>}
    <button type="button" role="menuitem" disabled={!hasSelection} onClick={() => run(() => copyText(selectedText(menu.target)))}><span>복사</span><kbd>Ctrl+C</kbd></button>
    {menu.editable && <button type="button" role="menuitem" onClick={() => run(async () => replaceSelection(menu.target, await clipboardText()))}><span>붙여넣기</span><kbd>Ctrl+V</kbd></button>}
    <div className="context-menu-separator" />
    <button type="button" role="menuitem" onClick={() => run(() => selectAll(menu.target))}><span>모두 선택</span><kbd>Ctrl+A</kbd></button>
  </div>;
}
