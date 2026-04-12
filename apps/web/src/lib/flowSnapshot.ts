import { toPng } from "html-to-image";

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
  });

  const link = document.createElement("a");
  link.download = `${toFileSafeName(boardName)}.png`;
  link.href = dataUrl;
  link.click();
}