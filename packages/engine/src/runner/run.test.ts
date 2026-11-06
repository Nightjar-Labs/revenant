import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerModule, type ModuleRegistry } from '../registry.js';
import type {
  Clock,
  ExecutionDeps,
  Fetcher,
  Item,
  ModuleDefinition,
  PipelineEdge,
  PipelineGraph,
  PipelineNode,
} from '../types.js';
import { ABORTED_MESSAGE, MAX_OUTPUT_ITEMS, run } from './run.js';

const makeItems = (count: number, prefix = 'item'): Item[] =>
  Array.from({ length: count }, (_, i) => ({
    title: `${prefix} ${i}`,
    link: `https://example.com/${prefix}/${i}`,
    guid: `${prefix}-${i}`,
    date: '2025-01-01T00:00:00.000Z',
  }));

const fixedClock: Clock = { now: () => new Date('2025-06-01T12:00:00.000Z') };
const unusedFetcher: Fetcher = {
  fetch: () => Promise.reject(new Error('fetcher must not be called')),
};

const module = (
  type: string,
  inputPorts: string[],
  outputPorts: string[],
  execute: ModuleDefinition['execute'],
  configSchema: z.ZodType<unknown> = z.object({}),
): ModuleDefinition => ({
  type,
  themedLabel: 'Ghost',
  plainLabel: type,
  configSchema,
  inputPorts,
  outputPorts,
  execute,
});

/** Builds a registry from the standard stubs plus per-test overrides. */
function makeRegistry(extra: ModuleDefinition[] = [], sourceItems: Item[] = makeItems(3)) {
  const registry: ModuleRegistry = new Map();
  registerModule(
    registry,
    module('source', [], ['out'], () => ({ out: sourceItems })),
  );
  registerModule(
    registry,
    module('failing-source', [], ['out'], () => {
      throw new Error('fetch exploded');
    }),
  );
  registerModule(
    registry,
    module('pass', ['items'], ['out'], (inputs) => ({
      out: (inputs as { items: Item[] }).items,
    })),
  );
  registerModule(
    registry,
    module('failing', ['items'], ['out'], () => {
      throw new Error('boom');
    }),
  );
  registerModule(
    registry,
    module('merge', ['in1', 'in2'], ['out'], (inputs) => {
      const { in1, in2 } = inputs as { in1: Item[]; in2: Item[] };
      return { out: [...in1, ...in2] };
    }),
  );
  registerModule(
    registry,
    module('output', ['items'], ['out'], (inputs) => ({
      out: (inputs as { items: Item[] }).items,
    })),
  );
  for (const definition of extra) registerModule(registry, definition);
  return registry;
}

const depsOf = (registry: ModuleRegistry): ExecutionDeps => ({
  fetcher: unusedFetcher,
  clock: fixedClock,
  registry,
});

const node = (id: string, type: string, config: unknown = {}): PipelineNode => ({
  id,
  type,
  config,
  position: { x: 0, y: 0 },
});
const edge = (
  source: string,
  target: string,
  targetPort = 'items',
  sourcePort = 'out',
): PipelineEdge => ({ source, sourcePort, target, targetPort });
const graphOf = (nodes: PipelineNode[], edges: PipelineEdge[]): PipelineGraph => ({
  meta: { id: 'test-pipe', name: 'Test pipe' },
  nodes,
  edges,
});

describe('run', () => {
  it('runs a linear pipeline with all nodes succeeding', async () => {
    const items = makeItems(3);
    const graph = graphOf(
      [node('s', 'source'), node('p', 'pass'), node('o', 'output')],
      [edge('s', 'p'), edge('p', 'o')],
    );
    const result = await run(graph, depsOf(makeRegistry([], items)));

    expect(result.success).toBe(true);
    expect(result.warnings).toBeUndefined();
    expect(result.nodeResults).toEqual({
      s: { items },
      p: { items },
      o: { items },
    });
    expect(result.outputItems).toEqual(items);
  });

  it('executes upstream nodes before downstream nodes even when listed in reverse', async () => {
    const order: string[] = [];
    const track = (type: string, ports: string[]): ModuleDefinition =>
      module(type, ports, ['out'], (inputs) => {
        order.push(type);
        return { out: (inputs as Record<string, Item[]>)['items'] ?? [] };
      });
    const registry = makeRegistry([track('t-source', []), track('t-pass', ['items'])]);
    const graph = graphOf(
      [node('o', 'output'), node('p', 't-pass'), node('s', 't-source')],
      [edge('s', 'p'), edge('p', 'o')],
    );
    const result = await run(graph, depsOf(registry));
    expect(result.success).toBe(true);
    expect(order).toEqual(['t-source', 't-pass']);
  });

  it('isolates a mid-graph failure and keeps running downstream nodes that have other inputs', async () => {
    // s -> bad -> merge.in1 ; s -> merge.in2 ; merge -> o ; bad -> dead -> (nothing else)
    const items = makeItems(3);
    const graph = graphOf(
      [
        node('s', 'source'),
        node('bad', 'failing'),
        node('dead', 'pass'),
        node('m', 'merge'),
        node('o', 'output'),
      ],
      [
        edge('s', 'bad'),
        edge('s', 'm', 'in2'),
        edge('bad', 'm', 'in1'),
        edge('bad', 'dead'),
        edge('m', 'o'),
      ],
    );
    const result = await run(graph, depsOf(makeRegistry([], items)));

    expect(result.success).toBe(false);
    expect(result.nodeResults['bad']).toEqual({
      items: [],
      error: { message: 'boom', nodeId: 'bad', nodeType: 'failing' },
    });
    // Depends solely on the failed node: not executed, error propagated.
    expect(result.nodeResults['dead']?.items).toEqual([]);
    expect(result.nodeResults['dead']?.error?.message).toBe('Upstream node failed: bad');
    // Has another healthy input: runs with the failed port empty.
    expect(result.nodeResults['m']).toEqual({ items });
    expect(result.nodeResults['o']).toEqual({ items });
    expect(result.outputItems).toEqual(items);
  });

  it('propagates a source failure to every dependent node', async () => {
    const graph = graphOf(
      [node('s', 'failing-source'), node('p', 'pass'), node('o', 'output')],
      [edge('s', 'p'), edge('p', 'o')],
    );
    const result = await run(graph, depsOf(makeRegistry()));

    expect(result.success).toBe(false);
    expect(result.nodeResults['s']?.error).toEqual({
      message: 'fetch exploded',
      nodeId: 's',
      nodeType: 'failing-source',
    });
    expect(result.nodeResults['p']?.error?.message).toBe('Upstream node failed: s');
    expect(result.nodeResults['o']?.error?.message).toBe('Upstream node failed: p');
    expect(result.nodeResults['p']?.items).toEqual([]);
    expect(result.outputItems).toEqual([]);
  });

  it('truncates output to 500 items and adds a warning', async () => {
    const items = makeItems(MAX_OUTPUT_ITEMS + 1);
    const graph = graphOf([node('s', 'source'), node('o', 'output')], [edge('s', 'o')]);
    const result = await run(graph, depsOf(makeRegistry([], items)));

    // Property 22: output truncation
    expect(result.success).toBe(true);
    expect(result.outputItems).toHaveLength(MAX_OUTPUT_ITEMS);
    expect(result.outputItems).toEqual(items.slice(0, MAX_OUTPUT_ITEMS));
    expect(result.warnings).toEqual(['Output truncated from 501 to 500 items']);
    // Per-node results stay complete for the Ghost Inspector.
    expect(result.nodeResults['o']?.items).toHaveLength(MAX_OUTPUT_ITEMS + 1);
  });

  it('does not truncate or warn at exactly 500 items', async () => {
    const items = makeItems(MAX_OUTPUT_ITEMS);
    const graph = graphOf([node('s', 'source'), node('o', 'output')], [edge('s', 'o')]);
    const result = await run(graph, depsOf(makeRegistry([], items)));
    expect(result.outputItems).toHaveLength(MAX_OUTPUT_ITEMS);
    expect(result.warnings).toBeUndefined();
  });

  it('returns empty outputItems when the output node fails', async () => {
    const throwingOutput = module('output', ['items'], ['out'], () => {
      throw new Error('output broke');
    });
    const registry = makeRegistry();
    registry.set('output', throwingOutput);
    const graph = graphOf([node('s', 'source'), node('o', 'output')], [edge('s', 'o')]);
    const result = await run(graph, depsOf(registry));
    expect(result.success).toBe(false);
    expect(result.outputItems).toEqual([]);
    expect(result.nodeResults['o']?.error?.message).toBe('output broke');
  });

  it('captures rejected promises from async modules', async () => {
    const registry = makeRegistry([
      module('rejecting', [], ['out'], () => Promise.reject(new Error('async failure'))),
    ]);
    const graph = graphOf([node('r', 'rejecting'), node('o', 'output')], [edge('r', 'o')]);
    const result = await run(graph, depsOf(registry));
    expect(result.nodeResults['r']?.error?.message).toBe('async failure');
  });

  it('captures non-Error throws', async () => {
    const registry = makeRegistry([
      module('string-thrower', [], ['out'], () => {
        throw 'plain string';
      }),
    ]);
    const graph = graphOf([node('t', 'string-thrower')], []);
    const result = await run(graph, depsOf(registry));
    expect(result.nodeResults['t']?.error?.message).toBe('plain string');
  });

  it('fails a node whose config does not match its schema, without executing it', async () => {
    let executed = false;
    const registry = makeRegistry([
      module(
        'needs-url',
        [],
        ['out'],
        () => {
          executed = true;
          return { out: [] };
        },
        z.object({ url: z.string() }),
      ),
    ]);
    const graph = graphOf([node('n', 'needs-url', { url: 42 })], []);
    const result = await run(graph, depsOf(registry));
    expect(executed).toBe(false);
    expect(result.nodeResults['n']?.error?.message).toMatch(/^Invalid config: /);
  });

  it('passes schema-parsed config (with defaults) to execute', async () => {
    let seen: unknown;
    const registry = makeRegistry([
      module(
        'defaulted',
        [],
        ['out'],
        (_inputs, config) => {
          seen = config;
          return { out: [] };
        },
        z.object({ field: z.string().default('guid') }),
      ),
    ]);
    await run(graphOf([node('d', 'defaulted', {})], []), depsOf(registry));
    expect(seen).toEqual({ field: 'guid' });
  });

  it('fails a node whose module returns no item array for a declared port', async () => {
    const registry = makeRegistry([module('sloppy', [], ['out'], () => ({ other: [] }))]);
    const result = await run(graphOf([node('x', 'sloppy')], []), depsOf(registry));
    expect(result.nodeResults['x']?.error?.message).toBe(
      "Module 'sloppy' did not return an item array for port 'out'",
    );
  });

  it('fails a node with an unregistered module type', async () => {
    const result = await run(graphOf([node('x', 'nope')], []), depsOf(makeRegistry()));
    expect(result.success).toBe(false);
    expect(result.nodeResults['x']?.error?.message).toBe('Unknown module type: nope');
  });

  it('routes items by source port and target port', async () => {
    const a = makeItems(1, 'a');
    const b = makeItems(2, 'b');
    const registry = makeRegistry([
      module('two-out', [], ['left', 'right'], () => ({ left: a, right: b })),
    ]);
    const graph = graphOf(
      [node('t', 'two-out'), node('m', 'merge'), node('o', 'output')],
      [edge('t', 'm', 'in1', 'right'), edge('t', 'm', 'in2', 'left'), edge('m', 'o')],
    );
    const result = await run(graph, depsOf(registry));
    expect(result.outputItems).toEqual([...b, ...a]);
    // NodeResult.items is the first declared output port.
    expect(result.nodeResults['t']?.items).toEqual(a);
  });

  it('gives unconnected input ports an empty array', async () => {
    const graph = graphOf(
      [node('s', 'source'), node('m', 'merge'), node('o', 'output')],
      [edge('s', 'm', 'in2'), edge('m', 'o')],
    );
    const items = makeItems(3);
    const result = await run(graph, depsOf(makeRegistry([], items)));
    expect(result.outputItems).toEqual(items);
  });

  it('protects fan-out consumers from a module mutating its input', async () => {
    const items = makeItems(3);
    const registry = makeRegistry(
      [
        module('mutator', ['items'], ['out'], (inputs) => {
          const list = (inputs as { items: Item[] }).items;
          list.length = 0;
          return { out: list };
        }),
      ],
      items,
    );
    const graph = graphOf(
      [node('s', 'source'), node('mut', 'mutator'), node('p', 'pass'), node('o', 'output')],
      [edge('s', 'mut'), edge('s', 'p'), edge('p', 'o')],
    );
    const result = await run(graph, depsOf(registry));
    // `mut` runs before `pass` (tie broken by node order) and empties its input array.
    expect(result.nodeResults['mut']?.items).toEqual([]);
    expect(result.outputItems).toEqual(items);
    expect(result.nodeResults['s']?.items).toEqual(items);
  });

  it('hands the injected fetcher, clock and registry to modules', async () => {
    // Properties 9 and 10: clock and fetcher injection
    const fetcher: Fetcher = {
      fetch: (url) => Promise.resolve({ body: `body of ${url}`, status: 200, headers: {} }),
    };
    const registry = makeRegistry([
      module('probe', [], ['out'], async (_inputs, _config, deps) => {
        const response = await deps.fetcher.fetch('https://example.com/feed');
        return {
          out: [
            {
              title: response.body,
              link: '',
              guid: 'probe',
              date: deps.clock.now().toISOString(),
            },
          ],
        };
      }),
    ]);
    const graph = graphOf([node('p', 'probe'), node('o', 'output')], [edge('p', 'o')]);
    const result = await run(graph, { fetcher, clock: fixedClock, registry });
    expect(result.outputItems).toEqual([
      {
        title: 'body of https://example.com/feed',
        link: '',
        guid: 'probe',
        date: '2025-06-01T12:00:00.000Z',
      },
    ]);
  });

  describe('abort signal', () => {
    it('fails every node when the signal is already aborted', async () => {
      const graph = graphOf([node('s', 'source'), node('o', 'output')], [edge('s', 'o')]);
      const result = await run(graph, depsOf(makeRegistry()), AbortSignal.abort());
      expect(result.success).toBe(false);
      expect(result.nodeResults['s']?.error?.message).toBe(ABORTED_MESSAGE);
      expect(result.nodeResults['o']?.error?.message).toBe(ABORTED_MESSAGE);
      expect(result.outputItems).toEqual([]);
    });

    it('stops waiting for a hung node and fails it and the nodes after it', async () => {
      const items = makeItems(2);
      const registry = makeRegistry(
        [module('hang', ['items'], ['out'], () => new Promise<never>(() => undefined))],
        items,
      );
      const graph = graphOf(
        [node('s', 'source'), node('h', 'hang'), node('o', 'output')],
        [edge('s', 'h'), edge('h', 'o')],
      );
      const controller = new AbortController();
      const pending = run(graph, depsOf(registry), controller.signal);
      setTimeout(() => controller.abort(), 10);
      const result = await pending;

      expect(result.success).toBe(false);
      expect(result.nodeResults['s']).toEqual({ items });
      expect(result.nodeResults['h']?.error?.message).toBe(ABORTED_MESSAGE);
      expect(result.nodeResults['o']?.error?.message).toBe(ABORTED_MESSAGE);
      expect(result.outputItems).toEqual([]);
    });
  });
});
