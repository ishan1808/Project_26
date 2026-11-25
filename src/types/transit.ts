export type TransitMode = "rail" | "bus" | "light_rail";

export type ComfortPreference = "fastest" | "least_crowded";

export type CrowdTier = "Seats Likely" | "Standing Room" | "Crowded" | "Overcrowded";

export type SignalSource = "official_sensor" | "platform_camera" | "rider_report" | "social_feed";

export interface Station {
  id: string;
  name: string;
  shortCode: string;
  zone: string;
  aliases: string[];
  x: number; // Schematic SVG coordinate (0-800)
  y: number; // Schematic SVG coordinate (0-360)
  isTransferHub: boolean;
}

export interface RouteStop {
  stationId: string;
  offsetMinutes: number; // Minutes from route origin departure
  platformOrBay: string;
}

export interface TransitRoute {
  id: string;
  code: string;
  name: string;
  mode: TransitMode;
  color: string;
  headwayMinutes: number;
  firstDepartureMinute: number; // Minutes since midnight (e.g., 300 = 05:00)
  lastDepartureMinute: number; // Minutes since midnight (e.g., 1410 = 23:30)
  baselineCrowdPct: number; // 0-100 baseline load during peak/midday
  reliabilityScore: number; // 0-100 historical schedule adherence
  stops: RouteStop[];
}

export interface CrowdSignal {
  id: string;
  routeId: string;
  stationId?: string;
  source: SignalSource;
  sourceLabel: string;
  reportedLoadPct: number; // 0-100
  ageMinutes: number; // How old the report is
  note: string;
}

export interface ReconciledCrowd {
  routeId: string;
  reconciledPct: number;
  tier: CrowdTier;
  status: "Aligned" | "Conflicting" | "Limited Data";
  confidence: "High" | "Medium" | "Low";
  explanation: string;
  signalsUsed: CrowdSignal[];
}

export interface BackupLeg {
  routeId: string;
  routeCode: string;
  routeName: string;
  mode: TransitMode;
  routeColor: string;
  boardStationId: string;
  boardStationName: string;
  boardPlatform: string;
  alightStationId: string;
  alightStationName: string;
  scheduledDeparture: string; // HH:MM
  scheduledArrival: string; // HH:MM
  departureMinute: number;
  arrivalMinute: number;
  rideMinutes: number;
  waitMinutes: number;
  crowdPct: number;
  crowdTier: CrowdTier;
  crowdStatus: "Aligned" | "Conflicting" | "Limited Data";
  timetableRefId: string;
}

export interface BackupOption {
  id: string;
  label: string;
  rank: number;
  isBaselineDelayed: boolean;
  legs: BackupLeg[];
  totalMinutes: number;
  etaTime: string; // HH:MM
  transferCount: number;
  maxCrowdPct: number;
  avgCrowdPct: number;
  comfortTier: CrowdTier;
  timeSavedVsBaseline: number; // positive = faster than waiting on delayed route
  crowdDeltaVsBaseline: number; // negative = less crowded than baseline
  reasons: string[];
  groundingRefs: string[];
}

export interface NormalizedInput {
  originId: string;
  destinationId: string;
  affectedRouteId: string;
  delayMinutes: number;
  preference: ComfortPreference;
  currentTimeMinutes: number;
  usedDefaults: string[];
  extractedFromNoise: boolean;
  interpretationNotes: string[];
  warnings: string[];
}

export interface AIBrief {
  headline: string;
  actionStep: string;
  crowdConflictNote: string;
  contingencyTip: string;
  groundingVerified: boolean;
  groundingAuditNotes: string[];
}

export interface RecommendRequest {
  noisyText?: string;
  originId?: string;
  destinationId?: string;
  affectedRouteId?: string;
  delayMinutes?: number | string;
  preference?: ComfortPreference;
  currentTimeMinutes?: number;
  customCrowdSignals?: CrowdSignal[];
  useAI?: boolean;
}

export interface RecommendResponse {
  normalizedInput: NormalizedInput;
  baselineOption: BackupOption | null;
  recommendedOptions: BackupOption[];
  reconciledCrowds: Record<string, ReconciledCrowd>;
  aiBrief: AIBrief | null;
  engineTimestamp: string;
}

export interface ScenarioPreset {
  id: string;
  title: string;
  summary: string;
  noisyText: string;
  originId: string;
  destinationId: string;
  affectedRouteId: string;
  delayMinutes: number;
  preference: ComfortPreference;
  crowdSignals: CrowdSignal[];
}
