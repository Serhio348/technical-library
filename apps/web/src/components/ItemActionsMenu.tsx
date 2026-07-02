import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type ItemMenuAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export function ItemActionsMenu({
  actions,
  align = "right",
}: {
  actions: ItemMenuAction[];
  align?: "left" | "right";
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (actions.length === 0) return <></>;

  return (
    <div
      className={`tl-row-menu${open ? " tl-row-menu--open" : ""}${align === "left" ? " tl-row-menu--left" : ""}`}
      ref={ref}
    >
      <button
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
      {open ? (
        <div className="tl-menu tl-row-menu__dropdown" role="menu">
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
        </div>
      ) : null}
    </div>
  );
}
