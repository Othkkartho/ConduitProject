import React, { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

export const ConfirmDeleteModal: React.FC = () => {
  const { pendingDelete, confirmPendingDelete, cancelPendingDelete } =
    useAppStore();

  useEffect(() => {
    if (!pendingDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelPendingDelete();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        void confirmPendingDelete();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingDelete, confirmPendingDelete, cancelPendingDelete]);

  if (!pendingDelete) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ width: 'min(430px, 100%)' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} style={{ color: 'var(--danger)' }} />
            <span>삭제 확인</span>
          </div>
          <button className="icon-btn" onClick={cancelPendingDelete}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {pendingDelete.kind === 'bookmark' && (
            <p style={{ margin: 0, lineHeight: 1.55 }}>
              <strong>"{pendingDelete.name}"</strong> 북마크를 정말 삭제하시겠습니까?
              저장된 비밀번호·자격 증명도 함께 삭제됩니다.
            </p>
          )}
          {pendingDelete.kind === 'folder' && (
            <>
              <p style={{ margin: 0, lineHeight: 1.55 }}>
                <strong>"{pendingDelete.name}"</strong> 폴더를 정말 삭제하시겠습니까?
              </p>
              {pendingDelete.childCount > 0 && (
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12 }}>
                  폴더 안의 {pendingDelete.childCount}개 항목은 상위 폴더(또는 루트)로
                  이동됩니다.
                </p>
              )}
            </>
          )}
          {pendingDelete.kind === 'sftp' && (
            <p style={{ margin: 0, lineHeight: 1.55 }}>
              원격 {pendingDelete.isDir ? '폴더' : '파일'}{' '}
              <strong>"{pendingDelete.name}"</strong>을(를) 정말 삭제하시겠습니까?
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={cancelPendingDelete}>
            취소
          </button>
          <button
            className="btn-danger"
            onClick={() => void confirmPendingDelete()}
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  );
};
