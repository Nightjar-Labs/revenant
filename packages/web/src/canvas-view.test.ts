import { getViewportForBounds } from '@xyflow/react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_VIEWPORT, FIT_VIEW_OPTIONS } from './canvas-view.js';
import { usePipelineStore } from './store.js';
import type { ModuleInfo } from './types.js';

const module = (type: string): ModuleInfo => ({
  type,
  category: 'operators',
  themedLabel: type,
  plainLabel: type,
  inputPorts: ['items'],
  outputPorts: ['out'],
  configSchema: { type: 'object' },
});

describe('canvas zoom behaviour', () => {
  const initialState = usePipelineStore.getState();

  beforeEach(() => {
    usePipelineStore.setState(
      { ...initialState, modules: [module('filter')], modulesStatus: 'ready' },
      true,
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts at the default 1x zoom', () => {
    expect(DEFAULT_VIEWPORT.zoom).toBe(1);
  });

  it('never fits above 1x, even for a single small node (the reported 2x zoom)', () => {
    const width = 1000;
    const height = 600;
    const oneNode = { x: 300, y: 200, width: 180, height: 80 };
    const padding = FIT_VIEW_OPTIONS.padding ?? 0;

    // Library default maxZoom is 2: this is what zoomed the first drop to 2x.
    expect(getViewportForBounds(oneNode, width, height, 0.5, 2, padding).zoom).toBe(2);
    const capped = getViewportForBounds(
      oneNode,
      width,
      height,
      0.5,
      FIT_VIEW_OPTIONS.maxZoom ?? 2,
      padding,
    );
    expect(capped.zoom).toBe(1);
  });

  it('keeps nodes dropped at different points at their own flow positions', () => {
    const first = usePipelineStore.getState().addNode('filter', { x: 100, y: 100 });
    const second = usePipelineStore.getState().addNode('filter', { x: 400, y: 250 });
    const nodes = usePipelineStore.getState().nodes;
    expect(nodes.find((n) => n.id === first)?.position).toEqual({ x: 100, y: 100 });
    expect(nodes.find((n) => n.id === second)?.position).toEqual({ x: 400, y: 250 });
    // Adding nodes must not ask the canvas to re-fit the view.
    expect(usePipelineStore.getState().loadRevision).toBe(0);
  });

  it('asks for a fit only when a saved pipeline is loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(Response.json({ meta: { id: 'p', name: 'P' }, nodes: [], edges: [] })),
      ),
    );
    await usePipelineStore.getState().loadPipeline('p');
    expect(usePipelineStore.getState().loadRevision).toBe(1);
    usePipelineStore.getState().addNode('filter', { x: 0, y: 0 });
    expect(usePipelineStore.getState().loadRevision).toBe(1);
  });

  it('does not enable the auto-fitting fitView prop on the canvas', () => {
    const source = readFileSync(new URL('./components/Canvas.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*fitView\s*$/m);
    expect(source).not.toMatch(/\bfitView=/);
  });
});
