import { getFlowTranslateExtent, type FlowLayoutMetrics } from "./flowAdapter";

export interface FlowViewportState {
  x: number;
  y: number;
  zoom: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampBetween(value: number, min: number, max: number) {
  if (min > max) {
    return (min + max) / 2;
  }

  return clamp(value, min, max);
}

export function clampFlowViewportPosition(
  viewport: FlowViewportState,
  metrics: FlowLayoutMetrics,
  shellWidth: number,
  shellHeight: number,
  minZoom: number,
  maxZoom: number,
): FlowViewportState {
  const nextZoom = clamp(viewport.zoom, minZoom, maxZoom);
  const extent = getFlowTranslateExtent(metrics, shellWidth, shellHeight, minZoom);
  const minX = shellWidth - extent[1][0] * nextZoom;
  const maxX = -extent[0][0] * nextZoom;
  const minY = shellHeight - extent[1][1] * nextZoom;
  const maxY = -extent[0][1] * nextZoom;

  return {
    ...viewport,
    zoom: nextZoom,
    x: clampBetween(viewport.x, minX, maxX),
    y: clampBetween(viewport.y, minY, maxY),
  };
}

export function fitFlowViewportToBounds(
  bounds: { x: number; y: number; width: number; height: number },
  viewportWidth: number,
  viewportHeight: number,
  minZoom: number,
  maxZoom: number,
  padding = 0.14,
): FlowViewportState {
  const safePadding = clamp(padding, 0, 0.42);
  const paddedWidth = Math.max(1, bounds.width);
  const paddedHeight = Math.max(1, bounds.height);
  const zoom = clamp(
    Math.min(
      (viewportWidth * (1 - safePadding * 2)) / paddedWidth,
      (viewportHeight * (1 - safePadding * 2)) / paddedHeight,
    ),
    minZoom,
    maxZoom,
  );

  return {
    zoom,
    x: viewportWidth / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: viewportHeight / 2 - (bounds.y + bounds.height / 2) * zoom,
  };
}

export function zoomFlowViewportAroundPoint(
  viewport: FlowViewportState,
  factor: number,
  focalPoint: { x: number; y: number },
  minZoom: number,
  maxZoom: number,
): FlowViewportState {
  const nextZoom = clamp(viewport.zoom * factor, minZoom, maxZoom);
  const boardX = (focalPoint.x - viewport.x) / viewport.zoom;
  const boardY = (focalPoint.y - viewport.y) / viewport.zoom;

  return {
    zoom: nextZoom,
    x: focalPoint.x - boardX * nextZoom,
    y: focalPoint.y - boardY * nextZoom,
  };
}

export function panFlowViewport(
  viewport: FlowViewportState,
  deltaX: number,
  deltaY: number,
): FlowViewportState {
  return {
    ...viewport,
    x: viewport.x - deltaX,
    y: viewport.y - deltaY,
  };
}