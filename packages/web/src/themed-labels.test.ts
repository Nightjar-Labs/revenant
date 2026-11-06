import { registerBuiltinModules } from '@revenant/engine';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigPanel } from './components/ConfigPanel.js';
import { ModuleNode } from './components/ModuleNode.js';
import { Sidebar } from './components/Sidebar.js';
import { fromPipelineDocument, type ModuleFlowNode } from './graph.js';
import { moduleLabel } from './labels.js';
import { usePipelineStore } from './store.js';
import type { ModuleInfo, PipelineDocument } from './types.js';

/** Module list as served by `GET /api/modules`, built from the real engine definitions. */
const modules: ModuleInfo[] = [...registerBuiltinModules(new Map()).values()].map((m) => ({
  type: m.type,
  ...(m.category === undefined ? {} : { category: m.category }),
  themedLabel: m.themedLabel,
  plainLabel: m.plainLabel,
  inputPorts: m.inputPorts,
  outputPorts: m.outputPorts,
  configSchema: {},
}));

/** Req 10.8: a themed label always carries its plain name, e.g. "Banish (Filter)". */
const showsBoth = (label: string, plain: string): boolean =>
  label === plain || label.endsWith(`(${plain})`);

const renderNode = (moduleType: string): string => {
  const props = {
    id: 'n1',
    data: { moduleType, config: {} },
    selected: false,
  } as unknown as NodeProps<ModuleFlowNode>;
  return renderToStaticMarkup(
    createElement(ReactFlowProvider, null, createElement(ModuleNode, props)),
  );
};

/**
 * Server rendering reads zustand's initial state, not the live state, so the fixture is written
 * into that object directly and restored after each test.
 */
const initialState = usePipelineStore.getInitialState();
const pristine = { ...initialState };
const seed = (patch: Partial<typeof initialState>): void => {
  Object.assign(initialState, patch);
};

describe('themed + plain module labels (Req 10.8)', () => {
  beforeEach(() => {
    seed({ modules, modulesStatus: 'ready' });
  });

  afterEach(() => {
    Object.assign(initialState, pristine);
  });

  it('every built-in module label shows the plain name', () => {
    expect(modules.length).toBeGreaterThan(0);
    for (const m of modules) {
      expect(showsBoth(moduleLabel(m), m.plainLabel), m.type).toBe(true);
    }
  });

  it('formats the steering examples', () => {
    const label = (type: string) => moduleLabel(modules.find((m) => m.type === type)!);
    expect(label('filter')).toBe('Banish (Filter)');
    expect(label('union')).toBe('Séance (Union)');
    expect(label('fetch-feed')).toBe('Summon (Fetch Feed)');
    expect(label('fetch-json')).toBe('Summon (Fetch JSON)');
  });

  it('shows the label in the palette', () => {
    const html = renderToStaticMarkup(createElement(Sidebar));
    for (const m of modules) expect(html).toContain(moduleLabel(m));
  });

  it('shows the label in the canvas node header', () => {
    for (const m of modules) {
      expect(renderNode(m.type)).toContain(`>${moduleLabel(m)}</div>`);
    }
  });

  it('shows the label in the config panel for the selected node', () => {
    for (const m of modules) {
      seed({
        nodes: [
          {
            id: 'n1',
            type: 'module',
            position: { x: 0, y: 0 },
            data: { moduleType: m.type, config: {} },
          },
        ],
        selectedNodeId: 'n1',
      });
      expect(renderToStaticMarkup(createElement(ConfigPanel))).toContain(
        `<h3>${moduleLabel(m)}</h3>`,
      );
    }
  });
});

describe('seeded example pipe in the editor', () => {
  const doc = JSON.parse(
    readFileSync(
      new URL('../../../data/pipes/hacker-news-rust-only.pipe.json', import.meta.url),
      'utf8',
    ),
  ) as PipelineDocument;

  beforeEach(() => {
    seed({ modules, modulesStatus: 'ready' });
  });

  afterEach(() => {
    Object.assign(initialState, pristine);
  });

  it('deserializes into a connected Summon -> Banish -> Arrange -> Raise Output chain', () => {
    const { nodes, edges } = fromPipelineDocument(doc);
    expect(nodes.map((n) => n.data.moduleType)).toEqual(['fetch-feed', 'filter', 'sort', 'output']);
    expect(edges.map((e) => [e.source, e.target])).toEqual([
      ['summon-hn', 'banish-not-rust'],
      ['banish-not-rust', 'arrange-newest-first'],
      ['arrange-newest-first', 'raise-output'],
    ]);
    // Every edge joins existing nodes through ports the modules actually declare.
    for (const edge of edges) {
      const from = nodes.find((n) => n.id === edge.source);
      const to = nodes.find((n) => n.id === edge.target);
      const fromModule = modules.find((m) => m.type === from?.data.moduleType);
      const toModule = modules.find((m) => m.type === to?.data.moduleType);
      expect(fromModule?.outputPorts).toContain(edge.sourceHandle);
      expect(toModule?.inputPorts).toContain(edge.targetHandle);
    }
  });

  it('renders every node with its themed + plain label', () => {
    const { nodes } = fromPipelineDocument(doc);
    const headers = nodes.map((n) => renderNode(n.data.moduleType));
    expect(headers[0]).toContain('Summon (Fetch Feed)');
    expect(headers[1]).toContain('Banish (Filter)');
    expect(headers[2]).toContain('Arrange (Sort)');
    expect(headers[3]).toContain('Raise Output (Output)');
  });
});
