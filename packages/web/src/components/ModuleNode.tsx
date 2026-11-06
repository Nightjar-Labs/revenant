import { Handle, Position, type NodeProps } from '@xyflow/react';

import type { ModuleFlowNode } from '../graph.js';
import { moduleLabel } from '../labels.js';
import { usePipelineStore } from '../store.js';

/** Canvas node: themed + plain label header with input ports on the left and outputs on the right. */
export function ModuleNode({ id, data, selected }: NodeProps<ModuleFlowNode>) {
  const module = usePipelineStore((s) => s.modules.find((m) => m.type === data.moduleType));
  const title = module ? moduleLabel(module) : `Unknown module: ${data.moduleType}`;
  const error = usePipelineStore((s) => s.nodeResults[id]?.error);
  const inputs = module?.inputPorts ?? [];
  const outputs = module?.outputPorts ?? [];

  return (
    <div
      className={['module-node', selected ? 'selected' : '', error ? 'has-error' : '']
        .filter(Boolean)
        .join(' ')}
    >
      {error && (
        <span
          className="module-node-badge"
          role="img"
          aria-label="Node error"
          title={error.message}
        >
          !
        </span>
      )}
      <div className="module-node-header">{title}</div>
      <div className="module-node-ports">
        <div className="module-node-inputs">
          {inputs.map((port) => (
            <div key={port} className="module-port module-port-in">
              <Handle type="target" position={Position.Left} id={port} />
              <span>{port}</span>
            </div>
          ))}
        </div>
        <div className="module-node-outputs">
          {outputs.map((port) => (
            <div key={port} className="module-port module-port-out">
              <span>{port}</span>
              <Handle type="source" position={Position.Right} id={port} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
