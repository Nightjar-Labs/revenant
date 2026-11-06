import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { PipelineEdge, PipelineGraph, PipelineNode } from '../types.js';
import { topologicalSort } from './sort.js';

const node = (id: string): PipelineNode => ({
  id,
  type: 'pass',
  config: {},
  position: { x: 0, y: 0 },
});
const edge = (source: string, target: string): PipelineEdge => ({
  source,
  sourcePort: 'out',
  target,
  targetPort: 'items',
});
const graphOf = (ids: string[], edges: PipelineEdge[]): PipelineGraph => ({
  meta: { id: 'test-pipe', name: 'Test pipe' },
  nodes: ids.map(node),
  edges,
});

function expectRespectsEdges(graph: PipelineGraph, order: string[]): void {
  expect([...order].sort()).toEqual(graph.nodes.map((n) => n.id).sort());
  for (const e of graph.edges) {
    expect(order.indexOf(e.source)).toBeLessThan(order.indexOf(e.target));
  }
}

describe('topologicalSort', () => {
  it('returns an empty order for an empty graph', () => {
    expect(topologicalSort(graphOf([], []))).toEqual([]);
  });

  it('orders a linear chain even when nodes are listed in reverse', () => {
    const graph = graphOf(['c', 'b', 'a'], [edge('a', 'b'), edge('b', 'c')]);
    expect(topologicalSort(graph)).toEqual(['a', 'b', 'c']);
  });

  it('orders fan-out with upstream first and ties by node order', () => {
    const graph = graphOf(['a', 'b', 'c'], [edge('a', 'b'), edge('a', 'c')]);
    expect(topologicalSort(graph)).toEqual(['a', 'b', 'c']);
  });

  it('orders fan-in with all inputs before the merge node', () => {
    const graph = graphOf(['u', 'a', 'b', 'o'], [edge('a', 'u'), edge('b', 'u'), edge('u', 'o')]);
    expect(topologicalSort(graph)).toEqual(['a', 'b', 'u', 'o']);
  });

  it('orders a diamond', () => {
    const graph = graphOf(
      ['d', 'c', 'b', 'a'],
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
    );
    const order = topologicalSort(graph);
    expectRespectsEdges(graph, order);
    expect(order[0]).toBe('a');
    expect(order[3]).toBe('d');
  });

  it('includes disconnected nodes', () => {
    const graph = graphOf(['x', 'a', 'b'], [edge('a', 'b')]);
    expect(topologicalSort(graph)).toEqual(['x', 'a', 'b']);
  });

  it('is deterministic across calls', () => {
    const graph = graphOf(['d', 'c', 'b', 'a'], [edge('a', 'c'), edge('b', 'c'), edge('c', 'd')]);
    expect(topologicalSort(graph)).toEqual(topologicalSort(graph));
  });

  it('throws on a cycle', () => {
    const graph = graphOf(['a', 'b'], [edge('a', 'b'), edge('b', 'a')]);
    expect(() => topologicalSort(graph)).toThrow('cycle');
  });

  it('throws on an edge to an unknown node', () => {
    expect(() => topologicalSort(graphOf(['a'], [edge('a', 'zzz')]))).toThrow('unknown node');
  });

  it('puts every source before its target for random DAGs', () => {
    // Edges only go from lower to higher index, so the graph is acyclic; node order is shuffled.
    const dagArbitrary = fc.integer({ min: 1, max: 12 }).chain((n) =>
      fc.record({
        n: fc.constant(n),
        pairs: fc.array(fc.tuple(fc.nat(n - 1), fc.nat(n - 1)), { maxLength: 30 }),
        shuffle: fc.shuffledSubarray(
          Array.from({ length: n }, (_, i) => i),
          {
            minLength: n,
            maxLength: n,
          },
        ),
      }),
    );

    fc.assert(
      fc.property(dagArbitrary, ({ n, pairs, shuffle }) => {
        const ids = Array.from({ length: n }, (_, i) => `n${i}`);
        const edges = pairs.filter(([a, b]) => a < b).map(([a, b]) => edge(`n${a}`, `n${b}`));
        const graph = graphOf(
          shuffle.map((i) => ids[i] as string),
          edges,
        );
        expectRespectsEdges(graph, topologicalSort(graph));
      }),
      { numRuns: 100 },
    );
  });
});
