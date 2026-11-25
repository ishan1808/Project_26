import React from "react";
import { ROUTES, STATIONS, getStationById } from "../data/transitNetwork.ts";
import type { BackupOption } from "../types/transit.ts";

interface SchematicMapProps {
  originId: string;
  destinationId: string;
  affectedRouteId: string;
  selectedOption: BackupOption | null;
  onSelectStation?: (stationId: string) => void;
}

export const SchematicMap: React.FC<SchematicMapProps> = ({
  originId,
  destinationId,
  affectedRouteId,
  selectedOption,
  onSelectStation,
}) => {
  const activeRouteSegments = new Set<string>();
  if (selectedOption) {
    for (const leg of selectedOption.legs) {
      const route = ROUTES.find((r) => r.id === leg.routeId);
      if (!route) continue;
      const i1 = route.stops.findIndex((s) => s.stationId === leg.boardStationId);
      const i2 = route.stops.findIndex((s) => s.stationId === leg.alightStationId);
      if (i1 !== -1 && i2 !== -1) {
        const start = Math.min(i1, i2);
        const end = Math.max(i1, i2);
        for (let i = start; i < end; i++) {
          activeRouteSegments.add(`${route.id}:${route.stops[i].stationId}->${route.stops[i + 1].stationId}`);
        }
      }
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Corridor Schematic</h3>
          <p className="text-xs text-slate-500">
            Tap any station to set origin or destination · Solid: Rail · Dashed: Bus &amp; Light Rail
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-5 rounded-xs bg-blue-700" />
            Selected Backup
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-5 rounded-xs bg-red-600" />
            Delayed Route
          </span>
        </div>
      </div>

      <div className="w-full overflow-hidden rounded-lg border border-slate-100 bg-slate-50/70">
        <svg
          viewBox="0 0 820 350"
          className="h-auto w-full select-none"
          role="img"
          aria-label="Suburban rail and express bus schematic network"
        >
          {/* Base verified route corridors */}
          {ROUTES.map((route) => {
            const isAffected = route.id === affectedRouteId;
            return route.stops.slice(0, -1).map((stop, idx) => {
              const nextStop = route.stops[idx + 1];
              const s1 = getStationById(stop.stationId);
              const s2 = getStationById(nextStop.stationId);
              if (!s1 || !s2) return null;

              const segKey = `${route.id}:${stop.stationId}->${nextStop.stationId}`;
              const isSelectedBackup = activeRouteSegments.has(segKey);

              // Subtle offset when multiple lines share a corridor
              const offsetY =
                route.id === "B42-EXP"
                  ? 5
                  : route.id === "B18-FDR"
                    ? -5
                    : route.id === "R2-LOC"
                      ? 4
                      : 0;

              const strokeColor = isSelectedBackup
                ? "#1D4ED8"
                : isAffected
                  ? "#DC2626"
                  : "#CBD5E1";

              const strokeWidth = isSelectedBackup ? 5.5 : isAffected ? 3.5 : 2.5;
              const dashArray =
                route.mode === "bus"
                  ? "6 4"
                  : route.mode === "light_rail"
                    ? "10 4"
                    : isAffected && !isSelectedBackup
                      ? "5 4"
                      : undefined;

              return (
                <line
                  key={segKey}
                  x1={s1.x}
                  y1={s1.y + offsetY}
                  x2={s2.x}
                  y2={s2.y + offsetY}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeDasharray={dashArray}
                  strokeLinecap="round"
                />
              );
            });
          })}

          {/* Station nodes */}
          {STATIONS.map((station) => {
            const isOrigin = station.id === originId;
            const isDest = station.id === destinationId;
            const isTransferStop = selectedOption?.legs.some(
              (l, i) => i > 0 && l.boardStationId === station.id
            );

            let nodeFill = "#FFFFFF";
            let nodeStroke = "#475569";
            let radius = station.isTransferHub ? 7.5 : 6;

            if (isOrigin) {
              nodeFill = "#1D4ED8";
              nodeStroke = "#1E3A8A";
              radius = 9.5;
            } else if (isDest) {
              nodeFill = "#0F766E";
              nodeStroke = "#134E4A";
              radius = 9.5;
            } else if (isTransferStop) {
              nodeFill = "#FEF3C7";
              nodeStroke = "#D97706";
              radius = 8.5;
            }

            const labelY = station.y < 120 ? station.y - 16 : station.y + 22;

            return (
              <g
                key={station.id}
                onClick={() => onSelectStation?.(station.id)}
                className={onSelectStation ? "cursor-pointer" : undefined}
              >
                <circle
                  cx={station.x}
                  cy={station.y}
                  r={18}
                  fill="transparent"
                />
                <circle
                  cx={station.x}
                  cy={station.y}
                  r={radius}
                  fill={nodeFill}
                  stroke={nodeStroke}
                  strokeWidth={2.5}
                />
                <text
                  x={station.x}
                  y={labelY}
                  textAnchor="middle"
                  className="fill-slate-800 text-[11px] font-semibold"
                >
                  {station.name}
                </text>
                {(isOrigin || isDest || isTransferStop) && (
                  <text
                    x={station.x}
                    y={labelY + (station.y < 120 ? -12 : 13)}
                    textAnchor="middle"
                    className={`text-[10px] font-bold ${
                      isOrigin
                        ? "fill-blue-700"
                        : isDest
                          ? "fill-teal-700"
                          : "fill-amber-700"
                    }`}
                  >
                    {isOrigin ? "ORIGIN" : isDest ? "DESTINATION" : "TRANSFER"}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
