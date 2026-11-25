import React, { useMemo, useState } from 'react';
import { CornerDownLeft, OctagonX, Radio } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import type { BroadcastMode } from '../types';

export const BroadcastDrawer: React.FC = () => {
  const {
    tabs,
    activeTabId,
    activePaneId,
    broadcastMode,
    setBroadcastMode,
    getAllConnectedPanes,
    getVisibleConnectedPanes,
    getBroadcastTargetIds,
    getActivePane,
    sendBroadcastInput,
    sendBroadcastCtrlC,
  } = useAppStore();

  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const allPanes = useMemo(
    () => getAllConnectedPanes(),
    [tabs, getAllConnectedPanes]
  );
  const visiblePanes = useMemo(
    () => getVisibleConnectedPanes(),
    [tabs, activeTabId, getVisibleConnectedPanes]
  );
  const activePane = useMemo(
    () => getActivePane(),
    [tabs, activeTabId, activePaneId, getActivePane]
  );
  const targetIds = useMemo(
    () => getBroadcastTargetIds(),
    [tabs, activeTabId, activePaneId, broadcastMode, getBroadcastTargetIds]
  );

  const handleSend = async () => {
    const count = await sendBroadcastInput(command, true);
    if (count === 0) {
      setStatusNotice('전송할 대상 세션이 없습니다.');
      return;
    }
    if (command.trim()) {
      setHistory((prev) => [command, ...prev.slice(0, 49)]);
    }
    setHistIdx(-1);
    setCommand('');
    setStatusNotice(`${count}개 세션에 전송됨`);
  };

  const handleCtrlC = async () => {
    const count = await sendBroadcastCtrlC();
    setStatusNotice(
      count > 0
        ? `${count}개 세션에 Ctrl+C 전송됨`
        : '전송할 대상 세션이 없습니다.'
    );
  };

  const modes: Array<{ id: BroadcastMode; label: string; count: number }> = [
    { id: 'all', label: '전체 세션 Broadcast', count: allPanes.length },
    { id: 'visible', label: '현재 화면 세션만 Broadcast', count: visiblePanes.length },
    {
      id: 'selected',
      label: '선택된 세션만 실행',
      count: activePane?.sessionId !== null && activePane?.sessionId !== undefined ? 1 : 0,
    },
  ];

  return (
    <div className="broadcast-panel">
      <div className="broadcast-modes">
        <div className="broadcast-mode-group">
          {modes.map((m) => (
            <button
              key={m.id}
              className={`mode-chip ${broadcastMode === m.id ? 'active' : ''}`}
              onClick={() => setBroadcastMode(m.id)}
            >
              <Radio size={12} />
              <span>{m.label}</span>
              <span className="chip-count">{m.count}</span>
            </button>
          ))}
        </div>

        <div className="broadcast-meta">
          <span className="target-badge">
            {broadcastMode === 'selected'
              ? `현재 포커스: ${activePane ? activePane.title : '없음'}`
              : `전송 대상: ${targetIds.length}개`}
          </span>
          {statusNotice && (
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {statusNotice}
            </span>
          )}
        </div>
      </div>

      <div className="broadcast-input-row">
        <textarea
          className="broadcast-textarea"
          placeholder="여기에 명령어를 입력하고 Enter를 누르면 선택한 방식대로 전송됩니다 (Shift+Enter: 줄바꿈, ↑/↓: 히스토리)"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            } else if (e.key === 'ArrowUp' && !e.shiftKey && command === '') {
              if (history.length > 0) {
                const next = Math.min(history.length - 1, histIdx + 1);
                setHistIdx(next);
                setCommand(history[next]);
              }
            } else if (e.key === 'ArrowDown' && histIdx >= 0) {
              const next = histIdx - 1;
              setHistIdx(next);
              setCommand(next >= 0 ? history[next] : '');
            }
          }}
        />
        <div className="broadcast-actions">
          <button
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            onClick={() => void handleSend()}
          >
            <CornerDownLeft size={14} />
            <span>전송</span>
          </button>
          <button
            className="btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}
            onClick={() => void handleCtrlC()}
            title="대상 세션들에 Ctrl+C 인터럽트 전송"
          >
            <OctagonX size={14} />
            <span>Ctrl+C</span>
          </button>
        </div>
      </div>
    </div>
  );
};
