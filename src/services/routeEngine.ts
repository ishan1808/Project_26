import { DEFAULT_CROWD_SIGNALS, ROUTES, STATIONS, getRouteById, getStationById } from "../data/transitNetwork.ts";
import type {
  BackupLeg,
  BackupOption,
  ComfortPreference,
  CrowdSignal,
  NormalizedInput,
  RecommendRequest,
  ReconciledCrowd,
  TransitRoute,
} from "../types/transit.ts";
import { crowdPctToTier, extractNoisyCrowdHint, reconcileAllRoutesCrowd } from "./crowdReconciler.ts";

export function minutesToHHMM(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hh = Math.floor(normalized / 60);
  const mm = normalized % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function getDefaultCurrentMinute(): number {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  // Keep within active suburban service window (05:30 - 22:30) for deterministic demo clarity
  if (mins < 330 || mins > 1350) {
    return 8 * 60 + 15; // 08:15 AM peak suburban window
  }
  return mins;
}

function fuzzyMatchStation(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const station of STATIONS) {
    if (lower.includes(station.name.toLowerCase()) || lower.includes(station.id)) {
      return station.id;
    }
    for (const alias of station.aliases) {
      if (lower.includes(alias)) {
        return station.id;
      }
    }
  }
  return undefined;
}

function fuzzyMatchRoute(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const route of ROUTES) {
    if (
      lower.includes(route.id.toLowerCase()) ||
      lower.includes(route.code.toLowerCase()) ||
      lower.includes(route.name.toLowerCase())
    ) {
      return route.id;
    }
  }
  if (lower.includes("42")) return "B42-EXP";
  if (lower.includes("18")) return "B18-FDR";
  if (lower.includes("99")) return "B99-LOOP";
  if (lower.includes("light rail") || lower.includes("l3")) return "L3-CROSS";
  if (lower.includes("valley") || lower.includes("r2")) return "R2-LOC";
  if (lower.includes("express") || lower.includes("r1")) return "R1-EXP";
  return undefined;
}

export function parseNoisyInputDeterministic(req: RecommendRequest): NormalizedInput {
  const usedDefaults: string[] = [];
  const interpretationNotes: string[] = [];
  const warnings: string[] = [];

  const text = (req.noisyText ?? "").trim();
  const extractedFromNoise = text.length > 0;

  let originId = req.originId && getStationById(req.originId) ? req.originId : "";
  let destinationId = req.destinationId && getStationById(req.destinationId) ? req.destinationId : "";
  let affectedRouteId = req.affectedRouteId && getRouteById(req.affectedRouteId) ? req.affectedRouteId : "";

  if (text) {
    const lower = text.toLowerCase();

    // Try extracting "from X to Y" or "at X ... to Y"
    if (!originId || !destinationId) {
      const toSplit = lower.split(/\b(?:to|toward|towards|->|=>|for)\b/);
      if (toSplit.length >= 2) {
        const leftMatch = fuzzyMatchStation(toSplit[0]);
        const rightMatch = fuzzyMatchStation(toSplit.slice(1).join(" "));
        if (!originId && leftMatch) {
          originId = leftMatch;
          interpretationNotes.push(`Origin parsed from text: ${getStationById(leftMatch)?.name}`);
        }
        if (!destinationId && rightMatch) {
          destinationId = rightMatch;
          interpretationNotes.push(`Destination parsed from text: ${getStationById(rightMatch)?.name}`);
        }
      } else {
        // Scan all matched stations in order of appearance
        const matches: { id: string; idx: number }[] = [];
        for (const st of STATIONS) {
          const candidates = [st.name.toLowerCase(), ...st.aliases];
          for (const c of candidates) {
            const idx = lower.indexOf(c);
            if (idx !== -1) {
              matches.push({ id: st.id, idx });
              break;
            }
          }
        }
        matches.sort((a, b) => a.idx - b.idx);
        if (!originId && matches[0]) {
          originId = matches[0].id;
          interpretationNotes.push(`Origin matched from text: ${getStationById(originId)?.name}`);
        }
        if (!destinationId && matches[1] && matches[1].id !== originId) {
          destinationId = matches[1].id;
          interpretationNotes.push(`Destination matched from text: ${getStationById(destinationId)?.name}`);
        }
      }
    }

    if (!affectedRouteId) {
      const routeMatch = fuzzyMatchRoute(text);
      if (routeMatch) {
        affectedRouteId = routeMatch;
        interpretationNotes.push(`Affected route matched: ${getRouteById(routeMatch)?.name}`);
      }
    }
  }

  // Apply safe defaults if fields are still missing
  if (!originId) {
    originId = "oakridge";
    usedDefaults.push("origin");
    warnings.push("Origin wasn't clear — defaulted to Oakridge Junction. Tap to change if needed.");
  }

  if (!destinationId) {
    destinationId = originId === "central" ? "oakridge" : "central";
    usedDefaults.push("destination");
    warnings.push(
      `Destination wasn't specified — defaulted to ${getStationById(destinationId)?.name}.`
    );
  }

  if (originId === destinationId) {
    destinationId = originId === "central" ? "oakridge" : "central";
    warnings.push(
      `Origin and destination matched; adjusted destination to ${getStationById(destinationId)?.name}.`
    );
  }

  if (!affectedRouteId) {
    // Pick a route serving originId if possible
    const servingOrigin = ROUTES.find((r) => r.stops.some((s) => s.stationId === originId));
    affectedRouteId = servingOrigin?.id ?? "R1-EXP";
    usedDefaults.push("affectedRoute");
    warnings.push(
      `Delayed route wasn't named — assumed ${getRouteById(affectedRouteId)?.name} serving your stop.`
    );
  }

  // Parse delay minutes safely from numeric, string, or noisy text
  let delayMinutes: number | null = null;
  if (typeof req.delayMinutes === "number" && Number.isFinite(req.delayMinutes)) {
    delayMinutes = req.delayMinutes;
  } else if (typeof req.delayMinutes === "string" && req.delayMinutes.trim() !== "") {
    const parsed = Number.parseInt(req.delayMinutes.replace(/[^\d-]/g, ""), 10);
    if (Number.isFinite(parsed)) delayMinutes = parsed;
  }

  if ((delayMinutes === null || delayMinutes === 0) && text) {
    const delayMatch = text.match(/(\d{1,3})\s*(?:m|min|mins|minute|minutes)\s*(?:late|delay|delayed|behind)?/i);
    if (delayMatch) {
      delayMinutes = Number.parseInt(delayMatch[1], 10);
      interpretationNotes.push(`Extracted ${delayMinutes} min delay from message.`);
    } else if (/\b(hour|1hr|1 hr)\b/i.test(text)) {
      delayMinutes = 60;
      interpretationNotes.push("Interpreted '1 hour' as 60 min delay.");
    }
  }

  if (delayMinutes === null || Number.isNaN(delayMinutes)) {
    delayMinutes = 18;
    usedDefaults.push("delayMinutes");
    warnings.push("Delay duration wasn't provided — assumed an 18-minute disruption.");
  }

  delayMinutes = Math.max(0, Math.min(120, Math.round(delayMinutes)));

  let preference: ComfortPreference = req.preference ?? "fastest";
  if (!req.preference && text) {
    const lower = text.toLowerCase();
    if (
      lower.includes("seat") ||
      lower.includes("quiet") ||
      lower.includes("calm") ||
      lower.includes("crowd") ||
      lower.includes("packed") ||
      lower.includes("comfort")
    ) {
      preference = "least_crowded";
      interpretationNotes.push("Preference inferred: Least Crowded (seat/comfort requested).");
    }
  }

  const currentTimeMinutes =
    typeof req.currentTimeMinutes === "number" && Number.isFinite(req.currentTimeMinutes)
      ? Math.max(330, Math.min(1380, Math.round(req.currentTimeMinutes)))
      : getDefaultCurrentMinute();

  return {
    originId,
    destinationId,
    affectedRouteId,
    delayMinutes,
    preference,
    currentTimeMinutes,
    usedDefaults,
    extractedFromNoise,
    interpretationNotes,
    warnings,
  };
}

interface DirectedSegment {
  route: TransitRoute;
  direction: "outbound" | "inbound";
  boardIndex: number;
  alightIndex: number;
  boardOffset: number;
  rideMinutes: number;
  boardPlatform: string;
}

function getDirectedSegmentsBetween(
  route: TransitRoute,
  fromStationId: string,
  toStationId: string
): DirectedSegment | null {
  const fromIdx = route.stops.findIndex((s) => s.stationId === fromStationId);
  const toIdx = route.stops.findIndex((s) => s.stationId === toStationId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return null;

  const totalSpan = route.stops[route.stops.length - 1].offsetMinutes;

  if (fromIdx < toIdx) {
    const boardStop = route.stops[fromIdx];
    const alightStop = route.stops[toIdx];
    return {
      route,
      direction: "outbound",
      boardIndex: fromIdx,
      alightIndex: toIdx,
      boardOffset: boardStop.offsetMinutes,
      rideMinutes: alightStop.offsetMinutes - boardStop.offsetMinutes,
      boardPlatform: boardStop.platformOrBay,
    };
  }

  // Reverse (inbound) direction along the same verified corridor
  const boardStop = route.stops[fromIdx];
  const alightStop = route.stops[toIdx];
  const revBoardOffset = totalSpan - boardStop.offsetMinutes;
  const revAlightOffset = totalSpan - alightStop.offsetMinutes;
  return {
    route,
    direction: "inbound",
    boardIndex: fromIdx,
    alightIndex: toIdx,
    boardOffset: revBoardOffset,
    rideMinutes: revAlightOffset - revBoardOffset,
    boardPlatform: `${boardStop.platformOrBay} (Opp.)`,
  };
}

function getNextVerifiedDeparture(
  segment: DirectedSegment,
  earliestBoardMinute: number,
  delayMinutes: number
): { departureMinute: number; timetableRefId: string } | null {
  const { route, direction, boardOffset } = segment;
  const directionStagger = direction === "inbound" ? 5 : 0;
  const firstStopAtStation = route.firstDepartureMinute + directionStagger + boardOffset;
  const lastStopAtStation = route.lastDepartureMinute + directionStagger + boardOffset;

  const neededBaseTime = earliestBoardMinute - delayMinutes;
  let k = 0;
  if (neededBaseTime > firstStopAtStation) {
    k = Math.ceil((neededBaseTime - firstStopAtStation) / route.headwayMinutes);
  }

  const baseDeparture = firstStopAtStation + k * route.headwayMinutes;
  if (baseDeparture > lastStopAtStation + 30) {
    return null;
  }

  const actualDeparture = baseDeparture + delayMinutes;
  const hhmmBase = minutesToHHMM(baseDeparture).replace(":", "");
  const dirCode = direction === "outbound" ? "OB" : "IB";

  return {
    departureMinute: actualDeparture,
    timetableRefId: `TT-${route.code}-${dirCode}-${hhmmBase}`,
  };
}

function buildLeg(
  segment: DirectedSegment,
  fromStationId: string,
  toStationId: string,
  earliestMinute: number,
  delayMinutes: number,
  reconciledCrowds: Record<string, ReconciledCrowd>
): BackupLeg | null {
  const dep = getNextVerifiedDeparture(segment, earliestMinute, delayMinutes);
  if (!dep) return null;

  const boardStation = getStationById(fromStationId);
  const alightStation = getStationById(toStationId);
  if (!boardStation || !alightStation) return null;

  const arrivalMinute = dep.departureMinute + segment.rideMinutes;
  const crowd = reconciledCrowds[segment.route.id];
  const crowdPct = crowd ? crowd.reconciledPct : segment.route.baselineCrowdPct;

  return {
    routeId: segment.route.id,
    routeCode: segment.route.code,
    routeName: segment.route.name,
    mode: segment.route.mode,
    routeColor: segment.route.color,
    boardStationId: fromStationId,
    boardStationName: boardStation.name,
    boardPlatform: segment.boardPlatform,
    alightStationId: toStationId,
    alightStationName: alightStation.name,
    scheduledDeparture: minutesToHHMM(dep.departureMinute),
    scheduledArrival: minutesToHHMM(arrivalMinute),
    departureMinute: dep.departureMinute,
    arrivalMinute,
    rideMinutes: segment.rideMinutes,
    waitMinutes: Math.max(0, dep.departureMinute - earliestMinute),
    crowdPct,
    crowdTier: crowdPctToTier(crowdPct),
    crowdStatus: crowd ? crowd.status : "Aligned",
    timetableRefId: dep.timetableRefId,
  };
}

export function computeBackupPlans(
  input: NormalizedInput,
  customSignals?: CrowdSignal[]
): {
  baselineOption: BackupOption | null;
  recommendedOptions: BackupOption[];
  reconciledCrowds: Record<string, ReconciledCrowd>;
} {
  const baseSignals = customSignals && customSignals.length > 0 ? customSignals : DEFAULT_CROWD_SIGNALS;
  const reconciledCrowds = reconcileAllRoutesCrowd(
    baseSignals,
    input.affectedRouteId,
    input.delayMinutes
  );

  // 1. Compute baseline option (staying on the affected delayed route, direct or with 1 transfer)
  let baselineOption: BackupOption | null = null;
  const affectedRoute = getRouteById(input.affectedRouteId);

  if (affectedRoute) {
    const directSeg = getDirectedSegmentsBetween(affectedRoute, input.originId, input.destinationId);
    if (directSeg) {
      const leg = buildLeg(
        directSeg,
        input.originId,
        input.destinationId,
        input.currentTimeMinutes,
        input.delayMinutes,
        reconciledCrowds
      );
      if (leg) {
        const totalMin = leg.arrivalMinute - input.currentTimeMinutes;
        baselineOption = {
          id: `baseline-${affectedRoute.id}`,
          label: `Wait for Delayed ${affectedRoute.code}`,
          rank: 0,
          isBaselineDelayed: true,
          legs: [leg],
          totalMinutes: totalMin,
          etaTime: leg.scheduledArrival,
          transferCount: 0,
          maxCrowdPct: leg.crowdPct,
          avgCrowdPct: leg.crowdPct,
          comfortTier: leg.crowdTier,
          timeSavedVsBaseline: 0,
          crowdDeltaVsBaseline: 0,
          reasons: [
            `Includes +${input.delayMinutes} min live delay on ${affectedRoute.name}.`,
            `Expected load: ${leg.crowdPct}% (${leg.crowdTier}).`,
          ],
          groundingRefs: [leg.timetableRefId],
        };
      }
    } else {
      // If affected route doesn't reach destination directly, model 1-transfer baseline starting on affectedRoute
      for (const hub of STATIONS) {
        if (hub.id === input.originId || hub.id === input.destinationId) continue;
        const firstSeg = getDirectedSegmentsBetween(affectedRoute, input.originId, hub.id);
        if (!firstSeg) continue;
        const leg1 = buildLeg(
          firstSeg,
          input.originId,
          hub.id,
          input.currentTimeMinutes,
          input.delayMinutes,
          reconciledCrowds
        );
        if (!leg1) continue;

        for (const nextRoute of ROUTES) {
          if (nextRoute.id === affectedRoute.id) continue;
          const secondSeg = getDirectedSegmentsBetween(nextRoute, hub.id, input.destinationId);
          if (!secondSeg) continue;
          const leg2 = buildLeg(
            secondSeg,
            hub.id,
            input.destinationId,
            leg1.arrivalMinute + 4,
            0,
            reconciledCrowds
          );
          if (!leg2) continue;

          const totalMin = leg2.arrivalMinute - input.currentTimeMinutes;
          const maxCrowd = Math.max(leg1.crowdPct, leg2.crowdPct);
          const avgCrowd = Math.round((leg1.crowdPct + leg2.crowdPct) / 2);

          if (!baselineOption || totalMin < baselineOption.totalMinutes) {
            baselineOption = {
              id: `baseline-${affectedRoute.id}-${nextRoute.id}`,
              label: `Wait for Delayed ${affectedRoute.code} -> ${nextRoute.code}`,
              rank: 0,
              isBaselineDelayed: true,
              legs: [leg1, leg2],
              totalMinutes: totalMin,
              etaTime: leg2.scheduledArrival,
              transferCount: 1,
              maxCrowdPct: maxCrowd,
              avgCrowdPct: avgCrowd,
              comfortTier: crowdPctToTier(maxCrowd),
              timeSavedVsBaseline: 0,
              crowdDeltaVsBaseline: 0,
              reasons: [
                `Starts on delayed ${affectedRoute.name} (+${input.delayMinutes}m) then transfers at ${hub.name}.`,
              ],
              groundingRefs: [leg1.timetableRefId, leg2.timetableRefId],
            };
          }
        }
      }
    }
  }

  // 2. Enumerate all verified candidate backup options (0 transfers and 1 transfer)
  const candidates: BackupOption[] = [];

  // Direct alternatives (excluding the disrupted route unless delay is 0)
  for (const route of ROUTES) {
    if (route.id === input.affectedRouteId && input.delayMinutes > 0) continue;
    const seg = getDirectedSegmentsBetween(route, input.originId, input.destinationId);
    if (!seg) continue;

    const leg = buildLeg(seg, input.originId, input.destinationId, input.currentTimeMinutes, 0, reconciledCrowds);
    if (!leg) continue;

    const totalMin = leg.arrivalMinute - input.currentTimeMinutes;
    const baselineMin = baselineOption ? baselineOption.totalMinutes : totalMin;
    const baselineCrowd = baselineOption ? baselineOption.maxCrowdPct : leg.crowdPct;

    candidates.push({
      id: `direct-${route.id}`,
      label: `Direct ${route.name}`,
      rank: 0,
      isBaselineDelayed: false,
      legs: [leg],
      totalMinutes: totalMin,
      etaTime: leg.scheduledArrival,
      transferCount: 0,
      maxCrowdPct: leg.crowdPct,
      avgCrowdPct: leg.crowdPct,
      comfortTier: leg.crowdTier,
      timeSavedVsBaseline: baselineMin - totalMin,
      crowdDeltaVsBaseline: leg.crowdPct - baselineCrowd,
      reasons: [
        `Direct ${route.mode === "bus" ? "express bus" : route.mode === "light_rail" ? "light rail" : "rail"} from ${leg.boardPlatform} with zero transfers.`,
        `Reconciled crowd: ${leg.crowdPct}% (${leg.crowdTier}).`,
      ],
      groundingRefs: [leg.timetableRefId],
    });
  }

  // 1-Transfer verified alternatives (minimum 4-minute transfer buffer)
  for (const hub of STATIONS) {
    if (!hub.isTransferHub || hub.id === input.originId || hub.id === input.destinationId) continue;

    for (const r1 of ROUTES) {
      if (r1.id === input.affectedRouteId && input.delayMinutes > 0) continue;
      const seg1 = getDirectedSegmentsBetween(r1, input.originId, hub.id);
      if (!seg1) continue;

      const leg1 = buildLeg(seg1, input.originId, hub.id, input.currentTimeMinutes, 0, reconciledCrowds);
      if (!leg1) continue;

      for (const r2 of ROUTES) {
        if (r2.id === r1.id) continue;
        if (r2.id === input.affectedRouteId && input.delayMinutes > 0) continue;
        const seg2 = getDirectedSegmentsBetween(r2, hub.id, input.destinationId);
        if (!seg2) continue;

        const leg2 = buildLeg(
          seg2,
          hub.id,
          input.destinationId,
          leg1.arrivalMinute + 4,
          0,
          reconciledCrowds
        );
        if (!leg2) continue;

        const totalMin = leg2.arrivalMinute - input.currentTimeMinutes;
        const maxCrowd = Math.max(leg1.crowdPct, leg2.crowdPct);
        const avgCrowd = Math.round((leg1.crowdPct + leg2.crowdPct) / 2);
        const baselineMin = baselineOption ? baselineOption.totalMinutes : totalMin;
        const baselineCrowd = baselineOption ? baselineOption.maxCrowdPct : maxCrowd;

        // Avoid absurdly long detours (> 2x baseline or > 75 mins unless nothing else exists)
        if (totalMin > 75 && candidates.length > 0) continue;

        const transferWait = leg2.departureMinute - leg1.arrivalMinute;

        candidates.push({
          id: `xfer-${r1.id}-${hub.id}-${r2.id}`,
          label: `${r1.code} -> ${r2.code} via ${hub.name}`,
          rank: 0,
          isBaselineDelayed: false,
          legs: [leg1, leg2],
          totalMinutes: totalMin,
          etaTime: leg2.scheduledArrival,
          transferCount: 1,
          maxCrowdPct: maxCrowd,
          avgCrowdPct: avgCrowd,
          comfortTier: crowdPctToTier(maxCrowd),
          timeSavedVsBaseline: baselineMin - totalMin,
          crowdDeltaVsBaseline: maxCrowd - baselineCrowd,
          reasons: [
            `1 transfer at ${hub.name} with ${transferWait} min buffer (min 4 min required).`,
            `Peak segment load: ${maxCrowd}% (${crowdPctToTier(maxCrowd)}).`,
          ],
          groundingRefs: [leg1.timetableRefId, leg2.timetableRefId],
        });
      }
    }
  }

  // Deduplicate identical route sequences keeping the best totalMinutes
  const uniqueMap = new Map<string, BackupOption>();
  for (const c of candidates) {
    const key = c.legs.map((l) => `${l.routeId}:${l.boardStationId}->${l.alightStationId}`).join("|");
    const existing = uniqueMap.get(key);
    if (!existing || c.totalMinutes < existing.totalMinutes) {
      uniqueMap.set(key, c);
    }
  }

  const deduped = Array.from(uniqueMap.values());

  // Score and sort strictly according to commuter comfort preference
  deduped.sort((a, b) => {
    if (input.preference === "fastest") {
      const scoreA = a.totalMinutes + a.transferCount * 2 + a.maxCrowdPct * 0.04;
      const scoreB = b.totalMinutes + b.transferCount * 2 + b.maxCrowdPct * 0.04;
      return scoreA - scoreB;
    }
    // least_crowded: heavily prioritize low max & avg crowd, while penalizing extreme detours
    const scoreA = a.maxCrowdPct * 1.15 + a.avgCrowdPct * 0.55 + a.totalMinutes * 0.65 + a.transferCount * 3;
    const scoreB = b.maxCrowdPct * 1.15 + b.avgCrowdPct * 0.55 + b.totalMinutes * 0.65 + b.transferCount * 3;
    return scoreA - scoreB;
  });

  // Also ensure diversity in top 3 (avoid 3 near-identical 1-transfer variants when another mode exists)
  const top3: BackupOption[] = [];
  const usedSignatures = new Set<string>();
  for (const item of deduped) {
    const primaryRoute = item.legs[0].routeId;
    if (top3.length < 2 || !usedSignatures.has(primaryRoute)) {
      top3.push({ ...item, rank: top3.length + 1 });
      usedSignatures.add(primaryRoute);
    }
    if (top3.length === 3) break;
  }

  // Backfill up to 3 if needed
  if (top3.length < 3) {
    for (const item of deduped) {
      if (!top3.some((t) => t.id === item.id)) {
        top3.push({ ...item, rank: top3.length + 1 });
      }
      if (top3.length === 3) break;
    }
  }

  return {
    baselineOption,
    recommendedOptions: top3,
    reconciledCrowds,
  };
}

export function runDeterministicPipeline(req: RecommendRequest): {
  normalizedInput: NormalizedInput;
  baselineOption: BackupOption | null;
  recommendedOptions: BackupOption[];
  reconciledCrowds: Record<string, ReconciledCrowd>;
} {
  const normalizedInput = parseNoisyInputDeterministic(req);
  const baseSignals =
    req.customCrowdSignals && req.customCrowdSignals.length > 0
      ? [...req.customCrowdSignals]
      : [...DEFAULT_CROWD_SIGNALS];

  const userCrowdHint = extractNoisyCrowdHint(req.noisyText, normalizedInput.affectedRouteId);
  if (userCrowdHint) {
    baseSignals.push(userCrowdHint);
    normalizedInput.interpretationNotes.push(
      `Crowd update extracted from message: ${userCrowdHint.reportedLoadPct}% (${crowdPctToTier(userCrowdHint.reportedLoadPct)}).`
    );
  }

  const { baselineOption, recommendedOptions, reconciledCrowds } = computeBackupPlans(
    normalizedInput,
    baseSignals
  );

  return {
    normalizedInput,
    baselineOption,
    recommendedOptions,
    reconciledCrowds,
  };
}
