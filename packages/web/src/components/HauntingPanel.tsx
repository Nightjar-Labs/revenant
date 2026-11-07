import { useEffect, useRef, useState } from 'react';

import { copyToClipboard, hauntingUrls } from '../haunting.js';
import { usePipelineStore } from '../store.js';

const COPIED_MS = 1500;

export interface HauntingPanelViewProps {
  /** Saved pipeline id, or null while the pipeline is unsaved (nothing is shown then). */
  pipeId: string | null;
  /** Origin the URLs are built on, normally `window.location.origin`. */
  origin: string;
  /** Copies a URL; injectable so tests need no browser. */
  onCopy?: (url: string) => Promise<boolean>;
}

/** The three Haunting (output feed) URLs of a saved pipeline, each with a copy button. */
export function HauntingPanelView({
  pipeId,
  origin,
  onCopy = copyToClipboard,
}: HauntingPanelViewProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (pipeId === null) return null;

  const copy = (url: string) => {
    void onCopy(url).then((ok) => {
      if (!ok) return;
      setCopied(url);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(null);
      }, COPIED_MS);
    });
  };

  return (
    <section className="haunting-panel" aria-label="Subscribe">
      <strong className="haunting-title">Subscribe: Haunting (Output feed URL)</strong>
      <ul className="haunting-list">
        {hauntingUrls(origin, pipeId).map(({ extension, format, url }) => (
          <li key={extension} className="haunting-item">
            <span className="haunting-format">{format}</span>
            <input
              type="text"
              readOnly
              className="haunting-url"
              value={url}
              aria-label={`${format} URL`}
              onFocus={(event) => {
                event.target.select();
              }}
            />
            <button
              type="button"
              aria-label={`Copy ${format} URL`}
              onClick={() => {
                copy(url);
              }}
            >
              {copied === url ? 'Copied' : 'Copy'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Store-connected panel: appears once the pipeline has a saved id (after Save or Load). */
export function HauntingPanel() {
  const pipeId = usePipelineStore((s) => s.meta.id);
  return <HauntingPanelView pipeId={pipeId} origin={window.location.origin} />;
}
