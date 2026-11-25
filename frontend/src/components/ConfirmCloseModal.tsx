import React, { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

export const ConfirmCloseModal: React.FC = () => {
  const { pendingClose, confirmPendingClose, cancelPendingClose } =
    useAppStore();

  useEffect(() => {
    if (!pendingClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelPendingClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        confirmPendingClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingClose, confirmPendingClose, cancelPendingClose]);

  if (!pendingClose) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ width: 'min(420px, 100%)' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={16} style={{ color: 'var(--danger)' }} />
            <span>세션 종료 확인</span>
          </div>
          <button className="icon-btn" onClick={cancelPendingClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            {pendingClose.kind === 'tab'
              ? `"${pendingClose.title}" 탭(${pendingClose.paneCount}개 패인)의 연결을 종료하시겠습니까?`
              : `"${pendingClose.title}" 세션을 종료하시겠습니까?`}
          </p>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={cancelPendingClose}>
            취소
          </button>
          <button className="btn-danger" onClick={confirmPendingClose}>
            종료
          </button>
        </div>
      </div>
    </div>
  );
};
