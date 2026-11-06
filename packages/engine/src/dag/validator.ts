import { PipelineGraphSchema } from '../schema/pipeline.js';
import type { ModuleRegistry } from '../registry.js';
import type { PipelineGraph } from '../types.js';

/** Maximum number of nodes allowed in one pipeline (Req 12.2). */
export const MAX_NODES = 20;

export interface ValidationError {
  message: string;
  /** Location in the pipeline JSON, e.g. ['nodes', '2', 'config', 'url']. */
  path?: string[];
}

export type ValidationResult =
  { success: true; graph: PipelineGraph } | { success: false; errors: ValidationError[] };

/**
 * Validates unknown JSON as an executable pipeline:
 * structure, node limit, module types, configs, ports, single-edge inputs,
 * exactly one output node, and acyclicity.
 *
 * On success the graph is returned as authored (configs are not rewritten with schema defaults).
 */
export function validate(json: unknown, moduleRegistry: ModuleRegistry): ValidationResult {
  const parsed = PipelineGraphSchema.safeParse(json);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.map(String),
      })),
    };
  }
  const graph: PipelineGraph = parsed.data;

  if (graph.nodes.length > MAX_NODES) {
    return {
      success: false,
      errors: [{ message: `Pipeline exceeds maximum node count (${MAX_NODES})`, path: ['nodes'] }],
    };
  }

  const errors: ValidationError[] = [];

  // Node ids, module types and configs.
  const nodesById = new Map<string, PipelineGraph['nodes'][number]>();
  graph.nodes.forEach((node, i) => {
    if (nodesById.has(node.id)) {
      errors.push({ message: `Duplicate node id: ${node.id}`, path: ['nodes', String(i), 'id'] });
    } else {
      nodesById.set(node.id, node);
    }

    const definition = moduleRegistry.get(node.type);
    if (definition === undefined) {
      const registered = [...moduleRegistry.keys()].sort().join(', ');
      errors.push({
        message: `Unknown module type: ${node.type} (registered types: ${registered})`,
        path: ['nodes', String(i), 'type'],
      });
      return;
    }

    const config = definition.configSchema.safeParse(node.config);
    if (!config.success) {
      for (const issue of config.error.issues) {
        errors.push({
          message: `Invalid config for node '${node.id}': ${issue.message}`,
          path: ['nodes', String(i), 'config', ...issue.path.map(String)],
        });
      }
    }
  });

  // Exactly one output node.
  const outputCount = graph.nodes.filter((node) => node.type === 'output').length;
  if (outputCount !== 1) {
    errors.push({
      message: `Pipeline must have exactly one output node (found ${outputCount})`,
      path: ['nodes'],
    });
  }

  // Edges: endpoints, ports, single edge per input port.
  let edgesReferenceKnownNodes = true;
  const incoming = new Map<string, number>();
  graph.edges.forEach((edge, i) => {
    const base = ['edges', String(i)];
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);

    if (source === undefined) {
      edgesReferenceKnownNodes = false;
      errors.push({
        message: `Edge source node not found: ${edge.source}`,
        path: [...base, 'source'],
      });
    }
    if (target === undefined) {
      edgesReferenceKnownNodes = false;
      errors.push({
        message: `Edge target node not found: ${edge.target}`,
        path: [...base, 'target'],
      });
    }

    const sourceDef = source && moduleRegistry.get(source.type);
    if (sourceDef && !sourceDef.outputPorts.includes(edge.sourcePort)) {
      errors.push({
        message: `Output port '${edge.sourcePort}' does not exist on node '${edge.source}' (${source.type}); available: ${sourceDef.outputPorts.join(', ')}`,
        path: [...base, 'sourcePort'],
      });
    }
    const targetDef = target && moduleRegistry.get(target.type);
    if (targetDef && !targetDef.inputPorts.includes(edge.targetPort)) {
      errors.push({
        message: `Input port '${edge.targetPort}' does not exist on node '${edge.target}' (${target.type}); available: ${targetDef.inputPorts.join(', ')}`,
        path: [...base, 'targetPort'],
      });
    }

    const key = JSON.stringify([edge.target, edge.targetPort]);
    const count = (incoming.get(key) ?? 0) + 1;
    incoming.set(key, count);
    if (count === 2) {
      errors.push({
        message: `Multiple edges to input port '${edge.targetPort}' on node '${edge.target}'`,
        path: [...base, 'targetPort'],
      });
    }
  });

  // Cycles (only meaningful when every edge points at a real node).
  if (edgesReferenceKnownNodes) {
    const messages = new Set(
      findCycles(graph).map((cycle) => `Cycle detected: ${cycle.join(' -> ')}`),
    );
    for (const message of messages) errors.push({ message, path: ['edges'] });
  }

  return errors.length > 0 ? { success: false, errors } : { success: true, graph };
}

/**
 * DFS with a recursion stack. Returns one path per back edge found,
 * written as `[a, b, c, a]` (first node repeated at the end).
 */
function findCycles(graph: PipelineGraph): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.id, []);
  for (const edge of graph.edges) adjacency.get(edge.source)?.push(edge.target);

  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  const visit = (id: string): void => {
    visited.add(id);
    stack.push(id);
    onStack.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (onStack.has(next)) {
        cycles.push([...stack.slice(stack.indexOf(next)), next]);
      } else if (!visited.has(next)) {
        visit(next);
      }
    }
    stack.pop();
    onStack.delete(id);
  };

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) visit(node.id);
  }
  return cycles;
}
