import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AccountMode, AccountType, DetectedType } from "./fields";

// What kind of account this session runs under, so setup and the statusline
// can offer only the fields that make sense: a subscription has usage limits
// (5-hour, weekly); pay per use has spend.
//
// Claude Code does not send this to the statusline, so it is read from the
// account's own config file: $CLAUDE_CONFIG_DIR/.claude.json when that variable
// is set (one file per account), otherwise ~/.claude.json. The file is internal
// to Claude Code and not a documented interface, so every read is guarded and
// an unreadable file gives "unknown" instead of a guess.

export interface Detection {
  readonly type: DetectedType;
  // e.g. "claude_pro"; null when not a subscription or not known.
  readonly plan: string | null;
  // True when the subscription allows paid extra usage beyond its limits.
  readonly extraUsage: boolean;
}

export const UNKNOWN_ACCOUNT: Detection = { type: "unknown", plan: null, extraUsage: false };

interface OauthAccount {
  readonly organizationType?: unknown;
  readonly hasExtraUsageEnabled?: unknown;
}

// Pure: decides the type from the parsed contents of .claude.json.
// - An `oauthAccount` entry means signed in with a Claude account: subscription.
//   (Team and Enterprise seats are treated the same way.)
// - A readable file without one means an API key or cloud-provider login.
export function classify(parsed: unknown): Detection {
  if (typeof parsed !== "object" || parsed === null) return UNKNOWN_ACCOUNT;
  const oauth = (parsed as { oauthAccount?: unknown }).oauthAccount;
  if (typeof oauth !== "object" || oauth === null) return { type: "payg", plan: null, extraUsage: false };
  const account = oauth as OauthAccount;
  return {
    type: "subscription",
    plan: typeof account.organizationType === "string" ? account.organizationType : null,
    extraUsage: account.hasExtraUsageEnabled === true,
  };
}

export function accountFilePath(): string | null {
  const dir = process.env.CLAUDE_CONFIG_DIR;
  if (dir !== undefined && dir !== "") return join(dir, ".claude.json");
  const home = process.env.HOME;
  return home === undefined || home === "" ? null : join(home, ".claude.json");
}

export function detectAccount(): Detection {
  const file = accountFilePath();
  if (file === null) return UNKNOWN_ACCOUNT;
  try {
    return classify(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return UNKNOWN_ACCOUNT;
  }
}

// The config can force the type; "auto" uses what was detected.
export function resolveType(mode: AccountMode, detected: DetectedType): DetectedType {
  return mode === "auto" ? detected : (mode satisfies AccountType);
}
