import { useEffect, useState, type FormEvent } from 'react';

import { usePipelineStore } from '../store.js';
import { Modal } from './Modal.js';

/** Asks for a pipeline name before the first save, then saves (Req 10.6). */
export function SaveDialog({ onClose }: { onClose: () => void }) {
  const savePipeline = usePipelineStore((s) => s.savePipeline);
  const saving = usePipelineStore((s) => s.saveStatus === 'saving');
  const [name, setName] = useState(() => usePipelineStore.getState().meta.name);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void savePipeline(name).then((saved) => {
      if (saved) onClose();
    });
  };

  return (
    <Modal title="Save pipeline" onClose={onClose}>
      <form onSubmit={submit} className="modal-form">
        <label>
          Pipeline name
          <input
            type="text"
            value={name}
            autoFocus
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving || name.trim() === ''}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Lists saved pipelines (id + name) and loads the chosen one (Req 10.7). */
export function LoadDialog({ onClose }: { onClose: () => void }) {
  const pipeList = usePipelineStore((s) => s.pipeList);
  const status = usePipelineStore((s) => s.pipeListStatus);
  const error = usePipelineStore((s) => s.pipeListError);
  const loadPipeList = usePipelineStore((s) => s.loadPipeList);
  const loadPipeline = usePipelineStore((s) => s.loadPipeline);

  useEffect(() => {
    void loadPipeList();
  }, [loadPipeList]);

  return (
    <Modal title="Load pipeline" onClose={onClose}>
      {status === 'loading' && <p className="muted">Loading…</p>}
      {status === 'error' && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status === 'ready' && pipeList.length === 0 && <p className="muted">No saved pipelines.</p>}
      {status === 'ready' && pipeList.length > 0 && (
        <ul className="pipe-list">
          {pipeList.map((pipe) => (
            <li key={pipe.id}>
              <button
                type="button"
                onClick={() => {
                  void loadPipeline(pipe.id).then((loaded) => {
                    if (loaded) onClose();
                  });
                }}
              >
                <span className="pipe-name">{pipe.name}</span>
                <span className="pipe-id">{pipe.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
