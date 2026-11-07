import { useEffect, useState } from 'react';

import { graphSignature } from '../graph.js';
import { usePipelineStore } from '../store.js';
import { HauntingPanel } from './HauntingPanel.js';
import { LoadDialog, SaveDialog } from './PipeDialogs.js';

/** Delay between the last graph change and the automatic preview run (task 18.3). */
export const AUTO_PREVIEW_DEBOUNCE_MS = 1000;

/** Top bar: New, Save, Load, Run Preview and the auto-preview toggle (Req 10.5-10.7). */
export function Toolbar() {
  const runPreview = usePipelineStore((s) => s.runPreview);
  const setAutoPreview = usePipelineStore((s) => s.setAutoPreview);
  const autoPreview = usePipelineStore((s) => s.autoPreview);
  const status = usePipelineStore((s) => s.previewStatus);
  const metaId = usePipelineStore((s) => s.meta.id);
  const metaName = usePipelineStore((s) => s.meta.name);
  const saving = usePipelineStore((s) => s.saveStatus === 'saving');
  const savePipeline = usePipelineStore((s) => s.savePipeline);
  const newPipeline = usePipelineStore((s) => s.newPipeline);
  const [dialog, setDialog] = useState<'save' | 'load' | null>(null);
  const signature = usePipelineStore((s) => graphSignature(s.nodes, s.edges));

  // Re-run after the graph has been quiet for a second. The signature ignores node positions
  // and selection, so dragging or clicking a node does not trigger a run.
  useEffect(() => {
    if (!autoPreview) return;
    const timer = setTimeout(() => {
      void runPreview();
    }, AUTO_PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [autoPreview, signature, runPreview]);

  return (
    <header className="toolbar" aria-label="Toolbar">
      <strong className="toolbar-title">Revenant</strong>
      <button type="button" onClick={newPipeline}>
        New
      </button>
      <button
        type="button"
        disabled={saving}
        onClick={() => {
          if (metaId === null) setDialog('save');
          else void savePipeline();
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => {
          setDialog('load');
        }}
      >
        Load
      </button>
      <button
        type="button"
        onClick={() => {
          void runPreview();
        }}
        disabled={status === 'running'}
      >
        {status === 'running' ? 'Running…' : 'Run Preview'}
      </button>
      <label className="toolbar-toggle">
        <input
          type="checkbox"
          checked={autoPreview}
          onChange={(event) => {
            setAutoPreview(event.target.checked);
          }}
        />
        Auto-preview
      </label>
      <span className="toolbar-pipe muted">{metaName === '' ? 'Unsaved pipeline' : metaName}</span>
      <HauntingPanel />
      {dialog === 'save' && (
        <SaveDialog
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
      {dialog === 'load' && (
        <LoadDialog
          onClose={() => {
            setDialog(null);
          }}
        />
      )}
    </header>
  );
}
