import type { FitViewOptions, Viewport } from '@xyflow/react';

/**
 * Viewport behaviour of the canvas. The view starts at 1x and is not fitted when nodes are added,
 * so a node dropped onto an empty canvas stays where it was dropped and later drops do not overlap.
 */
export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/** Fitting (used only after a pipeline is loaded) never zooms in past the default 1x. */
export const FIT_VIEW_OPTIONS: FitViewOptions = { padding: 0.2, maxZoom: 1 };
