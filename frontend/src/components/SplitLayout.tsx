import React, { useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { SplitNode } from '../types';
import { TerminalPane } from './TerminalPane';

interface SplitLayoutProps {
  tabId: string;
  node: SplitNode;
}

export const SplitLayout: React.FC<SplitLayoutProps> = ({ tabId, node }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const setSplitRatio = useAppStore((s) => s.setSplitRatio);

  if (node.type === 'pane') {
    return <TerminalPane tabId={tabId} pane={node} />;
  }

  const isHorizontal = node.direction === 'horizontal';

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    const onMove = (moveEvent: MouseEvent) => {
      const ratio = isHorizontal
        ? (moveEvent.clientX - rect.left) / rect.width
        : (moveEvent.clientY - rect.top) / rect.height;
      setSplitRatio(tabId, node.id, ratio);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const firstPct = `${(node.ratio * 100).toFixed(2)}%`;
  const secondPct = `${((1 - node.ratio) * 100).toFixed(2)}%`;

  return (
    <div
      ref={containerRef}
      className={`split-container ${node.direction}`}
    >
      <div
        style={{
          flexBasis: firstPct,
          flexGrow: 0,
          flexShrink: 0,
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <SplitLayout tabId={tabId} node={node.first} />
      </div>

      <div
        className={`split-resizer ${node.direction}`}
        onMouseDown={handleMouseDown}
      />

      <div
        style={{
          flexBasis: secondPct,
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <SplitLayout tabId={tabId} node={node.second} />
      </div>
    </div>
  );
};
