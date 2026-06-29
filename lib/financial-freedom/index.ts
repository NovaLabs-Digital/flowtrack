export type {
  FinancialFreedomReport,
  MovementReport,
  Milestone,
  MilestoneType,
  TimelineEntry,
  FreedomTimeline,
} from "./types";

export { calculateFreedomReport } from "./calculator";
export { buildTimeline } from "./timeline";
export { compareReports, computeMilestones, computeTimeSavedMilestones } from "./progress";
