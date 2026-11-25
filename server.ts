import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { DEFAULT_CROWD_SIGNALS, ROUTES, STATIONS, getRouteById, getStationById } from "./src/data/transitNetwork.ts";
import {
  computeBackupPlans,
  getDefaultCurrentMinute,
  minutesToHHMM,
  parseNoisyInputDeterministic,
  runDeterministicPipeline,
} from "./src/services/routeEngine.ts";
import { crowdPctToTier, extractNoisyCrowdHint } from "./src/services/crowdReconciler.ts";
import type {
  AIBrief,
  BackupOption,
  ComfortPreference,
  NormalizedInput,
  RecommendRequest,
  RecommendResponse,
  ReconciledCrowd,
} from "./src/types/transit.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.trim() === "") {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

async function withGeminiRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient = msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("429");
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }
      const delayMs = 600 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : "Failed to contact Gemini AI service.";
  let extracted = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; code?: number } };
    if (parsed?.error?.message) {
      extracted = parsed.error.message;
    }
  } catch {
    // Raw message is already plain text
  }

  if (raw.includes("403") || raw.includes("PERMISSION_DENIED")) {
    return {
      status: 403,
      message: "Gemini API key permission denied. Please verify your API key in Settings > Secrets.",
    };
  }
  if (raw.includes("400") || raw.includes("API_KEY_INVALID")) {
    return {
      status: 400,
      message: "Gemini API key is invalid. Please check Settings > Secrets.",
    };
  }
  if (raw.includes("429") || raw.includes("RESOURCE_EXHAUSTED")) {
    return {
      status: 429,
      message: "Gemini API quota temporarily reached. Please wait a moment or switch to the Verified Timetable Engine below.",
    };
  }
  if (raw.includes("503") || raw.includes("UNAVAILABLE")) {
    return {
      status: 503,
      message: `${extracted} You can retry or run the Verified Timetable Engine immediately below.`,
    };
  }
  return { status: 502, message: extracted };
}

async function parseInputWithGemini(
  ai: GoogleGenAI,
  noisyText: string,
  req: RecommendRequest
): Promise<Partial<NormalizedInput> & { crowdHintPct?: number; crowdHintNote?: string }> {
  const stationCatalog = STATIONS.map((s) => `${s.id} (${s.name}, aliases: ${s.aliases.join(", ")})`).join("\n");
  const routeCatalog = ROUTES.map((r) => `${r.id} (${r.code}: ${r.name})`).join("\n");

  const response = await ai.models.generateContent({
    model: "gemini-4-hydrogen",
    contents: `Extract structured commute disruption fields from this commuter message.
Only return IDs from the provided catalogs. If a field is not mentioned or is unclear, return an empty string or -1 for delayMinutes.

Commuter message:
"""
${noisyText}
"""

Existing structured overrides (keep if non-empty):
originId=${req.originId ?? ""}
destinationId=${req.destinationId ?? ""}
affectedRouteId=${req.affectedRouteId ?? ""}
delayMinutes=${req.delayMinutes ?? ""}
preference=${req.preference ?? ""}

Valid Stations:
${stationCatalog}

Valid Routes:
${routeCatalog}`,
    config: {
      systemInstruction:
        "You are a strict transit input parser. Normalize messy commuter text into valid station/route IDs from the catalog without inventing stations or schedules.",
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          originId: { type: Type.STRING, description: "Valid station id or empty string if unknown" },
          destinationId: { type: Type.STRING, description: "Valid station id or empty string if unknown" },
          affectedRouteId: { type: Type.STRING, description: "Valid route id or empty string if unknown" },
          delayMinutes: {
            type: Type.INTEGER,
            description: "Extracted delay in minutes (0-120), or -1 if missing/unknown",
          },
          preference: {
            type: Type.STRING,
            description: "'fastest' or 'least_crowded' or empty string if unspecified",
          },
          crowdHintPct: {
            type: Type.INTEGER,
            description: "0-100 estimated crowd level if message mentions crowding/empty, or -1 if not mentioned",
          },
          crowdHintNote: {
            type: Type.STRING,
            description: "Brief 1-sentence summary of any crowd observation in the message",
          },
          interpretationNotes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Short notes on what was inferred or clarified from noisy input",
          },
        },
        required: [
          "originId",
          "destinationId",
          "affectedRouteId",
          "delayMinutes",
          "preference",
          "crowdHintPct",
          "crowdHintNote",
          "interpretationNotes",
        ],
      },
    },
  });

  const raw = (response.text ?? "{}").trim();
  const parsed = JSON.parse(raw) as {
    originId?: string;
    destinationId?: string;
    affectedRouteId?: string;
    delayMinutes?: number;
    preference?: string;
    crowdHintPct?: number;
    crowdHintNote?: string;
    interpretationNotes?: string[];
  };

  const result: Partial<NormalizedInput> & { crowdHintPct?: number; crowdHintNote?: string } = {
    interpretationNotes: Array.isArray(parsed.interpretationNotes) ? parsed.interpretationNotes : [],
  };

  if (parsed.originId && getStationById(parsed.originId)) {
    result.originId = parsed.originId;
  }
  if (parsed.destinationId && getStationById(parsed.destinationId)) {
    result.destinationId = parsed.destinationId;
  }
  if (parsed.affectedRouteId && getRouteById(parsed.affectedRouteId)) {
    result.affectedRouteId = parsed.affectedRouteId;
  }
  if (typeof parsed.delayMinutes === "number" && parsed.delayMinutes >= 0 && parsed.delayMinutes <= 120) {
    result.delayMinutes = parsed.delayMinutes;
  }
  if (parsed.preference === "fastest" || parsed.preference === "least_crowded") {
    result.preference = parsed.preference as ComfortPreference;
  }
  if (typeof parsed.crowdHintPct === "number" && parsed.crowdHintPct >= 0 && parsed.crowdHintPct <= 100) {
    result.crowdHintPct = parsed.crowdHintPct;
    result.crowdHintNote = parsed.crowdHintNote;
  }

  return result;
}

function auditAIBriefGrounding(
  brief: Omit<AIBrief, "groundingVerified" | "groundingAuditNotes">,
  normalized: NormalizedInput,
  baseline: BackupOption | null,
  options: BackupOption[]
): AIBrief {
  const allowedTimes = new Set<string>([minutesToHHMM(normalized.currentTimeMinutes)]);
  const allowedCodes = new Set<string>();

  const collectOption = (opt: BackupOption | null) => {
    if (!opt) return;
    allowedTimes.add(opt.etaTime);
    for (const leg of opt.legs) {
      allowedTimes.add(leg.scheduledDeparture);
      allowedTimes.add(leg.scheduledArrival);
      allowedCodes.add(leg.routeCode.toUpperCase());
    }
  };

  collectOption(baseline);
  for (const opt of options) {
    collectOption(opt);
  }

  const combinedText = `${brief.headline} ${brief.actionStep} ${brief.crowdConflictNote} ${brief.contingencyTip}`;
  const mentionedTimes = combinedText.match(/\b\d{1,2}:\d{2}\b/g) ?? [];
  const auditNotes: string[] = [];
  let unverifiedFound = false;

  for (const t of mentionedTimes) {
    const padded = t.length === 4 ? `0${t}` : t;
    if (!allowedTimes.has(padded) && !allowedTimes.has(t)) {
      unverifiedFound = true;
      auditNotes.push(`Time ${t} not in verified departure table.`);
    }
  }

  const mentionedCodes = combinedText.match(/\b(?:R1|R2|B42|B18|B99|L3)\b/gi) ?? [];
  for (const code of mentionedCodes) {
    if (!allowedCodes.has(code.toUpperCase())) {
      unverifiedFound = true;
      auditNotes.push(`Route ${code} outside computed candidates.`);
    }
  }

  if (!unverifiedFound) {
    const refs = options[0]?.groundingRefs.join(", ") ?? "VERIFIED-TT";
    auditNotes.push(`All times and routes match verified timetable (${refs}).`);
  }

  return {
    ...brief,
    groundingVerified: !unverifiedFound,
    groundingAuditNotes: auditNotes,
  };
}

async function generateGroundedBrief(
  ai: GoogleGenAI,
  normalized: NormalizedInput,
  baseline: BackupOption | null,
  options: BackupOption[],
  reconciledCrowds: Record<string, ReconciledCrowd>
): Promise<AIBrief> {
  const originName = getStationById(normalized.originId)?.name ?? normalized.originId;
  const destName = getStationById(normalized.destinationId)?.name ?? normalized.destinationId;
  const affectedName = getRouteById(normalized.affectedRouteId)?.name ?? normalized.affectedRouteId;

  const groundTruth = {
    currentTime: minutesToHHMM(normalized.currentTimeMinutes),
    origin: originName,
    destination: destName,
    affectedRoute: affectedName,
    delayMinutes: normalized.delayMinutes,
    preference: normalized.preference,
    baselineOption: baseline
      ? {
          label: baseline.label,
          etaTime: baseline.etaTime,
          totalMinutes: baseline.totalMinutes,
          maxCrowdPct: baseline.maxCrowdPct,
          comfortTier: baseline.comfortTier,
          legs: baseline.legs.map((l) => ({
            routeCode: l.routeCode,
            routeName: l.routeName,
            boardPlatform: l.boardPlatform,
            scheduledDeparture: l.scheduledDeparture,
            scheduledArrival: l.scheduledArrival,
            crowdPct: l.crowdPct,
            crowdTier: l.crowdTier,
            timetableRefId: l.timetableRefId,
          })),
        }
      : null,
    topBackupOptions: options.map((o) => ({
      rank: o.rank,
      label: o.label,
      etaTime: o.etaTime,
      totalMinutes: o.totalMinutes,
      timeSavedVsBaseline: o.timeSavedVsBaseline,
      crowdDeltaVsBaseline: o.crowdDeltaVsBaseline,
      maxCrowdPct: o.maxCrowdPct,
      comfortTier: o.comfortTier,
      legs: o.legs.map((l) => ({
        routeCode: l.routeCode,
        routeName: l.routeName,
        boardStationName: l.boardStationName,
        boardPlatform: l.boardPlatform,
        alightStationName: l.alightStationName,
        scheduledDeparture: l.scheduledDeparture,
        scheduledArrival: l.scheduledArrival,
        crowdPct: l.crowdPct,
        crowdTier: l.crowdTier,
        timetableRefId: l.timetableRefId,
      })),
    })),
    crowdReconciliationSummary: Object.values(reconciledCrowds)
      .filter((c) => c.status === "Conflicting" || c.routeId === normalized.affectedRouteId)
      .map((c) => ({
        routeId: c.routeId,
        reconciledPct: c.reconciledPct,
        tier: c.tier,
        status: c.status,
        explanation: c.explanation,
      })),
  };

  const response = await ai.models.generateContent({
    model: "gemini-4-hydrogen",
    contents: `Generate a clear, mobile-scannable commuter backup plan brief strictly grounded in this verified JSON data.
DO NOT invent any departure time, route code, platform, or station not present in the JSON below.

Verified Routing & Crowd JSON:
${JSON.stringify(groundTruth, null, 2)}`,
    config: {
      systemInstruction:
        "You are a concise suburban transit dispatch advisor. Only cite exact times, platforms, and route codes from the provided JSON. Never invent schedules. Keep every field short and immediately actionable on a smartphone screen.",
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          headline: {
            type: Type.STRING,
            description: "1 short sentence (<= 14 words) stating the #1 recommended switch and ETA/comfort gain.",
          },
          actionStep: {
            type: Type.STRING,
            description: "Exact boarding instruction with verified departure time, route code, and platform/bay.",
          },
          crowdConflictNote: {
            type: Type.STRING,
            description: "1 short sentence explaining how conflicting or live crowd signals were weighed.",
          },
          contingencyTip: {
            type: Type.STRING,
            description: "1 short sentence naming Option #2 from the JSON in case the primary bus/train fills up.",
          },
        },
        required: ["headline", "actionStep", "crowdConflictNote", "contingencyTip"],
      },
    },
  });

  const raw = (response.text ?? "{}").trim();
  const parsed = JSON.parse(raw) as {
    headline: string;
    actionStep: string;
    crowdConflictNote: string;
    contingencyTip: string;
  };

  return auditAIBriefGrounding(
    {
      headline: parsed.headline || "Switch to the verified #1 backup route.",
      actionStep: parsed.actionStep || "Check the top card below for exact boarding platform and time.",
      crowdConflictNote: parsed.crowdConflictNote || "Crowd scores reconciled using latest station feeds.",
      contingencyTip: parsed.contingencyTip || "Keep Option #2 ready as a fallback.",
    },
    normalized,
    baseline,
    options
  );
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      hasGeminiKey: Boolean(getGeminiClient()),
      stationsCount: STATIONS.length,
      routesCount: ROUTES.length,
    });
  });

  app.get("/api/network", (_req, res) => {
    res.json({
      stations: STATIONS,
      routes: ROUTES,
      defaultCrowdSignals: DEFAULT_CROWD_SIGNALS,
      currentTimeMinutes: getDefaultCurrentMinute(),
    });
  });

  app.post("/api/recommend", async (req, res) => {
    try {
      const body = (req.body ?? {}) as RecommendRequest;
      const useAI = body.useAI !== false;

      if (!useAI) {
        const det = runDeterministicPipeline(body);
        const payload: RecommendResponse = {
          ...det,
          aiBrief: null,
          engineTimestamp: new Date().toISOString(),
        };
        res.json(payload);
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error:
            "Gemini API key is not configured. Check the Secrets panel in AI Studio, or run the Verified Timetable Engine directly.",
          code: "API_KEY_MISSING",
          deterministicAvailable: true,
        });
        return;
      }

      // Step 1: Parse noisy/partial input with Gemini if noisyText was supplied, then merge with deterministic guardrails
      let mergedReq: RecommendRequest = { ...body };
      const aiNotes: string[] = [];
      let aiCrowdPct: number | undefined;
      let aiCrowdNote: string | undefined;

      const needsAIParsing =
        Boolean(body.noisyText && body.noisyText.trim().length > 0) &&
        (!body.originId || !body.destinationId || !body.affectedRouteId || body.delayMinutes === undefined || body.delayMinutes === "");

      if (needsAIParsing && body.noisyText) {
        const aiParsed = await withGeminiRetry(() =>
          parseInputWithGemini(ai, body.noisyText!.trim(), body)
        );
        mergedReq = {
          ...body,
          originId: body.originId || aiParsed.originId,
          destinationId: body.destinationId || aiParsed.destinationId,
          affectedRouteId: body.affectedRouteId || aiParsed.affectedRouteId,
          delayMinutes:
            body.delayMinutes !== undefined && body.delayMinutes !== ""
              ? body.delayMinutes
              : aiParsed.delayMinutes,
          preference: body.preference || aiParsed.preference,
        };
        if (aiParsed.interpretationNotes) {
          aiNotes.push(...aiParsed.interpretationNotes);
        }
        aiCrowdPct = aiParsed.crowdHintPct;
        aiCrowdNote = aiParsed.crowdHintNote;
      }

      // Step 2: Run deterministic timetable & crowd reconciliation engine
      const normalizedInput = parseNoisyInputDeterministic(mergedReq);
      if (aiNotes.length > 0) {
        normalizedInput.interpretationNotes = Array.from(
          new Set([...aiNotes, ...normalizedInput.interpretationNotes])
        );
      }

      const signals =
        body.customCrowdSignals && body.customCrowdSignals.length > 0
          ? [...body.customCrowdSignals]
          : [...DEFAULT_CROWD_SIGNALS];

      if (typeof aiCrowdPct === "number" && aiCrowdPct >= 0) {
        signals.push({
          id: "sig-ai-user-crowd",
          routeId: normalizedInput.affectedRouteId,
          source: "rider_report",
          sourceLabel: "Live Rider Input",
          reportedLoadPct: aiCrowdPct,
          ageMinutes: 0,
          note: aiCrowdNote || `Extracted load ${aiCrowdPct}% (${crowdPctToTier(aiCrowdPct)}) from input.`,
        });
      } else {
        const detHint = extractNoisyCrowdHint(body.noisyText, normalizedInput.affectedRouteId);
        if (detHint) signals.push(detHint);
      }

      const { baselineOption, recommendedOptions, reconciledCrowds } = computeBackupPlans(
        normalizedInput,
        signals
      );

      // Step 3: Generate strictly grounded commuter briefing with Gemini
      const aiBrief = await withGeminiRetry(() =>
        generateGroundedBrief(
          ai,
          normalizedInput,
          baselineOption,
          recommendedOptions,
          reconciledCrowds
        )
      );

      const responsePayload: RecommendResponse = {
        normalizedInput,
        baselineOption,
        recommendedOptions,
        reconciledCrowds,
        aiBrief,
        engineTimestamp: new Date().toISOString(),
      };

      res.json(responsePayload);
    } catch (err: unknown) {
      console.error("[/api/recommend] error:", err);
      const formatted = formatGeminiError(err);

      res.status(formatted.status).json({
        error: formatted.message,
        code: "GEMINI_UPSTREAM_ERROR",
        deterministicAvailable: true,
      });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("/{*path}", (_req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`WaySwitch server listening on http://0.0.0.0:${port}`);
  });
}

createServer();
