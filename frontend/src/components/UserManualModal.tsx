import React, { useMemo, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { USER_MANUAL_SECTIONS } from '../manual/manualContent';
import { useAppStore } from '../store/useAppStore';

export const UserManualModal: React.FC = () => {
  const {
    manualOpen,
    manualSectionId,
    setManualOpen,
    setManualSection,
  } = useAppStore();
  const [filter, setFilter] = useState('');

  React.useEffect(() => {
    if (!manualOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setManualOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manualOpen, setManualOpen]);

  const filteredSections = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return USER_MANUAL_SECTIONS;
    return USER_MANUAL_SECTIONS.filter(
      (sec) =>
        sec.title.toLowerCase().includes(q) ||
        sec.summary.toLowerCase().includes(q) ||
        sec.blocks.some(
          (b) =>
            b.heading.toLowerCase().includes(q) ||
            b.body.some((p) => p.toLowerCase().includes(q))
        )
    );
  }, [filter]);

  if (!manualOpen) return null;

  const activeSection =
    filteredSections.find((s) => s.id === manualSectionId) ??
    filteredSections[0] ??
    USER_MANUAL_SECTIONS[0];

  return (
    <div className="modal-backdrop">
      <div className="modal-card wide">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BookOpen size={16} />
            <span>Conduit 사용자 매뉴얼</span>
            <span className="mode-badge">v0.3.0</span>
          </div>
          <button className="icon-btn" onClick={() => setManualOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div className="manual-layout">
          <nav className="manual-nav">
            <input
              type="text"
              placeholder="매뉴얼 검색..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ marginBottom: 8 }}
            />
            {filteredSections.map((sec) => (
              <button
                key={sec.id}
                className={`manual-nav-item ${
                  activeSection.id === sec.id ? 'active' : ''
                }`}
                onClick={() => setManualSection(sec.id)}
              >
                <div style={{ fontSize: 11, opacity: 0.7 }}>{sec.badge}</div>
                <div>{sec.title}</div>
              </button>
            ))}
          </nav>

          <article className="manual-content">
            <h2 style={{ marginTop: 0 }}>{activeSection.title}</h2>
            <p style={{ color: 'var(--text-muted)' }}>{activeSection.summary}</p>

            {activeSection.blocks.map((block) => (
              <section key={block.heading} style={{ marginTop: 18 }}>
                <h3>{block.heading}</h3>
                {block.body.map((paragraph, idx) => (
                  <p key={idx} style={{ margin: '6px 0' }}>
                    {paragraph}
                  </p>
                ))}
                {block.tips?.map((tip, idx) => (
                  <div key={idx} className="manual-tip">
                    <strong>Tip:</strong> {tip}
                  </div>
                ))}
              </section>
            ))}
          </article>
        </div>
      </div>
    </div>
  );
};
