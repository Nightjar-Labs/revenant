import { DRAG_MIME } from '../graph.js';
import { moduleLabel } from '../labels.js';
import { usePipelineStore } from '../store.js';
import type { ModuleInfo } from '../types.js';

const CATEGORIES: { key: NonNullable<ModuleInfo['category']>; title: string }[] = [
  { key: 'sources', title: 'Sources' },
  { key: 'operators', title: 'Operators' },
  { key: 'output', title: 'Output' },
];

/** Left pane: the module palette, grouped by category (Req 10.1). */
export function Sidebar() {
  const modules = usePipelineStore((s) => s.modules);
  const status = usePipelineStore((s) => s.modulesStatus);
  const error = usePipelineStore((s) => s.modulesError);

  return (
    <aside className="pane sidebar" aria-label="Palette">
      <h2>Palette</h2>
      {status === 'loading' && <p className="muted">Summoning modules…</p>}
      {status === 'error' && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {CATEGORIES.map(({ key, title }) => {
        const group = modules.filter((m) => m.category === key);
        if (group.length === 0) return null;
        return (
          <section key={key}>
            <h3>{title}</h3>
            <ul className="palette-list">
              {group.map((m) => (
                <li
                  key={m.type}
                  className="palette-item"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_MIME, m.type);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                >
                  {moduleLabel(m)}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </aside>
  );
}
