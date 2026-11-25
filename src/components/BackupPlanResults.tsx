import React from "react";
import { AlertTriangle, CheckCircle2, Info, TrainFront, Bus, ArrowRight, ShieldCheck } from "lucide-react";
import { getStationById, getRouteById } from "../data/transitNetwork.ts";
import { minutesToHHMM } from "../services/routeEngine.ts";
import type { BackupOption, CrowdTier, RecommendResponse, TransitMode } from "../types/transit.ts";

interface BackupPlanResultsProps {
  data: RecommendResponse | null;
  isLoading: boolean;
  error: { message: string; deterministicAvailable?: boolean } | null;
  selectedOptionId: string | null;
  onSelectOption: (optionId: string) => void;
  onRetryDeterministic: () => void;
}

function crowdColorClass(tier: CrowdTier): string {
  switch (tier) {
    case "Seats Likely":
      return "text-emerald-700";
    case "Standing Room":
      return "text-amber-700";
    case "Crowded":
      return "text-orange-700";
    case "Overcrowded":
      return "text-red-700";
  }
}

function ModeIcon({ mode }: { mode: TransitMode }) {
  if (mode === "bus") {
    return <Bus className="h-4 w-4 text-amber-700 shrink-0" />;
  }
  return <TrainFront className="h-4 w-4 text-blue-700 shrink-0" />;
}

export const BackupPlanResults: React.FC<BackupPlanResultsProps> = ({
  data,
  isLoading,
  error,
  selectedOptionId,
  onSelectOption,
  onRetryDeterministic,
}) => {
  if (isLoading) {
    return (
      <div className="space-y-4" aria-live="polite" aria-busy="true">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 animate-pulse">
          <div className="h-4 w-40 rounded bg-slate-200" />
          <div className="h-6 w-3/4 rounded bg-slate-200" />
          <div className="h-4 w-full rounded bg-slate-100" />
        </div>
        {[1, 2].map((idx) => (
          <div key={idx} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 animate-pulse">
            <div className="flex justify-between">
              <div className="h-5 w-48 rounded bg-slate-200" />
              <div className="h-6 w-20 rounded bg-slate-200" />
            </div>
            <div className="h-14 w-full rounded bg-slate-100" />
          </div>
        ))}
      </div>
    );
  }

  if (!data && !error) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center space-y-2">
        <h3 className="text-base font-semibold text-slate-900">Ready to Plan Your Detour</h3>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Describe your delay or pick a route on the left to get verified train and bus alternatives in seconds.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50/80 p-4 sm:p-5 space-y-3"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-700 shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
              <h3 className="text-sm font-semibold text-red-900">
                AI Briefing Unavailable — Showing Verified Timetable Alternatives
              </h3>
              <p className="text-xs sm:text-sm text-red-800">{error.message}</p>
            </div>
          </div>
          {error.deterministicAvailable && (
            <div className="pl-8">
              <button
                type="button"
                onClick={onRetryDeterministic}
                className="min-h-[40px] rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors"
              >
                Retry AI Brief
              </button>
            </div>
          )}
        </div>
      )}

      {data && <BackupResultsBody data={data} selectedOptionId={selectedOptionId} onSelectOption={onSelectOption} />}
    </div>
  );
};

interface BackupResultsBodyProps {
  data: RecommendResponse;
  selectedOptionId: string | null;
  onSelectOption: (optionId: string) => void;
}

const BackupResultsBody: React.FC<BackupResultsBodyProps> = ({
  data,
  selectedOptionId,
  onSelectOption,
}) => {

  const { normalizedInput, baselineOption, recommendedOptions, aiBrief } = data;
  const originName = getStationById(normalizedInput.originId)?.name ?? normalizedInput.originId;
  const destName = getStationById(normalizedInput.destinationId)?.name ?? normalizedInput.destinationId;
  const affectedRouteName = getRouteById(normalizedInput.affectedRouteId)?.name ?? normalizedInput.affectedRouteId;

  return (
    <div className="space-y-4">
      {/* Input Interpretation & Graceful Missing-Data Handling */}
      {(normalizedInput.warnings.length > 0 || normalizedInput.interpretationNotes.length > 0) && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-slate-800">
            <Info className="h-4 w-4 text-blue-700 shrink-0" />
            <span>Normalized Commute Context</span>
            <span className="text-slate-400" aria-hidden="true">·</span>
            <span className="font-normal text-slate-600">
              {originName} to {destName}
            </span>
            <span className="text-slate-400" aria-hidden="true">·</span>
            <span className="font-mono font-normal text-slate-600 tabular-nums">
              {affectedRouteName} (+{normalizedInput.delayMinutes}m)
            </span>
          </div>

          {normalizedInput.interpretationNotes.length > 0 && (
            <ul className="space-y-1 text-xs text-slate-600 pl-6 list-disc">
              {normalizedInput.interpretationNotes.map((note, idx) => (
                <li key={idx}>{note}</li>
              ))}
            </ul>
          )}

          {normalizedInput.warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-800 pl-6 list-disc">
              {normalizedInput.warnings.map((warn, idx) => (
                <li key={idx}>{warn}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Grounded AI Dispatch Brief */}
      {aiBrief && (
        <section
          aria-label="Commuter Action Brief"
          className="rounded-xl border border-blue-200 bg-blue-50/40 p-5 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <span className="font-semibold text-blue-900">Recommended Action Plan</span>
            <span className="inline-flex items-center gap-1.5 text-emerald-800 font-medium">
              <ShieldCheck className="h-3.5 w-3.5" />
              {aiBrief.groundingVerified ? "Schedule Grounding Verified" : "Timetable Audit Flagged"}
            </span>
          </div>

          <h2 className="text-lg sm:text-xl font-bold text-slate-900 leading-snug text-balance">
            {aiBrief.headline}
          </h2>

          <p className="text-sm font-medium text-slate-800 leading-relaxed">{aiBrief.actionStep}</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-blue-100 text-xs text-slate-700">
            <div>
              <span className="block font-semibold text-slate-900 mb-0.5">Crowd Signal Check</span>
              <span>{aiBrief.crowdConflictNote}</span>
            </div>
            <div>
              <span className="block font-semibold text-slate-900 mb-0.5">Fallback Option</span>
              <span>{aiBrief.contingencyTip}</span>
            </div>
          </div>

          <p className="text-xs text-slate-500 font-mono">
            {aiBrief.groundingAuditNotes.join(" · ")}
          </p>
        </section>
      )}

      {/* Baseline Delayed Route Comparison Strip */}
      {baselineOption && (
        <div className="rounded-xl border border-slate-200 bg-slate-100/70 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-xs font-medium text-slate-500">
              If you wait on delayed route · {baselineOption.groundingRefs.join(", ")}
            </div>
            <div className="text-sm font-semibold text-slate-800">
              {baselineOption.label}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm font-mono tabular-nums">
            <span className="text-slate-700">
              ETA <strong className="text-slate-900">{baselineOption.etaTime}</strong> ({baselineOption.totalMinutes}m)
            </span>
            <span className={`font-sans font-semibold ${crowdColorClass(baselineOption.comfortTier)}`}>
              {baselineOption.maxCrowdPct}% · {baselineOption.comfortTier}
            </span>
          </div>
        </div>
      )}

      {/* Ranked Verified Backup Plans */}
      {recommendedOptions.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">No Direct or 1-Transfer Alternatives Available</h3>
          <p className="text-xs text-slate-600">
            Service may be outside operating hours ({minutesToHHMM(normalizedInput.currentTimeMinutes)}). Try switching the departure window.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold text-slate-900">
              Verified Backup Alternatives ({recommendedOptions.length})
            </h3>
            <span className="text-xs text-slate-500">
              Sorted by {normalizedInput.preference === "fastest" ? "Fastest Arrival" : "Least Crowded"}
            </span>
          </div>

          {recommendedOptions.map((option: BackupOption) => {
            const isSelected = option.id === selectedOptionId;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onSelectOption(option.id)}
                className={`w-full text-left rounded-xl border p-4 sm:p-5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
                  isSelected
                    ? "border-blue-700 bg-white ring-1 ring-blue-700/20"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                {/* Header row */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-semibold text-blue-700">
                        Option {option.rank}
                        {option.rank === 1 ? " · Best Match" : ""}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{option.transferCount === 0 ? "Direct" : `${option.transferCount} Transfer`}</span>
                      <span aria-hidden="true">·</span>
                      <span className={crowdColorClass(option.comfortTier) + " font-semibold"}>
                        {option.maxCrowdPct}% {option.comfortTier}
                      </span>
                    </div>
                    <h4 className="text-base font-bold text-slate-900">{option.label}</h4>
                  </div>

                  <div className="text-right font-mono tabular-nums">
                    <div className="text-lg font-bold text-slate-900">ETA {option.etaTime}</div>
                    <div className="text-xs text-slate-600">
                      {option.totalMinutes} min total
                      {option.timeSavedVsBaseline > 0 && (
                        <span className="text-emerald-700 font-semibold">
                          {" "}
                          · Saves {option.timeSavedVsBaseline}m
                        </span>
                      )}
                      {option.timeSavedVsBaseline < 0 && (
                        <span className="text-slate-500">
                          {" "}
                          · +{Math.abs(option.timeSavedVsBaseline)}m vs delayed
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Step-by-step Legs */}
                <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-3">
                  {option.legs.map((leg, idx) => (
                    <div
                      key={`${leg.timetableRefId}-${idx}`}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
                    >
                      <div className="flex items-start sm:items-center gap-2.5">
                        <ModeIcon mode={leg.mode} />
                        <div>
                          <div className="font-medium text-slate-900">
                            {leg.routeName}
                          </div>
                          <div className="text-xs text-slate-600 flex flex-wrap items-center gap-1.5">
                            <span>
                              Board at <strong className="text-slate-800">{leg.boardStationName}</strong> ({leg.boardPlatform})
                            </span>
                            <ArrowRight className="h-3 w-3 text-slate-400 inline" />
                            <span>
                              Alight <strong className="text-slate-800">{leg.alightStationName}</strong>
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 font-mono text-xs tabular-nums pl-6 sm:pl-0">
                        <span className="font-semibold text-slate-900">
                          {leg.scheduledDeparture} – {leg.scheduledArrival}
                        </span>
                        <span className="text-slate-500">
                          Wait {leg.waitMinutes}m · {leg.timetableRefId}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Footer summary reasons */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-xs text-slate-600">
                  <span>{option.reasons[0]}</span>
                  {option.crowdDeltaVsBaseline < 0 && (
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {Math.abs(option.crowdDeltaVsBaseline)}% less crowded than delayed route
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
