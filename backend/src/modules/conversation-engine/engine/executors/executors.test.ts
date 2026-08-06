import { describe, expect, it, vi } from 'vitest';
import { compare, validateUserAnswer } from './index.js';
import { askUserInputExecutor, sendWhatsAppMessageExecutor } from './conversation.js';
import { conditionExecutor, delayExecutor, endWorkflowExecutor } from './logic.js';
import { buttonMessageExecutor } from './interactive.js';
import { httpRequestExecutor } from './integration.js';
import type { NodeExecutionContext } from '../types.js';

// A context stub with only what the executors under test actually read. Anything
// an executor reaches for that is not here fails loudly, which is the point.
const contextFor = <T>(config: T, overrides: Partial<NodeExecutionContext<T>> = {}) => {
  const sendText = vi.fn().mockResolvedValue({ messageId: 'wamid.stub' });
  const context = {
    config,
    node: { id: 'n1', type: 'X', position: { x: 0, y: 0 }, config: {} },
    contact: { waId: '15550009911' },
    variables: {},
    dryRun: false,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    services: { whatsapp: { sendText }, integrations: {} },
    ...overrides,
  } as unknown as NodeExecutionContext<T>;
  return { context, sendText };
};

describe('CONDITION', () => {
  it('routes to the yes handle when the test passes', async () => {
    const config = conditionExecutor.validateConfig({ left: 'book me in', op: 'contains', right: 'book' });
    const { context } = contextFor(config);
    const result = await conditionExecutor.execute(context);
    expect(result.nextHandle).toBe('yes');
  });

  it('routes to the no handle when it fails', async () => {
    const config = conditionExecutor.validateConfig({ left: 'hello', op: 'contains', right: 'book' });
    const { context } = contextFor(config);
    expect((await conditionExecutor.execute(context)).nextHandle).toBe('no');
  });
});

describe('compare', () => {
  it('is case-insensitive for text, because the left side is customer-typed', () => {
    expect(compare('Cardiology', 'equals', 'cardiology')).toBe(true);
  });

  it('refuses rather than coerces when a numeric operand is not numeric', () => {
    // `'abc' > 5` silently returning false would be a wrong branch, not a
    // no-match, so both directions must be false.
    expect(compare('abc', 'gt', 5)).toBe(false);
    expect(compare('abc', 'lt', 5)).toBe(false);
  });

  it('compares numbers numerically, not lexically', () => {
    expect(compare('9', 'lt', '10')).toBe(true);
  });
});

describe('ASK_USER_INPUT', () => {
  it('sends the prompt and parks the run', async () => {
    const config = askUserInputExecutor.validateConfig({
      prompt: 'Which speciality?', variableName: 'speciality',
    });
    const { context, sendText } = contextFor(config);
    const result = await askUserInputExecutor.execute(context);

    expect(sendText).toHaveBeenCalledWith({ to: '15550009911', body: 'Which speciality?' });
    expect(result.status).toBe('WAITING_FOR_USER');
    // Without this the next inbound message has nowhere to go.
    expect(result.awaiting).toEqual({ nodeId: 'n1', variableName: 'speciality' });
  });

  it('sends nothing on a dry run', async () => {
    const config = askUserInputExecutor.validateConfig({ prompt: 'Which?', variableName: 'x' });
    const { context, sendText } = contextFor(config, { dryRun: true });
    const result = await askUserInputExecutor.execute(context);
    expect(sendText).not.toHaveBeenCalled();
    expect(result.status).toBe('WAITING_FOR_USER');
  });
});

describe('validateUserAnswer', () => {
  const config = (over: Record<string, unknown> = {}) =>
    askUserInputExecutor.validateConfig({ prompt: 'p', variableName: 'v', ...over });

  it('accepts a plain string', () => {
    expect(validateUserAnswer(config(), ' Cardiology ')).toEqual({ ok: true, value: 'Cardiology' });
  });

  it('rejects an empty required answer', () => {
    expect(validateUserAnswer(config(), '   ').ok).toBe(false);
  });

  it('normalises a date so downstream nodes get one format', () => {
    expect(validateUserAnswer(config({ inputType: 'date' }), '2026-08-05'))
      .toEqual({ ok: true, value: '2026-08-05' });
  });

  it('rejects a date it cannot parse', () => {
    expect(validateUserAnswer(config({ inputType: 'date' }), 'sometime next week').ok).toBe(false);
  });

  it('enforces choices case-insensitively but stores the canonical form', () => {
    const c = config({ inputType: 'choice', validation: { choices: ['10:00', '11:30'] } });
    expect(validateUserAnswer(c, '11:30')).toEqual({ ok: true, value: '11:30' });
    expect(validateUserAnswer(c, '09:00').ok).toBe(false);
  });

  it('does not let a bad tenant-authored regex block the customer', () => {
    const c = config({ validation: { pattern: '([' } });
    expect(validateUserAnswer(c, 'anything').ok).toBe(true);
  });
});

describe('DELAY', () => {
  it('parks the run until a wall-clock time', async () => {
    const config = delayExecutor.validateConfig({ seconds: 90 });
    const { context } = contextFor(config);
    const result = await delayExecutor.execute(context);
    expect(result.status).toBe('WAITING');
    expect(result.waitUntil).toBeInstanceOf(Date);
  });

  it('refuses a duration beyond the 30-day cap', () => {
    expect(() => delayExecutor.validateConfig({ seconds: 60 * 60 * 24 * 400 })).toThrow();
  });
});

describe('END_WORKFLOW', () => {
  it('reports a terminal outcome', async () => {
    const config = endWorkflowExecutor.validateConfig({ outcome: 'CANCELLED' });
    const { context } = contextFor(config);
    expect((await endWorkflowExecutor.execute(context)).terminal).toBe('CANCELLED');
  });
});

describe('SEND_WHATSAPP_MESSAGE', () => {
  it('suppresses the send on a dry run', async () => {
    const config = sendWhatsAppMessageExecutor.validateConfig({ body: 'hi' });
    const { context, sendText } = contextFor(config, { dryRun: true });
    await sendWhatsAppMessageExecutor.execute(context);
    expect(sendText).not.toHaveBeenCalled();
  });
});

describe('HTTP_REQUEST', () => {
  it('calls a named mock integration', async () => {
    const config = httpRequestExecutor.validateConfig({
      url: 'https://example.test/slots', mockService: 'doctorAvailability',
    });
    const call = vi.fn().mockResolvedValue({ slots: ['10:00'] });
    const { context } = contextFor(config, {
      services: { integrations: { doctorAvailability: { name: 'doctorAvailability', call } } },
    } as never);

    const result = await httpRequestExecutor.execute(context);
    expect(call).toHaveBeenCalled();
    expect(result.variablesPatch).toEqual({ http_response: { slots: ['10:00'] } });
    expect(result.nextHandle).toBe('success');
  });

  it('refuses an arbitrary outbound URL until the egress allowlist exists', async () => {
    // This is the SSRF surface. Failing closed is the whole point — a node with
    // no mock must not dial a tenant-authored URL.
    const config = httpRequestExecutor.validateConfig({ url: 'http://169.254.169.254/latest/meta-data/' });
    const { context } = contextFor(config);
    await expect(httpRequestExecutor.execute(context)).rejects.toThrow(/not enabled yet/);
  });
});

describe('BUTTON_MESSAGE replies', () => {
  const config = buttonMessageExecutor.validateConfig({
    body: 'What next?',
    buttons: [
      { id: 'add_more', title: 'Add more items' },
      { id: 'checkout', title: 'Checkout' },
      { id: 'cancel_order', title: 'Cancel order' },
    ],
    variableName: 'basket_action',
    labelVariable: 'basket_action_label',
  });

  const accept = (text: string, replyId: string | null = null) =>
    buttonMessageExecutor.acceptReply!({ config, reply: { text, replyId }, variables: {} });

  it('takes the id from a tap', async () => {
    expect(await accept('Checkout', 'checkout')).toMatchObject({ ok: true, value: 'checkout' });
  });

  it('takes the visible title when the customer types instead', async () => {
    // Ids are ours, titles are theirs. A customer types what they can see.
    expect(await accept('checkout')).toMatchObject({
      ok: true,
      value: 'checkout',
      extraVariables: { basket_action_label: 'Checkout' },
    });
  });

  it('accepts an unambiguous prefix', async () => {
    expect(await accept('add')).toMatchObject({ ok: true, value: 'add_more' });
  });

  it('refuses an id the node never offered', async () => {
    expect(await accept('Something', 'confirm_order')).toMatchObject({ ok: false });
  });

  it('refuses rather than guessing when a prefix fits more than one option', async () => {
    const ambiguous = buttonMessageExecutor.validateConfig({
      body: 'Confirm?',
      buttons: [
        { id: 'yes_now', title: 'Yes, order now' },
        { id: 'yes_later', title: 'Yes, save it' },
      ],
      variableName: 'answer',
    });
    const outcome = await buttonMessageExecutor.acceptReply!({
      config: ambiguous, reply: { text: 'yes', replyId: null }, variables: {},
    });
    // Picking one at random here would place an order the customer did not choose.
    expect(outcome.ok).toBe(false);
  });
});
