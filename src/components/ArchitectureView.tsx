import React from "react";

export const ArchitectureView: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Requirements, Stack &amp; Grounding Architecture</h2>
        <p className="text-sm text-slate-600">
          How WaySwitch turns noisy commuter updates and conflicting crowd reports into verified, zero-hallucination backup plans.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2.5">
          <h3 className="text-sm font-bold text-slate-900">01. Requirements Breakdown</h3>
          <ul className="text-sm text-slate-600 space-y-1.5 list-disc pl-5">
            <li>Accept live route, reported delay, and comfort priority (fastest vs. least crowded).</li>
            <li>Handle messy, incomplete, or typo-heavy commuter inputs without failing.</li>
            <li>Reconcile conflicting crowd updates across sensors, cameras, and rider posts.</li>
            <li>Eliminate hallucinated departure times, platforms, or non-existent transfer stops.</li>
            <li>Deliver an immediately scannable mobile-first plan in seconds.</li>
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2.5">
          <h3 className="text-sm font-bold text-slate-900">02. Expected Solution</h3>
          <ul className="text-sm text-slate-600 space-y-1.5 list-disc pl-5">
            <li>
              <strong>Hybrid AI + Deterministic Architecture:</strong> Use AI strictly for natural-language normalization and human-friendly briefing, never for schedule generation.
            </li>
            <li>
              <strong>Verified Timetable Graph:</strong> All departures, headways, platform/bay assignments, and 4-minute transfer buffers come from a deterministic multi-modal graph.
            </li>
            <li>
              <strong>Side-by-Side Trade-off:</strong> Compare top 3 alternatives against staying on the delayed route (time saved and crowd reduction).
            </li>
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2.5">
          <h3 className="text-sm font-bold text-slate-900">03. Technology Stack</h3>
          <ul className="text-sm text-slate-600 space-y-1.5 list-disc pl-5">
            <li>
              <strong>Frontend:</strong> React 19 + TypeScript + Tailwind CSS v4 (mobile-first responsive layout, SVG schematic corridor map).
            </li>
            <li>
              <strong>Backend API:</strong> Node.js + Express (`server.ts`) hosting `/api/recommend` and `/api/network`.
            </li>
            <li>
              <strong>AI Layer:</strong> Server-side `@google/genai` (`gemini-4-hydrogen`, structured JSON `responseSchema`, `ThinkingLevel.LOW`).
            </li>
            <li>
              <strong>Deterministic Core:</strong> Custom multi-criteria path search + exponential-decay crowd reconciler.
            </li>
          </ul>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2.5">
          <h3 className="text-sm font-bold text-slate-900">04. Anti-Hallucination Pipeline</h3>
          <ol className="text-sm text-slate-600 space-y-1.5 list-decimal pl-5">
            <li>
              <strong>Input Normalization:</strong> Gemini extracts station/route IDs constrained to the verified catalog, backed by fuzzy fallback &amp; safe defaults.
            </li>
            <li>
              <strong>Crowd Reconciliation:</strong> Recency-weighted blending with conservative bias when fresh platform reports conflict with stale sensor data.
            </li>
            <li>
              <strong>Deterministic Routing:</strong> Computes exact departures (`TT-*` ref IDs) and ranks options by preference.
            </li>
            <li>
              <strong>Post-Generation Audit:</strong> Server verifies every timestamp and route code in the AI brief matches the computed timetable before rendering.
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
};
