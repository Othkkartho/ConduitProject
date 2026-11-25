import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { parseSshTarget } from '../utils/sshParser';

export const SshPasswordModal: React.FC = () => {
  const {
    quickSshModal,
    rememberedSshPasswords,
    openQuickSshModal,
    proceedQuickSshToPassword,
    closeQuickSshModal,
    submitSshPassword,
  } = useAppStore();

  const [address, setAddress] = useState('');
  const [addressError, setAddressError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);

  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!quickSshModal) return;
    if (quickSshModal.step === 'address') {
      setAddress('');
      setAddressError(null);
      window.setTimeout(() => addressInputRef.current?.focus(), 20);
    } else {
      const t = quickSshModal.target;
      const key = `${t.username}@${t.host}:${t.port}`;
      const saved = rememberedSshPasswords[key] ?? '';
      setPassword(saved);
      setRemember(Boolean(saved));
      window.setTimeout(() => passwordInputRef.current?.focus(), 20);
    }
  }, [quickSshModal, rememberedSshPasswords]);

  useEffect(() => {
    if (!quickSshModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeQuickSshModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [quickSshModal, closeQuickSshModal]);

  if (!quickSshModal) return null;

  if (quickSshModal.step === 'address') {
    const handleAddressSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      const parsed = parseSshTarget(address);
      if (!parsed?.host) {
        setAddressError('예: test@192.128.0.1 또는 test@192.128.0.1:2222 형식으로 입력하세요.');
        return;
      }
      setAddressError(null);
      proceedQuickSshToPassword({
        username: parsed.username ?? 'root',
        host: parsed.host,
        port: parsed.port ?? 22,
      });
    };

    return (
      <div className="modal-backdrop">
        <form className="ssh-password-card" onSubmit={handleAddressSubmit}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            간편 SSH 연결
          </div>
          <input
            ref={addressInputRef}
            type="text"
            className="ssh-password-input"
            placeholder="test@192.128.0.1 또는 test@192.128.0.1:2222"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              if (addressError) setAddressError(null);
            }}
          />
          {addressError && (
            <div style={{ color: 'var(--danger)', fontSize: 12 }}>
              {addressError}
            </div>
          )}
          <div className="ssh-password-footer">
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              북마크 저장 없이 즉시 연결
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={closeQuickSshModal}
              >
                취소
              </button>
              <button type="submit" className="btn-primary">
                다음
              </button>
            </div>
          </div>
        </form>
      </div>
    );
  }

  const target = quickSshModal.target;
  const targetLabel =
    target.port === 22
      ? `${target.username}@${target.host}`
      : `${target.username}@${target.host}:${target.port}`;

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitSshPassword(password, remember);
  };

  return (
    <div className="modal-backdrop">
      <form className="ssh-password-card" onSubmit={handlePasswordSubmit}>
        <input
          ref={passwordInputRef}
          type="password"
          className="ssh-password-input"
          placeholder={`Password for ${targetLabel}`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="ssh-password-footer">
          <label className="ssh-remember-label">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Remember</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={openQuickSshModal}
            >
              뒤로
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={closeQuickSshModal}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              OK
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
