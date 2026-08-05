import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OTP_TEMPLATE_VALIDITY_MINUTES, SmsSendError, assertTemplateMatchesTtl, canSendTo,
  renderOtpMessage, sendOtpSms, smsConfigured,
} from './sms.service.js';

// The SMS gateway.
//
// **`fetch` is mocked, always.** Every test here would otherwise send a real text
// message to a real handset and spend real credit, so there is no version of this suite
// that talks to TextSpeed. The one thing a mock cannot prove — that the operator accepts
// the DLT body — is a live check, and it is called out in the report rather than faked.
//
// Four things are worth pinning, and each is a way this integration fails silently
// rather than loudly:
//
//   1. **The body must match the registered template exactly**, or the operator drops
//      the message and the gateway still answers 200.
//   2. **A 200 is not an accept.** Gateways of this shape report errors in the body.
//   3. **India only.** A `+1 555` seed number cannot be delivered to, and must be
//      refused before a request is spent rather than after.
//   4. **Nothing secret may be logged.** The URL carries the API key, the customer's
//      number and the live code.

const KEY = 'test-api-key-1234';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.TEXTSPEEDAPIKEY = KEY;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  delete process.env.TEXTSPEEDAPIKEY;
  vi.unstubAllGlobals();
});

/** A gateway reply. Real ones are plain text, not JSON. */
const reply = (body: string, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

/** The query the last call was made with. */
const lastQuery = (): URLSearchParams => {
  const [url] = fetchMock.mock.calls[0] as [string];
  return new URL(url).searchParams;
};

describe('whether a gateway is configured', () => {
  it('is configured when the key is present', () => {
    expect(smsConfigured()).toBe(true);
  });

  it('**is not configured when the key is absent or blank**', () => {
    delete process.env.TEXTSPEEDAPIKEY;
    expect(smsConfigured()).toBe(false);

    // A key set to whitespace is the same as unset. An `.env` line left as
    // `TEXTSPEEDAPIKEY=` would otherwise read as configured and fail every login.
    process.env.TEXTSPEEDAPIKEY = '   ';
    expect(smsConfigured()).toBe(false);
  });

  it('**reads the key at the point of use, not from an import-time snapshot**', () => {
    // `config/env.ts` snapshots the environment at import, and a rotated secret read
    // from that snapshot keeps reading as the old value — the trap this codebase has hit
    // five times. Rotating mid-process must take effect.
    expect(smsConfigured()).toBe(true);
    delete process.env.TEXTSPEEDAPIKEY;
    expect(smsConfigured()).toBe(false);
  });
});

describe('which numbers it can reach', () => {
  it('accepts an Indian mobile number', () => {
    expect(canSendTo('917702000350')).toBe(true);
  });

  it('**refuses the reserved +1 555 range the seeds and webhook helper use**', () => {
    // Not a hypothetical: three demo accounts sign in with these, and the webhook
    // helper posts from one. Sending them to an Indian gateway would fail per login.
    expect(canSendTo('15550001234')).toBe(false);
    expect(canSendTo('15550009911')).toBe(false);
  });

  it('refuses other countries and malformed input', () => {
    expect(canSendTo('447911123456')).toBe(false);   // UK
    expect(canSendTo('971501234567')).toBe(false);   // UAE
    expect(canSendTo('7702000350')).toBe(false);     // missing the country code
    expect(canSendTo('9177020003501')).toBe(false);  // one digit too many
    expect(canSendTo('')).toBe(false);
  });

  it('**refuses before spending a request**', async () => {
    await expect(sendOtpSms('15550001234', '123456')).rejects.toBeInstanceOf(SmsSendError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the DLT template', () => {
  it('**renders the registered wording exactly, with only the code substituted**', () => {
    // The operator matches this against the registered body. A changed comma means
    // every login SMS stops being delivered while the gateway still answers 200.
    expect(renderOtpMessage('483920')).toBe(
      'Your ZunoPilot verification code is 483920. This code is valid for 10 minutes. '
      + 'Do not share this code with anyone. From mTouch Labs',
    );
  });

  it('**keeps the entity signature**, whose absence silently broke delivery', () => {
    // The first live attempt omitted " From mTouch Labs", reading it as prose rather
    // than as registered content. TextSpeed answered Success with a message id and
    // charged a credit; nothing arrived. Asserted separately from the wording above so
    // a future edit that drops it fails on a line that says why.
    expect(renderOtpMessage('483920')).toMatch(/ From mTouch Labs$/);
  });

  it('is the length the DLT portal registered', () => {
    // A count is a cheap way to catch a stray space that reads identically in a diff.
    // 130 is the registered template *with* the five-character `<OTP>` placeholder; a
    // six-digit code makes the rendered message one longer.
    expect(renderOtpMessage('483920')).toHaveLength(131);
  });

  it('leaves no placeholder behind', () => {
    expect(renderOtpMessage('000001')).not.toContain('<OTP>');
  });

  it('**refuses to send when the TTL disagrees with what the SMS says**', () => {
    // The body promises ten minutes. A five-minute TTL would tell every customer
    // something false about a code they are holding, and the template cannot be
    // reworded without re-registering it — so the TTL is what has to give.
    expect(() => assertTemplateMatchesTtl(5)).toThrow(/registered DLT template says 10 minutes/);
    expect(() => assertTemplateMatchesTtl(OTP_TEMPLATE_VALIDITY_MINUTES)).not.toThrow();
  });
});

describe('the request it makes', () => {
  it('sends every parameter the gateway expects', async () => {
    fetchMock.mockResolvedValue(reply('SMS sent successfully'));

    await sendOtpSms('917702000350', '483920');

    const query = lastQuery();
    expect(query.get('apikey')).toBe(KEY);
    expect(query.get('senderid')).toBe('ZUNOPI');
    expect(query.get('templateid')).toBe('1277178558983059679');
    expect(query.get('number')).toBe('917702000350');
    expect(query.get('message')).toBe(renderOtpMessage('483920'));
  });

  it('**encodes spaces as %20, matching the request known to reach a handset**', async () => {
    // `URLSearchParams` would produce `+`, which PHP also decodes to a space — but the
    // only request shape proven to deliver uses `%20`, and there is no reason to differ
    // by a character from that when the operator matches content byte-for-byte.
    fetchMock.mockResolvedValue(reply('ok'));
    await sendOtpSms('917702000350', '483920');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('message=Your%20ZunoPilot%20verification%20code%20is%20483920');
    expect(url).not.toContain('message=Your+ZunoPilot');
    // Raw spaces would be a malformed URL, and the template would not match.
    expect(url).not.toMatch(/message=Your ZunoPilot/);
    // And it still decodes back to the exact registered wording.
    expect(new URL(url).searchParams.get('message')).toBe(renderOtpMessage('483920'));
  });

  it('sends the signature through unaltered', async () => {
    fetchMock.mockResolvedValue(reply('ok'));
    await sendOtpSms('917702000350', '483920');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('%20From%20mTouch%20Labs');
  });

  it('gives up rather than hanging while someone watches a spinner', async () => {
    fetchMock.mockImplementation(() => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    await expect(sendOtpSms('917702000350', '483920'))
      .rejects.toThrow(/did not respond in time/);
  });
});

describe('what counts as sent', () => {
  it('**accepts the real JSON body a live send returns**', async () => {
    // Captured from an actual send on 2026-08-05. The suite originally assumed a plain
    // text reply and passed only because the denylist happened not to match — worth
    // pinning the true shape now that it is known.
    fetchMock.mockResolvedValue(reply(
      '{"status":"Success","code":"011","description":"Message submitted successfully"}',
    ));
    await expect(sendOtpSms('917702000350', '483920')).resolves.toBeUndefined();
  });

  it('**rejects a JSON body whose status is not Success**', async () => {
    // With the format known, this is an exact check rather than word-matching — a
    // failure whose description happens to contain no error words is still a failure.
    fetchMock.mockResolvedValue(reply(
      '{"status":"Failed","code":"014","description":"Sender id not approved"}',
    ));
    await expect(sendOtpSms('917702000350', '483920'))
      .rejects.toBeInstanceOf(SmsSendError);
  });

  it('accepts a plain success reply, for a gateway that changes its format', async () => {
    fetchMock.mockResolvedValue(reply('1701|917702000350'));
    await expect(sendOtpSms('917702000350', '483920')).resolves.toBeUndefined();
  });

  it('**treats an error inside a 200 as a failure**', async () => {
    // The important one. This gateway shape answers problems with HTTP 200 and an
    // error string, so trusting the status means silently dropping login codes and
    // telling the customer one is on the way.
    for (const body of [
      'Invalid API Key',
      'ERROR: insufficient balance',
      'Authentication failed',
      'Template id invalid',
    ]) {
      fetchMock.mockResolvedValue(reply(body));
      // eslint-disable-next-line no-await-in-loop
      await expect(sendOtpSms('917702000350', '483920'))
        .rejects.toBeInstanceOf(SmsSendError);
    }
  });

  it('treats a non-2xx as a failure', async () => {
    fetchMock.mockResolvedValue(reply('Bad Gateway', 502));
    await expect(sendOtpSms('917702000350', '483920')).rejects.toThrow(/refused the request/);
  });

  it('**accepts an unrecognised-but-harmless reply rather than blocking logins**', async () => {
    // The accept format is not documented. Failing closed on anything unfamiliar would
    // mean one wording change at the gateway locks every customer out, so the check is
    // a denylist of failure words rather than an allowlist of success ones.
    fetchMock.mockResolvedValue(reply('MSGID:88213311'));
    await expect(sendOtpSms('917702000350', '483920')).resolves.toBeUndefined();
  });

  it('refuses with no key configured, without calling out', async () => {
    delete process.env.TEXTSPEEDAPIKEY;
    await expect(sendOtpSms('917702000350', '483920')).rejects.toThrow(/No SMS API key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('what reaches the logs', () => {
  /** Everything passed to the logger during one send, flattened to searchable text. */
  const logsFrom = async (run: () => Promise<unknown>): Promise<string> => {
    const { logger } = await import('../config/logger.js');
    const captured: unknown[] = [];
    const levels = ['info', 'warn', 'error', 'debug'] as const;
    const spies = levels.map((level) =>
      vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
        captured.push(...args);
        return logger;
      }) as never));

    await run().catch(() => {});
    spies.forEach((spy) => spy.mockRestore());
    return JSON.stringify(captured);
  };

  it('**never logs the API key, the code, or the URL that carries both**', async () => {
    // The gateway takes everything in a query string, so the one thing that must never
    // be logged is the thing most natural to log. A log tail or an aggregator would
    // otherwise hold live login codes and a credential.
    fetchMock.mockResolvedValue(reply('SMS sent successfully'));

    const logged = await logsFrom(() => sendOtpSms('917702000350', '483920'));

    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain('483920');
    expect(logged).not.toContain('sms.textspeed.in');
    expect(logged).not.toContain('apikey');
  });

  it('logs a masked number, so a send is still traceable', async () => {
    // An OTP send is a security event worth recording. Masked rather than absent: it has
    // to be possible to answer "did we send anything to this person" later.
    fetchMock.mockResolvedValue(reply('ok'));

    const logged = await logsFrom(() => sendOtpSms('917702000350', '483920'));

    expect(logged).toContain('9177****50');
    expect(logged).not.toContain('917702000350');
  });

  it('**does not leak the code on a failure path either**', async () => {
    // The error branches log more detail than the success one, which is exactly where a
    // secret would slip through.
    fetchMock.mockResolvedValue(reply('Invalid API Key'));

    const logged = await logsFrom(() => sendOtpSms('917702000350', '483920'));

    expect(logged).not.toContain('483920');
    expect(logged).not.toContain(KEY);
    // The gateway's own words are kept, because that is the operational signal.
    expect(logged).toContain('Invalid API Key');
  });
});
