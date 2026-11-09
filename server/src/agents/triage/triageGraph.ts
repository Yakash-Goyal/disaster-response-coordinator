import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { classifyWithAi, isAiConfigured } from './llmClassifier';
import { classifyWithRules } from './ruleClassifier';
import type { Classification, TriageResult } from './types';

/**
 * TRIAGE AGENT (SRS 4.2), built as a LangGraph state graph.
 *
 *            START
 *              |
 *      [classify_with_ai] ---- AI failed / no key ----> [classify_with_rules]
 *              |                                                |
 *              +----------------> [check_confidence] <----------+
 *                                         |
 *                                        END
 *
 * Each box is a "node" (a function). Nodes read and update a shared
 * "state" object. The arrow after classify_with_ai is a "conditional edge":
 * the graph decides at run time which node runs next.
 */
const TriageState = Annotation.Root({
  text: Annotation<string>,
  classification: Annotation<Classification | undefined>,
  method: Annotation<'ai' | 'rules' | undefined>,
  aiError: Annotation<string | undefined>,
  needsReview: Annotation<boolean>,
});

type State = typeof TriageState.State;

async function classifyWithAiNode(state: State): Promise<Partial<State>> {
  if (!isAiConfigured()) return { aiError: 'No Gemini API key configured' };
  try {
    return { classification: await classifyWithAi(state.text), method: 'ai' };
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    logger.warn(`Triage AI call failed, using keyword rules instead: ${message}`);
    return { aiError: message };
  }
}

function classifyWithRulesNode(state: State): Partial<State> {
  return { classification: classifyWithRules(state.text), method: 'rules' };
}

/** Low-confidence results are never silently accepted: they are flagged for a human. */
function checkConfidenceNode(state: State): Partial<State> {
  const classification = state.classification!;
  const lowConfidence = classification.confidence < env.TRIAGE_REVIEW_THRESHOLD;
  const needsReview = state.method === 'rules' || lowConfidence;

  if (lowConfidence && state.method === 'ai') {
    classification.reason += ` Confidence is only ${Math.round(classification.confidence * 100)}%, so a person should check it.`;
  }
  return { classification, needsReview };
}

const triageGraph = new StateGraph(TriageState)
  .addNode('classify_with_ai', classifyWithAiNode)
  .addNode('classify_with_rules', classifyWithRulesNode)
  .addNode('check_confidence', checkConfidenceNode)
  .addEdge(START, 'classify_with_ai')
  .addConditionalEdges('classify_with_ai', (state) =>
    state.classification ? 'check_confidence' : 'classify_with_rules',
  )
  .addEdge('classify_with_rules', 'check_confidence')
  .addEdge('check_confidence', END)
  .compile();

/** Runs the Triage Agent on one report text. */
export async function runTriage(text: string): Promise<TriageResult> {
  const finalState = await triageGraph.invoke({ text });
  return {
    ...finalState.classification!,
    method: finalState.method!,
    needsReview: finalState.needsReview,
  };
}
