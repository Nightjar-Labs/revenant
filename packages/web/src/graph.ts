import type { Edge, Node } from '@xyflow/react';

import type { ModuleInfo, PipelineDocument, PipelinePayload } from './types.js';

/** Data carried by every canvas node. The module's labels and ports are looked up from the registry. */
export interface ModuleNodeData extends Record<string, unknown> {
  moduleType: string;
  config: Record<string, unknown>;
}

export type ModuleFlowNode = Node<ModuleNodeData, 'module'>;

/** MIME type used to carry the dragged module type from the palette to the canvas. */
export const DRAG_MIME = 'application/x-revenant-module';

export const INCOMPATIBLE_PORTS_MESSAGE = 'Incompatible port types';

/**
 * Value type of a declared port, or `undefined` if the module has no such port. The module
 * registry does not expose port types and every engine port carries an item list, so each
 * declared port is `items`. Keeping the lookup in one place lets the connection check handle
 * other types (e.g. `string`) if modules start declaring them.
 */
export function portType(
  module: ModuleInfo,
  direction: 'in' | 'out',
  port: string,
): string | undefined {
  const ports = direction === 'in' ? module.inputPorts : module.outputPorts;
  return ports.includes(port) ? 'items' : undefined;
}

/** Builds the default config for a new node from the `default` keywords of its JSON Schema. */
export function defaultConfig(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema['properties'];
  if (typeof properties !== 'object' || properties === null) return {};
  const config: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(properties)) {
    if (typeof property === 'object' && property !== null && 'default' in property) {
      config[key] = structuredClone((property as { default: unknown }).default);
    }
  }
  return config;
}

/** Generates a unique node id such as `node-<uuid>`. Works outside secure contexts too. */
export function generateNodeId(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return `node-${c.randomUUID()}`;
  const bytes = c.getRandomValues(new Uint8Array(16));
  return `node-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export function createModuleNode(
  module: ModuleInfo,
  position: { x: number; y: number },
  id: string = generateNodeId(),
): ModuleFlowNode {
  return {
    id,
    type: 'module',
    position,
    selected: true,
    data: { moduleType: module.type, config: defaultConfig(module.configSchema) },
  };
}

export interface ConnectionEnds {
  source: string | null;
  sourceHandle?: string | null;
  target: string | null;
  targetHandle?: string | null;
}

/**
 * Returns true when an output port may be wired to an input port: both nodes and ports exist,
 * the nodes differ, and the port types match (Req 10.3).
 */
export function canConnect(
  connection: ConnectionEnds,
  nodes: readonly ModuleFlowNode[],
  modules: readonly ModuleInfo[],
): boolean {
  const { source, target, sourceHandle, targetHandle } = connection;
  if (!source || !target || !sourceHandle || !targetHandle || source === target) return false;

  const sourceModule = moduleOfNode(nodes, modules, source);
  const targetModule = moduleOfNode(nodes, modules, target);
  if (!sourceModule || !targetModule) return false;

  const sourceType = portType(sourceModule, 'out', sourceHandle);
  const targetType = portType(targetModule, 'in', targetHandle);
  return sourceType !== undefined && sourceType === targetType;
}

function moduleOfNode(
  nodes: readonly ModuleFlowNode[],
  modules: readonly ModuleInfo[],
  nodeId: string,
): ModuleInfo | undefined {
  const node = nodes.find((n) => n.id === nodeId);
  return node ? modules.find((m) => m.type === node.data.moduleType) : undefined;
}

/** Name sent with preview requests; the server derives a slug from it. */
const PREVIEW_NAME = 'Preview';

/**
 * Converts canvas state to the pipeline JSON the server expects. Edges without both port
 * handles are dropped, since they cannot be executed.
 */
export function toPipelinePayload(
  nodes: readonly ModuleFlowNode[],
  edges: readonly Edge[],
  meta: PipelinePayload['meta'] = { id: 'preview', name: PREVIEW_NAME },
): PipelinePayload {
  return {
    meta,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.moduleType,
      config: n.data.config,
      position: { x: n.position.x, y: n.position.y },
    })),
    edges: edges.flatMap((e) =>
      e.sourceHandle && e.targetHandle
        ? [
            {
              source: e.source,
              sourcePort: e.sourceHandle,
              target: e.target,
              targetPort: e.targetHandle,
            },
          ]
        : [],
    ),
  };
}

/** Lowercase letters, digits and single hyphens; `pipe` if nothing usable remains. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return slug === '' ? 'pipe' : slug;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Converts a stored pipeline into canvas nodes and edges (Req 10.7). Nothing is selected. */
export function fromPipelineDocument(doc: PipelineDocument): {
  nodes: ModuleFlowNode[];
  edges: Edge[];
} {
  return {
    nodes: doc.nodes.map((n) => ({
      id: n.id,
      type: 'module',
      position: { x: n.position.x, y: n.position.y },
      data: { moduleType: n.type, config: isRecord(n.config) ? n.config : {} },
    })),
    edges: doc.edges.map((e) => ({
      id: `${e.source}:${e.sourcePort}->${e.target}:${e.targetPort}`,
      source: e.source,
      sourceHandle: e.sourcePort,
      target: e.target,
      targetHandle: e.targetPort,
    })),
  };
}

/**
 * Stable string that changes only when something affecting pipeline results changes: node
 * ids, types and configs, and edges. Dragging a node or selecting it does not alter it, so
 * auto-preview does not re-run for those.
 */
export function graphSignature(nodes: readonly ModuleFlowNode[], edges: readonly Edge[]): string {
  const payload = toPipelinePayload(nodes, edges);
  return JSON.stringify({
    nodes: payload.nodes.map(({ id, type, config }) => ({ id, type, config })),
    edges: payload.edges,
  });
}
