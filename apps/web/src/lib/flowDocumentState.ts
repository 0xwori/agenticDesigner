import type { FlowDocument, ProjectBundle } from "@designer/shared";

export function replaceFlowDocumentInBundle(
  bundle: ProjectBundle | null,
  frameId: string,
  flowDocument: FlowDocument | undefined,
): ProjectBundle | null {
  if (!bundle) {
    return bundle;
  }

  let changed = false;
  const frames = bundle.frames.map((frame) => {
    if (frame.id !== frameId) {
      return frame;
    }
    changed = true;
    return {
      ...frame,
      flowDocument,
    };
  });

  return changed ? { ...bundle, frames } : bundle;
}

export function rollbackFlowDocumentIfCurrent(
  bundle: ProjectBundle | null,
  frameId: string,
  optimisticDocument: FlowDocument,
  previousDocument: FlowDocument | undefined,
): ProjectBundle | null {
  if (!bundle) {
    return bundle;
  }

  const currentFrame = bundle.frames.find((frame) => frame.id === frameId);
  if (!currentFrame || currentFrame.flowDocument !== optimisticDocument) {
    return bundle;
  }

  return replaceFlowDocumentInBundle(bundle, frameId, previousDocument);
}