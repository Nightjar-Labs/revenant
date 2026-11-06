import { useEffect } from 'react';

import { Canvas } from './components/Canvas.js';
import { ConfigPanel } from './components/ConfigPanel.js';
import { GhostInspector } from './components/GhostInspector.js';
import { Sidebar } from './components/Sidebar.js';
import { Toast } from './components/Toast.js';
import { Toolbar } from './components/Toolbar.js';
import { usePipelineStore } from './store.js';

export function App() {
  const loadModules = usePipelineStore((s) => s.loadModules);

  useEffect(() => {
    void loadModules();
  }, [loadModules]);

  return (
    <div className="app">
      <Toolbar />
      <Sidebar />
      <Canvas />
      <ConfigPanel />
      <GhostInspector />
      <Toast />
    </div>
  );
}
