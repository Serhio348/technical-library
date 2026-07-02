import { MoreHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ItemMenuAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

const MENU_MIN_WIDTH = 200;

export function ItemActionsMenu({
  actions,
  align = "right",
}: {
  actions: ItemMenuAction[];
  align?: "left" | "right";
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setMenuPos(null);
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    let left = align === "left" ? rect.left : rect.right - MENU_MIN_WIDTH;
    left = Math.max(8, Math.min(left, window.innerWidth - MENU_MIN_WIDTH - 8));
    setMenuPos({ top: rect.bottom + 4, left });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const reposition = (): void => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      let left = align === "left" ? rect.left : rect.right - MENU_MIN_WIDTH;
      left = Math.max(8, Math.min(left, window.innerWidth - MENU_MIN_WIDTH - 8));
      setMenuPos({ top: rect.bottom + 4, left });
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, align]);

  if (actions.length === 0) return <></>;

  const menu =
    open && menuPos
      ? createPortal(
          <div
            ref={menuRef}
            className="tl-menu tl-row-menu__dropdown tl-row-menu__dropdown--fixed"
            style={{ top: menuPos.top, left: menuPos.left }}
            role="menu"
          >
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                className={`tl-menu__item${action.danger ? " tl-menu__item--danger" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  action.onClick();
                }}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div
        className={`tl-row-menu${open ? " tl-row-menu--open" : ""}${align === "left" ? " tl-row-menu--left" : ""}`}
        ref={wrapRef}
      >
        <button
          ref={triggerRef}
          type="button"
          className="tl-row-menu__trigger tl-icon-btn"
          aria-label="Действия"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setOpen((v) => !v);
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
      {menu}
    </>
  );
}
