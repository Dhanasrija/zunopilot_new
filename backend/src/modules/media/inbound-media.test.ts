import { describe, expect, it } from 'vitest';
import { describeMedia, isMediaType, messageTypeOf } from './inbound-media.js';
import { storageKeyFor } from './storage.js';

/*
 * Files a customer sends.
 *
 * What this replaced: every image, video, document and voice note was stored as `SYSTEM` with
 * no file behind it. The `IMAGE`/`VIDEO`/`DOCUMENT` enum values existed and were never used for
 * anything inbound, `mediaUrl` was never set, and the Inbox rendered the literal string
 * `[SYSTEM]` to an agent who had no way to see what the customer had sent.
 */

describe('typing an inbound message', () => {
  it('**gives media its real type instead of SYSTEM**', () => {
    expect(messageTypeOf('image')).toBe('IMAGE');
    expect(messageTypeOf('video')).toBe('VIDEO');
    expect(messageTypeOf('document')).toBe('DOCUMENT');
    expect(messageTypeOf('audio')).toBe('AUDIO');
  });

  it('files a sticker as an image and a voice note as audio', () => {
    // Both are media Meta labels separately; nothing downstream benefits from the distinction,
    // and giving them their own types would mean two more cases in every renderer.
    expect(messageTypeOf('sticker')).toBe('IMAGE');
    expect(messageTypeOf('voice')).toBe('AUDIO');
  });

  it('leaves the existing types alone', () => {
    expect(messageTypeOf('text')).toBe('TEXT');
    expect(messageTypeOf('interactive')).toBe('INTERACTIVE');
    expect(messageTypeOf('button')).toBe('INTERACTIVE');
    expect(messageTypeOf('location')).toBe('LOCATION');
  });

  it('**still says SYSTEM for something genuinely unhandled**', () => {
    // Contacts, reactions, order messages. SYSTEM is the honest answer for those — the bug was
    // that it was also the answer for a photograph.
    expect(messageTypeOf('reaction')).toBe('SYSTEM');
    expect(messageTypeOf('contacts')).toBe('SYSTEM');
    expect(messageTypeOf('something-meta-adds-next-year')).toBe('SYSTEM');
  });

  it('knows which types carry a file worth fetching', () => {
    for (const type of ['image', 'video', 'document', 'audio', 'sticker', 'voice']) {
      expect(isMediaType(type), type).toBe(true);
    }
    for (const type of ['text', 'interactive', 'location', 'reaction']) {
      expect(isMediaType(type), type).toBe(false);
    }
  });
});

describe('describing a file with no caption', () => {
  it('**says what arrived, rather than nothing at all**', () => {
    // The body used to be an empty string, which reached the router as no message and got the
    // generic fallback — reading to the customer as though the photo never arrived.
    expect(describeMedia('IMAGE')).toBe('[photo]');
    expect(describeMedia('VIDEO')).toBe('[video]');
    expect(describeMedia('AUDIO')).toBe('[voice message]');
  });

  it('names a document, because which one matters', () => {
    expect(describeMedia('DOCUMENT', 'invoice-4471.pdf')).toBe('[document: invoice-4471.pdf]');
    expect(describeMedia('DOCUMENT')).toBe('[document]');
  });
});

describe('where a file is stored', () => {
  const TENANT = 'aaaaaaaa-1111-4111-8111-111111111111';

  it('**puts the tenant first**, so one workspace is one prefix', () => {
    // What makes "how much is this workspace storing" and "delete everything for them" single
    // operations rather than a scan of the whole bucket.
    const key = storageKeyFor({ tenantId: TENANT, purpose: 'inbound', id: 'abc', extension: 'jpeg' });
    expect(key.startsWith(`tenants/${TENANT}/inbound/`)).toBe(true);
    expect(key.endsWith('/abc.jpeg')).toBe(true);
  });

  it('separates what a customer sent from what the business uploaded', () => {
    const inbound = storageKeyFor({ tenantId: TENANT, purpose: 'inbound', id: 'a' });
    const upload = storageKeyFor({ tenantId: TENANT, purpose: 'upload', id: 'a' });
    expect(inbound).not.toBe(upload);
    expect(inbound).toContain('/inbound/');
    expect(upload).toContain('/upload/');
  });

  it('dates the path, so no single prefix grows without limit', () => {
    const key = storageKeyFor({ tenantId: TENANT, purpose: 'inbound', id: 'a' });
    expect(key).toMatch(new RegExp(`^tenants/${TENANT}/inbound/\\d{4}/\\d{2}/a$`));
  });

  it('**cannot be talked out of the tenant prefix by a hostile extension**', () => {
    // The extension is the only part derived from anything a customer influences — it comes
    // from the MIME type Meta reports. Stripping it to alphanumerics means a crafted value
    // cannot climb out of the prefix or invent a second one.
    const key = storageKeyFor({
      tenantId: TENANT, purpose: 'inbound', id: 'a', extension: '../../etc/passwd',
    });

    // The property is structural, not lexical: the letters of "etc" surviving as part of an
    // extension is harmless, and asserting they do not is testing the wrong thing. What must
    // not survive is a separator or a traversal — either would let a key address an object
    // outside its workspace's prefix.
    expect(key.startsWith(`tenants/${TENANT}/inbound/`)).toBe(true);
    expect(key.split('/')).toHaveLength(6);
    expect(key.split('/')).not.toContain('..');
    expect(key).toMatch(new RegExp(`^tenants/${TENANT}/inbound/\\d{4}/\\d{2}/a\\.[a-z0-9]+$`));
  });

  it('copes with no extension at all', () => {
    expect(storageKeyFor({ tenantId: TENANT, purpose: 'inbound', id: 'a', extension: null }))
      .toMatch(/\/a$/);
  });
});
