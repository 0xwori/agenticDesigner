import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_SETTINGS } from "./project.js";

describe("shared project defaults", () => {
  it("uses strict design-system and web surface defaults", () => {
    expect(DEFAULT_PROJECT_SETTINGS.designSystemModeDefault).toBe("strict");
    expect(DEFAULT_PROJECT_SETTINGS.surfaceDefault).toBe("web");
  });

  it("keeps provider/model defaults stable", () => {
    expect(DEFAULT_PROJECT_SETTINGS.provider).toBe("openai");
    expect(DEFAULT_PROJECT_SETTINGS.model.length).toBeGreaterThan(0);
  });
});
