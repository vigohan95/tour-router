/**
 * MockPlannerModel: a keyless LanguageModelV3 that plans tool calls with rules instead of weights.
 *
 * It exists so the whole product (UI, agent loop, policy gate, approval cards, audit log) runs with zero API
 * keys and keeps running on the hosted demo when the free LLM tier is capped. It reads the same tool results a
 * real model would and follows the same playbook as the system prompt. Set a Gemini/Groq key to swap it out.
 */
import type { LanguageModelV3, LanguageModelV3CallOptions, LanguageModelV3GenerateResult, LanguageModelV3Prompt, LanguageModelV3StreamPart, LanguageModelV3StreamResult, LanguageModelV3Usage } from "@ai-sdk/provider";
import { CITIES, parseRegion, type Region } from "../tour/cities";

type J = Record<string, unknown>;
const j = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const arr = (v: unknown): J[] => (Array.isArray(v) ? v.map(j) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const s = (v: unknown, d = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
const n = (v: unknown, d = 0): number => (typeof v === "number" ? v : Number(v) || d);
const usd = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

export interface TurnResult {
  toolName: string;
  input: J;
  output: J;
  denied?: string;
  error?: string;
}

export interface Turn {
  system: string;
  userText: string;
  results: TurnResult[];
  policy: J;
  state: J;
}

export type Action = { type: "calls"; calls: Array<{ toolName: string; input: J }> } | { type: "text"; text: string };

/* ---------------- prompt parsing ---------------- */

export function parseTurn(prompt: LanguageModelV3Prompt): Turn {
  let system = "";
  let lastUser = -1;
  prompt.forEach((m, i) => {
    if (m.role === "system") system += m.content + "\n";
    if (m.role === "user") lastUser = i;
  });
  const userMsg = lastUser >= 0 ? prompt[lastUser] : undefined;
  const userText = userMsg && userMsg.role === "user" ? userMsg.content.map((p) => (p.type === "text" ? p.text : "")).join(" ") : "";
  const calls = new Map<string, { toolName: string; input: J }>();
  const results: TurnResult[] = [];
  for (let i = lastUser + 1; i < prompt.length; i++) {
    const m = prompt[i];
    if (m.role === "assistant") {
      for (const p of m.content) {
        if (p.type === "tool-call") {
          const input = typeof p.input === "string" ? safeJson(p.input) : j(p.input);
          calls.set(p.toolCallId, { toolName: p.toolName, input });
        }
      }
    } else if (m.role === "tool") {
      for (const p of m.content) {
        if (p.type !== "tool-result") continue;
        const call = calls.get(p.toolCallId) ?? { toolName: p.toolName, input: {} };
        const r: TurnResult = { toolName: call.toolName, input: call.input, output: {} };
        const out = p.output;
        if (out.type === "json") r.output = j(out.value);
        else if (out.type === "text") r.output = safeJson(out.value, { text: out.value });
        else if (out.type === "execution-denied") r.denied = out.reason ?? "denied by policy";
        else if (out.type === "error-text") r.error = out.value;
        else if (out.type === "error-json") r.error = JSON.stringify(out.value);
        if (r.output.error) r.error = s(r.output.error) || JSON.stringify(r.output.error);
        results.push(r);
      }
    }
  }
  const tag = (name: string): J => {
    const m = system.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
    return m ? safeJson(m[1]) : {};
  };
  return { system, userText, results, policy: tag("policy"), state: tag("state") };
}

function safeJson(text: string, fallback: J = {}): J {
  try {
    return j(JSON.parse(text));
  } catch {
    return fallback;
  }
}

/* ---------------- text parsing ---------------- */

const CITY_NAMES = CITIES.map((c) => c.name);

export function parseCities(text: string): string[] {
  const t = text.toLowerCase();
  return CITY_NAMES.filter((c) => new RegExp(`(^|[^a-z])${c.toLowerCase().replace(/\./g, "\\.")}([^a-z]|$)`).test(t));
}

export function parseCount(text: string): number | undefined {
  const m = text.match(/\b(\d{1,2})\s*[- ]?\s*(?:city|cities|stops?|dates?|shows?|nights?|gigs?)\b/i) ?? text.match(/\b(?:top|best)\s+(\d{1,2})\b/i);
  return m ? Number(m[1]) : undefined;
}

export function parseAct(text: string): string | undefined {
  const quoted = text.match(/["“]([^"”]+)["”]/);
  if (quoted) return quoted[1].trim();
  const m = text.match(/\b(?:[Ff]or|[Rr]out(?:e|ing)|[Bb]ook(?:ing)?|[Tt]ake|[Tt]our with)\s+((?:[A-Z][\w&.'-]*|&)(?:\s+(?:[A-Z][\w&.'-]*|&|of|the))*)/);
  if (!m) return undefined;
  const name = m[1].replace(/\s+(?:in|across|through|around|to|from|starting|next|this)\b.*$/i, "").trim();
  // "for 12 cities" and bare region names are not acts.
  if (!name || /^\d/.test(name) || parseRegion(name) || parseCities(name).length === name.split(/\s+/).length) return undefined;
  return name;
}

export function parseStartCity(text: string): string | undefined {
  const m = text.match(/\b(?:start(?:ing|s)?|kick(?:ing)? off|open(?:ing|s)?|begin(?:ning|s)?)\s+(?:in|at|from)\s+([A-Z][\w.]*(?:\s[A-Z][\w.]*)*)/);
  if (!m) return undefined;
  return parseCities(m[1])[0];
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function parseStartDate(text: string, now = new Date()): string | undefined {
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const m = text.match(new RegExp(`\\b(${MONTHS.join("|")})\\b(?:\\s+(\\d{4}))?`, "i"));
  if (m) {
    const month = MONTHS.indexOf(m[1].toLowerCase());
    let year = m[2] ? Number(m[2]) : now.getUTCFullYear();
    if (!m[2] && month < now.getUTCMonth()) year++;
    return `${year}-${String(month + 1).padStart(2, "0")}-01`;
  }
  const season = text.match(/\b(spring|summer|fall|autumn|winter)\s+(\d{4})\b/i);
  if (season) {
    const month = { spring: 4, summer: 6, fall: 9, autumn: 9, winter: 12 }[season[1].toLowerCase()]!;
    return `${season[2]}-${String(month).padStart(2, "0")}-01`;
  }
  return undefined;
}

export type Intent = "plan" | "explain" | "exclude" | "status" | "help";

export function detectIntent(text: string): Intent {
  const t = text.toLowerCase();
  if (/\b(why|explain|reason|how come)\b/.test(t)) return "explain";
  if (/\b(skip|avoid|drop|exclude|remove|not|without|no)\b/.test(t) && parseCities(text).length > 0) return "exclude";
  if (/\b(plan|route|book|tour|itinerary|cities|stops|where should|run)\b/.test(t) || parseAct(text)) return "plan";
  if (/\b(status|summary|what do we have|show me|current)\b/.test(t)) return "status";
  return "help";
}

/* ---------------- playbooks ---------------- */

const has = (turn: Turn, name: string) => turn.results.filter((r) => r.toolName === name);
const first = (turn: Turn, name: string) => has(turn, name)[0];

function outcome(r: TurnResult | undefined): string | undefined {
  if (!r) return "not attempted";
  if (r.denied) return `not done - ${r.denied}`;
  if (r.error) return `failed - ${r.error}`;
  return undefined;
}

function stopsWanted(turn: Turn): number {
  return parseCount(turn.userText) ?? Math.min(n(turn.policy.maxCities, 12), 8);
}

function summaryText(turn: Turn, build: TurnResult): string {
  const out = build.output;
  const act = s(j(turn.state.act).name) || s(first(turn, "resolve_artist")?.output?.selected && j(first(turn, "resolve_artist")!.output.selected).name) || "the act";
  const stops = arr(out.stops);
  const lines = stops.map((st) => `${s(st.order)}. ${s(st.city)} - ${s(st.date)}${st.venue ? ` - ${s(st.venue)}` : ""}${st.opener ? ` - opener: ${s(st.opener)}` : ""}${st.brand ? ` - brand: ${s(st.brand)}` : ""}${n(st.legKm) ? ` (${n(st.legKm)} km)` : ""}`);
  const topCity = s(stops[0]?.city);
  const partners = has(turn, "pick_city_partners").find((r) => s(r.output.city) === topCity);
  const why = partners ? s(partners.output.why) : "";
  const cost = n(out.estimatedCostUsd);
  const denied = has(turn, "pick_city_partners").filter((r) => r.denied || r.error);
  return [
    `Route for ${act}: ${stops.length} stops, ${s(out.startDate)} to ${s(out.endDate)}, ${n(out.totalKm).toLocaleString("en-US")} km of travel.`,
    ...lines,
    why ? `Why ${topCity} leads: ${why}` : "",
    cost ? `Estimated venue cost: ${usd(cost)} (estimates from the data source).` : "",
    denied.length ? `Skipped: ${denied.map((r) => `${s(r.input.city)} (${r.denied ?? r.error})`).join("; ")}.` : "",
    "Edit the order or exclude cities in the grid, or ask me 'why <city>?'.",
  ]
    .filter(Boolean)
    .join("\n");
}

function planPlaybook(turn: Turn): Action {
  const text = turn.userText;
  const named = parseAct(text);
  const stateAct = j(turn.state.act);
  const resolved = first(turn, "resolve_artist");
  // 1. resolve the act (when the user named one, or none is selected yet)
  if (!resolved && (named || !stateAct.name)) {
    if (!named && !stateAct.name) return { type: "text", text: "Which act should I route? Try: Plan a 10-city North American tour for Nova Reyes." };
    return { type: "calls", calls: [{ toolName: "resolve_artist", input: { query: named } }] };
  }
  if (resolved) {
    const o = outcome(resolved);
    if (o) return { type: "text", text: `I could not resolve the act: ${o}.` };
    if (!arr(resolved.output.hits).length) return { type: "text", text: `Qloo has no entity matching "${s(resolved.input.query)}". Try a different spelling.` };
  }
  const wanted = stopsWanted(turn);
  // 2. rank cities
  const ranked = first(turn, "rank_cities_by_affinity");
  if (!ranked) {
    const region = parseRegion(text);
    const input: J = { limit: Math.min(60, Math.max(wanted * 2, wanted + 4)) };
    if (region) input.regions = [region satisfies Region];
    return { type: "calls", calls: [{ toolName: "rank_cities_by_affinity", input }] };
  }
  const ro = outcome(ranked);
  if (ro) return { type: "text", text: `I could not rank cities: ${ro}.` };
  const cities = arr(ranked.output.cities)
    .filter((c) => !c.excluded)
    .map((c) => s(c.city));
  const mentioned = parseCities(text);
  const avoid = /\b(skip|avoid|without|except|not)\b/i.test(text) ? mentioned : [];
  const startCity = parseStartCity(text);
  // A named start city is part of the tour whatever its rank, as long as it is a ranked, non-excluded candidate.
  const pool = cities.filter((c) => !avoid.includes(c));
  const chosen = startCity && pool.includes(startCity) ? [startCity, ...pool.filter((c) => c !== startCity)].slice(0, wanted) : pool.slice(0, wanted);
  if (chosen.length === 0) return { type: "text", text: "Every candidate city is excluded by your policy; relax the exclude list or regions and ask again." };
  // 3. partners for each chosen city, in parallel
  const partners = has(turn, "pick_city_partners");
  if (partners.length === 0) return { type: "calls", calls: chosen.map((city) => ({ toolName: "pick_city_partners", input: { city } })) };
  // 4. build the itinerary from the cities whose partners came back
  const build = first(turn, "build_itinerary");
  if (!build) {
    const ok = partners.filter((r) => !r.denied && !r.error).map((r) => s(r.input.city));
    if (ok.length === 0) return { type: "text", text: `No city could be prepared: ${partners.map((r) => `${s(r.input.city)} - ${r.denied ?? r.error}`).join("; ")}.` };
    const input: J = { cities: ok };
    if (startCity && ok.includes(startCity)) input.startCity = startCity;
    const date = parseStartDate(text);
    if (date) input.startDate = date;
    return { type: "calls", calls: [{ toolName: "build_itinerary", input }] };
  }
  const bo = outcome(build);
  if (bo) return { type: "text", text: `Itinerary not built - ${bo}. Ask for fewer stops, raise maxCities / budgetPerCity in the policy, or approve the card above.` };
  return { type: "text", text: summaryText(turn, build) };
}

function explainPlaybook(turn: Turn): Action {
  const cities = parseCities(turn.userText);
  const r = first(turn, "explain_choice");
  if (!r) {
    const city = cities[0] ?? strs(turn.state.topCities)[0]?.replace(/^\d+\.\s*/, "").replace(/\s*\(.*$/, "").replace(/\s+\d+%$/, "");
    if (!city) return { type: "text", text: "Which city? e.g. 'Why Denver?'" };
    return { type: "calls", calls: [{ toolName: "explain_choice", input: { city } }] };
  }
  const o = outcome(r);
  if (o) return { type: "text", text: `I cannot explain that yet: ${o}.` };
  return { type: "text", text: s(r.output.explanation) };
}

function excludePlaybook(turn: Turn): Action {
  const cities = parseCities(turn.userText);
  const done = has(turn, "exclude_city");
  if (done.length === 0) return { type: "calls", calls: cities.map((city) => ({ toolName: "exclude_city", input: { city, excluded: true, reason: "excluded in chat" } })) };
  const remaining = strs(turn.state.itinerary)
    .map((x) => x.replace(/^\d+\.\s*/, "").replace(/\s+\d{4}-\d{2}-\d{2}$/, ""))
    .filter((c) => c && !cities.includes(c));
  const build = first(turn, "build_itinerary");
  if (!build && remaining.length > 0) return { type: "calls", calls: [{ toolName: "build_itinerary", input: { cities: remaining } }] };
  const failed = done.filter((r) => r.denied || r.error);
  const head = `${done.length - failed.length} of ${done.length} cities excluded${failed.length ? ` (${failed.map((r) => `${s(r.input.city)}: ${r.denied ?? r.error}`).join("; ")})` : ""}.`;
  if (build) {
    const bo = outcome(build);
    return { type: "text", text: bo ? `${head} Itinerary not rebuilt - ${bo}.` : `${head}\n${summaryText(turn, build)}` };
  }
  return { type: "text", text: `${head} There is no itinerary yet; ask me to plan the tour.` };
}

function statusText(turn: Turn): string {
  const st = turn.state;
  const act = j(st.act);
  if (!act.name) return "Nothing planned yet. Try: Plan a 10-city North American tour for Nova Reyes.";
  const it = strs(st.itinerary);
  return [`Act: ${s(act.name)}. ${n(st.rankedCities)} cities ranked; partners found for ${strs(st.partnersFor).length}.`, it.length ? `Itinerary: ${it.join(" -> ")}` : "No itinerary yet.", `Top cities: ${strs(st.topCities).slice(0, 5).join(", ")}`].join("\n");
}

const HELP = `I route tours with Qloo's taste data. Try:
- "Plan a 10-city North American tour for Nova Reyes"
- "Route Max Ortega through 8 cities in the UK starting in London in March 2027"
- "Why Denver?" / "Skip Phoenix and Las Vegas"`;

export function plan(turn: Turn): Action {
  switch (detectIntent(turn.userText)) {
    case "plan":
      return planPlaybook(turn);
    case "explain":
      return explainPlaybook(turn);
    case "exclude":
      return excludePlaybook(turn);
    case "status":
      return { type: "text", text: statusText(turn) };
    default:
      return { type: "text", text: HELP };
  }
}

/* ---------------- LanguageModelV3 implementation ---------------- */

const USAGE: LanguageModelV3Usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

let callSeq = 0;

export class MockPlannerModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "tour-router-mock";
  readonly modelId = "rule-based-planner";
  readonly supportedUrls = {};

  constructor(private readonly delayMs = 8) {}

  private decide(options: LanguageModelV3CallOptions): Action {
    const turn = parseTurn(options.prompt);
    const action = plan(turn);
    if (action.type === "calls") {
      const available = new Set((options.tools ?? []).map((t) => t.name));
      const calls = action.calls.filter((c) => available.size === 0 || available.has(c.toolName));
      if (calls.length === 0) return { type: "text", text: `I wanted to call ${action.calls.map((c) => c.toolName).join(", ")} but those tools are not available.` };
      return { type: "calls", calls };
    }
    return action;
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const action = this.decide(options);
    if (action.type === "text") {
      return { content: [{ type: "text", text: action.text }], finishReason: { unified: "stop", raw: "stop" }, usage: USAGE, warnings: [] };
    }
    return {
      content: action.calls.map((c) => ({ type: "tool-call" as const, toolCallId: `call_${++callSeq}`, toolName: c.toolName, input: JSON.stringify(c.input) })),
      finishReason: { unified: "tool-calls", raw: "tool-calls" },
      usage: USAGE,
      warnings: [],
    };
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const action = this.decide(options);
    const delay = this.delayMs;
    const parts: LanguageModelV3StreamPart[] = [{ type: "stream-start", warnings: [] }];
    if (action.type === "text") {
      const id = `txt_${++callSeq}`;
      parts.push({ type: "text-start", id });
      for (const chunk of action.text.match(/[^\s]+\s*|\s+/g) ?? [action.text]) parts.push({ type: "text-delta", id, delta: chunk });
      parts.push({ type: "text-end", id });
      parts.push({ type: "finish", usage: USAGE, finishReason: { unified: "stop", raw: "stop" } });
    } else {
      for (const c of action.calls) {
        const id = `call_${++callSeq}`;
        const input = JSON.stringify(c.input);
        parts.push({ type: "tool-input-start", id, toolName: c.toolName });
        parts.push({ type: "tool-input-delta", id, delta: input });
        parts.push({ type: "tool-input-end", id });
        parts.push({ type: "tool-call", toolCallId: id, toolName: c.toolName, input });
      }
      parts.push({ type: "finish", usage: USAGE, finishReason: { unified: "tool-calls", raw: "tool-calls" } });
    }
    let i = 0;
    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async pull(controller) {
        if (i >= parts.length) {
          controller.close();
          return;
        }
        const part = parts[i++];
        if (delay > 0 && part.type === "text-delta") await new Promise((r) => setTimeout(r, delay));
        controller.enqueue(part);
      },
    });
    return { stream };
  }
}
