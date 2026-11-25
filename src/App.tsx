import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CROWD_SIGNALS, ROUTES, SCENARIO_PRESETS, STATIONS, getStationById } from "./data/transitNetwork.ts";
import { reconcileAllRoutesCrowd } from "./services/crowdReconciler.ts";
import { minutesToHHMM } from "./services/routeEngine.ts";
import { TopBar, type AppSection } from "./components/TopBar.tsx";
import { CommutePlannerForm } from "./components/CommutePlannerForm.tsx";
import { BackupPlanResults } from "./components/BackupPlanResults.tsx";
import { SchematicMap } from "./components/SchematicMap.tsx";
import { CrowdSignalsView } from "./components/CrowdSignalsView.tsx";
import { ArchitectureView } from "./components/ArchitectureView.tsx";
import type {
  ComfortPreference,
  CrowdSignal,
  RecommendResponse,
  ScenarioPreset,
} from "./types/transit.ts";

const INITIAL_PRESET = SCENARIO_PRESETS[0];

export default function App() {
  const [activeSection, setActiveSection] = useState<AppSection>("planner");

  const [noisyText, setNoisyText] = useState(INITIAL_PRESET.noisyText);
  const [originId, setOriginId] = useState(INITIAL_PRESET.originId);
  const [destinationId, setDestinationId] = useState(INITIAL_PRESET.destinationId);
  const [affectedRouteId, setAffectedRouteId] = useState(INITIAL_PRESET.affectedRouteId);
  const [delayMinutes, setDelayMinutes] = useState(String(INITIAL_PRESET.delayMinutes));
  const [preference, setPreference] = useState<ComfortPreference>(INITIAL_PRESET.preference);
  const [currentTimeMinutes, setCurrentTimeMinutes] = useState(8 * 60 + 15);
  const [crowdSignals, setCrowdSignals] = useState<CrowdSignal[]>(INITIAL_PRESET.crowdSignals);

  const [result, setResult] = useState<RecommendResponse | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<{ message: string; deterministicAvailable?: boolean } | null>(null);

  const [mapSelectMode, setMapSelectMode] = useState<"origin" | "destination">("origin");
  const requestSeqRef = useRef(0);

  const fetchRecommendation = useCallback(
    async (opts: {
      useAI: boolean;
      noisyTextVal?: string;
      originVal?: string;
      destVal?: string;
      routeVal?: string;
      delayVal?: string;
      prefVal?: ComfortPreference;
      timeVal?: number;
      signalsVal?: CrowdSignal[];
    }) => {
      const seq = ++requestSeqRef.current;
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/recommend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            useAI: opts.useAI,
            noisyText: opts.noisyTextVal ?? noisyText,
            originId: opts.originVal ?? originId,
            destinationId: opts.destVal ?? destinationId,
            affectedRouteId: opts.routeVal ?? affectedRouteId,
            delayMinutes: opts.delayVal ?? delayMinutes,
            preference: opts.prefVal ?? preference,
            currentTimeMinutes: opts.timeVal ?? currentTimeMinutes,
            customCrowdSignals: opts.signalsVal ?? crowdSignals,
          }),
        });

        const data = (await res.json()) as RecommendResponse & {
          error?: string;
          deterministicAvailable?: boolean;
        };

        if (seq !== requestSeqRef.current) return;

        if (!res.ok) {
          setError({
            message: data.error || `Request failed with status ${res.status}`,
            deterministicAvailable: data.deterministicAvailable,
          });
          if (opts.useAI && data.deterministicAvailable) {
            const detRes = await fetch("/api/recommend", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                useAI: false,
                noisyText: opts.noisyTextVal ?? noisyText,
                originId: opts.originVal ?? originId,
                destinationId: opts.destVal ?? destinationId,
                affectedRouteId: opts.routeVal ?? affectedRouteId,
                delayMinutes: opts.delayVal ?? delayMinutes,
                preference: opts.prefVal ?? preference,
                currentTimeMinutes: opts.timeVal ?? currentTimeMinutes,
                customCrowdSignals: opts.signalsVal ?? crowdSignals,
              }),
            });
            if (detRes.ok && seq === requestSeqRef.current) {
              const detData = (await detRes.json()) as RecommendResponse;
              setResult(detData);
              setSelectedOptionId(detData.recommendedOptions[0]?.id ?? null);
            }
          }
          setIsLoading(false);
          return;
        }

        setResult(data);
        setSelectedOptionId(data.recommendedOptions[0]?.id ?? null);
      } catch (err: unknown) {
        if (seq !== requestSeqRef.current) return;
        setError({
          message: err instanceof Error ? err.message : "Network error communicating with WaySwitch server.",
          deterministicAvailable: true,
        });
      } finally {
        if (seq === requestSeqRef.current) {
          setIsLoading(false);
        }
      }
    },
    [noisyText, originId, destinationId, affectedRouteId, delayMinutes, preference, currentTimeMinutes, crowdSignals]
  );

  // Run initial scenario on mount
  useEffect(() => {
    void fetchRecommendation({ useAI: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApplyPreset = (preset: ScenarioPreset) => {
    setNoisyText(preset.noisyText);
    setOriginId(preset.originId);
    setDestinationId(preset.destinationId);
    setAffectedRouteId(preset.affectedRouteId);
    setDelayMinutes(String(preset.delayMinutes));
    setPreference(preset.preference);
    setCrowdSignals(preset.crowdSignals);
    void fetchRecommendation({
      useAI: true,
      noisyTextVal: preset.noisyText,
      originVal: preset.originId,
      destVal: preset.destinationId,
      routeVal: preset.affectedRouteId,
      delayVal: String(preset.delayMinutes),
      prefVal: preset.preference,
      signalsVal: preset.crowdSignals,
    });
  };

  const handleReset = () => {
    setActiveSection("planner");
    handleApplyPreset(INITIAL_PRESET);
  };

  const handleSwapStations = () => {
    const prevOrigin = originId;
    const prevDest = destinationId;
    setOriginId(prevDest);
    setDestinationId(prevOrigin);
  };

  const handleAddCrowdSignal = (signal: CrowdSignal) => {
    const updated = [signal, ...crowdSignals];
    setCrowdSignals(updated);
    void fetchRecommendation({ useAI: false, signalsVal: updated });
  };

  const handleResetCrowdSignals = () => {
    setCrowdSignals(DEFAULT_CROWD_SIGNALS);
    void fetchRecommendation({ useAI: false, signalsVal: DEFAULT_CROWD_SIGNALS });
  };

  const handleMapStationClick = (stationId: string) => {
    if (mapSelectMode === "origin") {
      setOriginId(stationId);
      setMapSelectMode("destination");
      if (stationId !== destinationId) {
        void fetchRecommendation({ useAI: false, originVal: stationId });
      }
    } else {
      setDestinationId(stationId);
      setMapSelectMode("origin");
      if (stationId !== originId) {
        void fetchRecommendation({ useAI: false, destVal: stationId });
      }
    }
  };

  const selectedOption = useMemo(() => {
    if (!result) return null;
    return (
      result.recommendedOptions.find((o) => o.id === selectedOptionId) ??
      result.recommendedOptions[0] ??
      null
    );
  }, [result, selectedOptionId]);

  const effectiveOrigin = result?.normalizedInput.originId ?? (originId || "oakridge");
  const effectiveDest = result?.normalizedInput.destinationId ?? (destinationId || "central");
  const effectiveRoute = result?.normalizedInput.affectedRouteId ?? (affectedRouteId || "R1-EXP");
  const effectiveDelay =
    result?.normalizedInput.delayMinutes ?? (Number.parseInt(delayMinutes, 10) || 0);

  const liveReconciledCrowds = useMemo(() => {
    return (
      result?.reconciledCrowds ??
      reconcileAllRoutesCrowd(crowdSignals, effectiveRoute, effectiveDelay)
    );
  }, [result, crowdSignals, effectiveRoute, effectiveDelay]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopBar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        onReset={handleReset}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
        {activeSection === "planner" && (
          <div className="space-y-6">
            {/* Compact Hero Lead */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 border-b border-slate-200 pb-5">
              <div className="space-y-1 max-w-2xl">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 text-balance">
                  Suburban Commute Backup Planner
                </h1>
                <p className="text-sm sm:text-base text-slate-600">
                  Enter a delayed train or bus, current delay, and comfort priority to get verified alternatives with reconciled crowd levels.
                </p>
              </div>
              <div className="text-xs text-slate-500 font-mono tabular-nums shrink-0">
                {STATIONS.length} stations · {ROUTES.length} verified routes ·{" "}
                {minutesToHHMM(currentTimeMinutes)} window
              </div>
            </div>

            {/* 2-Column Responsive Workspace */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <div className="lg:col-span-5">
                <CommutePlannerForm
                  noisyText={noisyText}
                  originId={originId}
                  destinationId={destinationId}
                  affectedRouteId={affectedRouteId}
                  delayMinutes={delayMinutes}
                  preference={preference}
                  currentTimeMinutes={currentTimeMinutes}
                  isLoading={isLoading}
                  onNoisyTextChange={setNoisyText}
                  onOriginChange={setOriginId}
                  onDestinationChange={setDestinationId}
                  onSwapStations={handleSwapStations}
                  onAffectedRouteChange={setAffectedRouteId}
                  onDelayChange={setDelayMinutes}
                  onPreferenceChange={(pref) => {
                    setPreference(pref);
                    void fetchRecommendation({ useAI: true, prefVal: pref });
                  }}
                  onTimeChange={(mins) => {
                    setCurrentTimeMinutes(mins);
                    void fetchRecommendation({ useAI: true, timeVal: mins });
                  }}
                  onApplyPreset={handleApplyPreset}
                  onSubmit={(useAI) => void fetchRecommendation({ useAI })}
                />
              </div>

              <div className="lg:col-span-7 space-y-6">
                <BackupPlanResults
                  data={result}
                  isLoading={isLoading}
                  error={error}
                  selectedOptionId={selectedOption?.id ?? null}
                  onSelectOption={setSelectedOptionId}
                  onRetryDeterministic={() => void fetchRecommendation({ useAI: true })}
                />

                <SchematicMap
                  originId={effectiveOrigin}
                  destinationId={effectiveDest}
                  affectedRouteId={effectiveRoute}
                  selectedOption={selectedOption}
                  onSelectStation={handleMapStationClick}
                />
              </div>
            </div>
          </div>
        )}

        {activeSection === "network" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Verified Network Map &amp; Timetables</h2>
                <p className="text-sm text-slate-600">
                  All backup routes are computed solely from these published suburban corridors and headways.
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
                <button
                  type="button"
                  onClick={() => setMapSelectMode("origin")}
                  className={`min-h-[40px] rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    mapSelectMode === "origin"
                      ? "bg-white text-blue-700 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Tap Sets Origin ({getStationById(effectiveOrigin)?.shortCode})
                </button>
                <button
                  type="button"
                  onClick={() => setMapSelectMode("destination")}
                  className={`min-h-[40px] rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    mapSelectMode === "destination"
                      ? "bg-white text-teal-700 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Tap Sets Dest ({getStationById(effectiveDest)?.shortCode})
                </button>
              </div>
            </div>

            <SchematicMap
              originId={effectiveOrigin}
              destinationId={effectiveDest}
              affectedRouteId={effectiveRoute}
              selectedOption={selectedOption}
              onSelectStation={handleMapStationClick}
            />

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-900">Published Suburban Route Schedule</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Route</th>
                      <th className="py-3 px-4">Mode</th>
                      <th className="py-3 px-4">Corridor Stops</th>
                      <th className="py-3 px-4 text-right">Headway</th>
                      <th className="py-3 px-4 text-right">Service Hours</th>
                      <th className="py-3 px-4 text-right">Live Crowd</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ROUTES.map((r) => {
                      const crowd = liveReconciledCrowds[r.id];
                      return (
                        <tr key={r.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                            {r.name}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                            {r.mode === "rail"
                              ? "Suburban Rail"
                              : r.mode === "light_rail"
                                ? "Light Rail"
                                : "Express Bus"}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600">
                            {r.stops.map((s) => getStationById(s.stationId)?.name).join(" → ")}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap">
                            Every {r.headwayMinutes}m
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-700 whitespace-nowrap">
                            {minutesToHHMM(r.firstDepartureMinute)}–{minutesToHHMM(r.lastDepartureMinute)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-xs tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                            {crowd ? `${crowd.reconciledPct}% · ${crowd.tier}` : `${r.baselineCrowdPct}%`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeSection === "crowd" && (
          <CrowdSignalsView
            signals={crowdSignals}
            reconciledCrowds={liveReconciledCrowds}
            onAddSignal={handleAddCrowdSignal}
            onResetSignals={handleResetCrowdSignals}
          />
        )}

        {activeSection === "architecture" && <ArchitectureView />}
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 px-4 sm:px-6 text-xs text-slate-500">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
          <span>WaySwitch · Suburban Rail &amp; Express Bus Backup Planner</span>
          <span>Deterministic timetables verified before briefing</span>
        </div>
      </footer>
    </div>
  );
}
