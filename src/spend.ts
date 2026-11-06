import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PCT_MAX } from "./pace";

// Spend for pay-per-use accounts: what this month has cost so far, counted in
// US dollars, as an estimate. Claude Code only reports the cost of the session
// it is running (`cost.total_cost_usd`), so tricorder keeps its own running
// total: one small file per session and month, summed on demand.
//
// It is an estimate, not the invoice. It misses sessions that run without a
// statusline (for example `claude -p`), other machines, other tools using the
// same API key, and anything spent before tricorder was installed.
//
// Time and folders are passed in, so every function can be checked by hand in
// a test. The month is the calendar month in UTC (1st 00:00 UTC to the next 1st).

const SECONDS_PER_DAY = 86_400;
const MS_PER_S = 1000;
const MONTH_KEY_DIGITS = 2;
const FIRST_DAY = 1;
const MONTH_INDEX_TO_NUMBER = 1; // January is 0 in a Date, month 1 in "2026-01"
const COST_FILE_EXT = ".json";
const NO_COST = 0; // nothing recorded yet
const LAST_COST_DIR = "last";

// "2026-11" for any moment in November 2026 (UTC).
export function monthKey(nowMs: number): string {
  const d = new Date(nowMs);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + MONTH_INDEX_TO_NUMBER).padStart(MONTH_KEY_DIGITS, "0");
}

const monthStartMs = (nowMs: number): number => {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), FIRST_DAY);
};

// Date.UTC rolls month 12 over to January of the next year by itself.
const nextMonthStartMs = (nowMs: number): number => {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + MONTH_INDEX_TO_NUMBER, FIRST_DAY);
};

// Days in the month containing `nowMs`. Hand check: November 2026 = 30, February 2028 = 29, February 2027 = 28.
export function daysInMonth(nowMs: number): number {
  return (nextMonthStartMs(nowMs) - monthStartMs(nowMs)) / (SECONDS_PER_DAY * MS_PER_S);
}

// Share of the calendar month (UTC) that has passed, in percent.
// Hand check: 16 Nov 2026 00:00 UTC is 15 of 30 days → 50.
export function monthElapsedPct(nowMs: number): number {
  return ((nowMs - monthStartMs(nowMs)) / (nextMonthStartMs(nowMs) - monthStartMs(nowMs))) * PCT_MAX;
}

interface CostRecord {
  readonly usd: number;
}

// Replaces everything but letters, digits and . _ - so a session id is safe as a file name:
// "a/b c" becomes "a_b_c"; "abc-1.2" is unchanged.
// https://regex101.com/?flavor=javascript&regex=%5B%5EA-Za-z0-9._-%5D&flags=g&testString=a%2Fb%20c%0Aabc-1.2
const UNSAFE_FILE_CHARS = /[^A-Za-z0-9._-]/g;
const sanitize = (id: string): string => id.replace(UNSAFE_FILE_CHARS, "_");

// A number stored in one of the ledger files; `fallback` when the file is missing or unreadable.
function readNumber(path: string, field: "usd" | "lastCostUsd", fallback: number): number {
  try {
    const value = (JSON.parse(readFileSync(path, "utf8")) as Partial<Record<string, unknown>>)[field];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

// Adds what a session has newly spent to this month's total.
// `costUsd` is the session's cost so far, as Claude Code reports it.
// - Normal case: the new part is the cost minus the last cost seen.
// - A cost that went down means the session was resumed and counts from zero
//   again, so the whole new cost is the new part.
// The new part goes to the month of `nowMs`, so a session that crosses midnight
// of the 1st puts the later part in the new month.
export function recordCost(dir: string, sessionId: string, costUsd: number, nowMs: number): void {
  if (!Number.isFinite(costUsd) || costUsd < 0) return;
  const id = sanitize(sessionId);
  const lastPath = join(dir, LAST_COST_DIR, id + COST_FILE_EXT);
  const last = readNumber(lastPath, "lastCostUsd", NO_COST);
  if (costUsd === last) return;
  const added = costUsd >= last ? costUsd - last : costUsd;
  const monthPath = join(dir, monthKey(nowMs), id + COST_FILE_EXT);
  const before = readNumber(monthPath, "usd", NO_COST);
  const record: CostRecord = { usd: before + added };
  writeJson(monthPath, record);
  writeJson(lastPath, { lastCostUsd: costUsd });
}

// Everything recorded for the month of `nowMs`, all sessions together.
export function monthSpendUsd(dir: string, nowMs: number): number {
  const monthDir = join(dir, monthKey(nowMs));
  if (!existsSync(monthDir)) return 0;
  return readdirSync(monthDir)
    .filter((name) => name.endsWith(COST_FILE_EXT))
    .reduce((sum, name) => sum + readNumber(join(monthDir, name), "usd", NO_COST), NO_COST);
}
