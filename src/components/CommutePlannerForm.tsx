import React from "react";
import { ArrowLeftRight, Clock, Search, ShieldCheck } from "lucide-react";
import { ROUTES, SCENARIO_PRESETS, STATIONS } from "../data/transitNetwork.ts";
import { minutesToHHMM } from "../services/routeEngine.ts";
import type { ComfortPreference, ScenarioPreset } from "../types/transit.ts";

interface CommutePlannerFormProps {
  noisyText: string;
  originId: string;
  destinationId: string;
  affectedRouteId: string;
  delayMinutes: string;
  preference: ComfortPreference;
  currentTimeMinutes: number;
  isLoading: boolean;
  onNoisyTextChange: (val: string) => void;
  onOriginChange: (val: string) => void;
  onDestinationChange: (val: string) => void;
  onSwapStations: () => void;
  onAffectedRouteChange: (val: string) => void;
  onDelayChange: (val: string) => void;
  onPreferenceChange: (val: ComfortPreference) => void;
  onTimeChange: (mins: number) => void;
  onApplyPreset: (preset: ScenarioPreset) => void;
  onSubmit: (useAI: boolean) => void;
}

const DELAY_CHIPS = [10, 15, 25, 35];
const TIME_WINDOWS = [
  { label: "08:15 AM Peak", minutes: 8 * 60 + 15 },
  { label: "12:15 PM Midday", minutes: 12 * 60 + 15 },
  { label: "05:30 PM Evening", minutes: 17 * 60 + 30 },
];

export const CommutePlannerForm: React.FC<CommutePlannerFormProps> = ({
  noisyText,
  originId,
  destinationId,
  affectedRouteId,
  delayMinutes,
  preference,
  currentTimeMinutes,
  isLoading,
  onNoisyTextChange,
  onOriginChange,
  onDestinationChange,
  onSwapStations,
  onAffectedRouteChange,
  onDelayChange,
  onPreferenceChange,
  onTimeChange,
  onApplyPreset,
  onSubmit,
}) => {
  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(true);
  };

  return (
    <form
      onSubmit={handleFormSubmit}
      className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 space-y-5"
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <label htmlFor="noisy-commute-input" className="text-sm font-semibold text-slate-900">
            Quick Disruption Input
          </label>
          <span className="text-xs text-slate-500">Handles typos &amp; missing details</span>
        </div>
        <textarea
          id="noisy-commute-input"
          rows={3}
          value={noisyText}
          onChange={(e) => onNoisyTextChange(e.target.value)}
          placeholder="e.g. Stuck at Oakridge, R1 express is 24m late and platform is packed, need a seat to Metro Central..."
          className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-700/15"
        />

        {/* 1-Tap Realistic Scenarios */}
        <div className="mt-2.5">
          <p className="text-xs font-medium text-slate-500 mb-1.5">Test Realistic Scenarios</p>
          <div className="flex flex-wrap gap-1.5">
            {SCENARIO_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onApplyPreset(preset)}
                className="min-h-[36px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 transition-colors hover:border-blue-300 hover:bg-blue-50/60 hover:text-blue-800 active:scale-[0.98]"
              >
                {preset.title}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100 pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Route &amp; Delay Controls</h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            Clock: {minutesToHHMM(currentTimeMinutes)}
          </span>
        </div>

        {/* Origin / Swap / Destination */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-end gap-2.5">
          <div>
            <label htmlFor="origin-select" className="block text-xs font-medium text-slate-600 mb-1">
              Current Station / Stop
            </label>
            <select
              id="origin-select"
              value={originId}
              onChange={(e) => onOriginChange(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/15"
            >
              <option value="">Auto-detect from text</option>
              {STATIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.shortCode})
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={onSwapStations}
            aria-label="Swap origin and destination"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:scale-[0.97] transition-colors"
          >
            <ArrowLeftRight className="h-4 w-4" />
          </button>

          <div>
            <label htmlFor="dest-select" className="block text-xs font-medium text-slate-600 mb-1">
              Destination
            </label>
            <select
              id="dest-select"
              value={destinationId}
              onChange={(e) => onDestinationChange(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/15"
            >
              <option value="">Auto-detect from text</option>
              {STATIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.shortCode})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Affected Route + Delay */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="route-select" className="block text-xs font-medium text-slate-600 mb-1">
              Delayed Live Route
            </label>
            <select
              id="route-select"
              value={affectedRouteId}
              onChange={(e) => onAffectedRouteChange(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/15"
            >
              <option value="">Auto-detect from text</option>
              {ROUTES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="delay-input" className="block text-xs font-medium text-slate-600 mb-1">
              Reported Delay (Minutes)
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="delay-input"
                type="number"
                min={0}
                max={120}
                placeholder="Auto"
                value={delayMinutes}
                onChange={(e) => onDelayChange(e.target.value)}
                className="min-h-[44px] w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/15"
              />
              <div className="flex flex-1 gap-1">
                {DELAY_CHIPS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onDelayChange(String(m))}
                    className={`min-h-[44px] flex-1 rounded-lg border text-xs font-mono font-medium tabular-nums transition-colors ${
                      delayMinutes === String(m)
                        ? "border-blue-700 bg-blue-50 text-blue-800"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    +{m}m
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Comfort Preference Segmented Control */}
        <div>
          <span className="block text-xs font-medium text-slate-600 mb-1.5">
            Priority Preference
          </span>
          <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => onPreferenceChange("fastest")}
              className={`min-h-[44px] rounded-md px-3 py-2 text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                preference === "fastest"
                  ? "bg-white text-blue-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Fastest Arrival
            </button>
            <button
              type="button"
              onClick={() => onPreferenceChange("least_crowded")}
              className={`min-h-[44px] rounded-md px-3 py-2 text-xs sm:text-sm font-semibold transition-all whitespace-nowrap ${
                preference === "least_crowded"
                  ? "bg-white text-blue-700 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Least Crowded
            </button>
          </div>
        </div>

        {/* Time Window Quick Selector */}
        <div>
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-1.5">
            <Clock className="h-3.5 w-3.5 text-slate-400" />
            Departure Window
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {TIME_WINDOWS.map((tw) => (
              <button
                key={tw.minutes}
                type="button"
                onClick={() => onTimeChange(tw.minutes)}
                className={`min-h-[40px] rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors truncate ${
                  Math.abs(currentTimeMinutes - tw.minutes) <= 5
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {tw.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="pt-1 space-y-2">
        <button
          type="submit"
          disabled={isLoading}
          className="min-h-[48px] w-full flex items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-800 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          <Search className="h-4 w-4" />
          {isLoading ? "Finding Verified Backup..." : "Recommend Backup Plan"}
        </button>

        <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
          <span>Schedules strictly anchored to verified suburban timetable</span>
        </div>
      </div>
    </form>
  );
};
