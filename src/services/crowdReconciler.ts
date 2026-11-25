import { ROUTES } from "../data/transitNetwork.ts";
import type { CrowdSignal, CrowdTier, ReconciledCrowd, SignalSource } from "../types/transit.ts";

const SOURCE_BASE_WEIGHT: Record<SignalSource, number> = {
  official_sensor: 1.0,
  platform_camera: 0.92,
  rider_report: 0.85,
  social_feed: 0.45,
};

export function crowdPctToTier(pct: number): CrowdTier {
  if (pct < 38) return "Seats Likely";
  if (pct < 62) return "Standing Room";
  if (pct < 82) return "Crowded";
  return "Overcrowded";
}

export function extractNoisyCrowdHint(
  noisyText: string | undefined,
  affectedRouteId: string
): CrowdSignal | null {
  if (!noisyText || !noisyText.trim()) return null;
  const lower = noisyText.toLowerCase();

  const crowdedKeywords = [
    "packed",
    "overcrowded",
    "jammed",
    "shoulder",
    "crush",
    "full",
    "no space",
    "cant board",
    "can't board",
    "crowded",
    "standing only",
    "mobbed",
  ];
  const emptyKeywords = ["empty", "quiet", "seats open", "plenty of seats", "uncrowded", "half empty"];

  const hitsCrowded = crowdedKeywords.some((kw) => lower.includes(kw));
  const hitsEmpty = emptyKeywords.some((kw) => lower.includes(kw));

  if (!hitsCrowded && !hitsEmpty) return null;

  if (hitsCrowded && !hitsEmpty) {
    return {
      id: "sig-user-live-crowd",
      routeId: affectedRouteId,
      source: "rider_report",
      sourceLabel: "Your Live Observation",
      reportedLoadPct: 90,
      ageMinutes: 0,
      note: "Extracted from your live situation input (crowded platform/vehicle).",
    };
  }

  if (hitsEmpty && !hitsCrowded) {
    return {
      id: "sig-user-live-empty",
      routeId: affectedRouteId,
      source: "rider_report",
      sourceLabel: "Your Live Observation",
      reportedLoadPct: 24,
      ageMinutes: 0,
      note: "Extracted from your live situation input (seats available).",
    };
  }

  return null;
}

export function reconcileAllRoutesCrowd(
  signals: CrowdSignal[],
  affectedRouteId?: string,
  delayMinutes = 0
): Record<string, ReconciledCrowd> {
  const result: Record<string, ReconciledCrowd> = {};

  for (const route of ROUTES) {
    const routeSignals = signals.filter((s) => s.routeId === route.id);
    const delaySpillover =
      route.id === affectedRouteId && delayMinutes > 0
        ? Math.min(22, Math.round(delayMinutes * 0.7))
        : 0;

    if (routeSignals.length === 0) {
      const pct = Math.min(98, route.baselineCrowdPct + delaySpillover);
      result[route.id] = {
        routeId: route.id,
        reconciledPct: pct,
        tier: crowdPctToTier(pct),
        status: "Limited Data",
        confidence: "Low",
        explanation:
          delaySpillover > 0
            ? `No live feed; baseline ${route.baselineCrowdPct}% adjusted +${delaySpillover}% for ${delayMinutes}m delay spillover.`
            : `Based on historical timetable baseline (${route.baselineCrowdPct}%).`,
        signalsUsed: [],
      };
      continue;
    }

    // Recency decay: half-life ~15 min. Signals older than 20m lose weight rapidly.
    let weightedSum = 0;
    let totalWeight = 0;
    const freshSignals: CrowdSignal[] = [];

    for (const sig of routeSignals) {
      const clampedAge = Math.max(0, sig.ageMinutes);
      const recencyFactor = Math.exp(-clampedAge / 14);
      const baseWeight = SOURCE_BASE_WEIGHT[sig.source] ?? 0.5;
      const weight = baseWeight * recencyFactor;
      weightedSum += sig.reportedLoadPct * weight;
      totalWeight += weight;
      if (clampedAge <= 12) {
        freshSignals.push(sig);
      }
    }

    let baseReconciled = totalWeight > 0 ? weightedSum / totalWeight : route.baselineCrowdPct;

    // Detect conflict among recent signals (or between fresh signal and stale outlier)
    const values = routeSignals.map((s) => s.reportedLoadPct);
    const spread = Math.max(...values) - Math.min(...values);
    const freshValues = freshSignals.map((s) => s.reportedLoadPct);
    const freshSpread = freshValues.length >= 2 ? Math.max(...freshValues) - Math.min(...freshValues) : 0;

    let status: ReconciledCrowd["status"] = "Aligned";
    let confidence: ReconciledCrowd["confidence"] = routeSignals.length >= 2 ? "High" : "Medium";
    let explanation = "";

    if (freshSpread >= 18) {
      status = "Conflicting";
      confidence = "Medium";
      // Conservative safety bias: weight the higher fresh crowd signal slightly more when platform reports warn of crowding
      const maxFresh = Math.max(...freshValues);
      baseReconciled = baseReconciled * 0.72 + maxFresh * 0.28;
      const minFresh = Math.min(...freshValues);
      explanation = `Conflicting live updates (${minFresh}% vs ${maxFresh}%). Weighted toward fresher platform reports to avoid boarding squeeze.`;
    } else if (spread >= 25) {
      status = "Conflicting";
      confidence = "High";
      const newest = [...routeSignals].sort((a, b) => a.ageMinutes - b.ageMinutes)[0];
      const oldest = [...routeSignals].sort((a, b) => b.ageMinutes - a.ageMinutes)[0];
      explanation = `Resolved stale conflict: ${oldest.sourceLabel} (${oldest.reportedLoadPct}%, ${oldest.ageMinutes}m ago) decayed in favor of recent ${newest.sourceLabel} (${newest.reportedLoadPct}%, ${newest.ageMinutes}m ago).`;
    } else {
      const newest = [...routeSignals].sort((a, b) => a.ageMinutes - b.ageMinutes)[0];
      explanation = `Signals aligned around ${Math.round(baseReconciled)}% via ${newest.sourceLabel} (${newest.ageMinutes}m ago).`;
    }

    const finalPct = Math.min(99, Math.max(5, Math.round(baseReconciled + delaySpillover)));
    if (delaySpillover > 0) {
      explanation += ` Includes +${delaySpillover}% platform accumulation from ${delayMinutes}m delay.`;
    }

    result[route.id] = {
      routeId: route.id,
      reconciledPct: finalPct,
      tier: crowdPctToTier(finalPct),
      status,
      confidence,
      explanation,
      signalsUsed: [...routeSignals].sort((a, b) => a.ageMinutes - b.ageMinutes),
    };
  }

  return result;
}
