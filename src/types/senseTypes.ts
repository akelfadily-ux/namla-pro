/**
 * Digital sense types. A "sense" is a structured way for an ant to perceive
 * something about its situation. Phase 0 senses return simulated or
 * static readings only — they never touch a real camera, microphone,
 * filesystem, or network.
 */

export type DigitalSense =
  | "vision"
  | "hearing"
  | "smell"
  | "touch"
  | "taste"
  | "memory"
  | "time"
  | "risk";

export interface SenseInput {
  senseType: DigitalSense;
  context: Record<string, unknown>;
  requestedByAntId: string;
  requestedAt: string;
}

export interface SenseReading {
  senseType: DigitalSense;
  summary: string;
  confidence: number; // 0..1
  generatedAt: string;
  raw?: Record<string, unknown>;
}

export interface VisionReading extends SenseReading {
  senseType: "vision";
  observedStructures: string[]; // e.g. file names, folder shapes, diagram nodes
}

export interface HearingReading extends SenseReading {
  senseType: "hearing";
  heardSignals: string[]; // e.g. incoming messages, human instructions
}

export interface SmellReading extends SenseReading {
  senseType: "smell";
  detectedPheromoneTypes: string[];
}

export interface TouchReading extends SenseReading {
  senseType: "touch";
  contactedPaths: string[]; // paths considered, not necessarily modified
}

export interface TasteReading extends SenseReading {
  senseType: "taste";
  qualityScore: number; // 0..1, "does this feel right"
}

export interface MemoryReading extends SenseReading {
  senseType: "memory";
  recalledEntryIds: string[];
}

export interface TimeReading extends SenseReading {
  senseType: "time";
  elapsedSinceMissionStartMs: number;
}

export interface RiskReading extends SenseReading {
  senseType: "risk";
  riskLevel: "safe" | "caution" | "risky" | "forbidden";
  riskIndicators: string[];
}
