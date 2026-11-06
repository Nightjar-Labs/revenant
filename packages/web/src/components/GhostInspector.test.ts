import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GhostInspectorView, type GhostInspectorViewProps } from './GhostInspector.js';

function render(props: Partial<GhostInspectorViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(GhostInspectorView, {
      nodeLabel: 'Banish (Filter)',
      result: undefined,
      previewError: null,
      ...props,
    }),
  );
}

const makeItems = (count: number) =>
  Array.from({ length: count }, (_, n) => ({
    title: `Title ${String(n)}`,
    link: `https://x.test/${String(n)}`,
    guid: `g${String(n)}`,
    date: '2026-01-01T00:00:00Z',
  }));

describe('GhostInspector', () => {
  it('asks for a selection when no node is selected', () => {
    expect(render({ nodeLabel: null })).toContain('Select a node to inspect');
  });

  it('shows Title, Link and Date columns with the selected node items', () => {
    const html = render({ result: { items: makeItems(2) } });
    expect(html).toContain('<th>Title</th>');
    expect(html).toContain('<th>Link</th>');
    expect(html).toContain('<th>Date</th>');
    expect(html).toContain('Title 0');
    expect(html).toContain('href="https://x.test/1"');
    expect(html).not.toContain('Showing the first');
  });

  it('renders at most 20 rows and says how many were left out', () => {
    const html = render({ result: { items: makeItems(30) } });
    expect(html.match(/<tr>/g)).toHaveLength(21); // header row + 20 items
    expect(html).toContain('Title 19');
    expect(html).not.toContain('Title 20');
    expect(html).toContain('Showing the first 20 of 30 items');
  });

  it('shows the node error in a banner above the table', () => {
    const html = render({ result: { items: [], error: { message: 'Upstream fetch failed' } } });
    expect(html).toContain('error-banner');
    expect(html).toContain('Upstream fetch failed');
    expect(html).not.toContain('<table');
  });

  it('does not turn non-http links into anchors', () => {
    const items = [{ ...makeItems(1)[0]!, link: 'javascript:alert(1)' }];
    const html = render({ result: { items } });
    expect(html).not.toContain('href="javascript');
  });

  it('shows a hint before any preview has run', () => {
    expect(render()).toContain('Run Preview');
  });

  it('shows a failed preview request', () => {
    expect(render({ previewError: 'No output node' })).toContain('Preview failed: No output node');
  });
});
