/**
 * Model selection. Both options are free tiers that need no card:
 *  - Google AI Studio (Gemini)   GOOGLE_GENERATIVE_AI_API_KEY
 *  - Groq                        GROQ_API_KEY
 * With no key at all (or MOCK_LLM=1) the deterministic rule planner drives the same tools.
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";
import { MockPlannerModel } from "./mock-model";

export function isMockLlm(): boolean {
  if (process.env.MOCK_LLM === "1") return true;
  if (process.env.MOCK_LLM === "0") return false;
  return !(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GROQ_API_KEY);
}

export function llmLabel(): string {
  if (isMockLlm()) return "rule planner (no LLM key)";
  const override = process.env.LLM_MODEL;
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return `Gemini ${override ?? "2.5 Flash"}`;
  if (process.env.GROQ_API_KEY) return `Groq ${override ?? "gpt-oss-120b"}`;
  return "rule planner";
}

export function getModel(opts: { forceMock?: boolean } = {}): LanguageModel {
  if (opts.forceMock || isMockLlm()) return new MockPlannerModel();
  const override = process.env.LLM_MODEL;
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
    return google(override ?? "gemini-2.5-flash");
  }
  if (process.env.GROQ_API_KEY) {
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
    return groq(override ?? "openai/gpt-oss-120b");
  }
  return new MockPlannerModel();
}
