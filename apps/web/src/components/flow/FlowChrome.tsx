import type { CSSProperties } from "react";

import type { FlowAreaChrome } from "../../lib/flowAdapter";

type FlowViewportTransform = {
  x: number;
  y: number;
  zoom: number;
};

type FlowChromeLayerProps = {
  areas: FlowAreaChrome[];
  contentWidth: number;
  contentHeight: number;
  variant: "underlay" | "overlay";
  viewport?: FlowViewportTransform;
  className?: string;
  showTitles?: boolean;
};

function buildLayerStyle(
  contentWidth: number,
  contentHeight: number,
  viewport?: FlowViewportTransform,
): CSSProperties {
  return {
    width: contentWidth,
    height: contentHeight,
    transform: viewport
      ? `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
      : undefined,
    transformOrigin: "0 0",
  };
}

export function FlowChromeLayer({
  areas,
  contentWidth,
  contentHeight,
  variant,
  viewport,
  className,
  showTitles = true,
}: FlowChromeLayerProps) {
  if (areas.length === 0) {
    return null;
  }

  return (
    <div
      className={[
        "flow-chrome-layer",
        `flow-chrome-layer--${variant}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={buildLayerStyle(contentWidth, contentHeight, viewport)}
      aria-hidden
    >
      {areas.map((area) => (
        <div
          key={area.id}
          className={`flow-chrome-area ${variant === "overlay" ? "flow-chrome-area--overlay" : ""}`.trim()}
          style={{
            left: area.left,
            width: variant === "overlay" ? area.gutterWidth : area.width,
            height: area.height,
            ["--flow-chrome-gutter-width" as string]: `${area.gutterWidth}px`,
            ["--flow-chrome-title-max-width" as string]: `${Math.max(
              120,
              Math.min(area.width - 32, area.gutterWidth + 48),
            )}px`,
          }}
        >
          {variant === "underlay" ? (
            <div className="flow-chrome-area__grid" aria-hidden>
              {area.lanes.flatMap((lane) =>
                area.gridColumns.map((column, columnIndex) => (
                  <div
                    key={`${area.id}-${lane.laneId}-grid-${columnIndex}`}
                    className="flow-chrome-grid-cell"
                    style={{
                      left: column.left,
                      top: lane.top + 12,
                      width: column.width,
                      height: Math.max(36, lane.height - 24),
                    }}
                  />
                )),
              )}
            </div>
          ) : null}

          {variant === "overlay" && showTitles ? (
            <div className="flow-chrome-area__title" title={area.name}>{area.name}</div>
          ) : null}

          {area.lanes.map((lane) => (
            <div
              key={`${area.id}-${lane.laneId}`}
              className="flow-chrome-lane"
              data-lane={lane.laneId}
              data-first={lane.isFirstLane ? "true" : "false"}
              data-last={lane.isLastLane ? "true" : "false"}
              style={{
                top: lane.top,
                height: lane.height,
              }}
            >
              {variant === "overlay" ? (
                <div className="flow-chrome-lane__gutter">
                  <div className="flow-chrome-lane__label">{lane.label}</div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}