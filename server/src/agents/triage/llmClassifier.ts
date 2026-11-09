import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { z } from 'zod';
import { env } from '../../config/env';
import { INCIDENT_TYPES } from '../../domain';
import type { Classification } from './types';

/**
 * AI classifier: asks Google Gemini to read the report text and return a
 * structured classification (type, severity, confidence, title, reason).
 *
 * `withStructuredOutput` makes the model answer in exactly this shape,
 * so we never have to parse free text.
 */
const classificationSchema = z.object({
  type: z.enum(INCIDENT_TYPES).describe('The kind of incident described'),
  severity: z.number().int().min(1).max(5).describe('1 minor, 2 moderate, 3 serious, 4 severe, 5 critical'),
  confidence: z.number().min(0).max(1).describe('How sure you are about type and severity, from 0 to 1'),
  title: z.string().max(80).describe('A short neutral headline, max 8 words'),
  reason: z.string().max(400).describe('One or two sentences explaining the type and severity'),
});

const SYSTEM_PROMPT = `You are the triage officer of a disaster response control room in Chennai, India.
You read one incoming report (citizen call, social media post or weather alert) and classify it.

Incident types:
- flood: waterlogging, rising water, people stranded by water
- fire: fire, smoke, explosion, gas leak
- structural_collapse: building, wall or roof collapse, people under debris
- medical: injured or sick people needing medical help
- road_blockage: fallen trees, blocked or damaged roads
- power_outage: power cuts, fallen electric lines, transformer problems
- supply_shortage: people without food, drinking water, milk or medicines
- other: anything that fits none of the above

Severity:
1 minor (inconvenience) - 2 moderate (property at risk) - 3 serious (people need help soon)
4 severe (lives at risk) - 5 critical (lives at immediate risk, many people affected)

Rules:
- Base your answer only on the text. Do not invent details.
- If a report mixes several problems, choose the one most dangerous to human life.
- Reports may use Indian English or Tamil words written in English letters.
- Be honest about confidence: use below 0.6 if the text is vague, joking, or could be several types.`;

function buildModel() {
  const llm = new ChatGoogleGenerativeAI({
    model: env.GEMINI_MODEL,
    apiKey: env.GEMINI_API_KEY,
    temperature: 0, // same input -> same answer
    maxRetries: 1, // fail fast and fall back to rules instead of waiting
  });
  return llm.withStructuredOutput(classificationSchema, { name: 'classify_report' });
}

// Created on first use, then reused for every report.
let model: ReturnType<typeof buildModel> | null = null;

function getModel() {
  model ??= buildModel();
  return model;
}

export function isAiConfigured(): boolean {
  return env.GEMINI_API_KEY.trim().length > 0;
}

export async function classifyWithAi(text: string): Promise<Classification> {
  const result = await getModel().invoke(
    [
      ['system', SYSTEM_PROMPT],
      ['human', `Report:\n"""${text}"""`],
    ],
    { timeout: 15_000 },
  );
  return classificationSchema.parse(result);
}
