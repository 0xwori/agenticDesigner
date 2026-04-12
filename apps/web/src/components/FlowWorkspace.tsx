import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  FlowArtifact,
  FlowDocument,
  FlowHandleSide,
  FrameVersion,
  FrameWithVersions,
  UploadedImageArtifact,
} from "@designer/shared";
import {
  createEmptyFlowDocument,
  FLOW_LANE_LABELS,
  getFlowSourceHandleId,
  getFlowTargetHandleId,
  isFlowCellOccupied,
  normalizeFlowConnection,
  resolveFlowInsertColumn,
} from "@designer/shared";
import { Code, FileText, LayoutDashboard, Plus, Upload, Workflow, X } from "lucide-react";

import { FlowChromeLayer } from "./flow/FlowChrome";
import { FlowArtifactCard } from "./flow/FlowArtifactCard";
import {
  buildFlowBoardLayout,
  getFlowAreaBounds,
  getFlowDocumentBounds,
  getFlowGridSlotAtPosition,
  getFlowLaneHeight,
  getFlowLaneTop,
  getFlowNodeHandlePosition,
  getFlowSlotCenter,
  getFlowTranslateExtent,
  isValidFlowConnectionBetweenCells,
  type FlowBoardCellLayout,
  type FlowGridSlot,
} from "../lib/flowAdapter";

type FlowWorkspaceProps = {
  frame: FrameWithVersions;
  flowDocument?: FlowDocument;
  viewportWidth: number;
  viewportHeight: number;
  allDesignFrames: FrameWithVersions[];
  allFlowFrames: FrameWithVersions[];
  onFlowDocumentChange?: (frameId: string, doc: FlowDocument) => void;
  buildPreviewDocument: (frameId: string, version?: FrameVersion, isBuilding?: boolean) => string;
  onFocusedAreaChange?: (areaId: string | null) => void;
  onExitToDesign?: () => void;
  onSelectFlowBoard?: (frameId: string) => Promise<void> | void;
  onCreateFlowBoard?: () => Promise<void> | void;
  onDeleteBoard?: (frameId: string) => Promise<void> | void;
  onAskAgentForBoard?: (frameId: string) => Promise<void> | void;
  onOpenFlowStory?: (frameId: string) => Promise<void> | void;
  boardBusyState?: "agent" | "story" | null;
};

type ViewportState = {
  x: number;
  y: number;
  zoom: number;
};

type SlotMenuState = FlowGridSlot | null;

type PointerPanState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startViewport: ViewportState;
};

type NodeDragState = {
  pointerId: number;
  cellId: string;
  areaId: string;
  laneId: FlowBoardCellLayout["laneId"];
  column: number;
  width: number;
  height: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  position: { x: number; y: number };
  slot: FlowGridSlot | null;
};

type ConnectionDraftState = {
  pointerId: number;
  fromCellId: string;
  sourceSide: FlowHandleSide;
  startPoint: { x: number; y: number };
  currentPoint: { x: number; y: number };
};

const FLOW_WORKSPACE_MIN_ZOOM = 0.35;
const FLOW_WORKSPACE_MAX_ZOOM = 1.8;

function newCellId() {
  return crypto.randomUUID();
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

function loadImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Failed to read image size."));
    image.src = dataUrl;
  });
}

async function readImageArtifact(file: File): Promise<UploadedImageArtifact> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });

  try {
    const { width, height } = await loadImageSize(dataUrl);
    return {
      type: "uploaded-image",
      dataUrl,
      label: file.name,
      width,
      height,
    };
  } catch {
    return {
      type: "uploaded-image",
      dataUrl,
      label: file.name,
    };
  }
}

function isExactConnectionDuplicate(
  doc: FlowDocument,
  nextConnection: Pick<FlowDocument["connections"][number], "fromCellId" | "toCellId" | "sourceHandle" | "targetHandle">,
  ignoreEdgeId?: string,
) {
  return doc.connections.some(
    (connection) =>
      connection.id !== ignoreEdgeId &&
      connection.fromCellId === nextConnection.fromCellId &&
      connection.toCellId === nextConnection.toCellId &&
      connection.sourceHandle === nextConnection.sourceHandle &&
      connection.targetHandle === nextConnection.targetHandle,
  );
}

function isInteractiveElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      "button, input, textarea, select, label, [data-flow-node-interactive='true'], .flow-frame-picker, .flow-lane__menu",
    ),
  );
}

function cubicPointAt(
  start: { x: number; y: number },
  controlA: { x: number; y: number },
  controlB: { x: number; y: number },
  end: { x: number; y: number },
  t: number,
) {
  const inv = 1 - t;
  const x =
    inv * inv * inv * start.x +
    3 * inv * inv * t * controlA.x +
    3 * inv * t * t * controlB.x +
    t * t * t * end.x;
  const y =
    inv * inv * inv * start.y +
    3 * inv * inv * t * controlA.y +
    3 * inv * t * t * controlB.y +
    t * t * t * end.y;
  return { x, y };
}

function getBezierControlPoint(point: { x: number; y: number }, side: FlowHandleSide, distance: number) {
  switch (side) {
    case "top":
      return { x: point.x, y: point.y - distance };
    case "right":
      return { x: point.x + distance, y: point.y };
    case "bottom":
      return { x: point.x, y: point.y + distance };
    case "left":
      return { x: point.x - distance, y: point.y };
  }
}

function buildConnectionPath(
  start: { x: number; y: number },
  end: { x: number; y: number },
  sourceSide: FlowHandleSide,
  targetSide: FlowHandleSide,
) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);
  const sourceOffset =
    sourceSide === "left" || sourceSide === "right"
      ? Math.max(56, horizontalDistance * 0.36)
      : Math.max(48, verticalDistance * 0.36);
  const targetOffset =
    targetSide === "left" || targetSide === "right"
      ? Math.max(56, horizontalDistance * 0.36)
      : Math.max(48, verticalDistance * 0.36);
  const controlA = getBezierControlPoint(start, sourceSide, sourceOffset);
  const controlB = getBezierControlPoint(end, targetSide, targetOffset);
  const midpoint = cubicPointAt(start, controlA, controlB, end, 0.5);

  return {
    path: `M ${start.x} ${start.y} C ${controlA.x} ${controlA.y}, ${controlB.x} ${controlB.y}, ${end.x} ${end.y}`,
    midpoint,
  };
}

function inferFloatingTargetSide(start: { x: number; y: number }, current: { x: number; y: number }): FlowHandleSide {
  const deltaX = current.x - start.x;
  const deltaY = current.y - start.y;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0 ? "left" : "right";
  }
  return deltaY >= 0 ? "top" : "bottom";
}

function clampViewportPosition(
  viewport: ViewportState,
  metrics: ReturnType<typeof buildFlowBoardLayout>["metrics"],
  shellWidth: number,
  shellHeight: number,
) {
  const extent = getFlowTranslateExtent(metrics, shellWidth, shellHeight, FLOW_WORKSPACE_MIN_ZOOM);
  const minX = shellWidth - extent[1][0] * viewport.zoom;
  const maxX = -extent[0][0] * viewport.zoom;
  const minY = shellHeight - extent[1][1] * viewport.zoom;
  const maxY = -extent[0][1] * viewport.zoom;

  return {
    ...viewport,
    zoom: clamp(viewport.zoom, FLOW_WORKSPACE_MIN_ZOOM, FLOW_WORKSPACE_MAX_ZOOM),
    x: clampBetween(viewport.x, minX, maxX),
    y: clampBetween(viewport.y, minY, maxY),
  };
}

function FlowWorkspaceInner({
  frame,
  flowDocument,
  viewportWidth,
  viewportHeight,
  allDesignFrames,
  allFlowFrames,
  onFlowDocumentChange,
  buildPreviewDocument,
  onFocusedAreaChange,
  onExitToDesign,
  onSelectFlowBoard,
  onCreateFlowBoard,
}: FlowWorkspaceProps) {
  const doc = flowDocument ?? createEmptyFlowDocument();
  const docRef = useRef(doc);
  docRef.current = doc;

  const shellRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<ViewportState>({ x: 0, y: 0, zoom: 1 });
  const autoFitEnabledRef = useRef(true);
  const panStateRef = useRef<PointerPanState | null>(null);
  const nodeDragRef = useRef<NodeDragState | null>(null);
  const connectionDraftRef = useRef<ConnectionDraftState | null>(null);

  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [hoveredSlot, setHoveredSlot] = useState<FlowGridSlot | null>(null);
  const [activeMenu, setActiveMenu] = useState<SlotMenuState>(null);
  const [showFramePicker, setShowFramePicker] = useState<SlotMenuState>(null);
  const [measuredNodeHeights, setMeasuredNodeHeights] = useState<Record<string, number>>({});
  const [focusedAreaId, setFocusedAreaId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ViewportState>({ x: 0, y: 0, zoom: 1 });
  const [panState, setPanState] = useState<PointerPanState | null>(null);
  const [nodeDrag, setNodeDrag] = useState<NodeDragState | null>(null);
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraftState | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const markerPrefix = useId().replace(/:/g, "");

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    panStateRef.current = panState;
  }, [panState]);

  useEffect(() => {
    nodeDragRef.current = nodeDrag;
  }, [nodeDrag]);

  useEffect(() => {
    connectionDraftRef.current = connectionDraft;
  }, [connectionDraft]);

  useEffect(() => {
    setMeasuredNodeHeights((current) => {
      const validCellIds = new Set(doc.cells.map((cell) => cell.id));
      const nextEntries = Object.entries(current).filter(([cellId]) => validCellIds.has(cellId));
      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [doc.cells]);

  const commitDoc = useCallback(
    (nextDoc: FlowDocument) => {
      docRef.current = nextDoc;
      onFlowDocumentChange?.(frame.id, nextDoc);
    },
    [frame.id, onFlowDocumentChange],
  );

  const updateDoc = useCallback(
    (updater: (prev: FlowDocument) => FlowDocument) => {
      commitDoc(updater(docRef.current));
    },
    [commitDoc],
  );

  const layout = useMemo(
    () =>
      buildFlowBoardLayout(doc, {
        frameWidth: Math.max(viewportWidth - 48, 1240),
        frameHeight: Math.max(viewportHeight - 96, 760),
        headerHeight: 0,
        layoutScale: 1,
        maxVisibleBodyHeight: Math.max(viewportHeight - 160, 640),
        measuredNodeHeights,
        allDesignFrames,
        editingCellId,
      }),
    [allDesignFrames, doc, editingCellId, measuredNodeHeights, viewportHeight, viewportWidth],
  );

  const metrics = layout.metrics;
  const chromeAreas = layout.chromeAreas;
  const cellLayoutById = useMemo(
    () => new Map(layout.cells.map((cell) => [cell.cellId, cell])),
    [layout.cells],
  );
  const edgeGeometries = useMemo(
    () =>
      layout.edges.flatMap((edge) => {
        const sourceCell = cellLayoutById.get(edge.fromCellId);
        const targetCell = cellLayoutById.get(edge.toCellId);
        if (!sourceCell || !targetCell) {
          return [];
        }

        const start = getFlowNodeHandlePosition(sourceCell, edge.sourceHandleSide);
        const end = getFlowNodeHandlePosition(targetCell, edge.targetHandleSide);
        const geometry = buildConnectionPath(start, end, edge.sourceHandleSide, edge.targetHandleSide);

        return [
          {
            ...edge,
            start,
            end,
            ...geometry,
          },
        ];
      }),
    [cellLayoutById, layout.edges],
  );

  const getCanvasSize = useCallback(() => {
    const element = shellRef.current;
    return {
      width: Math.max(1, element?.clientWidth ?? viewportWidth),
      height: Math.max(1, element?.clientHeight ?? viewportHeight),
    };
  }, [viewportHeight, viewportWidth]);

  const setClampedViewport = useCallback(
    (nextViewport: ViewportState | ((current: ViewportState) => ViewportState), lockAutoFit = true) => {
      if (lockAutoFit) {
        autoFitEnabledRef.current = false;
      }

      const size = getCanvasSize();
      setViewport((current) => {
        const resolved = typeof nextViewport === "function" ? nextViewport(current) : nextViewport;
        return clampViewportPosition(resolved, metrics, size.width, size.height);
      });
    },
    [getCanvasSize, metrics],
  );

  const screenToBoardPoint = useCallback((clientX: number, clientY: number) => {
    const shellRect = shellRef.current?.getBoundingClientRect();
    const currentViewport = viewportRef.current;
    const localX = clientX - (shellRect?.left ?? 0);
    const localY = clientY - (shellRect?.top ?? 0);
    return {
      x: (localX - currentViewport.x) / currentViewport.zoom,
      y: (localY - currentViewport.y) / currentViewport.zoom,
    };
  }, []);

  const boardToScreenPoint = useCallback((point: { x: number; y: number }) => {
    const currentViewport = viewportRef.current;
    return {
      x: currentViewport.x + point.x * currentViewport.zoom,
      y: currentViewport.y + point.y * currentViewport.zoom,
    };
  }, []);

  const fitBounds = useCallback(
    (bounds: { x: number; y: number; width: number; height: number }, padding = 0.14, lockAutoFit = true) => {
      const size = getCanvasSize();
      const safePadding = clamp(padding, 0, 0.42);
      const paddedWidth = Math.max(1, bounds.width);
      const paddedHeight = Math.max(1, bounds.height);
      const zoom = clamp(
        Math.min(
          (size.width * (1 - safePadding * 2)) / paddedWidth,
          (size.height * (1 - safePadding * 2)) / paddedHeight,
        ),
        FLOW_WORKSPACE_MIN_ZOOM,
        FLOW_WORKSPACE_MAX_ZOOM,
      );

      setClampedViewport(
        {
          zoom,
          x: size.width / 2 - (bounds.x + bounds.width / 2) * zoom,
          y: size.height / 2 - (bounds.y + bounds.height / 2) * zoom,
        },
        lockAutoFit,
      );
    },
    [getCanvasSize, setClampedViewport],
  );

  const focusArea = useCallback(
    (areaId: string, lockAutoFit = true) => {
      const bounds = getFlowAreaBounds(areaId, metrics);
      if (!bounds) {
        return;
      }
      setFocusedAreaId(areaId);
      fitBounds(bounds, 0.14, lockAutoFit);
    },
    [fitBounds, metrics],
  );

  const fitWorkspace = useCallback(
    (lockAutoFit = true) => {
      const documentBounds = getFlowDocumentBounds(docRef.current, metrics);
      if (documentBounds) {
        fitBounds(documentBounds, 0.12, lockAutoFit);
        return;
      }

      const fallbackAreaId = focusedAreaId ?? metrics.areas[0]?.id;
      if (!fallbackAreaId) {
        return;
      }
      const bounds = getFlowAreaBounds(fallbackAreaId, metrics);
      if (!bounds) {
        return;
      }
      fitBounds(bounds, 0.14, lockAutoFit);
    },
    [fitBounds, focusedAreaId, metrics],
  );

  const resetViewport = useCallback(() => {
    const areaId = focusedAreaId ?? metrics.areas[0]?.id;
    if (!areaId) {
      return;
    }
    const bounds = getFlowAreaBounds(areaId, metrics);
    if (!bounds) {
      return;
    }

    const size = getCanvasSize();
    setClampedViewport(
      {
        zoom: 1,
        x: size.width / 2 - (bounds.x + bounds.width / 2),
        y: size.height / 2 - (bounds.y + bounds.height / 2),
      },
      true,
    );
  }, [focusedAreaId, getCanvasSize, metrics, setClampedViewport]);

  const zoomByFactor = useCallback(
    (factor: number, center?: { x: number; y: number }) => {
      const size = getCanvasSize();
      const focalPoint = center ?? { x: size.width / 2, y: size.height / 2 };
      setClampedViewport((current) => {
        const nextZoom = clamp(current.zoom * factor, FLOW_WORKSPACE_MIN_ZOOM, FLOW_WORKSPACE_MAX_ZOOM);
        const boardX = (focalPoint.x - current.x) / current.zoom;
        const boardY = (focalPoint.y - current.y) / current.zoom;
        return {
          zoom: nextZoom,
          x: focalPoint.x - boardX * nextZoom,
          y: focalPoint.y - boardY * nextZoom,
        };
      }, true);
    },
    [getCanvasSize, setClampedViewport],
  );

  useEffect(() => {
    const nextFocusedAreaId =
      focusedAreaId && metrics.areas.some((area) => area.id === focusedAreaId)
        ? focusedAreaId
        : metrics.areas[0]?.id ?? null;
    if (nextFocusedAreaId !== focusedAreaId) {
      setFocusedAreaId(nextFocusedAreaId);
    }
  }, [focusedAreaId, metrics.areas]);

  useEffect(() => {
    onFocusedAreaChange?.(focusedAreaId ?? null);
  }, [focusedAreaId, onFocusedAreaChange]);

  useEffect(() => {
    autoFitEnabledRef.current = true;
  }, [frame.id]);

  useEffect(() => {
    const size = getCanvasSize();
    setViewport((current) => clampViewportPosition(current, metrics, size.width, size.height));
  }, [getCanvasSize, metrics]);

  useEffect(() => {
    if (!metrics.areas.length || !autoFitEnabledRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (!autoFitEnabledRef.current) {
        return;
      }
      fitWorkspace(false);
    }, 140);

    return () => window.clearTimeout(timer);
  }, [doc.cells.length, fitWorkspace, frame.id, metrics.areas.length, metrics.contentHeight, metrics.contentWidth]);

  const closeMenus = useCallback(() => {
    setActiveMenu(null);
    setShowFramePicker(null);
  }, []);

  const handleMeasuredNodeHeight = useCallback((cellId: string, height: number) => {
    const normalizedHeight = Math.max(96, Math.ceil(height));
    setMeasuredNodeHeights((current) => {
      const previous = current[cellId];
      if (typeof previous === "number" && Math.abs(previous - normalizedHeight) < 2) {
        return current;
      }
      return {
        ...current,
        [cellId]: normalizedHeight,
      };
    });
  }, []);

  const handleRemoveCell = useCallback(
    (cellId: string) => {
      updateDoc((prev) => ({
        ...prev,
        cells: prev.cells.filter((cell) => cell.id !== cellId),
        connections: prev.connections.filter(
          (connection) => connection.fromCellId !== cellId && connection.toCellId !== cellId,
        ),
      }));
      setMeasuredNodeHeights((current) => {
        if (!(cellId in current)) {
          return current;
        }
        const { [cellId]: _removed, ...rest } = current;
        return rest;
      });
    },
    [updateDoc],
  );

  const handleUpdateArtifact = useCallback(
    (cellId: string, artifact: FlowArtifact) => {
      updateDoc((prev) => ({
        ...prev,
        cells: prev.cells.map((cell) => (cell.id === cellId ? { ...cell, artifact } : cell)),
      }));
    },
    [updateDoc],
  );

  const handleStartEdit = useCallback((cellId: string) => {
    setEditingCellId(cellId);
  }, []);

  const handleFinishEdit = useCallback(() => {
    setEditingCellId(null);
  }, []);

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      updateDoc((prev) => ({
        ...prev,
        connections: prev.connections.filter((connection) => connection.id !== edgeId),
      }));
      setHoveredEdgeId((current) => (current === edgeId ? null : current));
    },
    [updateDoc],
  );

  const placeArtifactAtSlot = useCallback(
    (
      slot: FlowGridSlot,
      artifact: FlowArtifact,
      options?: {
        editCell?: boolean;
        cellId?: string;
      },
    ) => {
      const cellId = options?.cellId ?? newCellId();
      updateDoc((prev) => {
        const column = resolveFlowInsertColumn(prev, slot.laneId, slot.column, undefined, slot.areaId);
        return {
          ...prev,
          cells: [
            ...prev.cells,
            {
              id: cellId,
              areaId: slot.areaId,
              laneId: slot.laneId,
              column,
              artifact,
            },
          ],
        };
      });

      setFocusedAreaId(slot.areaId);
      if (options?.editCell) {
        setEditingCellId(cellId);
      }
      setHoveredSlot(null);
      closeMenus();
    },
    [closeMenus, updateDoc],
  );

  const addDesignFrameRef = useCallback(
    (slot: FlowGridSlot, refFrameId: string) => {
      placeArtifactAtSlot(slot, {
        type: "design-frame-ref",
        frameId: refFrameId,
      });
    },
    [placeArtifactAtSlot],
  );

  const addUploadedImage = useCallback(
    (slot: FlowGridSlot) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;
      input.onchange = async () => {
        const files = input.files ? Array.from(input.files) : [];
        if (files.length === 0) {
          return;
        }

        const images = await Promise.all(files.map((file) => readImageArtifact(file)));

        updateDoc((prev) => {
          const next: FlowDocument = {
            ...prev,
            cells: [...prev.cells],
          };

          let nextColumn = resolveFlowInsertColumn(next, slot.laneId, slot.column, undefined, slot.areaId);
          for (const image of images) {
            next.cells.push({
              id: newCellId(),
              areaId: slot.areaId,
              laneId: slot.laneId,
              column: nextColumn,
              artifact: image,
            });
            nextColumn = resolveFlowInsertColumn(next, slot.laneId, nextColumn + 1, undefined, slot.areaId);
          }

          return next;
        });
      };

      setFocusedAreaId(slot.areaId);
      closeMenus();
      input.click();
    },
    [closeMenus, updateDoc],
  );

  const addJourneyStep = useCallback(
    (slot: FlowGridSlot) => {
      placeArtifactAtSlot(
        slot,
        {
          type: "journey-step",
          text: "",
        },
        { editCell: true },
      );
    },
    [placeArtifactAtSlot],
  );

  const addTechnicalBrief = useCallback(
    (slot: FlowGridSlot) => {
      placeArtifactAtSlot(
        slot,
        {
          type: "technical-brief",
          title: "Untitled",
          language: "json",
          body: "",
        },
        { editCell: true },
      );
    },
    [placeArtifactAtSlot],
  );

  const updateBoardLink = useCallback(
    (field: "entryFlowFrameId" | "exitFlowFrameId", nextFrameId: string | null) => {
      updateDoc((prev) => ({
        ...prev,
        [field]: nextFrameId && nextFrameId.length > 0 ? nextFrameId : undefined,
      }));
    },
    [updateDoc],
  );

  const handleFlowBoardSelect = useCallback(
    (frameId: string) => {
      if (!frameId || frameId === frame.id) {
        return;
      }
      void onSelectFlowBoard?.(frameId);
    },
    [frame.id, onSelectFlowBoard],
  );

  const startNodeDrag = useCallback(
    (cell: FlowBoardCellLayout, event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || isInteractiveElement(event.target)) {
        return;
      }

      event.stopPropagation();
      autoFitEnabledRef.current = false;
      closeMenus();
      setFocusedAreaId(cell.areaId);

      const pointerPoint = screenToBoardPoint(event.clientX, event.clientY);
      const nextState: NodeDragState = {
        pointerId: event.pointerId,
        cellId: cell.cellId,
        areaId: cell.areaId,
        laneId: cell.laneId,
        column: cell.column,
        width: cell.width,
        height: cell.height,
        pointerOffsetX: pointerPoint.x - cell.x,
        pointerOffsetY: pointerPoint.y - cell.y,
        position: { x: cell.x, y: cell.y },
        slot: null,
      };

      nodeDragRef.current = nextState;
      setNodeDrag(nextState);
    },
    [closeMenus, screenToBoardPoint],
  );

  const startConnection = useCallback(
    (cell: FlowBoardCellLayout, side: FlowHandleSide, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      autoFitEnabledRef.current = false;
      closeMenus();
      setFocusedAreaId(cell.areaId);

      const anchor = getFlowNodeHandlePosition(cell, side);
      const nextState: ConnectionDraftState = {
        pointerId: event.pointerId,
        fromCellId: cell.cellId,
        sourceSide: side,
        startPoint: anchor,
        currentPoint: anchor,
      };

      connectionDraftRef.current = nextState;
      setConnectionDraft(nextState);
    },
    [closeMenus],
  );

  const handleCanvasPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (panStateRef.current || nodeDragRef.current || connectionDraftRef.current) {
        return;
      }

      const point = screenToBoardPoint(event.clientX, event.clientY);
      const slot = getFlowGridSlotAtPosition(point, metrics);
      if (!slot) {
        setHoveredSlot(null);
        return;
      }

      if (isFlowCellOccupied(docRef.current, slot.laneId, slot.column, undefined, slot.areaId)) {
        setHoveredSlot(null);
        return;
      }

      setHoveredSlot(slot);
    },
    [metrics, screenToBoardPoint],
  );

  const handleCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || isInteractiveElement(event.target)) {
        return;
      }

      autoFitEnabledRef.current = false;
      closeMenus();
      setHoveredEdgeId(null);

      const slot = getFlowGridSlotAtPosition(screenToBoardPoint(event.clientX, event.clientY), metrics);
      if (slot) {
        setFocusedAreaId(slot.areaId);
      }

      const nextState: PointerPanState = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewport: viewportRef.current,
      };
      panStateRef.current = nextState;
      setPanState(nextState);
    },
    [closeMenus, metrics, screenToBoardPoint],
  );

  const handleCanvasWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      autoFitEnabledRef.current = false;

      const shellRect = shellRef.current?.getBoundingClientRect();
      const localPoint = {
        x: event.clientX - (shellRect?.left ?? 0),
        y: event.clientY - (shellRect?.top ?? 0),
      };

      if (event.metaKey || event.ctrlKey) {
        const factor = Math.exp(-event.deltaY * 0.0015);
        zoomByFactor(factor, localPoint);
        return;
      }

      setClampedViewport(
        (current) => ({
          ...current,
          x: current.x - event.deltaX,
          y: current.y - event.deltaY,
        }),
        true,
      );
    },
    [setClampedViewport, zoomByFactor],
  );

  useEffect(() => {
    if (!panState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const currentPan = panStateRef.current;
      if (!currentPan || event.pointerId !== currentPan.pointerId) {
        return;
      }

      const nextViewport = {
        ...currentPan.startViewport,
        x: currentPan.startViewport.x + (event.clientX - currentPan.startClientX),
        y: currentPan.startViewport.y + (event.clientY - currentPan.startClientY),
      };

      const size = getCanvasSize();
      const clamped = clampViewportPosition(nextViewport, metrics, size.width, size.height);
      viewportRef.current = clamped;
      setViewport(clamped);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const currentPan = panStateRef.current;
      if (!currentPan || event.pointerId !== currentPan.pointerId) {
        return;
      }
      panStateRef.current = null;
      setPanState(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [getCanvasSize, metrics, panState]);

  useEffect(() => {
    if (!nodeDrag) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const currentDrag = nodeDragRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      const point = screenToBoardPoint(event.clientX, event.clientY);
      const nextPosition = {
        x: point.x - currentDrag.pointerOffsetX,
        y: point.y - currentDrag.pointerOffsetY,
      };
      const nextSlot = getFlowGridSlotAtPosition(
        {
          x: nextPosition.x + currentDrag.width / 2,
          y: nextPosition.y + currentDrag.height / 2,
        },
        metrics,
      );

      const nextState = {
        ...currentDrag,
        position: nextPosition,
        slot: nextSlot,
      };
      nodeDragRef.current = nextState;
      setNodeDrag(nextState);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const currentDrag = nodeDragRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      nodeDragRef.current = null;
      setNodeDrag(null);

      const slot = currentDrag.slot;
      if (!slot) {
        return;
      }

      setFocusedAreaId(slot.areaId);

      const currentDoc = docRef.current;
      const occupant = currentDoc.cells.find(
        (cell) =>
          cell.laneId === slot.laneId &&
          cell.column === slot.column &&
          cell.areaId === slot.areaId &&
          cell.id !== currentDrag.cellId,
      );

      if (occupant) {
        updateDoc((prev) => ({
          ...prev,
          cells: prev.cells.map((cell) => {
            if (cell.id === currentDrag.cellId) {
              return { ...cell, areaId: slot.areaId, laneId: slot.laneId, column: slot.column };
            }
            if (cell.id === occupant.id) {
              return {
                ...cell,
                areaId: currentDrag.areaId,
                laneId: currentDrag.laneId,
                column: currentDrag.column,
              };
            }
            return cell;
          }),
        }));
        return;
      }

      if (
        slot.areaId === currentDrag.areaId &&
        slot.laneId === currentDrag.laneId &&
        slot.column === currentDrag.column
      ) {
        return;
      }

      updateDoc((prev) => ({
        ...prev,
        cells: prev.cells.map((cell) =>
          cell.id === currentDrag.cellId
            ? { ...cell, areaId: slot.areaId, laneId: slot.laneId, column: slot.column }
            : cell,
        ),
      }));
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [metrics, nodeDrag, screenToBoardPoint, updateDoc]);

  useEffect(() => {
    if (!connectionDraft) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const currentDraft = connectionDraftRef.current;
      if (!currentDraft || event.pointerId !== currentDraft.pointerId) {
        return;
      }

      const nextState = {
        ...currentDraft,
        currentPoint: screenToBoardPoint(event.clientX, event.clientY),
      };
      connectionDraftRef.current = nextState;
      setConnectionDraft(nextState);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const currentDraft = connectionDraftRef.current;
      if (!currentDraft || event.pointerId !== currentDraft.pointerId) {
        return;
      }

      const targetElement = document.elementFromPoint(event.clientX, event.clientY);
      const handleElement = targetElement instanceof HTMLElement
        ? targetElement.closest<HTMLElement>("[data-flow-target-handle='true']")
        : null;
      const targetCellId = handleElement?.dataset.cellId;
      const targetSide = handleElement?.dataset.side as FlowHandleSide | undefined;

      if (
        targetCellId &&
        targetSide &&
        targetCellId !== currentDraft.fromCellId &&
        isValidFlowConnectionBetweenCells(docRef.current, currentDraft.fromCellId, targetCellId)
      ) {
        const normalized = normalizeFlowConnection(docRef.current, {
          id: crypto.randomUUID(),
          fromCellId: currentDraft.fromCellId,
          toCellId: targetCellId,
          sourceHandle: getFlowSourceHandleId(currentDraft.sourceSide),
          targetHandle: getFlowTargetHandleId(targetSide),
        });

        if (
          !isExactConnectionDuplicate(docRef.current, {
            fromCellId: normalized.fromCellId,
            toCellId: normalized.toCellId,
            sourceHandle: normalized.sourceHandle,
            targetHandle: normalized.targetHandle,
          })
        ) {
          updateDoc((prev) => ({
            ...prev,
            connections: [...prev.connections, normalized],
          }));
        }
      }

      connectionDraftRef.current = null;
      setConnectionDraft(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [connectionDraft, screenToBoardPoint, updateDoc]);

  const availableFlowBoards = useMemo(
    () => allFlowFrames.filter((flowFrame) => flowFrame.id !== frame.id),
    [allFlowFrames, frame.id],
  );
  const entryBoardValue = availableFlowBoards.some((flowFrame) => flowFrame.id === doc.entryFlowFrameId)
    ? doc.entryFlowFrameId ?? ""
    : "";
  const exitBoardValue = availableFlowBoards.some((flowFrame) => flowFrame.id === doc.exitFlowFrameId)
    ? doc.exitFlowFrameId ?? ""
    : "";
  const visibleSlot = !panState && !nodeDrag && !connectionDraft ? activeMenu ?? hoveredSlot : null;
  const hasLegacyAreas = metrics.areas.length > 1;
  const boardSubtitle = hasLegacyAreas
    ? `Legacy board with ${metrics.areas.length} imported areas`
    : "4 fixed swimlanes";

  const dragLaneTop = nodeDrag?.slot ? getFlowLaneTop(nodeDrag.slot.laneId, metrics) : 0;
  const dragLaneHeight = nodeDrag?.slot ? getFlowLaneHeight(nodeDrag.slot.laneId, metrics) : 0;
  const dragSlotCenter = nodeDrag?.slot ? getFlowSlotCenter(nodeDrag.slot, metrics) : null;

  const getMenuAnchorStyle = useCallback(
    (slot: FlowGridSlot) => {
      const center = getFlowSlotCenter(slot, metrics);
      const screen = boardToScreenPoint(center);
      return {
        left: screen.x - 15,
        top: screen.y - 15,
      };
    },
    [boardToScreenPoint, metrics],
  );

  const connectionPreview = useMemo(() => {
    if (!connectionDraft) {
      return null;
    }

    const start = boardToScreenPoint(connectionDraft.startPoint);
    const end = boardToScreenPoint(connectionDraft.currentPoint);
    const targetSide = inferFloatingTargetSide(connectionDraft.startPoint, connectionDraft.currentPoint);
    return buildConnectionPath(start, end, connectionDraft.sourceSide, targetSide);
  }, [boardToScreenPoint, connectionDraft]);

  const canvasSize = getCanvasSize();

  return (
    <div className="flow-workspace">
      <div className="flow-workspace__toolbar">
        <div className="flow-workspace__toolbar-main">
          <div className="flow-workspace__toolbar-title">
            <strong>{frame.name}</strong>
            <span>{boardSubtitle}</span>
          </div>
          <div className="flow-workspace__toolbar-actions">
            {onExitToDesign ? (
              <button type="button" onClick={onExitToDesign} aria-label="Design mode">
                <LayoutDashboard size={13} /> Design
              </button>
            ) : null}
            <button type="button" onClick={() => zoomByFactor(1 / 1.12)} aria-label="Zoom out">
              -
            </button>
            <button type="button" onClick={() => zoomByFactor(1.12)} aria-label="Zoom in">
              +
            </button>
            <button type="button" onClick={resetViewport}>
              Reset
            </button>
            <button type="button" onClick={() => fitWorkspace(true)}>
              Fit
            </button>
            <button
              type="button"
              onClick={() => {
                void onCreateFlowBoard?.();
              }}
              className="flow-workspace__new-board-btn"
            >
              <Plus size={13} /> New board
            </button>
          </div>
        </div>
        <div className="flow-workspace__toolbar-secondary">
          <div className="flow-workspace__toolbar-fields">
            <label className="flow-workspace__field">
              <span>Board</span>
              <select value={frame.id} onChange={(event) => handleFlowBoardSelect(event.target.value)}>
                {allFlowFrames.map((flowFrame) => (
                  <option key={flowFrame.id} value={flowFrame.id}>
                    {flowFrame.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flow-workspace__field">
              <span>Entry board</span>
              <select
                value={entryBoardValue}
                onChange={(event) => updateBoardLink("entryFlowFrameId", event.target.value || null)}
                disabled={availableFlowBoards.length === 0}
              >
                <option value="">None</option>
                {availableFlowBoards.map((flowFrame) => (
                  <option key={flowFrame.id} value={flowFrame.id}>
                    {flowFrame.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flow-workspace__field">
              <span>Exit board</span>
              <select
                value={exitBoardValue}
                onChange={(event) => updateBoardLink("exitFlowFrameId", event.target.value || null)}
                disabled={availableFlowBoards.length === 0}
              >
                <option value="">None</option>
                {availableFlowBoards.map((flowFrame) => (
                  <option key={flowFrame.id} value={flowFrame.id}>
                    {flowFrame.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flow-workspace__toolbar-links">
            <button type="button" onClick={() => handleFlowBoardSelect(entryBoardValue)} disabled={!entryBoardValue}>
              Open entry
            </button>
            <button type="button" onClick={() => handleFlowBoardSelect(exitBoardValue)} disabled={!exitBoardValue}>
              Open exit
            </button>
            {hasLegacyAreas ? (
              <span className="flow-workspace__legacy-note">
                Legacy imported areas stay readable, but new boards are standalone.
              </span>
            ) : null}
          </div>
        </div>
        {hasLegacyAreas ? (
          <div className="flow-workspace__area-chips" aria-label="Legacy flow areas">
            {metrics.areas.map((area) => (
              <button
                key={area.id}
                type="button"
                className={`flow-workspace__area-chip ${focusedAreaId === area.id ? "is-active" : ""}`}
                onClick={() => focusArea(area.id)}
              >
                {area.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div
        ref={shellRef}
        className={`flow-workspace__canvas-shell ${panState ? "is-panning" : ""}`}
        onPointerMove={handleCanvasPointerMove}
        onPointerLeave={() => {
          if (!activeMenu) {
            setHoveredSlot(null);
          }
          setHoveredEdgeId(null);
        }}
        onPointerDown={handleCanvasPointerDown}
        onWheel={handleCanvasWheel}
      >
        <div className="flow-workspace__canvas">
          <div
            className="flow-workspace__viewport"
            style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
          >
            <div
              className="flow-workspace__board"
              style={{ width: metrics.contentWidth, height: metrics.contentHeight }}
            >
              <FlowChromeLayer
                areas={chromeAreas}
                contentWidth={metrics.contentWidth}
                contentHeight={metrics.contentHeight}
                variant="underlay"
                className="flow-workspace__chrome-layer"
              />

              <svg
                className="flow-workspace__edge-layer"
                width={metrics.contentWidth}
                height={metrics.contentHeight}
                viewBox={`0 0 ${metrics.contentWidth} ${metrics.contentHeight}`}
                aria-hidden
              >
                <defs>
                  <marker id={`${markerPrefix}-user-journey`} markerWidth="12" markerHeight="12" refX="9" refY="6" orient="auto">
                    <path d="M 0 0 L 12 6 L 0 12 z" fill="rgba(92, 98, 239, 0.94)" />
                  </marker>
                  <marker id={`${markerPrefix}-normal-flow`} markerWidth="12" markerHeight="12" refX="9" refY="6" orient="auto">
                    <path d="M 0 0 L 12 6 L 0 12 z" fill="rgba(15, 156, 95, 0.94)" />
                  </marker>
                  <marker id={`${markerPrefix}-unhappy-path`} markerWidth="12" markerHeight="12" refX="9" refY="6" orient="auto">
                    <path d="M 0 0 L 12 6 L 0 12 z" fill="rgba(234, 120, 36, 0.96)" />
                  </marker>
                  <marker id={`${markerPrefix}-technical-briefing`} markerWidth="12" markerHeight="12" refX="9" refY="6" orient="auto">
                    <path d="M 0 0 L 12 6 L 0 12 z" fill="rgba(22, 132, 204, 0.94)" />
                  </marker>
                </defs>

                {edgeGeometries.map((edge) => (
                  <g key={edge.id}>
                    <path
                      d={edge.path}
                      className={`flow-rf-edge flow-rf-edge--glow ${edge.isCrossLane ? "flow-rf-edge--cross-lane" : ""}`}
                      style={{
                        stroke: edge.glowColor,
                        strokeWidth: edge.isCrossLane ? 5.2 : 5.8,
                        opacity: hoveredEdgeId === edge.id ? 0.34 : 0.22,
                      }}
                    />
                    <path
                      d={edge.path}
                      className={`flow-rf-edge ${edge.isCrossLane ? "flow-rf-edge--cross-lane" : ""} ${hoveredEdgeId === edge.id ? "flow-rf-edge--selected" : ""}`}
                      style={{
                        stroke: edge.strokeColor,
                        strokeWidth: hoveredEdgeId === edge.id ? 3.2 : edge.isCrossLane ? 2.35 : 2.7,
                        markerEnd: `url(#${markerPrefix}-${edge.laneId})`,
                      }}
                    />
                    <path
                      d={edge.path}
                      className="flow-workspace__edge-hit-area"
                      onPointerEnter={(event) => {
                        event.stopPropagation();
                        setHoveredEdgeId(edge.id);
                      }}
                      onPointerLeave={() => {
                        setHoveredEdgeId((current) => (current === edge.id ? null : current));
                      }}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                      }}
                    />
                  </g>
                ))}
              </svg>

              <div className="flow-workspace__node-layer">
                {layout.cells.map((cell) => {
                  const activeDrag = nodeDrag?.cellId === cell.cellId ? nodeDrag : null;
                  return (
                    <div
                      key={cell.cellId}
                      className={`flow-workspace__node ${activeDrag ? "is-dragging" : ""}`}
                      style={{
                        left: activeDrag?.position.x ?? cell.x,
                        top: activeDrag?.position.y ?? cell.y,
                        width: cell.width,
                        height: cell.height,
                      }}
                    >
                      <FlowArtifactCard
                        cellId={cell.cellId}
                        artifact={cell.artifact}
                        refFrame={cell.refFrame}
                        buildPreviewDocument={buildPreviewDocument}
                        editing={editingCellId === cell.cellId}
                        dragging={Boolean(activeDrag)}
                        connecting={Boolean(connectionDraft)}
                        onRemove={handleRemoveCell}
                        onUpdateArtifact={handleUpdateArtifact}
                        onStartEdit={handleStartEdit}
                        onFinishEdit={handleFinishEdit}
                        onMeasure={handleMeasuredNodeHeight}
                        onPointerDown={(event) => startNodeDrag(cell, event)}
                        onStartConnection={(side, event) => startConnection(cell, side, event)}
                      />
                    </div>
                  );
                })}
              </div>

              <FlowChromeLayer
                areas={chromeAreas}
                contentWidth={metrics.contentWidth}
                contentHeight={metrics.contentHeight}
                variant="overlay"
                className="flow-workspace__chrome-layer"
              />
            </div>
          </div>
        </div>

        <div className="flow-workspace__overlay-layer" aria-hidden>
          {nodeDrag?.slot && dragSlotCenter ? (
            <div
              className="flow-workspace__drag-highlight"
              style={{
                top: boardToScreenPoint({ x: 0, y: dragLaneTop }).y,
                left: boardToScreenPoint({ x: dragSlotCenter.x - metrics.nodeWidth / 2, y: 0 }).x,
                width: metrics.nodeWidth * viewport.zoom,
                height: Math.max(84, dragLaneHeight - 12) * viewport.zoom,
              }}
            />
          ) : null}

          {edgeGeometries.map((edge) => {
            if (edge.id !== hoveredEdgeId) {
              return null;
            }
            const screenPoint = boardToScreenPoint(edge.midpoint);
            return (
              <button
                key={`${edge.id}-delete`}
                type="button"
                className="flow-rf-edge__delete flow-rf-edge__delete--visible flow-workspace__edge-delete"
                style={{ left: screenPoint.x - 9, top: screenPoint.y - 9 }}
                onClick={() => handleDeleteEdge(edge.id)}
                aria-label="Delete connection"
              >
                <X size={10} />
              </button>
            );
          })}

          {visibleSlot ? (
            <div className="flow-slot-menu-anchor" style={getMenuAnchorStyle(visibleSlot)}>
              <button
                type="button"
                className={`flow-lane__add-btn ${activeMenu ? "flow-lane__add-btn--open" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setFocusedAreaId(visibleSlot.areaId);
                  setActiveMenu(
                    activeMenu &&
                      activeMenu.areaId === visibleSlot.areaId &&
                      activeMenu.laneId === visibleSlot.laneId &&
                      activeMenu.column === visibleSlot.column
                      ? null
                      : visibleSlot,
                  );
                }}
                aria-label={`Add to ${FLOW_LANE_LABELS[visibleSlot.laneId]} column ${visibleSlot.column + 1}`}
              >
                <Plus size={14} />
              </button>

              {activeMenu &&
              activeMenu.areaId === visibleSlot.areaId &&
              activeMenu.laneId === visibleSlot.laneId &&
              activeMenu.column === visibleSlot.column ? (
                <div className="flow-lane__menu">
                  <button
                    type="button"
                    onClick={() => {
                      setShowFramePicker(activeMenu);
                    }}
                  >
                    <FileText size={13} /> Add existing frame
                  </button>
                  <button type="button" onClick={() => addUploadedImage(activeMenu)}>
                    <Upload size={13} /> Upload image(s)
                  </button>
                  <button type="button" onClick={() => addJourneyStep(activeMenu)}>
                    <Workflow size={13} /> Add step
                  </button>
                  <button type="button" onClick={() => addTechnicalBrief(activeMenu)}>
                    <Code size={13} /> Add code block
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {connectionPreview ? (
            <svg className="flow-workspace__draft-overlay" width="100%" height="100%" viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}>
              <path
                d={connectionPreview.path}
                className="flow-rf-edge flow-rf-edge--selected"
                style={{
                  stroke: "rgba(47, 126, 247, 0.78)",
                  strokeWidth: 2.4,
                  fill: "none",
                  strokeDasharray: "8 6",
                }}
              />
            </svg>
          ) : null}
        </div>
      </div>

      {showFramePicker ? (
        <FlowWorkspaceFramePicker
          frames={allDesignFrames}
          onSelect={(refId) => addDesignFrameRef(showFramePicker, refId)}
          onClose={() => setShowFramePicker(null)}
        />
      ) : null}
    </div>
  );
}

export function FlowWorkspace(props: FlowWorkspaceProps) {
  return <FlowWorkspaceInner {...props} />;
}

function FlowWorkspaceFramePicker({
  frames,
  onSelect,
  onClose,
}: {
  frames: FrameWithVersions[];
  onSelect: (frameId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="flow-frame-picker" onClick={(event) => event.stopPropagation()}>
      <div className="flow-frame-picker__header">
        <span>Select a design frame</span>
        <button type="button" onClick={onClose} aria-label="Close">
          <X size={14} />
        </button>
      </div>
      <div className="flow-frame-picker__list">
        {frames.length === 0 ? <div className="flow-frame-picker__empty">No design frames yet</div> : null}
        {frames.map((frameItem) => (
          <button
            key={frameItem.id}
            type="button"
            className="flow-frame-picker__item"
            onClick={() => onSelect(frameItem.id)}
          >
            <span className="flow-frame-picker__item-name">{frameItem.name}</span>
            <span className="flow-frame-picker__item-meta">
              {frameItem.devicePreset} • {frameItem.mode}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
