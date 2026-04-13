import { toPng } from "html-to-image";

const FLOW_EXPORT_IGNORED_CLASSES = [
  "flow-workspace__edge-hit-area",
  "flow-workspace__board-menu--floating",
  "flow-workspace__board-menu-popover",
  "flow-workspace__board-status",
  "flow-workspace__add-column-button",
  "flow-slot-menu-anchor",
  "flow-lane__menu",
  "flow-lane__add-btn",
  "flow-workspace__edge-delete",
  "flow-workspace__frame-resize",
] as const;

function shouldIncludeFlowExportNode(node: Element) {
  return !FLOW_EXPORT_IGNORED_CLASSES.some((className) => node.classList.contains(className));
}

function toFileSafeName(value: string) {
  const trimmed = value.trim().toLowerCase();
  const normalized = trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "flow-board";
}

export async function exportFlowBoardToPng(element: HTMLElement, boardName: string) {
  const dataUrl = await toPng(element, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: "#f7f9fc",
    filter: (node) => !(node instanceof Element) || shouldIncludeFlowExportNode(node),
  });

  const link = document.createElement("a");
  link.download = `${toFileSafeName(boardName)}.png`;
  link.href = dataUrl;
  link.click();
}