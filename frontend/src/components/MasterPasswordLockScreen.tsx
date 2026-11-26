import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

export const MasterPasswordLockScreen: React.FC = () => {
  const { unlockWithMasterPassword } = useAppStore();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const ok = await unlockWithMasterPassword(password);
      if (!ok) {
        setError('마스터 패스워드가 올바르지 않습니다.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="lock-screen">
      <form className="lock-card" onSubmit={(e) => void handleUnlock(e)}>
        <div className="lock-header">
          <div className="lock-icon-badge">
            <Lock size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Conduit 잠금</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              프로그램을 사용하려면 마스터 패스워드를 입력해 주세요.
            </div>
          </div>
        </div>

        <input
          type="password"
          className="ssh-password-input"
          placeholder="마스터 패스워드 입력"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
        />

        {error && (
          <div className="modal-error-banner" role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="btn-primary"
          disabled={!password || submitting}
          style={{ width: '100%', padding: '9px 14px' }}
        >
          {submitting ? '확인 중...' : '잠금 해제'}
        </button>
      </form>
    </div>
  );
};
