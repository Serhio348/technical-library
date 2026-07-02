import { FolderOpen, Pencil, Trash2 } from "lucide-react";
import type { FolderTreeNode } from "../types";
import { ItemActionsMenu } from "./ItemActionsMenu";

export function SidebarFolderTree({
  nodes,
  currentPath,
  depth = 0,
  onNavigate,
  onRenameFolder,
  onDeleteFolder,
}: {
  nodes: FolderTreeNode[];
  currentPath: string;
  depth?: number;
  onNavigate: (path: string) => void;
  onRenameFolder: (path: string, name: string) => void;
  onDeleteFolder: (path: string, name: string) => void;
}): React.ReactElement | null {
  if (nodes.length === 0) return null;

  return (
    <>
      {nodes.map((node) => {
        const isActive = currentPath === node.path;
        const isAncestor = !isActive && currentPath.startsWith(`${node.path}/`);
        return (
          <div key={node.path} className="tl-sidebar-tree__branch">
            <div
              className={`tl-sidebar__folder${isActive ? " tl-sidebar__folder--active" : ""}${isAncestor ? " tl-sidebar__folder--ancestor" : ""}`}
              style={{ paddingLeft: `${0.35 + depth * 0.75}rem` }}
            >
              <button type="button" className="tl-nav-item" onClick={() => onNavigate(node.path)}>
                <FolderOpen size={15} />
                <span className="tl-nav-item__label">{node.name}</span>
              </button>
              <ItemActionsMenu
                actions={[
                  {
                    id: "rename",
                    label: "Переименовать",
                    icon: <Pencil size={15} />,
                    onClick: () => onRenameFolder(node.path, node.name),
                  },
                  {
                    id: "delete",
                    label: "Удалить папку",
                    icon: <Trash2 size={15} />,
                    danger: true,
                    onClick: () => void onDeleteFolder(node.path, node.name),
                  },
                ]}
              />
            </div>
            {node.children.length > 0 ? (
              <SidebarFolderTree
                nodes={node.children}
                currentPath={currentPath}
                depth={depth + 1}
                onNavigate={onNavigate}
                onRenameFolder={onRenameFolder}
                onDeleteFolder={onDeleteFolder}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}
