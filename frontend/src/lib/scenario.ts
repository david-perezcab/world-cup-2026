import type { FactDraft, FactResult } from "../types";

type ScenarioPayload = {
  v: 1;
  facts: FactResult[];
};

export function completeFacts(facts: Record<number, FactDraft>): FactResult[] {
  return Object.values(facts)
    .filter((fact): fact is FactResult => {
      return Number.isInteger(fact.home_score) && Number.isInteger(fact.away_score);
    })
    .sort((left, right) => left.match_id - right.match_id);
}

export function encodeScenario(facts: Record<number, FactDraft>): string {
  const payload: ScenarioPayload = { v: 1, facts: completeFacts(facts) };
  const json = JSON.stringify(payload);
  return toBase64Url(utf8ToBinary(json));
}

export function decodeScenario(encoded: string): Record<number, FactDraft> {
  const binary = fromBase64Url(encoded);
  const json = binaryToUtf8(binary);
  const payload = JSON.parse(json) as ScenarioPayload;
  if (payload.v !== 1 || !Array.isArray(payload.facts)) {
    throw new Error("Formato de escenario no compatible.");
  }
  return Object.fromEntries(payload.facts.map((fact) => [fact.match_id, fact]));
}

export function scenarioFromHash(hash: string): Record<number, FactDraft> | null {
  const marker = "#scenario=";
  if (!hash.startsWith(marker)) {
    return null;
  }
  return decodeScenario(hash.slice(marker.length));
}

function toBase64Url(binary: string): string {
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function utf8ToBinary(value: string): string {
  return unescape(encodeURIComponent(value));
}

function binaryToUtf8(value: string): string {
  return decodeURIComponent(escape(value));
}
