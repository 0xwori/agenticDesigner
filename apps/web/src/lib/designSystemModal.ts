import type { DesignSystemVisualSection, ProjectDesignSystem } from "@designer/shared";

export function getDesignSystemVisualSections(designSystem: ProjectDesignSystem | null): DesignSystemVisualSection[] {
  return designSystem?.structuredTokens?.visualBoard?.sections ?? [];
}

export type SequentialQueueResult = {
  total: number;
  successful: number;
  failed: number;
};

export async function runSequentialQueue<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<boolean>
): Promise<SequentialQueueResult> {
  let successful = 0;
  let failed = 0;

  for (let index = 0; index < items.length; index += 1) {
    const result = await worker(items[index], index);
    if (result) {
      successful += 1;
    } else {
      failed += 1;
    }
  }

  return {
    total: items.length,
    successful,
    failed
  };
}
