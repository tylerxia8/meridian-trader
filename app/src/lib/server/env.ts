import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function envValue(...keys: string[]): string | undefined {
  const rootEnv = readRootEnv();
  for (const key of keys) {
    const value = process.env[key] ?? rootEnv[key];
    if (value) return value;
  }
  return undefined;
}

export function requiredEnvValue(...keys: string[]): string {
  const value = envValue(...keys);
  if (!value) throw new Error(`Missing required env var: ${keys.join(" or ")}`);
  return value;
}

function readRootEnv(): Record<string, string> {
  const candidates = [path.resolve(process.cwd(), "..", ".env"), path.resolve(process.cwd(), ".env")];
  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (!envPath) return {};
  const parsed: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    parsed[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return parsed;
}
