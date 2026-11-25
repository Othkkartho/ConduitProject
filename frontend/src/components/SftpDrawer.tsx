import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Download,
  File as FileIcon,
  Folder,
  FolderPlus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import type { SftpEntry } from '../types';

export const SftpDrawer: React.FC = () => {
  const { transport, getActivePane, requestDeleteSftpEntry } = useAppStore();
  const activePane = getActivePane();

  const [path, setPath] = useState('.');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sshSessionId =
    activePane?.protocol === 'ssh' && activePane.sessionId !== null
      ? activePane.sessionId
      : null;

  const refresh = async (targetPath = path) => {
    if (sshSessionId === null) return;
    setLoading(true);
    setError(null);
    try {
      const list = await transport.sftpListDir(sshSessionId, targetPath);
      setEntries(list);
      setPath(targetPath);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sshSessionId !== null) {
      void refresh('.');
    }
  }, [sshSessionId]);

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || sshSessionId === null) return;
    for (const file of Array.from(files)) {
      const buf = new Uint8Array(await file.arrayBuffer());
      const remotePath =
        path === '.' || !path
          ? file.name
          : `${path.replace(/\/$/, '')}/${file.name}`;
      await transport.sftpUpload(sshSessionId, remotePath, buf);
    }
    await refresh(path);
  };

  const handleDownload = async (entry: SftpEntry) => {
    if (sshSessionId === null) return;
    const data = await transport.sftpDownload(sshSessionId, entry.path);
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const blob = new Blob([copy.buffer]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = entry.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const goParent = () => {
    if (path === '.' || path === '/') return;
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    const next = path.startsWith('/')
      ? `/${parts.join('/')}`
      : parts.join('/') || '.';
    void refresh(next);
  };

  const handleMkdir = async () => {
    if (sshSessionId === null) return;
    const name = window.prompt('생성할 디렉토리 이름:');
    if (!name) return;
    const target = path === '.' ? name : `${path.replace(/\/$/, '')}/${name}`;
    await transport.sftpMkdir(sshSessionId, target);
    await refresh(path);
  };

  return (
    <div
      className={`sftp-drawer ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleUploadFiles(e.dataTransfer.files);
      }}
    >
      <div className="sftp-toolbar">
        {sshSessionId === null ? (
          <span style={{ color: 'var(--text-muted)' }}>
            SSH 세션을 선택하면 SFTP가 자동으로 연결됩니다.
          </span>
        ) : (
          <>
            <button className="icon-btn" onClick={goParent} title="상위 폴더">
              <ArrowUp size={14} />
            </button>
            <input
              style={{ flex: 1 }}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void refresh(path)}
            />
            <button
              className="icon-btn"
              onClick={() => void refresh(path)}
              title="새로고침"
            >
              <RefreshCw size={14} />
            </button>
            <button
              className="icon-btn"
              onClick={() => void handleMkdir()}
              title="새 폴더"
            >
              <FolderPlus size={14} />
            </button>
            <button
              className="icon-btn"
              onClick={() => fileInputRef.current?.click()}
              title="파일 업로드 (또는 드래그 앤 드롭)"
            >
              <Upload size={14} />
              <span>업로드</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => void handleUploadFiles(e.target.files)}
            />
          </>
        )}
      </div>

      {error && (
        <div style={{ padding: '6px 10px', color: 'var(--danger)' }}>{error}</div>
      )}

      {sshSessionId !== null && (
        <div className="sftp-table-wrap">
          <table className="sftp-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>크기</th>
                <th style={{ width: 90 }}>작업</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={3}>불러오는 중...</td>
                </tr>
              )}
              {!loading &&
                entries.map((entry) => (
                  <tr key={entry.path}>
                    <td>
                      <div
                        className="row-main"
                        onDoubleClick={() =>
                          entry.is_dir
                            ? void refresh(entry.path)
                            : void handleDownload(entry)
                        }
                      >
                        {entry.is_dir ? <Folder size={14} /> : <FileIcon size={14} />}
                        <span>{entry.name}</span>
                      </div>
                    </td>
                    <td>{entry.is_dir ? '-' : `${entry.size.toLocaleString()} B`}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {!entry.is_dir && (
                          <button
                            className="icon-btn"
                            onClick={() => void handleDownload(entry)}
                            title="다운로드"
                          >
                            <Download size={13} />
                          </button>
                        )}
                        <button
                          className="icon-btn"
                          onClick={() =>
                            requestDeleteSftpEntry({
                              sessionId: sshSessionId,
                              path: entry.path,
                              name: entry.name,
                              isDir: entry.is_dir,
                              onDone: () => void refresh(path),
                            })
                          }
                          title="삭제"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
