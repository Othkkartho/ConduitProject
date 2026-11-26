import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Server,
  Trash2,
  Upload,
} from 'lucide-react';
import { getProtocolBadge, useAppStore } from '../store/useAppStore';
import type {
  Bookmark,
  BookmarkPosition,
  DragPayload,
  Folder,
  FolderPosition,
} from '../types';

interface ContextMenuState {
  x: number;
  y: number;
  folder: Folder | null;
}

type TreeDropHint =
  | { kind: 'folder'; id: string; pos: 'before' | 'inside' | 'after' }
  | { kind: 'bookmark'; id: string; pos: 'before' | 'after' }
  | { kind: 'root' }
  | null;

export const Sidebar: React.FC = () => {
  const {
    bookmarkTree,
    draggingItem,
    saveFolder,
    reorderBookmarkTree,
    requestDeleteFolder,
    requestDeleteBookmark,
    connectBookmark,
    openQuickConnect,
    openBookmarkTransfer,
    setDraggingItem,
  } = useAppStore();

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dropHint, setDropHint] = useState<TreeDropHint>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const folderMap = useMemo(() => {
    const map = new Map<string, Folder>();
    for (const f of bookmarkTree.folders) map.set(f.id, f);
    return map;
  }, [bookmarkTree.folders]);

  const isDescendantFolder = (
    ancestorId: string,
    candidateId: string | null
  ): boolean => {
    let cur = candidateId;
    const seen = new Set<string>();
    while (cur) {
      if (cur === ancestorId) return true;
      if (seen.has(cur)) break;
      seen.add(cur);
      cur = folderMap.get(cur)?.parent_id ?? null;
    }
    return false;
  };

  const filteredBookmarks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bookmarkTree.bookmarks;
    return bookmarkTree.bookmarks.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.host ?? '').toLowerCase().includes(q) ||
        b.protocol.toLowerCase().includes(q)
    );
  }, [bookmarkTree.bookmarks, query]);

  const foldersByParent = useMemo(() => {
    const map = new Map<string | null, Folder[]>();
    for (const f of bookmarkTree.folders) {
      const key = f.parent_id ?? null;
      const arr = map.get(key) ?? [];
      arr.push(f);
      map.set(key, arr);
    }
    map.forEach((arr) =>
      arr.sort((a, b) =>
        a.sort_order !== b.sort_order
          ? a.sort_order - b.sort_order
          : a.name.localeCompare(b.name)
      )
    );
    return map;
  }, [bookmarkTree.folders]);

  const bookmarksByFolder = useMemo(() => {
    const map = new Map<string | null, Bookmark[]>();
    for (const b of filteredBookmarks) {
      const key = b.folder_id ?? null;
      const arr = map.get(key) ?? [];
      arr.push(b);
      map.set(key, arr);
    }
    map.forEach((arr) =>
      arr.sort((a, b) => {
        const diff = (a.sort_order ?? 0) - (b.sort_order ?? 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      })
    );
    return map;
  }, [filteredBookmarks]);

  const isTreeDrag =
    draggingItem?.kind === 'folder' || draggingItem?.kind === 'bookmark';

  const toggleFolder = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddFolder = async (parentId: string | null) => {
    const promptMsg = parentId
      ? '하위 폴더 이름을 입력하세요:'
      : '새 폴더 이름을 입력하세요:';
    const name = window.prompt(promptMsg);
    if (!name || !name.trim()) return;
    const siblingCount = (foldersByParent.get(parentId) ?? []).length;
    await saveFolder({
      id: `fld-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      parent_id: parentId,
      name: name.trim(),
      sort_order: siblingCount,
    });
    if (parentId) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
    }
  };

  const expandFolder = (folderId: string) => {
    setCollapsed((prev) => {
      if (!prev.has(folderId)) return prev;
      const next = new Set(prev);
      next.delete(folderId);
      return next;
    });
  };

  const handleDropOnFolder = async (
    target: Folder,
    pos: 'before' | 'inside' | 'after',
    payload: DragPayload
  ) => {
    if (payload.kind === 'folder') {
      const dragged = payload.folder;
      if (
        dragged.id === target.id ||
        isDescendantFolder(dragged.id, target.id)
      ) {
        return;
      }

      if (pos === 'inside') {
        const siblings = (foldersByParent.get(target.id) ?? []).filter(
          (f) => f.id !== dragged.id
        );
        const folderPositions: FolderPosition[] = [
          ...siblings.map((f, idx) => ({
            id: f.id,
            parent_id: target.id,
            sort_order: idx,
          })),
          { id: dragged.id, parent_id: target.id, sort_order: siblings.length },
        ];
        expandFolder(target.id);
        await reorderBookmarkTree({ folders: folderPositions, bookmarks: [] });
        return;
      }

      const targetParent = target.parent_id ?? null;
      const siblings = (foldersByParent.get(targetParent) ?? []).filter(
        (f) => f.id !== dragged.id
      );
      const targetIdx = siblings.findIndex((f) => f.id === target.id);
      const insertAt =
        targetIdx === -1
          ? siblings.length
          : pos === 'before'
            ? targetIdx
            : targetIdx + 1;
      siblings.splice(insertAt, 0, dragged);
      const folderPositions: FolderPosition[] = siblings.map((f, idx) => ({
        id: f.id,
        parent_id: targetParent,
        sort_order: idx,
      }));
      await reorderBookmarkTree({ folders: folderPositions, bookmarks: [] });
      return;
    }

    if (payload.kind === 'bookmark') {
      const dragged = payload.bookmark;
      const destFolderId =
        pos === 'inside' ? target.id : target.parent_id ?? null;
      const siblings = bookmarkTree.bookmarks
        .filter(
          (b) => (b.folder_id ?? null) === destFolderId && b.id !== dragged.id
        )
        .sort(
          (a, b) =>
            (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
            a.name.localeCompare(b.name)
        );
      const bookmarkPositions: BookmarkPosition[] = [
        ...siblings.map((b, idx) => ({
          id: b.id,
          folder_id: destFolderId,
          sort_order: idx,
        })),
        {
          id: dragged.id,
          folder_id: destFolderId,
          sort_order: siblings.length,
        },
      ];
      if (pos === 'inside') expandFolder(target.id);
      await reorderBookmarkTree({ folders: [], bookmarks: bookmarkPositions });
    }
  };

  const handleDropOnBookmark = async (
    target: Bookmark,
    pos: 'before' | 'after',
    payload: DragPayload
  ) => {
    if (payload.kind === 'bookmark') {
      const dragged = payload.bookmark;
      if (dragged.id === target.id) return;
      const destFolderId = target.folder_id ?? null;
      const siblings = bookmarkTree.bookmarks
        .filter(
          (b) => (b.folder_id ?? null) === destFolderId && b.id !== dragged.id
        )
        .sort(
          (a, b) =>
            (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
            a.name.localeCompare(b.name)
        );
      const targetIdx = siblings.findIndex((b) => b.id === target.id);
      const insertAt =
        targetIdx === -1
          ? siblings.length
          : pos === 'before'
            ? targetIdx
            : targetIdx + 1;
      siblings.splice(insertAt, 0, dragged);
      const bookmarkPositions: BookmarkPosition[] = siblings.map((b, idx) => ({
        id: b.id,
        folder_id: destFolderId,
        sort_order: idx,
      }));
      await reorderBookmarkTree({ folders: [], bookmarks: bookmarkPositions });
      return;
    }

    if (payload.kind === 'folder') {
      const dragged = payload.folder;
      const destParent = target.folder_id ?? null;
      if (destParent && isDescendantFolder(dragged.id, destParent)) return;
      const siblings = (foldersByParent.get(destParent) ?? []).filter(
        (f) => f.id !== dragged.id
      );
      const folderPositions: FolderPosition[] = [
        ...siblings.map((f, idx) => ({
          id: f.id,
          parent_id: destParent,
          sort_order: idx,
        })),
        { id: dragged.id, parent_id: destParent, sort_order: siblings.length },
      ];
      await reorderBookmarkTree({ folders: folderPositions, bookmarks: [] });
    }
  };

  const handleDropOnRoot = async (payload: DragPayload) => {
    if (payload.kind === 'folder') {
      const dragged = payload.folder;
      const siblings = (foldersByParent.get(null) ?? []).filter(
        (f) => f.id !== dragged.id
      );
      const folderPositions: FolderPosition[] = [
        ...siblings.map((f, idx) => ({
          id: f.id,
          parent_id: null,
          sort_order: idx,
        })),
        { id: dragged.id, parent_id: null, sort_order: siblings.length },
      ];
      await reorderBookmarkTree({ folders: folderPositions, bookmarks: [] });
    } else if (payload.kind === 'bookmark') {
      const dragged = payload.bookmark;
      const siblings = bookmarkTree.bookmarks
        .filter((b) => (b.folder_id ?? null) === null && b.id !== dragged.id)
        .sort(
          (a, b) =>
            (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
            a.name.localeCompare(b.name)
        );
      const bookmarkPositions: BookmarkPosition[] = [
        ...siblings.map((b, idx) => ({
          id: b.id,
          folder_id: null,
          sort_order: idx,
        })),
        { id: dragged.id, folder_id: null, sort_order: siblings.length },
      ];
      await reorderBookmarkTree({ folders: [], bookmarks: bookmarkPositions });
    }
  };

  const renderBookmark = (bm: Bookmark) => {
    const hintPos =
      dropHint?.kind === 'bookmark' && dropHint.id === bm.id
        ? dropHint.pos
        : null;

    return (
      <div
        key={bm.id}
        className={`bookmark-row ${
          hintPos ? `tree-drop-${hintPos}` : ''
        }`}
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = 'copyMove';
          e.dataTransfer.setData('text/plain', bm.id);
          setDraggingItem({ kind: 'bookmark', bookmark: bm });
        }}
        onDragEnd={() => {
          setDraggingItem(null);
          setDropHint(null);
        }}
        onDragEnter={(e) => {
          const payload = draggingItem ?? useAppStore.getState().draggingItem;
          if (
            payload?.kind === 'folder' ||
            (payload?.kind === 'bookmark' && payload.bookmark.id !== bm.id)
          ) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onDragOver={(e) => {
          const payload = draggingItem ?? useAppStore.getState().draggingItem;
          if (
            !payload ||
            (payload.kind !== 'folder' && payload.kind !== 'bookmark')
          ) {
            return;
          }
          if (payload.kind === 'bookmark' && payload.bookmark.id === bm.id) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          const rect = e.currentTarget.getBoundingClientRect();
          const pos =
            e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
          setDropHint({ kind: 'bookmark', id: bm.id, pos });
        }}
        onDrop={(e) => {
          const payload = draggingItem ?? useAppStore.getState().draggingItem;
          if (
            !payload ||
            (payload.kind !== 'folder' && payload.kind !== 'bookmark')
          ) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const pos =
            e.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
          setDropHint(null);
          setDraggingItem(null);
          void handleDropOnBookmark(bm, pos, payload);
        }}
      >
        <div
          className="row-main"
          onClick={() => void connectBookmark(bm)}
          title="클릭하여 새 탭 연결 · 드래그하여 위치 이동 또는 창 분할"
        >
          <Server
            size={13}
            style={{ color: 'var(--text-muted)', flexShrink: 0 }}
          />
          <span className="row-label">{bm.name}</span>
          <span className="proto-tag">{getProtocolBadge(bm.protocol)}</span>
        </div>
        <div className="row-actions">
          <button
            className="icon-btn"
            style={{ padding: 3 }}
            onClick={() => openQuickConnect(bm)}
            title="편집"
          >
            <Pencil size={12} />
          </button>
          <button
            className="icon-btn"
            style={{ padding: 3 }}
            onClick={() => requestDeleteBookmark(bm)}
            title="삭제"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    );
  };

  const renderFolder = (
    folder: Folder,
    visited: Set<string>
  ): React.ReactNode => {
    if (visited.has(folder.id)) return null;
    const nextVisited = new Set(visited);
    nextVisited.add(folder.id);

    const isCollapsed = collapsed.has(folder.id);
    const childFolders = foldersByParent.get(folder.id) ?? [];
    const childBookmarks = bookmarksByFolder.get(folder.id) ?? [];
    const hintPos =
      dropHint?.kind === 'folder' && dropHint.id === folder.id
        ? dropHint.pos
        : null;

    return (
      <div key={folder.id} className="folder-block">
        <div
          className={`folder-row ${hintPos ? `tree-drop-${hintPos}` : ''}`}
          draggable
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', folder.id);
            setDraggingItem({ kind: 'folder', folder });
          }}
          onDragEnd={() => {
            setDraggingItem(null);
            setDropHint(null);
          }}
          onDragEnter={(e) => {
            const payload = draggingItem ?? useAppStore.getState().draggingItem;
            if (
              !payload ||
              (payload.kind !== 'folder' && payload.kind !== 'bookmark')
            ) {
              return;
            }
            if (
              payload.kind === 'folder' &&
              (payload.folder.id === folder.id ||
                isDescendantFolder(payload.folder.id, folder.id))
            ) {
              return;
            }
            e.preventDefault();
            e.stopPropagation();
          }}
          onDragOver={(e) => {
            const payload = draggingItem ?? useAppStore.getState().draggingItem;
            if (
              !payload ||
              (payload.kind !== 'folder' && payload.kind !== 'bookmark')
            ) {
              return;
            }
            if (
              payload.kind === 'folder' &&
              (payload.folder.id === folder.id ||
                isDescendantFolder(payload.folder.id, folder.id))
            ) {
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            const rect = e.currentTarget.getBoundingClientRect();
            const ry = (e.clientY - rect.top) / Math.max(1, rect.height);
            const pos =
              payload.kind === 'bookmark'
                ? 'inside'
                : ry < 0.22
                  ? 'before'
                  : ry > 0.78
                    ? 'after'
                    : 'inside';
            setDropHint({ kind: 'folder', id: folder.id, pos });
          }}
          onDrop={(e) => {
            const payload = draggingItem ?? useAppStore.getState().draggingItem;
            if (
              !payload ||
              (payload.kind !== 'folder' && payload.kind !== 'bookmark')
            ) {
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            const ry = (e.clientY - rect.top) / Math.max(1, rect.height);
            const pos =
              payload.kind === 'bookmark'
                ? 'inside'
                : ry < 0.22
                  ? 'before'
                  : ry > 0.78
                    ? 'after'
                    : 'inside';
            setDropHint(null);
            setDraggingItem(null);
            void handleDropOnFolder(folder, pos, payload);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY, folder });
          }}
        >
          <div className="row-main" onClick={() => toggleFolder(folder.id)}>
            {isCollapsed ? (
              <ChevronRight size={13} style={{ flexShrink: 0 }} />
            ) : (
              <ChevronDown size={13} style={{ flexShrink: 0 }} />
            )}
            {isCollapsed ? (
              <FolderIcon
                size={13}
                style={{ color: 'var(--accent)', flexShrink: 0 }}
              />
            ) : (
              <FolderOpen
                size={13}
                style={{ color: 'var(--accent)', flexShrink: 0 }}
              />
            )}
            <span className="row-label folder-name">{folder.name}</span>
          </div>
          <div className="row-actions">
            <button
              className="icon-btn"
              style={{ padding: 3 }}
              onClick={() => void handleAddFolder(folder.id)}
              title="이 폴더에 하위 폴더 추가"
            >
              <FolderPlus size={12} />
            </button>
            <button
              className="icon-btn"
              style={{ padding: 3 }}
              onClick={() => openQuickConnect(null, folder.id)}
              title="이 폴더에 세션 추가"
            >
              <Plus size={12} />
            </button>
            <button
              className="icon-btn"
              style={{ padding: 3 }}
              onClick={() => requestDeleteFolder(folder)}
              title="폴더 삭제"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {!isCollapsed && (
          <div className="tree-children">
            {childFolders.map((cf) => renderFolder(cf, nextVisited))}
            {childBookmarks.map(renderBookmark)}
          </div>
        )}
      </div>
    );
  };

  const rootFolders = foldersByParent.get(null) ?? [];
  const rootBookmarks = bookmarksByFolder.get(null) ?? [];

  return (
    <div className="sidebar-view">
      <div className="sidebar-header">
        <span>세션 북마크</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            className="icon-btn"
            style={{ padding: 4 }}
            onClick={() => openBookmarkTransfer('export')}
            title="북마크 내보내기 (Export)"
          >
            <Download size={13} />
          </button>
          <button
            className="icon-btn"
            style={{ padding: 4 }}
            onClick={() => openBookmarkTransfer('import')}
            title="북마크 가져오기 (Import)"
          >
            <Upload size={13} />
          </button>
          <button
            className="icon-btn"
            style={{ padding: 4 }}
            onClick={() => void handleAddFolder(null)}
            title="루트에 폴더 추가"
          >
            <FolderPlus size={14} />
          </button>
          <button
            className="icon-btn"
            style={{ padding: 4 }}
            onClick={() => openQuickConnect(null, null)}
            title="새 북마크 / 연결"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="sidebar-search">
        <input
          type="text"
          placeholder="호스트, 이름 검색..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div
        className={`sidebar-tree ${
          dropHint?.kind === 'root' ? 'tree-drop-root' : ''
        }`}
        onDragEnter={(e) => {
          if (isTreeDrag) e.preventDefault();
        }}
        onDragOver={(e) => {
          if (!isTreeDrag) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropHint({ kind: 'root' });
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDropHint(null);
          }
        }}
        onDrop={(e) => {
          const payload = draggingItem ?? useAppStore.getState().draggingItem;
          if (
            !payload ||
            (payload.kind !== 'folder' && payload.kind !== 'bookmark')
          ) {
            return;
          }
          e.preventDefault();
          setDropHint(null);
          setDraggingItem(null);
          void handleDropOnRoot(payload);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, folder: null });
        }}
      >
        {rootFolders.map((f) => renderFolder(f, new Set()))}
        {rootBookmarks.map(renderBookmark)}

        {bookmarkTree.folders.length === 0 && filteredBookmarks.length === 0 && (
          <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>
            저장된 북마크가 없습니다. 상단 버튼이나 빈 공간 우클릭으로 폴더·세션을 추가하세요.
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.folder ? (
            <>
              <div className="context-menu-title">
                폴더: {contextMenu.folder.name}
              </div>
              <button
                className="context-menu-item"
                onClick={() => {
                  const targetId = contextMenu.folder!.id;
                  setContextMenu(null);
                  void handleAddFolder(targetId);
                }}
              >
                <FolderPlus size={13} />
                <span>하위 폴더 추가</span>
              </button>
              <button
                className="context-menu-item"
                onClick={() => {
                  const targetId = contextMenu.folder!.id;
                  setContextMenu(null);
                  openQuickConnect(null, targetId);
                }}
              >
                <Plus size={13} />
                <span>이 폴더에 세션 추가</span>
              </button>
              <button
                className="context-menu-item danger"
                onClick={() => {
                  const targetFolder = contextMenu.folder!;
                  setContextMenu(null);
                  requestDeleteFolder(targetFolder);
                }}
              >
                <Trash2 size={13} />
                <span>폴더 삭제</span>
              </button>
            </>
          ) : (
            <>
              <div className="context-menu-title">루트 (Root)</div>
              <button
                className="context-menu-item"
                onClick={() => {
                  setContextMenu(null);
                  void handleAddFolder(null);
                }}
              >
                <FolderPlus size={13} />
                <span>루트에 폴더 추가</span>
              </button>
              <button
                className="context-menu-item"
                onClick={() => {
                  setContextMenu(null);
                  openQuickConnect(null, null);
                }}
              >
                <Plus size={13} />
                <span>루트에 세션 추가</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
