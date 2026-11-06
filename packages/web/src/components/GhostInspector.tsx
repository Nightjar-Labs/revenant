import { formatItemDate, safeHref, visibleItems } from '../inspector.js';
import { moduleLabel } from '../labels.js';
import { usePipelineStore } from '../store.js';
import type { NodeResult } from '../types.js';

export interface GhostInspectorViewProps {
  /** Label of the selected node, or null when nothing is selected. */
  nodeLabel: string | null;
  /** Result of the selected node from the last preview, if any. */
  result: NodeResult | undefined;
  /** Failure of the last preview request, if any. */
  previewError: string | null;
}

/** Presentational part of the Ghost Inspector: items table, node error and request error. */
export function GhostInspectorView({ nodeLabel, result, previewError }: GhostInspectorViewProps) {
  const { shown, hidden } = visibleItems(result?.items ?? []);
  const selected = nodeLabel !== null;
  return (
    <section className="pane ghost-inspector" aria-label="Ghost Inspector (Debugger)">
      <h2>
        Ghost Inspector (Debugger)
        {nodeLabel ? ` — ${nodeLabel}` : ''}
      </h2>
      {previewError && (
        <div className="error-banner" role="alert">
          Preview failed: {previewError}
        </div>
      )}
      {!selected && <p className="muted">Select a node to inspect.</p>}
      {selected && !result && (
        <p className="muted">No results for this node yet. Run Preview to see its items.</p>
      )}
      {result?.error && (
        <div className="error-banner" role="alert">
          {result.error.message}
        </div>
      )}
      {result && !result.error && result.items.length === 0 && (
        <p className="muted">This node produced no items.</p>
      )}
      {shown.length > 0 && (
        <>
          <table className="inspector-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Link</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item, index) => {
                const href = safeHref(item.link);
                return (
                  <tr key={`${item.guid}-${String(index)}`}>
                    <td>{item.title}</td>
                    <td>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer noopener">
                          {item.link}
                        </a>
                      ) : (
                        item.link
                      )}
                    </td>
                    <td>{formatItemDate(item.date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hidden > 0 && (
            <p className="muted">
              Showing the first {shown.length} of {shown.length + hidden} items.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** Bottom pane: items after the selected node from the last preview (Req 10.1, 10.4, 10.5). */
export function GhostInspector() {
  const nodeLabel = usePipelineStore((s) => {
    const node = s.nodes.find((n) => n.id === s.selectedNodeId);
    if (!node) return null;
    const module = s.modules.find((m) => m.type === node.data.moduleType);
    return module ? moduleLabel(module) : node.data.moduleType;
  });
  const result = usePipelineStore((s) =>
    s.selectedNodeId ? s.nodeResults[s.selectedNodeId] : undefined,
  );
  const previewError = usePipelineStore((s) => s.previewError);
  return <GhostInspectorView nodeLabel={nodeLabel} result={result} previewError={previewError} />;
}
