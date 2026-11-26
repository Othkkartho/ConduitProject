import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { THEME_PRESETS } from '../themes/presets';
import type { AppSettings } from '../types';

const FONT_PRESETS = [
  '"JetBrainsMono Nerd Font", "Cascadia Code", monospace',
  '"FiraCode Nerd Font", "Fira Code", monospace',
  '"MesloLGS NF", "Consolas", monospace',
  '"Cascadia Code", "Consolas", monospace',
];

export const SettingsModal: React.FC = () => {
  const {
    settingsOpen,
    setSettingsOpen,
    settings,
    masterPasswordEnabled,
    updateSettings,
    setMasterPassword,
    disableMasterPassword,
    resetSavedSessions,
  } = useAppStore();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetDoneMessage, setResetDoneMessage] = useState<string | null>(null);

  const [mpMode, setMpMode] = useState<'idle' | 'enable' | 'change' | 'disable'>('idle');
  const [mpCurrent, setMpCurrent] = useState('');
  const [mpNew, setMpNew] = useState('');
  const [mpConfirm, setMpConfirm] = useState('');
  const [mpBusy, setMpBusy] = useState(false);
  const [mpError, setMpError] = useState<string | null>(null);
  const [mpStatusMessage, setMpStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (settingsOpen) {
      setDraft(settings);
      setResetModalOpen(false);
      setResetConfirmText('');
      setResetDoneMessage(null);
      setMpMode('idle');
      setMpCurrent('');
      setMpNew('');
      setMpConfirm('');
      setMpError(null);
      setMpStatusMessage(null);
    }
  }, [settingsOpen, settings]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (resetModalOpen) {
          setResetModalOpen(false);
          setResetConfirmText('');
        } else {
          setSettingsOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, resetModalOpen, setSettingsOpen]);

  if (!settingsOpen) return null;

  const canConfirmReset = resetConfirmText.trim() === '초기화' && !resetting;

  const handleConfirmReset = async () => {
    if (!canConfirmReset) return;
    setResetting(true);
    try {
      await resetSavedSessions();
      setResetModalOpen(false);
      setResetConfirmText('');
      setResetDoneMessage('저장된 모든 세션(폴더/북마크/자격 증명)이 초기화되었습니다.');
    } finally {
      setResetting(false);
    }
  };

  const closeMpForm = () => {
    setMpMode('idle');
    setMpCurrent('');
    setMpNew('');
    setMpConfirm('');
    setMpError(null);
  };

  const handleSaveMasterPassword = async () => {
    setMpError(null);
    setMpStatusMessage(null);
    if (!mpNew) {
      setMpError('새 마스터 패스워드를 입력해 주세요.');
      return;
    }
    if (mpNew !== mpConfirm) {
      setMpError('새 마스터 패스워드가 서로 일치하지 않습니다.');
      return;
    }
    setMpBusy(true);
    try {
      await setMasterPassword(mpNew, mpMode === 'change' ? mpCurrent : null);
      closeMpForm();
      setMpStatusMessage(
        mpMode === 'change'
          ? '마스터 패스워드가 변경되었습니다.'
          : '마스터 패스워드가 활성화되었습니다. 다음 실행부터 잠금 화면이 표시됩니다.'
      );
    } catch (err: unknown) {
      setMpError(err instanceof Error ? err.message : String(err));
    } finally {
      setMpBusy(false);
    }
  };

  const handleDisableMasterPassword = async () => {
    setMpError(null);
    setMpStatusMessage(null);
    if (!mpCurrent) {
      setMpError('현재 마스터 패스워드를 입력해 주세요.');
      return;
    }
    setMpBusy(true);
    try {
      await disableMasterPassword(mpCurrent);
      closeMpForm();
      setMpStatusMessage('마스터 패스워드 잠금이 해제되었습니다.');
    } catch (err: unknown) {
      setMpError(err instanceof Error ? err.message : String(err));
    } finally {
      setMpBusy(false);
    }
  };

  const saveAndClose = async () => {
    await updateSettings(draft);
    setSettingsOpen(false);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-header">
          <span>터미널 커스터마이징 설정</span>
          <button className="icon-btn" onClick={() => setSettingsOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-field">
            <label>컬러 스킴 (Color Scheme)</label>
            <div className="theme-grid">
              {THEME_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={`theme-card ${draft.theme === preset.id ? 'active' : ''}`}
                  onClick={() => {
                    const next = { ...draft, theme: preset.id };
                    setDraft(next);
                    void updateSettings(next);
                  }}
                >
                  <strong>{preset.name}</strong>
                  <div className="swatch-row">
                    <span className="swatch-dot" style={{ background: preset.ui.bgElevated }} />
                    <span className="swatch-dot" style={{ background: preset.ui.accent }} />
                    <span className="swatch-dot" style={{ background: preset.xterm.green }} />
                    <span className="swatch-dot" style={{ background: preset.ui.broadcast }} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="form-grid">
            <div className="form-field full">
              <label>폰트 패밀리 (Nerd Fonts 및 합자 지원)</label>
              <input
                list="conduit-font-presets"
                value={draft.font_family}
                onChange={(e) => setDraft({ ...draft, font_family: e.target.value })}
              />
              <datalist id="conduit-font-presets">
                {FONT_PRESETS.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>

            <div className="form-field">
              <label>폰트 크기 ({draft.font_size}px)</label>
              <input
                type="range"
                min={10}
                max={24}
                value={draft.font_size}
                onChange={(e) => setDraft({ ...draft, font_size: Number(e.target.value) })}
              />
            </div>

            <div className="form-field">
              <label>커서 스타일</label>
              <select
                value={draft.cursor_style}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    cursor_style: e.target.value as AppSettings['cursor_style'],
                  })
                }
              >
                <option value="block">Block</option>
                <option value="underline">Underline</option>
                <option value="bar">Bar</option>
              </select>
            </div>

            <div className="form-field">
              <label>스크롤백 버퍼 (Lines)</label>
              <input
                type="number"
                min={500}
                max={100000}
                step={500}
                value={draft.scrollback}
                onChange={(e) => setDraft({ ...draft, scrollback: Number(e.target.value) })}
              />
            </div>

            <div className="form-field">
              <label>세션 종료 시 동작</label>
              <select
                value={draft.confirm_on_close ? 'ask' : 'immediate'}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    confirm_on_close: e.target.value === 'ask',
                  })
                }
              >
                <option value="immediate">바로 닫기</option>
                <option value="ask">종료 전 한 번 물어보기</option>
              </select>
            </div>

            <div className="form-field full" style={{ justifyContent: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={draft.ligatures}
                  onChange={(e) => setDraft({ ...draft, ligatures: e.target.checked })}
                />
                <span>폰트 합자(Ligatures) 사용</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={draft.cursor_blink}
                  onChange={(e) => setDraft({ ...draft, cursor_blink: e.target.checked })}
                />
                <span>커서 깜빡임</span>
              </label>
            </div>
          </div>

          <div className="master-pw-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={masterPasswordEnabled}
                  onChange={(e) => {
                    setMpStatusMessage(null);
                    setMpError(null);
                    if (e.target.checked) {
                      setMpMode('enable');
                    } else if (masterPasswordEnabled) {
                      setMpMode('disable');
                    } else {
                      closeMpForm();
                    }
                  }}
                />
                <strong>마스터 패스워드 사용 (프로그램 실행 시 입력 요구)</strong>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className={`status-pill ${masterPasswordEnabled ? 'on' : ''}`}>
                  {masterPasswordEnabled ? '활성화됨' : '비활성화 (기본값)'}
                </span>
                {masterPasswordEnabled && mpMode === 'idle' && (
                  <button
                    className="btn-secondary"
                    style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => {
                      setMpStatusMessage(null);
                      setMpError(null);
                      setMpMode('change');
                    }}
                  >
                    패스워드 변경
                  </button>
                )}
              </div>
            </div>

            {mpStatusMessage && (
              <span style={{ fontSize: 12, color: 'var(--accent)' }}>
                {mpStatusMessage}
              </span>
            )}

            {(mpMode === 'enable' || mpMode === 'change') && (
              <div className="form-grid" style={{ marginTop: 4 }}>
                {mpMode === 'change' && (
                  <div className="form-field full">
                    <label>현재 마스터 패스워드</label>
                    <input
                      type="password"
                      value={mpCurrent}
                      onChange={(e) => setMpCurrent(e.target.value)}
                    />
                  </div>
                )}
                <div className="form-field">
                  <label>새 마스터 패스워드</label>
                  <input
                    type="password"
                    value={mpNew}
                    onChange={(e) => setMpNew(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label>새 마스터 패스워드 확인</label>
                  <input
                    type="password"
                    value={mpConfirm}
                    onChange={(e) => setMpConfirm(e.target.value)}
                  />
                </div>
                {mpError && (
                  <div className="form-field full">
                    <div className="modal-error-banner">{mpError}</div>
                  </div>
                )}
                <div className="form-field full" style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                  <button className="btn-secondary" disabled={mpBusy} onClick={closeMpForm}>
                    취소
                  </button>
                  <button className="btn-primary" disabled={mpBusy} onClick={() => void handleSaveMasterPassword()}>
                    {mpBusy ? '저장 중...' : '마스터 패스워드 적용'}
                  </button>
                </div>
              </div>
            )}

            {mpMode === 'disable' && (
              <div className="form-grid" style={{ marginTop: 4 }}>
                <div className="form-field full">
                  <label>해제를 위해 현재 마스터 패스워드를 입력하세요</label>
                  <input
                    type="password"
                    value={mpCurrent}
                    onChange={(e) => setMpCurrent(e.target.value)}
                  />
                </div>
                {mpError && (
                  <div className="form-field full">
                    <div className="modal-error-banner">{mpError}</div>
                  </div>
                )}
                <div className="form-field full" style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                  <button className="btn-secondary" disabled={mpBusy} onClick={closeMpForm}>
                    취소
                  </button>
                  <button className="btn-danger" disabled={mpBusy} onClick={() => void handleDisableMasterPassword()}>
                    {mpBusy ? '처리 중...' : '잠금 해제(비활성화)'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="danger-zone-card">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong style={{ color: 'var(--danger)' }}>
                저장된 세션 초기화
              </strong>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                SQLite에 저장된 모든 세션 북마크, 폴더 구조 및 암호화된 자격 증명을 삭제합니다.
              </span>
              {resetDoneMessage && (
                <span style={{ fontSize: 12, color: 'var(--accent)' }}>
                  {resetDoneMessage}
                </span>
              )}
            </div>
            <button
              className="btn-danger"
              style={{ flexShrink: 0 }}
              onClick={() => {
                setResetConfirmText('');
                setResetModalOpen(true);
              }}
            >
              세션 초기화
            </button>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={() => setSettingsOpen(false)}>
            닫기
          </button>
          <button className="btn-primary" onClick={() => void saveAndClose()}>
            저장 및 적용
          </button>
        </div>
      </div>

      {resetModalOpen && (
        <div
          className="modal-backdrop"
          style={{ zIndex: 120 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ssh-password-card">
            <div style={{ fontWeight: 600, color: 'var(--danger)' }}>
              저장된 세션을 정말 초기화하시겠습니까?
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              모든 세션 북마크, 폴더 및 저장된 비밀번호가 영구 삭제됩니다. 계속하려면 아래 입력창에 <strong>초기화</strong>를 입력한 뒤 확인을 누르세요.
            </div>
            <input
              type="text"
              className="ssh-password-input"
              placeholder="초기화"
              autoFocus
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canConfirmReset) {
                  e.preventDefault();
                  void handleConfirmReset();
                }
              }}
            />
            <div className="ssh-password-footer" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button
                className="btn-secondary"
                disabled={resetting}
                onClick={() => {
                  setResetModalOpen(false);
                  setResetConfirmText('');
                }}
              >
                취소
              </button>
              <button
                className="btn-danger"
                disabled={!canConfirmReset}
                onClick={() => void handleConfirmReset()}
              >
                {resetting ? '초기화 중...' : '확인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
