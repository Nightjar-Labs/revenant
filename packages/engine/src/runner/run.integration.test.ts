import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerModule, type ModuleRegistry } from '../registry.js';
import type {
  Clock,
  Fetcher,
  Item,
  ModuleDefinition,
  PipelineEdge,
  PipelineGraph,
  PipelineNode,
} from '../types.js';
import { run } from './run.js';

// Stub modules are defined here on purpose: real operator modules are not imported.
const emptyConfig = z.object({});

const SOURCE_ITEMS: Item[] = [
  { title: 'First', link: 'https://example.com/1', guid: 'g1', date: '2025-01-01T00:00:00.000Z' },
  { title: 'Second', link: 'https://example.com/2', guid: 'g2', date: '2025-01-02T00:00:00.000Z' },
  {
    title: 'Third',
    link: 'https://example.com/3',
    guid: 'g3',
    date: '2025-01-03T00:00:00.000Z',
    content: 'body',
  },
];

const sourceStub: ModuleDefinition = {
  type: 'source-stub',
  themedLabel: 'Summon (Stub)',
  plainLabel: 'Stub Source',
  configSchema: emptyConfig,
  inputPorts: [],
  outputPorts: ['out'],
  execute: () => ({ out: SOURCE_ITEMS.map((item) => ({ ...item })) }),
};

const passthroughStub: ModuleDefinition = {
  type: 'passthrough-stub',
  themedLabel: 'Haunt (Stub)',
  plainLabel: 'Stub Passthrough',
  configSchema: emptyConfig,
  inputPorts: ['items'],
  outputPorts: ['out'],
  execute: (inputs) => ({ out: (inputs as { items: Item[] }).items }),
};

// The runner (like the validator) identifies the output node by `type === 'output'`,
// so this stub is registered under that type.
const outputStub: ModuleDefinition = {
  type: 'output',
  themedLabel: 'Raise Output (Stub)',
  plainLabel: 'Stub Output',
  configSchema: emptyConfig,
  inputPorts: ['items'],
  outputPorts: ['out'],
  execute: (inputs) => ({ out: (inputs as { items: Item[] }).items }),
};

const localRegistry: ModuleRegistry = new Map();
registerModule(localRegistry, sourceStub);
registerModule(localRegistry, passthroughStub);
registerModule(localRegistry, outputStub);

const systemClock: Clock = { now: () => new Date() };
const neverCalledFetcher: Fetcher = {
  fetch: () => {
    throw new Error('fetcher must not be called');
  },
};

const node = (id: string, type: string): PipelineNode => ({
  id,
  type,
  config: {},
  position: { x: 0, y: 0 },
});
const edge = (source: string, target: string): PipelineEdge => ({
  source,
  sourcePort: 'out',
  target,
  targetPort: 'items',
});

const graph: PipelineGraph = {
  meta: { id: 'stub-pipe', name: 'Stub pipe' },
  nodes: [
    node('source', 'source-stub'),
    node('passthrough', 'passthrough-stub'),
    node('output', 'output'),
  ],
  edges: [edge('source', 'passthrough'), edge('passthrough', 'output')],
};

describe('run (integration with stub modules)', () => {
  const deps = { fetcher: neverCalledFetcher, clock: systemClock, registry: localRegistry };

  it('populates nodeResults for all nodes and outputs the source items', async () => {
    const result = await run(graph, deps);

    expect(result.success).toBe(true);
    expect(Object.keys(result.nodeResults).sort()).toEqual(['output', 'passthrough', 'source']);
    expect(result.nodeResults['source']?.items).toEqual(SOURCE_ITEMS);
    expect(result.nodeResults['passthrough']?.items).toEqual(SOURCE_ITEMS);
    expect(result.nodeResults['output']?.items).toEqual(SOURCE_ITEMS);
    expect(result.outputItems).toEqual(SOURCE_ITEMS);
  });

  it('is deterministic across runs', async () => {
    // Property 8: deterministic execution with injected deps
    const first = await run(graph, deps);
    const second = await run(graph, deps);
    expect(second.outputItems).toEqual(first.outputItems);
    expect(second).toEqual(first);
  });
});
