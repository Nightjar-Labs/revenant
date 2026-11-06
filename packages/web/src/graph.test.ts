import { describe, expect, it } from 'vitest';

import {
  canConnect,
  createModuleNode,
  defaultConfig,
  fromPipelineDocument,
  generateNodeId,
  graphSignature,
  portType,
  slugify,
  toPipelinePayload,
  type ModuleFlowNode,
} from './graph.js';
import type { ModuleInfo } from './types.js';

const feed: ModuleInfo = {
  type: 'fetch-feed',
  category: 'sources',
  themedLabel: 'Summon (Fetch Feed)',
  plainLabel: 'Fetch Feed',
  inputPorts: [],
  outputPorts: ['out'],
  configSchema: { type: 'object', properties: { url: { type: 'string' } } },
};
const union: ModuleInfo = {
  type: 'union',
  category: 'operators',
  themedLabel: 'Séance',
  plainLabel: 'Union',
  inputPorts: ['items1', 'items2'],
  outputPorts: ['out'],
  configSchema: {},
};
const modules = [feed, union];

function node(id: string, moduleType: string): ModuleFlowNode {
  return { id, type: 'module', position: { x: 0, y: 0 }, data: { moduleType, config: {} } };
}
const nodes = [node('a', 'fetch-feed'), node('b', 'union'), node('c', 'union')];

describe('generateNodeId', () => {
  it('returns unique ids prefixed with node-', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateNodeId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^node-[0-9a-f-]+$/);
  });
});

describe('defaultConfig', () => {
  it('collects schema defaults and ignores properties without one', () => {
    expect(
      defaultConfig({
        properties: { limit: { default: 10 }, url: { type: 'string' }, rules: { default: [] } },
      }),
    ).toEqual({ limit: 10, rules: [] });
  });

  it('returns an empty object for schemas without properties', () => {
    expect(defaultConfig({})).toEqual({});
    expect(defaultConfig({ properties: 'nope' })).toEqual({});
  });

  it('does not share default objects between nodes', () => {
    const schema = { properties: { rules: { default: [] } } };
    expect(defaultConfig(schema)['rules']).not.toBe(defaultConfig(schema)['rules']);
  });
});

describe('createModuleNode', () => {
  it('creates a selected module node at the position with default config', () => {
    const created = createModuleNode(feed, { x: 5, y: 7 }, 'node-x');
    expect(created).toMatchObject({
      id: 'node-x',
      type: 'module',
      position: { x: 5, y: 7 },
      selected: true,
      data: { moduleType: 'fetch-feed', config: {} },
    });
  });
});

describe('portType', () => {
  it('reports items for declared ports and undefined otherwise', () => {
    expect(portType(union, 'in', 'items1')).toBe('items');
    expect(portType(union, 'out', 'out')).toBe('items');
    expect(portType(union, 'in', 'out')).toBeUndefined();
    expect(portType(feed, 'in', 'items')).toBeUndefined();
  });
});

describe('canConnect', () => {
  it('accepts an output port wired to an input port', () => {
    expect(
      canConnect(
        { source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'items1' },
        nodes,
        modules,
      ),
    ).toBe(true);
  });

  it.each([
    [
      'unknown source port',
      { source: 'a', sourceHandle: 'nope', target: 'b', targetHandle: 'items1' },
    ],
    [
      'unknown target port',
      { source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'nope' },
    ],
    [
      'output used as input',
      { source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'out' },
    ],
    [
      'input used as output',
      { source: 'b', sourceHandle: 'items1', target: 'c', targetHandle: 'items1' },
    ],
    [
      'source with no input ports as target',
      { source: 'b', sourceHandle: 'out', target: 'a', targetHandle: 'out' },
    ],
    ['self connection', { source: 'b', sourceHandle: 'out', target: 'b', targetHandle: 'items1' }],
    ['unknown node', { source: 'zzz', sourceHandle: 'out', target: 'b', targetHandle: 'items1' }],
    ['missing handle', { source: 'a', sourceHandle: null, target: 'b', targetHandle: 'items1' }],
  ])('rejects %s', (_name, connection) => {
    expect(canConnect(connection, nodes, modules)).toBe(false);
  });

  it('rejects a node whose module is not in the registry', () => {
    const orphan = [...nodes, node('d', 'gone')];
    expect(
      canConnect(
        { source: 'a', sourceHandle: 'out', target: 'd', targetHandle: 'items' },
        orphan,
        modules,
      ),
    ).toBe(false);
  });
});

describe('toPipelinePayload / graphSignature', () => {
  const a = createModuleNode(feed, { x: 1, y: 2 }, 'a');
  a.data.config = { url: 'https://example.com/rss' };
  const b = createModuleNode(union, { x: 3, y: 4 }, 'b');
  const edge = { id: 'e1', source: 'a', sourceHandle: 'out', target: 'b', targetHandle: 'items1' };

  it('maps canvas nodes and edges to the pipeline JSON format', () => {
    expect(toPipelinePayload([a, b], [edge])).toEqual({
      meta: { id: 'preview', name: 'Preview' },
      nodes: [
        {
          id: 'a',
          type: 'fetch-feed',
          config: { url: 'https://example.com/rss' },
          position: { x: 1, y: 2 },
        },
        { id: 'b', type: 'union', config: {}, position: { x: 3, y: 4 } },
      ],
      edges: [{ source: 'a', sourcePort: 'out', target: 'b', targetPort: 'items1' }],
    });
  });

  it('drops edges that lack a port handle', () => {
    const loose = { id: 'e2', source: 'a', target: 'b' };
    expect(toPipelinePayload([a, b], [loose]).edges).toEqual([]);
  });

  it('ignores position and selection but reacts to config and edge changes', () => {
    const base = graphSignature([a, b], [edge]);
    const moved = { ...a, position: { x: 99, y: 99 }, selected: !a.selected };
    expect(graphSignature([moved, b], [edge])).toBe(base);

    const edited = { ...a, data: { ...a.data, config: { url: 'https://example.com/other' } } };
    expect(graphSignature([edited, b], [edge])).not.toBe(base);
    expect(graphSignature([a, b], [])).not.toBe(base);
  });
});

describe('fromPipelineDocument', () => {
  const doc = {
    meta: { id: 'demo', name: 'Demo' },
    nodes: [
      {
        id: 'a',
        type: 'fetch-feed',
        config: { url: 'https://x.example' },
        position: { x: 1, y: 2 },
      },
      { id: 'b', type: 'union', config: null, position: { x: 3, y: 4 } },
    ],
    edges: [{ source: 'a', sourcePort: 'out', target: 'b', targetPort: 'items1' }],
  };

  it('maps nodes and edges onto canvas shapes without a selection', () => {
    const { nodes, edges } = fromPipelineDocument(doc);
    expect(nodes).toEqual([
      {
        id: 'a',
        type: 'module',
        position: { x: 1, y: 2 },
        data: { moduleType: 'fetch-feed', config: { url: 'https://x.example' } },
      },
      {
        id: 'b',
        type: 'module',
        position: { x: 3, y: 4 },
        data: { moduleType: 'union', config: {} },
      },
    ]);
    expect(edges).toEqual([
      {
        id: 'a:out->b:items1',
        source: 'a',
        sourceHandle: 'out',
        target: 'b',
        targetHandle: 'items1',
      },
    ]);
  });

  it('round-trips through toPipelinePayload', () => {
    const { nodes, edges } = fromPipelineDocument({
      ...doc,
      nodes: doc.nodes.map((n) => ({ ...n, config: { k: n.id } })),
    });
    const payload = toPipelinePayload(nodes, edges, doc.meta);
    expect(payload.meta).toEqual(doc.meta);
    expect(payload.edges).toEqual(doc.edges);
    expect(payload.nodes.map((n) => [n.id, n.type, n.config, n.position])).toEqual(
      doc.nodes.map((n) => [n.id, n.type, { k: n.id }, n.position]),
    );
  });
});

describe('slugify', () => {
  it('produces a valid pipeline slug', () => {
    expect(slugify('Hacker News — Rust Only')).toBe('hacker-news-rust-only');
    expect(slugify('  Café  Crème! ')).toBe('cafe-creme');
    expect(slugify('!!!')).toBe('pipe');
    expect(slugify('a'.repeat(100))).toMatch(/^a{64}$/);
  });
});
