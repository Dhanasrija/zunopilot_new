import type { Assistant } from '@prisma/client';
import type { RouterCapabilityView } from '../domain/capability.js';
import type { ValidatedRouterOutput } from './contract.js';

// The confidence gate.
//
// The router says what it thinks; this decides what actually happens. Keeping
// them separate matters because the thresholds are policy — per assistant, and
// tightened per workflow — while the model's opinion is just evidence.
//
// Defaults: >= 0.80 start, >= 0.55 clarify, below that fall back.

export type GateAction =
  | { action: 'START_WORKFLOW'; workflowId: string; confidence: number; reasonCode: string }
  | { action: 'ASK_CLARIFICATION'; question: string; confidence: number; reasonCode: string; candidates: string[] }
  | { action: 'GENERAL_RESPONSE'; reasonCode: string }
  | { action: 'HUMAN_HANDOFF'; reasonCode: string }
  | { action: 'FALLBACK'; reasonCode: string };

const DEFAULT_CLARIFICATION = 'I can help with a few things — could you tell me a bit more about what you need?';

export const applyConfidenceGate = ({
  output, assistant, candidates,
}: {
  output: ValidatedRouterOutput;
  assistant: Pick<Assistant, 'highConfidenceThreshold' | 'mediumConfidenceThreshold' | 'generalResponseEnabled'>;
  candidates: RouterCapabilityView[];
}): GateAction => {
  // These two bypass the thresholds entirely. Someone asking for a human should
  // get one whether the model was 0.9 or 0.5 sure about it.
  if (output.decision === 'HUMAN_HANDOFF') {
    return { action: 'HUMAN_HANDOFF', reasonCode: output.reasonCode };
  }

  if (output.decision === 'NO_MATCH') {
    return assistant.generalResponseEnabled
      ? { action: 'GENERAL_RESPONSE', reasonCode: output.reasonCode }
      : { action: 'FALLBACK', reasonCode: output.reasonCode };
  }

  if (output.decision === 'ASK_CLARIFICATION') {
    return {
      action: 'ASK_CLARIFICATION',
      question: output.clarificationQuestion?.trim() || DEFAULT_CLARIFICATION,
      confidence: output.confidence,
      reasonCode: output.reasonCode,
      candidates: output.possibleWorkflowIds,
    };
  }

  if (output.decision === 'GENERAL_RESPONSE') {
    return assistant.generalResponseEnabled
      ? { action: 'GENERAL_RESPONSE', reasonCode: output.reasonCode }
      : { action: 'FALLBACK', reasonCode: output.reasonCode };
  }

  // ── START_WORKFLOW ─────────────────────────────────────────────────────────
  const selected = candidates.find((c) => c.workflowId === output.workflowId);
  if (!selected || !output.workflowId) {
    return { action: 'FALLBACK', reasonCode: 'NO_SUITABLE_WORKFLOW' };
  }

  // The workflow's own bar wins when it is stricter. A booking flow that
  // creates a real appointment should be harder to trigger than an FAQ lookup,
  // and that decision belongs to whoever authored the workflow.
  const threshold = Math.max(assistant.highConfidenceThreshold, selected.minimumConfidence);

  if (output.confidence >= threshold) {
    // Required inputs are not a gate. The workflow asks for what it is missing
    // — that is what ASK_USER_INPUT is for — and blocking here would mean a
    // customer saying "book me an appointment" gets a clarifying question
    // instead of the booking flow they asked for.
    return {
      action: 'START_WORKFLOW',
      workflowId: output.workflowId,
      confidence: output.confidence,
      reasonCode: output.reasonCode,
    };
  }

  if (output.confidence >= assistant.mediumConfidenceThreshold) {
    return {
      action: 'ASK_CLARIFICATION',
      question: output.clarificationQuestion?.trim() || clarificationFor(selected, candidates),
      confidence: output.confidence,
      reasonCode: 'LOW_CONFIDENCE',
      candidates: output.possibleWorkflowIds.length
        ? output.possibleWorkflowIds
        : [selected.workflowId],
    };
  }

  return assistant.generalResponseEnabled
    ? { action: 'GENERAL_RESPONSE', reasonCode: 'LOW_CONFIDENCE' }
    : { action: 'FALLBACK', reasonCode: 'LOW_CONFIDENCE' };
};

/**
 * A clarifying question built from the candidates' own purposes, so the
 * customer is asked in business language rather than shown workflow names.
 */
const clarificationFor = (
  selected: RouterCapabilityView,
  candidates: RouterCapabilityView[],
): string => {
  const others = candidates.filter((c) => c.workflowId !== selected.workflowId).slice(0, 2);
  if (!others.length) return `Just to confirm — did you want to ${lowerFirst(selected.purpose)}?`;

  const options = [selected, ...others].map((c) => lowerFirst(c.purpose));
  return `I can help you ${options.slice(0, -1).join(', ')} or ${options.at(-1)}. Which would you like?`;
};

const lowerFirst = (text: string): string => {
  const trimmed = text.trim().replace(/\.$/, '');
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
};
