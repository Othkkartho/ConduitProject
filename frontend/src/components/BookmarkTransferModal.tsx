import React, { useEffect, useRef, useState } from 'react';
import { Download, Upload, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import type { BookmarkExportBundle, ImportMode } from '../types';

export const BookmarkTransferModal: React.FC = () => {
  const {
    bookmarkTransferModal,
    openBookmarkTransfer,
    closeBookmarkTransfer,
    exportBookmarksBundle,
    importBookmarksBundle,
  } = useAppStore();

  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [parsedBundle, setParsedBundle] = useState<BookmarkExportBundle | null>(
    null
  );
  const [fileName, setFileName] = useState<string>('');
  const [dragging, setDragging] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!bookmarkTransferModal) return;
    setStatusMsg(null);
    setErrorMsg(null);
    setParsedBundle(null);
    setFileName('');

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeBookmarkTransfer();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bookmarkTransferModal, closeBookmarkTransfer]);

  if (!bookmarkTransferModal) return null;

  const handleExport = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const bundle = await exportBookmarksBundle(includeSecrets);
      const json = JSON.stringify(bundle, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const a = document.createElement('a');
      a.href = url;
      a.download = `ptyloom-bookmarks-${dateStamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg(
        `내보내기 완료: 폴더 ${bundle.folders.length}개, 북마크 ${bundle.bookmarks.length}개`
      );
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleReadFile = async (file: File | undefined) => {
    if (!file) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text) as Partial<BookmarkExportBundle>;
      if (!Array.isArray(data.folders) || !Array.isArray(data.bookmarks)) {
        throw new Error('올바른 Ptyloom 북마크 JSON 형식이 아닙니다.');
      }
      setParsedBundle({
        version: typeof data.version === 'number' ? data.version : 1,
        exported_at:
          typeof data.exported_at === 'string'
            ? data.exported_at
            : new Date().toISOString(),
        folders: data.folders,
        bookmarks: data.bookmarks,
      });
      setFileName(file.name);
    } catch (err: unknown) {
      setParsedBundle(null);
      setFileName('');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleImport = async () => {
    if (!parsedBundle) return;
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await importBookmarksBundle(parsedBundle, importMode);
      setStatusMsg(
        `가져오기 완료: 폴더 ${res.folders_imported}개, 북마크 ${res.bookmarks_imported}개`
      );
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ width: 'min(520px, 100%)' }}>
        <div className="modal-header">
          <span>세션 북마크 가져오기 / 내보내기</span>
          <button
            className="icon-btn"
            onClick={closeBookmarkTransfer}
            title="닫기 (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className={`mode-chip ${
                bookmarkTransferModal === 'export' ? 'active' : ''
              }`}
              onClick={() => openBookmarkTransfer('export')}
            >
              <Download size={13} />
              <span>내보내기 (Export)</span>
            </button>
            <button
              className={`mode-chip ${
                bookmarkTransferModal === 'import' ? 'active' : ''
              }`}
              onClick={() => openBookmarkTransfer('import')}
            >
              <Upload size={13} />
              <span>가져오기 (Import)</span>
            </button>
          </div>

          {bookmarkTransferModal === 'export' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                폴더 구조와 세션 북마크 설정을 JSON 파일로 백업합니다.
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={includeSecrets}
                  onChange={(e) => setIncludeSecrets(e.target.checked)}
                />
                <span>
                  비밀번호 / 패스프레이즈 포함하여 내보내기 (로컬 백업 전용)
                </span>
              </label>
              {includeSecrets && (
                <div className="manual-tip">
                  비밀번호가 평문 JSON으로 포함되므로 파일 보관 및 공유에 주의하세요.
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="form-field">
                <label>가져오기 방식</label>
                <select
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value as ImportMode)}
                >
                  <option value="merge">기존 북마크와 병합 (Merge)</option>
                  <option value="replace">
                    기존 북마크 모두 덮어쓰기 (Replace)
                  </option>
                </select>
              </div>

              <div
                className={`transfer-dropzone ${dragging ? 'dragging' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void handleReadFile(e.dataTransfer.files[0]);
                }}
              >
                <Upload size={18} />
                <div>
                  {parsedBundle
                    ? `${fileName} — 폴더 ${parsedBundle.folders.length}개, 북마크 ${parsedBundle.bookmarks.length}개`
                    : '여기를 클릭하거나 JSON 파일을 드래그하여 놓으세요'}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(e) => void handleReadFile(e.target.files?.[0])}
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <div style={{ color: 'var(--danger)', fontSize: 12 }}>{errorMsg}</div>
          )}
          {statusMsg && (
            <div style={{ color: 'var(--accent)', fontSize: 12 }}>{statusMsg}</div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={closeBookmarkTransfer}>
            닫기
          </button>
          {bookmarkTransferModal === 'export' ? (
            <button
              className="btn-primary"
              onClick={() => void handleExport()}
            >
              JSON 파일 다운로드
            </button>
          ) : (
            <button
              className="btn-primary"
              disabled={!parsedBundle}
              style={{ opacity: parsedBundle ? 1 : 0.5 }}
              onClick={() => void handleImport()}
            >
              가져오기 실행
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
