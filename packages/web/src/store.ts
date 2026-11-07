import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type OnConnect,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import { create } from 'zustand';

import { fetchModules, fetchPipe, fetchPipeList, postPreview, savePipe } from './api.js';
import { setConfigValue, type ConfigPath } from './config-form.js';
import {
  canConnect,
  createModuleNode,
  fromPipelineDocument,
  slugify,
  toPipelinePayload,
  type ModuleFlowNode,
} from './graph.js';
import type { ModuleInfo, NodeResult, PipeSummary } from './types.js';

export type ModulesStatus = 'idle' | 'loading' | 'ready' | 'error';
export type PreviewStatus = 'idle' | 'running' | 'ready' | 'error';

export type SaveStatus = 'idle' | 'saving';
export type PipeListStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Short message shown after save/load; `key` changes for every toast so timers restart. */
export interface Toast {
  key: number;
  kind: 'success' | 'error';
  message: string;
}

/** Identity of the pipeline on the canvas. `id` is null until it has been saved once. */
export interface PipeMeta {
  id: string | null;
  name: string;
}

export interface PipelineStore {
  modules: ModuleInfo[];
  modulesStatus: ModulesStatus;
  modulesError: string | null;
  nodes: ModuleFlowNode[];
  edges: Edge[];
  /** Id of the node whose config panel and Ghost Inspector are shown, or null. */
  selectedNodeId: string | null;
  /** Per-node results of the last successful preview, keyed by node id (Req 10.4). */
  nodeResults: Record<string, NodeResult>;
  previewStatus: PreviewStatus;
  /** Why the last preview request failed (validation, timeout, network), or null. */
  previewError: string | null;
  /** When true the toolbar re-runs the preview after graph changes. */
  autoPreview: boolean;
  /** Pipeline being edited: saved id (null for a new pipeline) and its name. */
  meta: PipeMeta;
  saveStatus: SaveStatus;
  /** Bumped each time a saved pipeline is loaded; the canvas fits the view to it once per bump. */
  loadRevision: number;
  toast: Toast | null;
  /** Saved pipelines offered by the Load dialog. */
  pipeList: PipeSummary[];
  pipeListStatus: PipeListStatus;
  pipeListError: string | null;
  /**
   * Saves the canvas (Req 10.6): POST for a new pipeline, PUT for one that already has an id.
   * `name` sets the pipeline name and is required while the pipeline is still unsaved.
   * Returns true on success; failures are reported in a toast.
   */
  savePipeline: (name?: string) => Promise<boolean>;
  /** Fetches the saved pipeline list for the Load dialog. */
  loadPipeList: () => Promise<void>;
  /** Loads a saved pipeline onto the canvas, replacing the current graph (Req 10.7). */
  loadPipeline: (id: string) => Promise<boolean>;
  /** Clears the canvas and starts an unsaved pipeline. */
  newPipeline: () => void;
  dismissToast: () => void;
  /** Runs `POST /api/pipes/preview` for the current canvas and stores `nodeResults` (Req 10.5). */
  runPreview: () => Promise<void>;
  setAutoPreview: (enabled: boolean) => void;
  /** Loads the module registry from `GET /api/modules` (Req 9.8). */
  loadModules: () => Promise<void>;
  /** Adds a node for `moduleType` at `position`, selects it, and returns its id (null if unknown). */
  addNode: (moduleType: string, position: { x: number; y: number }) => string | null;
  /** Selects a node (or clears the selection with null) and highlights it on the canvas. */
  selectNode: (nodeId: string | null) => void;
  /** Stores `value` at `path` inside a node's config (`undefined` removes the key). */
  updateNodeConfig: (nodeId: string, path: ConfigPath, value: unknown) => void;
  onNodesChange: OnNodesChange<ModuleFlowNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
}

/** Aborts the in-flight preview when a newer one starts, so stale results never overwrite fresh ones. */
let previewController: AbortController | undefined;

let toastCounter = 0;
const makeToast = (kind: Toast['kind'], message: string): Toast => ({
  key: ++toastCounter,
  kind,
  message,
});

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

/** Drops everything derived from the previous graph: selection and preview results. */
function resetCanvasState(): Pick<
  PipelineStore,
  'selectedNodeId' | 'nodeResults' | 'previewStatus' | 'previewError'
> {
  previewController?.abort();
  return { selectedNodeId: null, nodeResults: {}, previewStatus: 'idle', previewError: null };
}

export const usePipelineStore = create<PipelineStore>((set, get) => ({
  modules: [],
  modulesStatus: 'idle',
  modulesError: null,
  nodes: [],
  edges: [],
  selectedNodeId: null,
  nodeResults: {},
  previewStatus: 'idle',
  previewError: null,
  autoPreview: false,
  meta: { id: null, name: '' },
  saveStatus: 'idle',
  loadRevision: 0,
  toast: null,
  pipeList: [],
  pipeListStatus: 'idle',
  pipeListError: null,
  savePipeline: async (name) => {
    const { nodes, edges, meta, saveStatus } = get();
    if (saveStatus === 'saving') return false;
    const pipeName = (name ?? meta.name).trim();
    if (pipeName === '') {
      set({ toast: makeToast('error', 'Pipeline name is required') });
      return false;
    }
    // For a new pipeline the server makes the slug unique; the one sent here only has to be valid.
    const payload = toPipelinePayload(nodes, edges, {
      id: meta.id ?? slugify(pipeName),
      name: pipeName,
    });
    set({ saveStatus: 'saving' });
    try {
      const saved = await savePipe(meta.id, payload);
      set({
        meta: { id: saved.meta.id, name: saved.meta.name },
        saveStatus: 'idle',
        toast: makeToast('success', 'Pipeline saved'),
      });
      return true;
    } catch (error) {
      set({
        saveStatus: 'idle',
        toast: makeToast('error', errorMessage(error, 'Failed to save pipeline')),
      });
      return false;
    }
  },
  loadPipeList: async () => {
    set({ pipeListStatus: 'loading', pipeListError: null });
    try {
      set({ pipeList: await fetchPipeList(), pipeListStatus: 'ready' });
    } catch (error) {
      set({
        pipeListStatus: 'error',
        pipeListError: errorMessage(error, 'Failed to list pipelines'),
      });
    }
  },
  loadPipeline: async (id) => {
    try {
      const doc = await fetchPipe(id);
      const { nodes, edges } = fromPipelineDocument(doc);
      set({
        nodes,
        edges,
        meta: { id: doc.meta.id, name: doc.meta.name },
        loadRevision: get().loadRevision + 1,
        ...resetCanvasState(),
      });
      return true;
    } catch (error) {
      set({ toast: makeToast('error', errorMessage(error, 'Failed to load pipeline')) });
      return false;
    }
  },
  newPipeline: () => {
    set({ nodes: [], edges: [], meta: { id: null, name: '' }, ...resetCanvasState() });
  },
  dismissToast: () => {
    set({ toast: null });
  },
  runPreview: async () => {
    previewController?.abort();
    const controller = new AbortController();
    previewController = controller;
    const { nodes, edges } = get();
    set({ previewStatus: 'running', previewError: null });
    try {
      const result = await postPreview(toPipelinePayload(nodes, edges), controller.signal);
      if (controller.signal.aborted) return;
      set({ nodeResults: result.nodeResults, previewStatus: 'ready' });
    } catch (error) {
      if (controller.signal.aborted) return;
      set({
        previewStatus: 'error',
        previewError: error instanceof Error ? error.message : 'Preview failed',
      });
    }
  },
  setAutoPreview: (enabled) => {
    set({ autoPreview: enabled });
  },
  loadModules: async () => {
    set({ modulesStatus: 'loading', modulesError: null });
    try {
      set({ modules: await fetchModules(), modulesStatus: 'ready' });
    } catch (error) {
      set({
        modulesStatus: 'error',
        modulesError: error instanceof Error ? error.message : 'Failed to load modules',
      });
    }
  },
  addNode: (moduleType, position) => {
    const module = get().modules.find((m) => m.type === moduleType);
    if (!module) return null;
    const node = createModuleNode(module, position);
    set({
      nodes: [...get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), node],
      selectedNodeId: node.id,
    });
    return node.id;
  },
  selectNode: (nodeId) => {
    set({
      nodes: get().nodes.map((n) => {
        const selected = n.id === nodeId;
        return n.selected === selected ? n : { ...n, selected };
      }),
      selectedNodeId: nodeId,
    });
  },
  updateNodeConfig: (nodeId, path, value) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, config: setConfigValue(n.data.config, path, value) } }
          : n,
      ),
    });
  },
  onNodesChange: (changes) => {
    const { nodes, selectedNodeId } = get();
    const removed = changes.some((c) => c.type === 'remove' && c.id === selectedNodeId);
    set({
      nodes: applyNodeChanges(changes, nodes),
      selectedNodeId: removed ? null : selectedNodeId,
    });
  },
  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },
  onConnect: (connection) => {
    const { nodes, modules, edges } = get();
    // Defence in depth: the canvas already rejects these through `isValidConnection`.
    if (!canConnect(connection, nodes, modules)) return;
    set({ edges: addEdge(connection, edges) });
  },
}));
