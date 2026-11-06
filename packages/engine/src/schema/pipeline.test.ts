import { describe, expect, it } from 'vitest';
import { PipelineGraphSchema } from './pipeline.js';

const validGraph = {
  meta: { id: 'my-feed-mashup', name: 'My Feed Mashup' },
  nodes: [
    {
      id: 'node-1',
      type: 'fetch-feed',
      config: { url: 'https://example.com/rss' },
      position: { x: 100, y: 100 },
    },
    { id: 'node-2', type: 'output', config: {}, position: { x: 300, y: 100 } },
  ],
  edges: [{ source: 'node-1', sourcePort: 'out', target: 'node-2', targetPort: 'items' }],
};

describe('PipelineGraphSchema', () => {
  it('accepts a well-formed graph', () => {
    expect(PipelineGraphSchema.safeParse(validGraph).success).toBe(true);
  });

  it('accepts an empty graph with valid meta', () => {
    expect(PipelineGraphSchema.safeParse({ ...validGraph, nodes: [], edges: [] }).success).toBe(
      true,
    );
  });

  it.each(['nodes', 'edges', 'meta'] as const)('rejects a graph missing %s', (key) => {
    const { [key]: _omitted, ...rest } = validGraph;
    void _omitted;
    expect(PipelineGraphSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a node without a position', () => {
    const node = { id: 'n', type: 'output', config: {} };
    expect(PipelineGraphSchema.safeParse({ ...validGraph, nodes: [node] }).success).toBe(false);
  });

  it('rejects a non-numeric position', () => {
    const node = { id: 'n', type: 'output', config: {}, position: { x: '1', y: 2 } };
    expect(PipelineGraphSchema.safeParse({ ...validGraph, nodes: [node] }).success).toBe(false);
  });

  it('rejects an edge missing a port', () => {
    const edge = { source: 'node-1', target: 'node-2', targetPort: 'items' };
    expect(PipelineGraphSchema.safeParse({ ...validGraph, edges: [edge] }).success).toBe(false);
  });

  it.each(['My Pipe', 'UPPER', 'under_score', '', 'a/b', '../etc'])(
    'rejects meta.id %j (not a slug)',
    (id) => {
      expect(
        PipelineGraphSchema.safeParse({ ...validGraph, meta: { id, name: 'X' } }).success,
      ).toBe(false);
    },
  );

  it('rejects an empty meta.name', () => {
    expect(
      PipelineGraphSchema.safeParse({ ...validGraph, meta: { id: 'ok', name: '' } }).success,
    ).toBe(false);
  });

  it('keeps node config as provided', () => {
    const parsed = PipelineGraphSchema.parse(validGraph);
    expect(parsed.nodes[0]?.config).toEqual({ url: 'https://example.com/rss' });
  });
});
