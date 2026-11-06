import { moduleLabel } from '../labels.js';
import { usePipelineStore } from '../store.js';
import { ConfigForm } from './ConfigForm.js';

/** Right pane: configuration form for the selected node, generated from its module's schema. */
export function ConfigPanel() {
  const node = usePipelineStore((s) => s.nodes.find((n) => n.id === s.selectedNodeId));
  const module = usePipelineStore((s) =>
    node ? s.modules.find((m) => m.type === node.data.moduleType) : undefined,
  );
  const updateNodeConfig = usePipelineStore((s) => s.updateNodeConfig);

  return (
    <aside className="pane config-panel" aria-label="Config">
      <h2>Config</h2>
      {!node && <p className="muted">Select a node to configure.</p>}
      {node && !module && (
        <p className="error" role="alert">
          Unknown module: {node.data.moduleType}
        </p>
      )}
      {node && module && (
        <>
          <h3>{moduleLabel(module)}</h3>
          <ConfigForm
            key={node.id}
            schema={module.configSchema}
            config={node.data.config}
            onChange={(path, value) => updateNodeConfig(node.id, path, value)}
          />
        </>
      )}
    </aside>
  );
}
