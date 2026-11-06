import { topologicalSort } from '../dag/sort.js';
import type {
  ExecutionDeps,
  Item,
  NodeResult,
  PipelineGraph,
  PipelineNode,
  PipelineRunResult,
} from '../types.js';

/** Maximum number of items returned in `outputItems` (Req 12.3). */
export const MAX_OUTPUT_ITEMS = 500;

/** Error message given to nodes that did not finish because the run was aborted. */
export const ABORTED_MESSAGE = 'Pipeline execution aborted';

/** Thrown internally when the abort signal fires while a node is running. */
class AbortedError extends Error {
  constructor() {
    super(ABORTED_MESSAGE);
  }
}

const failure = (node: PipelineNode, message: string): NodeResult => ({
  items: [],
  error: { message, nodeId: node.id, nodeType: node.type },
});

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Resolves with `promise`, or rejects with `AbortedError` as soon as `signal` aborts. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new AbortedError());
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Executes a validated pipeline in topological order.
 *
 * - Errors are isolated per node: a node that throws, rejects, has an invalid config or returns
 *   malformed output gets `{ items: [], error }` and the run continues.
 * - A node whose connected inputs all come from failed nodes is not executed; it is marked
 *   failed too. If at least one connected input succeeded, it runs and unavailable inputs are `[]`.
 * - If `signal` aborts, the running node and every node not yet executed are marked failed with
 *   `ABORTED_MESSAGE` and the result is returned (callers can check `signal.aborted`).
 * - `outputItems` are the output node's items, capped at `MAX_OUTPUT_ITEMS`; a warning is
 *   added to `warnings` when the cap applies. `nodeResults` keeps the uncapped items.
 *
 * The graph must already have passed `validate()`; a cyclic graph makes this throw.
 */
export async function run(
  graph: PipelineGraph,
  deps: ExecutionDeps,
  signal?: AbortSignal,
): Promise<PipelineRunResult> {
  const order = topologicalSort(graph);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const nodeResults: Record<string, NodeResult> = {};
  /** Output items per node and output port, for nodes that succeeded. */
  const outputs = new Map<string, Record<string, Item[]>>();

  for (const id of order) {
    const node = nodesById.get(id);
    if (node === undefined) continue;

    if (signal?.aborted === true) {
      nodeResults[id] = failure(node, ABORTED_MESSAGE);
      continue;
    }

    const definition = deps.registry.get(node.type);
    if (definition === undefined) {
      nodeResults[id] = failure(node, `Unknown module type: ${node.type}`);
      continue;
    }

    const incoming = graph.edges.filter((edge) => edge.target === id);
    const failedUpstream = incoming.filter((edge) => !outputs.has(edge.source));
    if (incoming.length > 0 && failedUpstream.length === incoming.length) {
      const sources = [...new Set(failedUpstream.map((edge) => edge.source))].join(', ');
      nodeResults[id] = failure(node, `Upstream node failed: ${sources}`);
      continue;
    }

    const config = definition.configSchema.safeParse(node.config);
    if (!config.success) {
      const detail = config.error.issues.map((issue) => issue.message).join('; ');
      nodeResults[id] = failure(node, `Invalid config: ${detail}`);
      continue;
    }

    // Unconnected ports and ports fed only by failed nodes receive an empty array.
    const inputs: Record<string, Item[]> = {};
    for (const port of definition.inputPorts) inputs[port] = [];
    for (const edge of incoming) {
      const upstream = outputs.get(edge.source)?.[edge.sourcePort];
      // Copy so a module that mutates its input cannot affect other consumers of the same output.
      if (upstream !== undefined) inputs[edge.targetPort] = [...upstream];
    }

    try {
      const produced = (await raceAbort(
        (async () => definition.execute(inputs, config.data, deps))(),
        signal,
      )) as unknown;
      const portItems: Record<string, Item[]> = {};
      for (const port of definition.outputPorts) {
        const value = (produced as Record<string, unknown> | null | undefined)?.[port];
        if (!Array.isArray(value)) {
          throw new Error(`Module '${node.type}' did not return an item array for port '${port}'`);
        }
        portItems[port] = value as Item[];
      }
      outputs.set(id, portItems);
      const primary = definition.outputPorts[0];
      nodeResults[id] = { items: primary === undefined ? [] : (portItems[primary] ?? []) };
    } catch (error) {
      nodeResults[id] = failure(node, messageOf(error));
    }
  }

  const warnings: string[] = [];
  const outputNode = graph.nodes.find((node) => node.type === 'output');
  const outputResult = outputNode === undefined ? undefined : nodeResults[outputNode.id];
  let outputItems: Item[] = [];
  if (outputResult !== undefined && outputResult.error === undefined) {
    outputItems = outputResult.items;
    if (outputItems.length > MAX_OUTPUT_ITEMS) {
      warnings.push(`Output truncated from ${outputItems.length} to ${MAX_OUTPUT_ITEMS} items`);
      outputItems = outputItems.slice(0, MAX_OUTPUT_ITEMS);
    }
  }

  return {
    success: Object.values(nodeResults).every((result) => result.error === undefined),
    nodeResults,
    outputItems,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
