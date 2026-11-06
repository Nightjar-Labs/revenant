import type { PipelineGraph } from '../types.js';

/**
 * Kahn's algorithm. Returns node IDs in execution order (upstream before downstream).
 * Ties are broken by node order in `graph.nodes`, so the result is deterministic.
 * Throws if an edge references an unknown node or the graph contains a cycle
 * (neither should happen after `validate()`).
 */
export function topologicalSort(graph: PipelineGraph): string[] {
  const index = new Map<string, number>();
  graph.nodes.forEach((node, i) => index.set(node.id, i));

  const inDegree = new Array<number>(graph.nodes.length).fill(0);
  const downstream: number[][] = graph.nodes.map(() => []);

  for (const edge of graph.edges) {
    const from = index.get(edge.source);
    const to = index.get(edge.target);
    if (from === undefined || to === undefined) {
      throw new Error(`Edge references unknown node: ${edge.source} -> ${edge.target}`);
    }
    downstream[from]?.push(to);
    inDegree[to] = (inDegree[to] ?? 0) + 1;
  }

  // Ready nodes kept sorted ascending by original index.
  const ready: number[] = [];
  inDegree.forEach((degree, i) => {
    if (degree === 0) ready.push(i);
  });

  const order: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift() as number;
    const node = graph.nodes[current];
    if (node === undefined) continue;
    order.push(node.id);
    for (const next of downstream[current] ?? []) {
      const remaining = (inDegree[next] ?? 0) - 1;
      inDegree[next] = remaining;
      if (remaining === 0) {
        ready.push(next);
        ready.sort((a, b) => a - b);
      }
    }
  }

  if (order.length !== graph.nodes.length) {
    throw new Error('Cannot sort graph: it contains a cycle');
  }
  return order;
}
