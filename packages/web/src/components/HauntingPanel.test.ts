import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hauntingUrls } from '../haunting.js';
import { usePipelineStore } from '../store.js';
import { HauntingPanelView } from './HauntingPanel.js';
import { Toolbar } from './Toolbar.js';

const ORIGIN = 'https://revenant.test:8443';

const renderView = (pipeId: string | null, origin = ORIGIN): string =>
  renderToStaticMarkup(createElement(HauntingPanelView, { pipeId, origin }));

describe('hauntingUrls', () => {
  it('builds absolute /h/<id>.xml|.atom|.json URLs with the format names', () => {
    expect(hauntingUrls(ORIGIN, 'hacker-news-rust-only')).toEqual([
      {
        extension: 'xml',
        format: 'RSS 2.0',
        url: `${ORIGIN}/h/hacker-news-rust-only.xml`,
      },
      {
        extension: 'atom',
        format: 'Atom',
        url: `${ORIGIN}/h/hacker-news-rust-only.atom`,
      },
      {
        extension: 'json',
        format: 'JSON Feed',
        url: `${ORIGIN}/h/hacker-news-rust-only.json`,
      },
    ]);
  });

  it('does not double the slash when the origin ends with one', () => {
    expect(hauntingUrls(`${ORIGIN}/`, 'a').map((u) => u.url)[0]).toBe(`${ORIGIN}/h/a.xml`);
  });
});

describe('HauntingPanelView', () => {
  it('renders nothing for an unsaved pipeline', () => {
    expect(renderView(null)).toBe('');
  });

  it('shows the three URLs, format names, copy buttons and the themed + plain label', () => {
    const html = renderView('my-pipe');
    expect(html).toContain('Haunting (Output feed URL)');
    for (const [format, path] of [
      ['RSS 2.0', 'my-pipe.xml'],
      ['Atom', 'my-pipe.atom'],
      ['JSON Feed', 'my-pipe.json'],
    ] as const) {
      expect(html).toContain(`>${format}<`);
      expect(html).toContain(`value="${ORIGIN}/h/${path}"`);
      expect(html).toContain(`aria-label="Copy ${format} URL"`);
    }
    expect(html.match(/>Copy</g)).toHaveLength(3);
  });
});

describe('Toolbar Haunting URLs', () => {
  // Server rendering reads zustand's initial state, so the live `meta` is copied into it before
  // rendering and restored after each test (same approach as themed-labels.test.ts).
  const initialState = usePipelineStore.getInitialState();
  const pristine = { ...initialState };

  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: ORIGIN } });
    usePipelineStore.setState({ ...pristine }, true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.assign(initialState, pristine);
  });

  const renderToolbar = (): string => {
    Object.assign(initialState, { meta: usePipelineStore.getState().meta });
    return renderToStaticMarkup(createElement(Toolbar));
  };

  it('hides the URLs for an unsaved pipeline and shows them with the saved id after Save', async () => {
    expect(renderToolbar()).not.toContain('/h/');

    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json(
            { meta: { id: 'my-pipe-2', name: 'My Pipe' }, nodes: [], edges: [] },
            { status: 201 },
          ),
        ),
      ),
    );
    expect(await usePipelineStore.getState().savePipeline('My Pipe')).toBe(true);

    const html = renderToolbar();
    expect(html).toContain(`value="${ORIGIN}/h/my-pipe-2.xml"`);
    expect(html).toContain(`value="${ORIGIN}/h/my-pipe-2.atom"`);
    expect(html).toContain(`value="${ORIGIN}/h/my-pipe-2.json"`);
  });

  it('shows the URLs of a loaded pipeline and hides them again after New', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          Response.json({ meta: { id: 'loaded', name: 'Loaded' }, nodes: [], edges: [] }),
        ),
      ),
    );
    expect(await usePipelineStore.getState().loadPipeline('loaded')).toBe(true);
    expect(renderToolbar()).toContain(`value="${ORIGIN}/h/loaded.json"`);

    usePipelineStore.getState().newPipeline();
    expect(renderToolbar()).not.toContain('/h/');
  });

  it('does not show URLs when saving fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('boom', { status: 500 }))),
    );
    expect(await usePipelineStore.getState().savePipeline('Nope')).toBe(false);
    expect(renderToolbar()).not.toContain('/h/');
  });
});
