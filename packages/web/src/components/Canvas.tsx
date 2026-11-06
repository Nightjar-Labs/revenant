import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type IsValidConnection,
  type NodeTypes,
  type OnConnectEnd,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';

import { canConnect, DRAG_MIME, INCOMPATIBLE_PORTS_MESSAGE } from '../graph.js';
import { usePipelineStore } from '../store.js';
import { ModuleNode } from './ModuleNode.js';

const nodeTypes: NodeTypes = { module: ModuleNode };
const TOOLTIP_MS = 2000;

interface TooltipState {
  x: number;
  y: number;
}

function CanvasInner() {
  const nodes = usePipelineStore((s) => s.nodes);
  const edges = usePipelineStore((s) => s.edges);
  const onNodesChange = usePipelineStore((s) => s.onNodesChange);
  const onEdgesChange = usePipelineStore((s) => s.onEdgesChange);
  const onConnect = usePipelineStore((s) => s.onConnect);
  const addNode = usePipelineStore((s) => s.addNode);
  const selectNode = usePipelineStore((s) => s.selectNode);
  const { screenToFlowPosition } = useReactFlow();

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(tooltipTimer.current), []);

  const onDragOver = useCallback((event: DragEvent) => {
    if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      const moduleType = event.dataTransfer.getData(DRAG_MIME);
      if (!moduleType) return;
      event.preventDefault();
      addNode(moduleType, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [addNode, screenToFlowPosition],
  );

  // Read the latest store state at call time so the callback identity stays stable.
  const isValidConnection = useCallback<IsValidConnection>((connection) => {
    const { nodes: current, modules } = usePipelineStore.getState();
    return canConnect(connection, current, modules);
  }, []);

  const onConnectEnd = useCallback<OnConnectEnd>((event, connectionState) => {
    // Released on a port but the connection was refused: explain why.
    if (connectionState.toHandle === null || connectionState.isValid !== false) return;
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    if (!point) return;
    setTooltip({ x: point.clientX, y: point.clientY });
    clearTimeout(tooltipTimer.current);
    tooltipTimer.current = setTimeout(() => {
      setTooltip(null);
    }, TOOLTIP_MS);
  }, []);

  return (
    <main className="pane canvas" aria-label="Canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onNodeClick={(_event, node) => {
          selectNode(node.id);
        }}
        onPaneClick={() => {
          selectNode(null);
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
        colorMode="dark"
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
      {tooltip && (
        <div
          className="connection-tooltip"
          role="alert"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {INCOMPATIBLE_PORTS_MESSAGE}
        </div>
      )}
    </main>
  );
}

/** Center pane: the @xyflow/react pipeline canvas (Req 10.1-10.3). */
export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
