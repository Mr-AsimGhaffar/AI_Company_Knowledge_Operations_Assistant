import { GoogleGenAI } from "@google/genai";
import { config, EMBEDDING_DIM } from "./config";

let client: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (!config.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured. Add it to your .env file.");
  }
  client ??= new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  return client;
}

export const geminiConfigured = () => Boolean(config.GEMINI_API_KEY);

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export async function embedTexts(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<number[][]> {
  const ai = getGemini();
  const out: number[][] = [];
  const BATCH = 50;
  for (let i = 0; i < texts.length; i += BATCH) {
    const res = await ai.models.embedContent({
      model: config.GEMINI_EMBEDDING_MODEL,
      contents: texts.slice(i, i + BATCH),
      config: { taskType, outputDimensionality: EMBEDDING_DIM },
    });
    for (const e of res.embeddings ?? []) out.push(normalize(e.values ?? []));
  }
  if (out.length !== texts.length) throw new Error("Embedding count mismatch");
  return out;
}

export const toVectorLiteral = (v: number[]) => `[${v.join(",")}]`;
