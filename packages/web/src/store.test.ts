import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePipelineStore } from './store.js';
import type { ModuleInfo } from './types.js';

const filterModule: ModuleInfo = {
  type: 'filter',
  category: 'operators',
  themedLabel: 'Banish',
  plainLabel: 'Filter',
  inputPorts: ['items'],
  outputPorts: ['out'],
  configSchema: { type: 'object' },
};

const initialState = usePipelineStore.getState();

describe('usePipelineStore.loadModules', () => {
  beforeEach(() => {
    usePipelineStore.setState(initialState, true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches GET /api/modules and stores the registry', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(Response.json([filterModule])));
    vi.stubGlobal('fetch', fetchMock);

    await usePipelineStore.getState().loadModules();

    expect(fetchMock).toHaveBeenCalledWith('/api/modules', { signal: undefined });
    const state = usePipelineStore.getState();
    expect(state.modulesStatus).toBe('ready');
    expect(state.modules).toEqual([filterModule]);
    expect(state.modulesError).toBeNull();
  });

  it('records an error when the server responds with a failure status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 500 }))),
    );

    await usePipelineStore.getState().loadModules();

    const state = usePipelineStore.getState();
    expect(state.modulesStatus).toBe('error');
    expect(state.modulesError).toContain('500');
    expect(state.modules).toEqual([]);
  });

  it('records an error when the payload is not an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ nope: true }))),
    );

    await usePipelineStore.getState().loadModules();

    expect(usePipelineStore.getState().modulesStatus).toBe('error');
  });

  it('records an error when the network request rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );

    await usePipelineStore.getState().loadModules();

    const state = usePipelineStore.getState();
    expect(state.modulesStatus).toBe('error');
    expect(state.modulesError).toBe('offline');
  });
});

const feedModule: ModuleInfo = {
  type: 'fetch-feed',
  category: 'sources',
  themedLabel: 'Summon (Fetch Feed)',
  plainLabel: 'Fetch Feed',
  inputPorts: [],
  outputPorts: ['out'],
  configSchema: { type: 'object', properties: { url: { type: 'string', default: '' } } },
};

describe('usePipelineStore.updateNodeConfig', () => {
  beforeEach(() => {
    usePipelineStore.setState(
      { ...initialState, modules: [feedModule, filterModule], modulesStatus: 'ready' },
      true,
    );
  });

  it('writes a value into the matching node config only', () => {
    const a = usePipelineStore.getState().addNode('fetch-feed', { x: 0, y: 0 }) ?? '';
    const b = usePipelineStore.getState().addNode('fetch-feed', { x: 0, y: 0 }) ?? '';

    usePipelineStore.getState().updateNodeConfig(a, ['url'], 'https://a.example/feed');

    const { nodes } = usePipelineStore.getState();
    expect(nodes.find((n) => n.id === a)?.data.config).toEqual({ url: 'https://a.example/feed' });
    expect(nodes.find((n) => n.id === b)?.data.config).toEqual({ url: '' });
  });

  it('edits nested filter rules and replaces arrays immutably', () => {
    const id = usePipelineStore.getState().addNode('filter', { x: 0, y: 0 }) ?? '';
    const { updateNodeConfig } = usePipelineStore.getState();

    updateNodeConfig(id, ['rules'], [{ field: '', op: 'contains', value: '' }]);
    const before = usePipelineStore.getState().nodes[0]?.data.config;
    updateNodeConfig(id, ['rules', 0, 'field'], 'title');

    const after = usePipelineStore.getState().nodes[0]?.data.config;
    expect(after).toEqual({ rules: [{ field: 'title', op: 'contains', value: '' }] });
    expect(before).toEqual({ rules: [{ field: '', op: 'contains', value: '' }] });
  });

  it('ignores unknown node ids', () => {
    usePipelineStore.getState().addNode('filter', { x: 0, y: 0 });
    const before = usePipelineStore.getState().nodes;
    usePipelineStore.getState().updateNodeConfig('missing', ['mode'], 'any');
    expect(usePipelineStore.getState().nodes).toEqual(before);
  });
});

describe('usePipelineStore canvas actions', () => {
  beforeEach(() => {
    usePipelineStore.setState(
      { ...initialState, modules: [feedModule, filterModule], modulesStatus: 'ready' },
      true,
    );
  });

  it('addNode creates a selected node with default config and focuses it', () => {
    const first = usePipelineStore.getState().addNode('fetch-feed', { x: 10, y: 20 });
    const second = usePipelineStore.getState().addNode('filter', { x: 30, y: 40 });

    expect(first).toMatch(/^node-/);
    expect(second).not.toBe(first);
    const state = usePipelineStore.getState();
    expect(state.nodes).toHaveLength(2);
    expect(state.nodes[0]).toMatchObject({
      id: first,
      position: { x: 10, y: 20 },
      selected: false,
      data: { moduleType: 'fetch-feed', config: { url: '' } },
    });
    expect(state.nodes[1]).toMatchObject({ id: second, selected: true });
    expect(state.selectedNodeId).toBe(second);
  });

  it('addNode ignores unknown module types', () => {
    expect(usePipelineStore.getState().addNode('nope', { x: 0, y: 0 })).toBeNull();
    expect(usePipelineStore.getState().nodes).toEqual([]);
  });

  it('selectNode highlights one node and null clears the selection', () => {
    const a = usePipelineStore.getState().addNode('fetch-feed', { x: 0, y: 0 });
    const b = usePipelineStore.getState().addNode('filter', { x: 0, y: 0 });

    usePipelineStore.getState().selectNode(a);
    expect(usePipelineStore.getState().selectedNodeId).toBe(a);
    expect(usePipelineStore.getState().nodes.map((n) => n.selected)).toEqual([true, false]);

    usePipelineStore.getState().selectNode(null);
    expect(usePipelineStore.getState().selectedNodeId).toBeNull();
    expect(usePipelineStore.getState().nodes.every((n) => !n.selected)).toBe(true);
    expect(b).not.toBeNull();
  });

  it('clears selectedNodeId when the selected node is removed', () => {
    const id = usePipelineStore.getState().addNode('filter', { x: 0, y: 0 }) ?? '';
    usePipelineStore.getState().onNodesChange([{ type: 'remove', id }]);
    const state = usePipelineStore.getState();
    expect(state.nodes).toEqual([]);
    expect(state.selectedNodeId).toBeNull();
  });

  it('onConnect adds an edge for compatible ports only', () => {
    const source = usePipelineStore.getState().addNode('fetch-feed', { x: 0, y: 0 }) ?? '';
    const target = usePipelineStore.getState().addNode('filter', { x: 0, y: 0 }) ?? '';

    usePipelineStore
      .getState()
      .onConnect({ source, sourceHandle: 'out', target, targetHandle: 'out' });
    expect(usePipelineStore.getState().edges).toEqual([]);

    usePipelineStore
      .getState()
      .onConnect({ source, sourceHandle: 'out', target, targetHandle: 'items' });
    expect(usePipelineStore.getState().edges).toMatchObject([
      { source, sourceHandle: 'out', target, targetHandle: 'items' },
    ]);
  });
});

describe('usePipelineStore.runPreview', () => {
  const previewBody = {
    success: false,
    nodeResults: {
      a: {
        items: [{ title: 'T', link: 'https://x.test/1', guid: 'g', date: '2026-01-01T00:00:00Z' }],
      },
      b: { items: [], error: { message: 'boom' } },
    },
    outputItems: [],
  };

  beforeEach(() => {
    usePipelineStore.setState(
      { ...initialState, modules: [feedModule, filterModule], modulesStatus: 'ready' },
      true,
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the canvas graph to /api/pipes/preview and stores nodeResults', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json(previewBody)));
    vi.stubGlobal('fetch', fetchMock);
    const source = usePipelineStore.getState().addNode('fetch-feed', { x: 5, y: 6 }) ?? '';
    const target = usePipelineStore.getState().addNode('filter', { x: 0, y: 0 }) ?? '';
    usePipelineStore
      .getState()
      .onConnect({ source, sourceHandle: 'out', target, targetHandle: 'items' });

    await usePipelineStore.getState().runPreview();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/pipes/preview');
    expect(init?.method).toBe('POST');
    const sent = JSON.parse(String(init?.body)) as {
      nodes: { id: string; type: string }[];
      edges: unknown[];
    };
    expect(sent.nodes.map((n) => n.type)).toEqual(['fetch-feed', 'filter']);
    expect(sent.edges).toEqual([{ source, sourcePort: 'out', target, targetPort: 'items' }]);
    const state = usePipelineStore.getState();
    expect(state.previewStatus).toBe('ready');
    expect(state.previewError).toBeNull();
    expect(state.nodeResults['b']?.error?.message).toBe('boom');
    expect(state.nodeResults['a']?.items).toHaveLength(1);
  });

  it('reports server validation errors and keeps earlier results', async () => {
    usePipelineStore.setState({ nodeResults: previewBody.nodeResults });
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            { error: 'Pipeline validation failed', errors: [{ message: 'No output node' }] },
            { status: 422 },
          ),
        ),
      ),
    );

    await usePipelineStore.getState().runPreview();

    const state = usePipelineStore.getState();
    expect(state.previewStatus).toBe('error');
    expect(state.previewError).toBe('No output node');
    expect(state.nodeResults).toEqual(previewBody.nodeResults);
  });

  it('reports network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    await usePipelineStore.getState().runPreview();
    expect(usePipelineStore.getState().previewError).toBe('offline');
  });

  it('lets only the latest run write results', async () => {
    const pending: ((r: Response) => void)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            pending.push(resolve);
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }),
      ),
    );

    const first = usePipelineStore.getState().runPreview();
    const second = usePipelineStore.getState().runPreview();
    pending[1]?.(
      Response.json({ success: true, nodeResults: { n: { items: [] } }, outputItems: [] }),
    );
    await Promise.all([first, second]);

    const state = usePipelineStore.getState();
    expect(Object.keys(state.nodeResults)).toEqual(['n']);
    expect(state.previewStatus).toBe('ready');
  });

  it('toggles auto-preview', () => {
    usePipelineStore.getState().setAutoPreview(true);
    expect(usePipelineStore.getState().autoPreview).toBe(true);
  });
});

describe('usePipelineStore save, load and new', () => {
  const stored = {
    meta: { id: 'my-pipe', name: 'My Pipe' },
    nodes: [
      {
        id: 'n1',
        type: 'fetch-feed',
        config: { url: 'https://a.example' },
        position: { x: 5, y: 6 },
      },
      { id: 'n2', type: 'filter', config: {}, position: { x: 7, y: 8 } },
    ],
    edges: [{ source: 'n1', sourcePort: 'out', target: 'n2', targetPort: 'items' }],
  };

  beforeEach(() => {
    usePipelineStore.setState(
      { ...initialState, modules: [feedModule, filterModule], modulesStatus: 'ready' },
      true,
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(response: () => Response) {
    const mock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(response()),
    );
    vi.stubGlobal('fetch', mock);
    return mock;
  }

  function buildGraph() {
    const source = usePipelineStore.getState().addNode('fetch-feed', { x: 1, y: 2 }) ?? '';
    const target = usePipelineStore.getState().addNode('filter', { x: 3, y: 4 }) ?? '';
    usePipelineStore
      .getState()
      .onConnect({ source, sourceHandle: 'out', target, targetHandle: 'items' });
    return { source, target };
  }

  it('POSTs a new pipeline with a slug from its name and records the server id', async () => {
    const { source, target } = buildGraph();
    const fetchMock = stubFetch(() =>
      Response.json({ ...stored, meta: { id: 'my-pipe-2', name: 'My Pipe' } }, { status: 201 }),
    );

    const saved = await usePipelineStore.getState().savePipeline('My Pipe');

    expect(saved).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/pipes');
    expect(init?.method).toBe('POST');
    const sent = JSON.parse(String(init?.body)) as {
      meta: unknown;
      nodes: { id: string }[];
      edges: unknown[];
    };
    expect(sent.meta).toEqual({ id: 'my-pipe', name: 'My Pipe' });
    expect(sent.nodes.map((n) => n.id)).toEqual([source, target]);
    expect(sent.edges).toEqual([{ source, sourcePort: 'out', target, targetPort: 'items' }]);
    const state = usePipelineStore.getState();
    expect(state.meta).toEqual({ id: 'my-pipe-2', name: 'My Pipe' });
    expect(state.toast).toMatchObject({ kind: 'success', message: 'Pipeline saved' });
    expect(state.saveStatus).toBe('idle');
  });

  it('PUTs an already saved pipeline to its own id', async () => {
    buildGraph();
    usePipelineStore.setState({ meta: { id: 'my-pipe', name: 'My Pipe' } });
    const fetchMock = stubFetch(() => Response.json(stored));

    expect(await usePipelineStore.getState().savePipeline()).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/pipes/my-pipe');
    expect(init?.method).toBe('PUT');
    expect(usePipelineStore.getState().toast?.message).toBe('Pipeline saved');
  });

  it('refuses to save a new pipeline without a name', async () => {
    const fetchMock = stubFetch(() => Response.json(stored));

    expect(await usePipelineStore.getState().savePipeline('   ')).toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(usePipelineStore.getState().toast).toMatchObject({ kind: 'error' });
  });

  it('shows the server validation errors from a 422 and keeps the pipeline unsaved', async () => {
    buildGraph();
    stubFetch(() =>
      Response.json(
        {
          error: 'Pipeline validation failed',
          errors: [{ message: 'Cycle detected: a -> b -> a' }],
        },
        { status: 422 },
      ),
    );

    expect(await usePipelineStore.getState().savePipeline('Bad')).toBe(false);

    const state = usePipelineStore.getState();
    expect(state.toast).toMatchObject({ kind: 'error', message: 'Cycle detected: a -> b -> a' });
    expect(state.meta.id).toBeNull();
    expect(state.saveStatus).toBe('idle');
  });

  it('reports a network failure while saving', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    expect(await usePipelineStore.getState().savePipeline('X')).toBe(false);
    expect(usePipelineStore.getState().toast).toMatchObject({ kind: 'error', message: 'offline' });
  });

  it('loadPipeList stores the id and name of each saved pipeline', async () => {
    const fetchMock = stubFetch(() => Response.json([{ id: 'my-pipe', name: 'My Pipe' }]));
    await usePipelineStore.getState().loadPipeList();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/pipes');
    const state = usePipelineStore.getState();
    expect(state.pipeList).toEqual([{ id: 'my-pipe', name: 'My Pipe' }]);
    expect(state.pipeListStatus).toBe('ready');
  });

  it('loadPipeList records an error on failure', async () => {
    stubFetch(() => new Response('boom', { status: 500 }));
    await usePipelineStore.getState().loadPipeList();
    const state = usePipelineStore.getState();
    expect(state.pipeListStatus).toBe('error');
    expect(state.pipeListError).toContain('500');
  });

  it('loadPipeline replaces the graph and clears selection and preview results', async () => {
    buildGraph();
    usePipelineStore.setState({
      nodeResults: { old: { items: [] } },
      previewStatus: 'ready',
      previewError: 'stale',
    });
    const fetchMock = stubFetch(() => Response.json(stored));

    expect(await usePipelineStore.getState().loadPipeline('my-pipe')).toBe(true);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/pipes/my-pipe');
    const state = usePipelineStore.getState();
    expect(state.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(state.nodes[0]).toMatchObject({
      position: { x: 5, y: 6 },
      data: { moduleType: 'fetch-feed', config: { url: 'https://a.example' } },
    });
    expect(state.edges).toMatchObject([
      { source: 'n1', sourceHandle: 'out', target: 'n2', targetHandle: 'items' },
    ]);
    expect(state.meta).toEqual({ id: 'my-pipe', name: 'My Pipe' });
    expect(state.selectedNodeId).toBeNull();
    expect(state.nodeResults).toEqual({});
    expect(state.previewStatus).toBe('idle');
    expect(state.previewError).toBeNull();
  });

  it('loadPipeline keeps the canvas and shows a toast when the pipeline is missing', async () => {
    buildGraph();
    stubFetch(() => Response.json({ error: 'Pipeline not found' }, { status: 404 }));

    expect(await usePipelineStore.getState().loadPipeline('gone')).toBe(false);

    const state = usePipelineStore.getState();
    expect(state.nodes).toHaveLength(2);
    expect(state.toast).toMatchObject({ kind: 'error', message: 'Pipeline not found' });
  });

  it('newPipeline resets nodes, edges, results, selection and identity', () => {
    buildGraph();
    usePipelineStore.setState({
      meta: { id: 'my-pipe', name: 'My Pipe' },
      nodeResults: { x: { items: [] } },
      previewStatus: 'ready',
    });

    usePipelineStore.getState().newPipeline();

    const state = usePipelineStore.getState();
    expect(state.nodes).toEqual([]);
    expect(state.edges).toEqual([]);
    expect(state.nodeResults).toEqual({});
    expect(state.selectedNodeId).toBeNull();
    expect(state.previewStatus).toBe('idle');
    expect(state.meta).toEqual({ id: null, name: '' });
  });

  it('dismissToast clears the toast', async () => {
    stubFetch(() => Response.json(stored));
    await usePipelineStore.getState().savePipeline('   ');
    usePipelineStore.getState().dismissToast();
    expect(usePipelineStore.getState().toast).toBeNull();
  });
});
