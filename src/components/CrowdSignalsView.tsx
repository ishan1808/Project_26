import React, { useState } from "react";
import { AlertCircle, Plus, RotateCcw } from "lucide-react";
import { ROUTES } from "../data/transitNetwork.ts";
import type { CrowdSignal, ReconciledCrowd, SignalSource } from "../types/transit.ts";

interface CrowdSignalsViewProps {
  signals: CrowdSignal[];
  reconciledCrowds: Record<string, ReconciledCrowd>;
  onAddSignal: (signal: CrowdSignal) => void;
  onResetSignals: () => void;
}

export const CrowdSignalsView: React.FC<CrowdSignalsViewProps> = ({
  signals,
  reconciledCrowds,
  onAddSignal,
  onResetSignals,
}) => {
  const [routeId, setRouteId] = useState(ROUTES[0].id);
  const [source, setSource] = useState<SignalSource>("rider_report");
  const [loadPct, setLoadPct] = useState(88);
  const [ageMinutes, setAgeMinutes] = useState(1);
  const [note, setNote] = useState("Platform queue spilling onto stairs.");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const sourceLabels: Record<SignalSource, string> = {
      official_sensor: "Official APC Sensor",
      platform_camera: "Platform Optical Counter",
      rider_report: "Live Rider Report",
      social_feed: "Social Post",
    };
    onAddSignal({
      id: `custom-${Date.now()}`,
      routeId,
      source,
      sourceLabel: sourceLabels[source],
      reportedLoadPct: Math.max(0, Math.min(100, loadPct)),
      ageMinutes: Math.max(0, ageMinutes),
      note: note.trim() || "Live crowd observation submitted.",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Conflicting Crowd Signal Reconciler</h2>
          <p className="text-sm text-slate-600">
            Resolves disagreements between official train sensors, platform cameras, and noisy rider feeds using recency decay and source trust weights.
          </p>
        </div>
        <button
          type="button"
          onClick={onResetSignals}
          className="min-h-[44px] inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restore Default Feed
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Inject conflicting signal */}
        <form
          onSubmit={handleAdd}
          className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-4 h-fit"
        >
          <h3 className="text-sm font-semibold text-slate-900">Simulate Conflicting Crowd Update</h3>

          <div>
            <label htmlFor="sig-route" className="block text-xs font-medium text-slate-600 mb-1">
              Target Route
            </label>
            <select
              id="sig-route"
              value={routeId}
              onChange={(e) => setRouteId(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {ROUTES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="sig-source" className="block text-xs font-medium text-slate-600 mb-1">
                Signal Source
              </label>
              <select
                id="sig-source"
                value={source}
                onChange={(e) => setSource(e.target.value as SignalSource)}
                className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="rider_report">Rider Report</option>
                <option value="official_sensor">Official Sensor</option>
                <option value="platform_camera">Platform Camera</option>
                <option value="social_feed">Social Feed</option>
              </select>
            </div>

            <div>
              <label htmlFor="sig-age" className="block text-xs font-medium text-slate-600 mb-1">
                Age (Minutes)
              </label>
              <input
                id="sig-age"
                type="number"
                min={0}
                max={60}
                value={ageMinutes}
                onChange={(e) => setAgeMinutes(Number(e.target.value))}
                className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm tabular-nums"
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
              <label htmlFor="sig-load">Reported Crowd Load</label>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">{loadPct}%</span>
            </div>
            <input
              id="sig-load"
              type="range"
              min={5}
              max={100}
              value={loadPct}
              onChange={(e) => setLoadPct(Number(e.target.value))}
              className="w-full accent-blue-700 h-2 cursor-pointer"
            />
          </div>

          <div>
            <label htmlFor="sig-note" className="block text-xs font-medium text-slate-600 mb-1">
              Update Note
            </label>
            <input
              id="sig-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>

          <button
            type="submit"
            className="min-h-[44px] w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Inject Signal &amp; Re-score
          </button>
        </form>

        {/* Reconciled route breakdown */}
        <div className="lg:col-span-8 space-y-3">
          {ROUTES.map((route) => {
            const rec = reconciledCrowds[route.id];
            const routeSignals = signals.filter((s) => s.routeId === route.id);
            if (!rec) return null;

            return (
              <div key={route.id} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs text-slate-500">
                      {route.mode.toUpperCase()} · Every {route.headwayMinutes} min · Status:{" "}
                      <strong
                        className={
                          rec.status === "Conflicting"
                            ? "text-amber-700"
                            : rec.status === "Aligned"
                              ? "text-emerald-700"
                              : "text-slate-600"
                        }
                      >
                        {rec.status}
                      </strong>
                    </div>
                    <h4 className="text-base font-bold text-slate-900">{route.name}</h4>
                  </div>

                  <div className="text-right font-mono tabular-nums">
                    <div className="text-lg font-bold text-slate-900">{rec.reconciledPct}%</div>
                    <div className="text-xs font-sans font-semibold text-slate-600">
                      {rec.tier} · {rec.confidence} Confidence
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-700 flex items-start gap-1.5">
                  {rec.status === "Conflicting" && (
                    <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                  )}
                  <span>{rec.explanation}</span>
                </p>

                {routeSignals.length > 0 && (
                  <div className="border-t border-slate-100 pt-2.5 space-y-1.5">
                    {routeSignals.map((sig) => (
                      <div
                        key={sig.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600"
                      >
                        <span>
                          <strong className="text-slate-800">{sig.sourceLabel}</strong> · {sig.note}
                        </span>
                        <span className="font-mono tabular-nums text-slate-700">
                          {sig.reportedLoadPct}% · {sig.ageMinutes}m ago
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
