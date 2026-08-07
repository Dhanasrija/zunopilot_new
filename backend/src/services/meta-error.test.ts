import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import { metaFailure, metaFailureMessage } from './meta-error.js';

/*
 * An agent replied in the shared inbox and was told **"Internal server error"**.
 *
 * The server was fine. Meta had refused the send with a complete explanation, and we threw
 * the raw AxiosError, so the global handler — which is right not to leak the message of an
 * error it does not recognise — replaced it with the generic 500. The advice the operator
 * needed reached the log and nothing else.
 *
 * The fixture below is the response production actually returned, copied from
 * `/var/log/zunopilot/api.out.log`.
 */

const graphError = (status: number, body: unknown): AxiosError => {
  const err = new AxiosError('Request failed with status code ' + status);
  err.response = {
    status,
    statusText: '',
    data: body,
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
  return err;
};

const NOT_IN_ALLOWED_LIST = {
  error: {
    message: '(#131030) Recipient phone number not in allowed list',
    code: 131030,
    error_data: {
      messaging_product: 'whatsapp',
      details:
        'Recipient phone number not in allowed list: Add recipient phone number to recipient list and try again.',
    },
    fbtrace_id: 'AWNWxO8SdhmY7VK9_7x8YML',
  },
};

describe('metaFailure', () => {
  it('**does not report a refused send as a server error**', () => {
    // The whole bug in one assertion. 5xx says "we broke", sends the operator to us rather
    // than to their own settings, and is what the frontend retries on.
    const failure = metaFailure(graphError(400, NOT_IN_ALLOWED_LIST));
    expect(failure?.statusCode).toBe(422);
    expect(failure?.statusCode).toBeLessThan(500);
  });

  it("**passes Meta's own explanation through, not the axios message**", () => {
    const failure = metaFailure(graphError(400, NOT_IN_ALLOWED_LIST));
    expect(failure?.message).toContain('not in allowed list');
    expect(failure?.message).toContain('Add recipient phone number');
    expect(failure?.message).not.toContain('status code');
  });

  it('prefers error_user_msg, which Meta writes for end users', () => {
    const failure = metaFailure(graphError(400, {
      error: {
        code: 131047,
        message: '(#131047) Re-engagement message',
        error_user_msg: 'This customer has not messaged you in 24 hours. Send a template instead.',
        error_data: { details: 'Message failed to send because more than 24 hours have passed.' },
      },
    }));
    expect(failure?.message).toBe(
      'This customer has not messaged you in 24 hours. Send a template instead.',
    );
  });

  it('**never lets a phone number through**', () => {
    // `maskCustomerNumbers` stops an agent harvesting contacts. A verbatim relay of a third
    // party's error text would be a hole in it the day Meta quotes the recipient back.
    const failure = metaFailure(graphError(400, {
      error: { code: 131026, error_data: { details: 'Message undeliverable to +91 77020 00350' } },
    }));
    expect(failure?.message).not.toContain('77020');
    expect(failure?.message).not.toContain('7702000350');
    expect(failure?.message).toContain('[number]');
  });

  it('leaves small numbers alone, so the text still says something', () => {
    const failure = metaFailure(graphError(400, {
      error: { code: 100, error_data: { details: 'Body exceeds the 4096 character limit' } },
    }));
    expect(failure?.message).toContain('4096');
  });

  it('keeps the expired token on its own status — it is fixed elsewhere', () => {
    // Reconnecting WhatsApp in Settings, not editing the message. 424 predates this mapping
    // and the frontend already keys on it.
    expect(metaFailure(graphError(400, { error: { code: 190, message: 'Session expired' } }))?.statusCode)
      .toBe(424);
    expect(metaFailure(graphError(401, {}))?.statusCode).toBe(424);
  });

  it('calls a Meta outage a gateway failure, not a bad request', () => {
    expect(metaFailure(graphError(500, {}))?.statusCode).toBe(502);
    expect(metaFailure(graphError(503, {}))?.statusCode).toBe(502);
  });

  it('treats a timeout — no response at all — as unreachable', () => {
    // The `timeout` on the shared Graph client produces this: an AxiosError with no
    // `response`. Reading `status` off it would have thrown.
    const timeout = new AxiosError('timeout of 10000ms exceeded', AxiosError.ECONNABORTED);
    const failure = metaFailure(timeout);
    expect(failure?.statusCode).toBe(502);
    expect(failure?.message).toContain('not responding');
  });

  it('passes rate limiting through as rate limiting', () => {
    expect(metaFailure(graphError(429, {}))?.statusCode).toBe(429);
  });

  it('**returns null for anything that is not a Graph rejection**', () => {
    // Load-bearing: the call sites do `throw metaFailure(err) ?? err`, so a genuine bug in
    // the handler has to keep falling through to the error handler as a 500. If this ever
    // returned an ApiError for a TypeError, real faults would start reading as 422s.
    expect(metaFailure(new TypeError('cannot read properties of undefined'))).toBeNull();
    expect(metaFailure('not an error')).toBeNull();
  });

  it('still answers when Meta sends a 4xx with no body', () => {
    const failure = metaFailure(graphError(400, undefined));
    expect(failure?.statusCode).toBe(422);
    expect(failure?.message).toBe('WhatsApp refused the message.');
  });
});

describe('metaFailureMessage', () => {
  it('gives the ticket sender a sentence worth showing the agent', () => {
    expect(metaFailureMessage(graphError(400, NOT_IN_ALLOWED_LIST)))
      .toContain('Add recipient phone number');
  });

  it('falls back to a plain error message, scrubbed', () => {
    expect(metaFailureMessage(new Error('could not reach +91 77020 00350')))
      .toBe('could not reach [number]');
  });
});
