import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerModule, type ModuleRegistry } from '../registry.js';
import type { ModuleDefinition, PipelineEdge, PipelineNode } from '../types.js';
import { MAX_NODES, validate } from './validator.js';

const stub = (
  type: string,
  inputPorts: string[],
  outputPorts: string[],
  configSchema: z.ZodType<unknown> = z.object({}),
): ModuleDefinition => ({
  type,
  themedLabel: 'Ghost',
  plainLabel: type,
  configSchema,
  inputPorts,
  outputPorts,
  execute: () => ({}),
});

const registry: ModuleRegistry = new Map();
registerModule(registry, stub('source', [], ['out'], z.object({ url: z.string() })));
registerModule(registry, stub('pass', ['items'], ['out']));
registerModule(registry, stub('union', ['in1', 'in2', 'in3', 'in4'], ['out']));
registerModule(registry, stub('output', ['items'], ['out']));

const node = (id: string, type: string, config: unknown = {}): PipelineNode => ({
  id,
  type,
  config,
  position: { x: 0, y: 0 },
});
const src = (id: string): PipelineNode => node(id, 'source', { url: 'https://example.com/rss' });
const edge = (
  source: string,
  target: string,
  sourcePort = 'out',
  targetPort = 'items',
): PipelineEdge => ({ source, sourcePort, target, targetPort });

const graphOf = (nodes: PipelineNode[], edges: PipelineEdge[]) => ({
  meta: { id: 'test-pipe', name: 'Test pipe' },
  nodes,
  edges,
});

function errorsOf(json: unknown): string[] {
  const result = validate(json, registry);
  if (result.success) throw new Error('expected validation to fail');
  return result.errors.map((e) => e.message);
}

describe('validate: valid graphs', () => {
  it('accepts a linear graph and returns the typed graph', () => {
    const json = graphOf(
      [src('a'), node('b', 'pass'), node('c', 'output')],
      [edge('a', 'b'), edge('b', 'c')],
    );
    const result = validate(json, registry);
    expect(result.success).toBe(true);
    if (result.success) expect(result.graph).toEqual(json);
  });

  it('accepts fan-out (one source feeding two nodes)', () => {
    const json = graphOf(
      [src('a'), node('b', 'pass'), node('c', 'pass'), node('u', 'union'), node('o', 'output')],
      [
        edge('a', 'b'),
        edge('a', 'c'),
        edge('b', 'u', 'out', 'in1'),
        edge('c', 'u', 'out', 'in2'),
        edge('u', 'o'),
      ],
    );
    expect(validate(json, registry).success).toBe(true);
  });

  it('accepts fan-in through distinct union ports', () => {
    const json = graphOf(
      [src('a'), src('b'), src('c'), node('u', 'union'), node('o', 'output')],
      [
        edge('a', 'u', 'out', 'in1'),
        edge('b', 'u', 'out', 'in2'),
        edge('c', 'u', 'out', 'in3'),
        edge('u', 'o'),
      ],
    );
    expect(validate(json, registry).success).toBe(true);
  });
});

describe('validate: structure', () => {
  it('reports schema errors with a path', () => {
    const result = validate({ nodes: [], edges: [] }, registry);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors.some((e) => e.path?.[0] === 'meta')).toBe(true);
  });

  it('reports an invalid node config with its path', () => {
    const result = validate(
      graphOf([node('a', 'source', { url: 42 }), node('o', 'output')], [edge('a', 'o')]),
      registry,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = result.errors.find((e) => e.path?.[2] === 'config');
      expect(error?.path).toEqual(['nodes', '0', 'config', 'url']);
    }
  });

  it('rejects duplicate node ids', () => {
    expect(errorsOf(graphOf([node('o', 'output'), node('o', 'pass')], []))).toContain(
      'Duplicate node id: o',
    );
  });

  it('rejects edges to nodes that do not exist', () => {
    const errors = errorsOf(graphOf([node('o', 'output')], [edge('ghost', 'o')]));
    expect(errors).toContain('Edge source node not found: ghost');
  });
});

describe('validate: unknown module type', () => {
  it('names the type and lists registered types', () => {
    const errors = errorsOf(graphOf([node('x', 'banana'), node('o', 'output')], []));
    const message = errors.find((m) => m.startsWith('Unknown module type: banana'));
    expect(message).toBeDefined();
    expect(message).toContain('output, pass, source, union');
  });
});

describe('validate: cycles', () => {
  // Property 11: cycles are detected and the cycle path is reported
  it('detects a self-loop', () => {
    const errors = errorsOf(
      graphOf([node('a', 'pass'), node('o', 'output')], [edge('a', 'a'), edge('a', 'o')]),
    );
    expect(errors).toContain('Cycle detected: a -> a');
  });

  it('detects A -> B -> A', () => {
    const errors = errorsOf(
      graphOf(
        [node('a', 'pass'), node('b', 'pass'), node('o', 'output')],
        [edge('a', 'b'), edge('b', 'a'), edge('b', 'o')],
      ),
    );
    expect(errors).toContain('Cycle detected: a -> b -> a');
  });

  it('detects A -> B -> C -> A', () => {
    const errors = errorsOf(
      graphOf(
        [node('a', 'pass'), node('b', 'pass'), node('c', 'pass'), node('o', 'output')],
        [edge('a', 'b'), edge('b', 'c'), edge('c', 'a'), edge('c', 'o')],
      ),
    );
    expect(errors).toContain('Cycle detected: a -> b -> c -> a');
  });

  it('reports a cycle that is not reachable from the first node', () => {
    const errors = errorsOf(
      graphOf(
        [src('s'), node('o', 'output'), node('x', 'pass'), node('y', 'pass')],
        [edge('s', 'o'), edge('x', 'y'), edge('y', 'x')],
      ),
    );
    expect(errors).toContain('Cycle detected: x -> y -> x');
  });
});

describe('validate: output node', () => {
  // Property 12: exactly one output node
  it('rejects zero output nodes', () => {
    const errors = errorsOf(graphOf([src('a'), node('b', 'pass')], [edge('a', 'b')]));
    expect(errors).toContain('Pipeline must have exactly one output node (found 0)');
  });

  it('rejects multiple output nodes', () => {
    const errors = errorsOf(
      graphOf([src('a'), node('o1', 'output'), node('o2', 'output')], [edge('a', 'o1')]),
    );
    expect(errors).toContain('Pipeline must have exactly one output node (found 2)');
  });
});

describe('validate: ports', () => {
  // Property 13: edge ports must exist on their nodes
  it('rejects a non-existent source port', () => {
    const errors = errorsOf(
      graphOf([src('a'), node('o', 'output')], [edge('a', 'o', 'nope', 'items')]),
    );
    expect(errors.some((m) => m.startsWith("Output port 'nope' does not exist on node 'a'"))).toBe(
      true,
    );
  });

  it('rejects a non-existent target port', () => {
    const errors = errorsOf(
      graphOf([src('a'), node('o', 'output')], [edge('a', 'o', 'out', 'nope')]),
    );
    expect(errors.some((m) => m.startsWith("Input port 'nope' does not exist on node 'o'"))).toBe(
      true,
    );
  });

  it('rejects multiple edges to the same non-union input port', () => {
    const errors = errorsOf(
      graphOf([src('a'), src('b'), node('o', 'output')], [edge('a', 'o'), edge('b', 'o')]),
    );
    expect(errors).toContain("Multiple edges to input port 'items' on node 'o'");
  });

  it('rejects multiple edges to the same union port', () => {
    const errors = errorsOf(
      graphOf(
        [src('a'), src('b'), node('u', 'union'), node('o', 'output')],
        [edge('a', 'u', 'out', 'in1'), edge('b', 'u', 'out', 'in1'), edge('u', 'o')],
      ),
    );
    expect(errors).toContain("Multiple edges to input port 'in1' on node 'u'");
  });
});

describe('validate: node count limit', () => {
  const chain = (count: number) => {
    const nodes = [src('n0')];
    const edges: PipelineEdge[] = [];
    for (let i = 1; i < count - 1; i++) {
      nodes.push(node(`n${i}`, 'pass'));
      edges.push(edge(`n${i - 1}`, `n${i}`));
    }
    nodes.push(node('out', 'output'));
    edges.push(edge(`n${count - 2}`, 'out'));
    return graphOf(nodes, edges);
  };

  it('accepts exactly the maximum number of nodes', () => {
    expect(validate(chain(MAX_NODES), registry).success).toBe(true);
  });

  it('rejects one node over the maximum', () => {
    expect(errorsOf(chain(MAX_NODES + 1))).toEqual(['Pipeline exceeds maximum node count (20)']);
  });

  // Property 21: any pipeline over the node limit is rejected
  it('rejects any node count above the maximum', () => {
    fc.assert(
      fc.property(fc.integer({ min: MAX_NODES + 1, max: 60 }), (count) => {
        const result = validate(chain(count), registry);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.errors.map((e) => e.message)).toContain(
            'Pipeline exceeds maximum node count (20)',
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
