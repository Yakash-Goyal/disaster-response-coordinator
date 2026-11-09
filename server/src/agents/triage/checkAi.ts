import { env } from '../../config/env';
import { classifyWithAi, isAiConfigured } from './llmClassifier';

/**
 * Quick check that the Gemini API key works.
 *   npm run ai:check
 * Sends one sample report to Gemini and prints the answer, or the exact error.
 */
async function main() {
  if (!isAiConfigured()) {
    console.log('No key found. Put your key in server/.env as GEMINI_API_KEY=... and run this again.');
    process.exitCode = 1;
    return;
  }

  console.log(`Testing Gemini model "${env.GEMINI_MODEL}"...`);
  const sample = 'Water has entered houses in Velachery, waist deep, an elderly couple is trapped on the ground floor.';

  try {
    const result = await classifyWithAi(sample);
    console.log('\nSUCCESS - the AI is working. It answered:');
    console.log(`  Type:       ${result.type}`);
    console.log(`  Severity:   ${result.severity}`);
    console.log(`  Confidence: ${Math.round(result.confidence * 100)}%`);
    console.log(`  Title:      ${result.title}`);
    console.log(`  Reason:     ${result.reason}`);
  } catch (error) {
    console.log('\nFAILED - Gemini returned an error:');
    console.log(`  ${(error as Error).message}`);
    console.log('\nCommon causes: key copied with extra spaces, key restricted to another API,');
    console.log('free-tier limit reached, or the model name in GEMINI_MODEL is not available to your account.');
    process.exitCode = 1;
  }
}

void main();
