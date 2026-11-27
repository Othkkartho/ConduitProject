import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { DEFAULT_ENCODING, ENCODING_OPTIONS } from '../constants/encodings';
import { useAppStore } from '../store/useAppStore';
import type { Bookmark, Folder, ProtocolType, SessionConfig } from '../types';

interface FolderOption {
  id: string;
  label: string;
}

function buildFolderOptions(folders: Folder[]): FolderOption[] {
  const byParent = new Map<string | null, Folder[]>();
  for (const f of folders) {
    const key = f.parent_id ?? null;
    const list = byParent.get(key) ?? [];
    list.push(f);
    byParent.set(key, list);
  }

  const out: FolderOption[] = [];
  const visited = new Set<string>();

  const walk = (parentId: string | null, depth: number) => {
    const children = (byParent.get(parentId) ?? []).slice().sort((a, b) =>
      a.sort_order !== b.sort_order
        ? a.sort_order - b.sort_order
        : a.name.localeCompare(b.name)
    );
    for (const f of children) {
      if (visited.has(f.id)) continue;
      visited.add(f.id);
      const prefix = depth > 0 ? `${'  '.repeat(depth)}└ ` : '';
      out.push({ id: f.id, label: `${prefix}${f.name}` });
      walk(f.id, depth + 1);
    }
  };

  walk(null, 0);
  return out;
}

export const QuickConnectModal: React.FC = () => {
  const {
    transport,
    quickConnectOpen,
    editingBookmark,
    quickConnectDefaultFolderId,
    saveFromPaneDraft,
    bookmarkTree,
    closeQuickConnect,
    openSessionTab,
    saveBookmark,
  } = useAppStore();

  const passwordInputRef = useRef<HTMLInputElement | null>(null);

  const [protocol, setProtocol] = useState<ProtocolType>('ssh');
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState<string>('');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('root');
  const [authType, setAuthType] = useState<'password' | 'private_key'>('password');
  const [password, setPassword] = useState('');
  const [keyPath, setKeyPath] = useState('~/.ssh/id_ed25519');
  const [shell, setShell] = useState('');
  const [cwd, setCwd] = useState('');
  const [serialPort, setSerialPort] = useState('');
  const [baudRate, setBaudRate] = useState(115200);
  const [encoding, setEncoding] = useState(DEFAULT_ENCODING);
  const [serialPorts, setSerialPorts] = useState<string[]>([]);
  const [saveToBookmarks, setSaveToBookmarks] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [pendingForceSave, setPendingForceSave] = useState<{
    bm: Bookmark;
    password?: string;
    reason: string;
  } | null>(null);

  const folderOptions = useMemo(
    () => buildFolderOptions(bookmarkTree.folders),
    [bookmarkTree.folders]
  );

  useEffect(() => {
    if (!quickConnectOpen) return;
    setErrorMessage(null);
    setTesting(false);
    setPendingForceSave(null);
    void transport
      .listSerialPorts()
      .then((ports) => {
        setSerialPorts(ports);
        if (ports.length > 0 && !serialPort) setSerialPort(ports[0]);
      })
      .catch(() => setSerialPorts([]));

    if (editingBookmark) {
      setProtocol(editingBookmark.protocol);
      setName(editingBookmark.name);
      setFolderId(editingBookmark.folder_id ?? '');
      setHost(editingBookmark.host ?? '127.0.0.1');
      setPort(
        editingBookmark.port ?? (editingBookmark.protocol === 'telnet' ? 23 : 22)
      );
      setUsername(editingBookmark.username ?? '');
      setAuthType(editingBookmark.auth_type ?? 'password');
      setKeyPath(editingBookmark.key_path ?? '~/.ssh/id_ed25519');
      setShell(editingBookmark.shell ?? '');
      setCwd(editingBookmark.cwd ?? '');
      setSerialPort(editingBookmark.serial_port ?? '');
      setBaudRate(editingBookmark.baud_rate ?? 115200);
      setEncoding(editingBookmark.encoding ?? DEFAULT_ENCODING);
      setPassword('');
      setSaveToBookmarks(true);
    } else if (saveFromPaneDraft) {
      setProtocol(saveFromPaneDraft.protocol);
      setName(saveFromPaneDraft.name);
      setFolderId('');
      setHost(saveFromPaneDraft.host ?? '127.0.0.1');
      setPort(
        saveFromPaneDraft.port ??
          (saveFromPaneDraft.protocol === 'telnet' ? 23 : 22)
      );
      setUsername(saveFromPaneDraft.username ?? '');
      setAuthType('password');
      setKeyPath('~/.ssh/id_ed25519');
      setShell(saveFromPaneDraft.shell ?? '');
      setCwd(saveFromPaneDraft.cwd ?? '');
      setSerialPort(saveFromPaneDraft.serial_port ?? '');
      setBaudRate(saveFromPaneDraft.baud_rate ?? 115200);
      setEncoding(saveFromPaneDraft.encoding ?? DEFAULT_ENCODING);
      setPassword('');
      setSaveToBookmarks(true);
      if (saveFromPaneDraft.protocol === 'ssh') {
        window.setTimeout(() => passwordInputRef.current?.focus(), 30);
      }
    } else {
      setProtocol('ssh');
      setName('');
      setFolderId(quickConnectDefaultFolderId ?? '');
      setHost('127.0.0.1');
      setPort(22);
      setUsername('root');
      setAuthType('password');
      setKeyPath('~/.ssh/id_ed25519');
      setShell('');
      setCwd('');
      setEncoding(DEFAULT_ENCODING);
      setPassword('');
      setSaveToBookmarks(true);
    }
  }, [
    quickConnectOpen,
    editingBookmark,
    saveFromPaneDraft,
    quickConnectDefaultFolderId,
    transport,
  ]);

  useEffect(() => {
    if (!quickConnectOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (pendingForceSave) {
          setPendingForceSave(null);
        } else {
          closeQuickConnect();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [quickConnectOpen, pendingForceSave, closeQuickConnect]);

  if (!quickConnectOpen) return null;

  const buildConfig = (): SessionConfig => {
    const size = { cols: 100, rows: 30 };
    if (protocol === 'local_pty') {
      return {
        protocol: 'local_pty',
        shell: shell.trim() || undefined,
        cwd: cwd.trim() || undefined,
        size,
        encoding,
      };
    }
    if (protocol === 'ssh') {
      return {
        protocol: 'ssh',
        host: host.trim() || '127.0.0.1',
        port: Number(port) || 22,
        username: username.trim() || 'root',
        auth:
          authType === 'password'
            ? { auth_type: 'password', password }
            : {
                auth_type: 'private_key',
                key_path: keyPath.trim(),
                passphrase: password || undefined,
              },
        size,
        encoding,
      };
    }
    if (protocol === 'serial') {
      return {
        protocol: 'serial',
        port_name: serialPort.trim(),
        baud_rate: Number(baudRate) || 115200,
        encoding,
      };
    }
    return {
      protocol: 'telnet',
      host: host.trim(),
      port: Number(port) || 23,
      size,
      encoding,
    };
  };

  const handleSubmit = async (connectNow: boolean) => {
    if (testing) return;
    setErrorMessage(null);

    if ((protocol === 'ssh' || protocol === 'telnet') && !host.trim()) {
      setErrorMessage('호스트(IP 또는 도메인)를 입력해 주세요.');
      return;
    }
    if (protocol === 'serial' && !serialPort.trim()) {
      setErrorMessage('시리얼 포트를 입력해 주세요.');
      return;
    }

    const cfg = buildConfig();
    const displayName = (
      name.trim() ||
      (cfg.protocol === 'local_pty'
        ? cfg.shell || 'Local Shell'
        : cfg.protocol === 'ssh'
          ? `${cfg.username}@${cfg.host}`
          : cfg.protocol === 'serial'
            ? cfg.port_name
            : `${cfg.host}:${cfg.port}`)
    ).trim();

    if (saveToBookmarks) {
      const isDuplicateName = bookmarkTree.bookmarks.some(
        (b) => b.name.trim() === displayName && b.id !== editingBookmark?.id
      );
      if (isDuplicateName) {
        setErrorMessage(
          `이미 "${displayName}" 이름의 세션이 존재합니다. 다른 이름을 입력해 주세요.`
        );
        return;
      }

      const targetFolderId = folderId || null;
      const defaultOrder =
        editingBookmark?.sort_order ??
        bookmarkTree.bookmarks.filter(
          (b) => (b.folder_id ?? null) === targetFolderId
        ).length;
      const bm: Bookmark = {
        id: editingBookmark?.id ?? `bm-${Date.now()}`,
        folder_id: targetFolderId,
        name: displayName,
        protocol,
        host:
          cfg.protocol === 'ssh' || cfg.protocol === 'telnet' ? cfg.host : null,
        port:
          cfg.protocol === 'ssh' || cfg.protocol === 'telnet' ? cfg.port : null,
        username: cfg.protocol === 'ssh' ? cfg.username : null,
        shell: cfg.protocol === 'local_pty' ? cfg.shell ?? null : null,
        cwd: cfg.protocol === 'local_pty' ? cfg.cwd ?? null : null,
        serial_port: cfg.protocol === 'serial' ? cfg.port_name : null,
        baud_rate: cfg.protocol === 'serial' ? cfg.baud_rate : null,
        auth_type: protocol === 'ssh' ? authType : null,
        key_path:
          protocol === 'ssh' && authType === 'private_key'
            ? keyPath.trim()
            : null,
        credential_id: editingBookmark?.credential_id ?? null,
        encoding,
        sort_order: defaultOrder,
        port_forwards: editingBookmark?.port_forwards ?? [],
        notes: editingBookmark?.notes ?? '',
      };

      setTesting(true);
      try {
        await transport.testSessionConnection(cfg, editingBookmark?.id ?? null);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setTesting(false);
        if (!connectNow) {
          setPendingForceSave({
            bm,
            password: password || undefined,
            reason: msg,
          });
          return;
        }
        setErrorMessage(`연결되지 않습니다: ${msg}`);
        return;
      }

      try {
        await saveBookmark(bm, password || undefined);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMessage(msg);
        setTesting(false);
        return;
      }
      setTesting(false);
    }

    if (connectNow) {
      openSessionTab(displayName, cfg);
    }
    closeQuickConnect();
  };

  const handleConfirmForceSave = async () => {
    if (!pendingForceSave) return;
    const target = pendingForceSave;
    setPendingForceSave(null);
    setTesting(true);
    try {
      await saveBookmark(target.bm, target.password);
      setTesting(false);
      closeQuickConnect();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setTesting(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-header">
          <span>
            {editingBookmark
              ? '북마크 편집'
              : saveFromPaneDraft
                ? '현재 세션을 북마크에 저장'
                : '새 연결 / 세션 생성'}
          </span>
          <button
            className="icon-btn"
            onClick={closeQuickConnect}
            title="닫기 (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-grid">
            <div className="form-field">
              <label>프로토콜</label>
              <select
                value={protocol}
                onChange={(e) => {
                  const p = e.target.value as ProtocolType;
                  setProtocol(p);
                  setErrorMessage(null);
                  if (p === 'ssh') setPort(22);
                  if (p === 'telnet') setPort(23);
                }}
              >
                <option value="ssh">SSH / SFTP</option>
                <option value="local_pty">Local PTY (Shell)</option>
                <option value="serial">Serial (COM / ttyUSB)</option>
                <option value="telnet">Telnet</option>
              </select>
            </div>

            <div className="form-field">
              <label>세션 이름</label>
              <input
                type="text"
                placeholder="비우면 user@host 자동 지정"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setErrorMessage(null);
                }}
              />
            </div>

            <div className="form-field">
              <label>저장 폴더</label>
              <select
                value={folderId}
                onChange={(e) => setFolderId(e.target.value)}
              >
                <option value="">(루트)</option>
                {folderOptions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label>인코딩 (Encoding)</label>
              <select
                value={encoding}
                onChange={(e) => setEncoding(e.target.value)}
              >
                {ENCODING_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {(protocol === 'ssh' || protocol === 'telnet') && (
              <>
                <div className="form-field">
                  <label>호스트 (IP / 도메인)</label>
                  <input
                    value={host}
                    onChange={(e) => {
                      setHost(e.target.value);
                      setErrorMessage(null);
                    }}
                  />
                </div>
                <div className="form-field">
                  <label>포트</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => {
                      setPort(Number(e.target.value));
                      setErrorMessage(null);
                    }}
                  />
                </div>
              </>
            )}

            {protocol === 'ssh' && (
              <>
                <div className="form-field">
                  <label>사용자명</label>
                  <input
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setErrorMessage(null);
                    }}
                  />
                </div>
                <div className="form-field">
                  <label>인증 방식</label>
                  <select
                    value={authType}
                    onChange={(e) =>
                      setAuthType(
                        e.target.value as 'password' | 'private_key'
                      )
                    }
                  >
                    <option value="password">비밀번호</option>
                    <option value="private_key">SSH 개인키</option>
                  </select>
                </div>

                {authType === 'private_key' && (
                  <div className="form-field full">
                    <label>개인키 경로</label>
                    <input
                      value={keyPath}
                      onChange={(e) => setKeyPath(e.target.value)}
                    />
                  </div>
                )}

                <div className="form-field full">
                  <label>
                    {authType === 'password'
                      ? saveFromPaneDraft
                        ? '비밀번호 (저장을 위해 비밀번호를 다시 입력해 주세요)'
                        : '비밀번호 (AES-256-GCM 암호화 저장)'
                      : '개인키 Passphrase (선택)'}
                  </label>
                  <input
                    ref={passwordInputRef}
                    type="password"
                    placeholder={
                      editingBookmark?.credential_id
                        ? '변경 시에만 입력'
                        : saveFromPaneDraft
                          ? '비밀번호를 다시 입력하세요'
                          : ''
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleSubmit(!saveFromPaneDraft);
                      }
                    }}
                  />
                </div>
              </>
            )}

            {protocol === 'local_pty' && (
              <>
                <div className="form-field">
                  <label>쉘 실행 경로 (비우면 기본 쉘)</label>
                  <input
                    placeholder="powershell.exe / /bin/zsh"
                    value={shell}
                    onChange={(e) => setShell(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label>시작 디렉토리 (선택)</label>
                  <input
                    placeholder="예: D:\workspace"
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                  />
                </div>
              </>
            )}

            {protocol === 'serial' && (
              <>
                <div className="form-field">
                  <label>시리얼 포트</label>
                  <input
                    list="ptyloom-serial-ports"
                    placeholder="COM3 또는 /dev/ttyUSB0"
                    value={serialPort}
                    onChange={(e) => setSerialPort(e.target.value)}
                  />
                  <datalist id="ptyloom-serial-ports">
                    {serialPorts.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </div>
                <div className="form-field">
                  <label>Baud Rate</label>
                  <input
                    type="number"
                    value={baudRate}
                    onChange={(e) => setBaudRate(Number(e.target.value))}
                  />
                </div>
              </>
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={saveToBookmarks}
              onChange={(e) => {
                setSaveToBookmarks(e.target.checked);
                setErrorMessage(null);
              }}
            />
            <span>세션 북마크에 저장 (저장 전 연결 가능 여부를 확인합니다)</span>
          </label>

          {errorMessage && (
            <div className="modal-error-banner" role="alert">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            className="btn-secondary"
            onClick={closeQuickConnect}
            disabled={testing}
          >
            취소
          </button>
          {saveToBookmarks && (
            <button
              className="btn-secondary"
              disabled={testing}
              onClick={() => void handleSubmit(false)}
            >
              {testing ? '연결 확인 중...' : '저장만 하기'}
            </button>
          )}
          {!saveFromPaneDraft && (
            <button
              className="btn-primary"
              disabled={testing}
              onClick={() => void handleSubmit(true)}
            >
              {testing ? '연결 확인 중...' : '연결'}
            </button>
          )}
        </div>
      </div>

      {pendingForceSave && (
        <div
          className="modal-backdrop"
          style={{ zIndex: 120 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ssh-password-card">
            <div style={{ fontWeight: 600, color: 'var(--broadcast)' }}>
              연결되지 않습니다. 그래도 저장하시겠습니까?
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              세션 <strong>{pendingForceSave.bm.name}</strong> 연결 확인 중 오류가 발생했습니다. 그래도 북마크에 저장하시겠습니까?
            </div>
            <div className="modal-error-banner">{pendingForceSave.reason}</div>
            <div className="ssh-password-footer" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button
                className="btn-secondary"
                onClick={() => setPendingForceSave(null)}
              >
                취소
              </button>
              <button
                className="btn-primary"
                onClick={() => void handleConfirmForceSave()}
              >
                그래도 저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
