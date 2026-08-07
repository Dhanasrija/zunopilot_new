import { describe, expect, it } from 'vitest';
import { rejectReason, type MediaRules } from './media';

/*
 * Whether a file can be sent, decided before it is uploaded.
 *
 * **The failure this prevents.** An oversized video reached nginx, which caps the request body
 * and answers 413 with its own HTML page — no message for the client to read, so the agent saw
 * "Request failed with status code 413" after waiting out the whole upload. The limits are the
 * server's, fetched from `GET /media/rules`; this only applies them earlier.
 */

const RULES: MediaRules = {
  kinds: {
    IMAGE: { mimeTypes: ['image/jpeg', 'image/png'], maxBytes: 5 * 1024 * 1024, label: 'JPEG or PNG, up to 5 MB' },
    VIDEO: { mimeTypes: ['video/mp4', 'video/3gpp'], maxBytes: 16 * 1024 * 1024, label: 'MP4 or 3GPP, up to 16 MB' },
    DOCUMENT: { mimeTypes: ['application/pdf'], maxBytes: 16 * 1024 * 1024, label: 'PDF, up to 16 MB' },
  },
  publicUrlReachable: true,
};

/** A file of a given size without allocating it — only `size` is read. */
const fileOf = (name: string, type: string, bytes: number): File => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
};

describe('a file that is too big', () => {
  it('**is refused, with its size and the limit**', () => {
    const reason = rejectReason(fileOf('holiday.mp4', 'video/mp4', 42 * 1024 * 1024), RULES);
    expect(reason).toContain('42.0 MB');
    expect(reason).toContain('up to 16 MB');
  });

  it('applies the limit for its own kind, not the largest one going', () => {
    // 8 MB is fine for a video and not for an image. One shared ceiling would let a photo
    // through that Meta then refuses at send time, once per recipient.
    const eightMb = 8 * 1024 * 1024;
    expect(rejectReason(fileOf('a.mp4', 'video/mp4', eightMb), RULES)).toBeNull();
    expect(rejectReason(fileOf('a.png', 'image/png', eightMb), RULES)).toContain('up to 5 MB');
  });

  it('allows a file exactly on the limit', () => {
    // The boundary is Meta's own, and a video at exactly 16 MB is one WhatsApp accepts.
    expect(rejectReason(fileOf('a.mp4', 'video/mp4', 16 * 1024 * 1024), RULES)).toBeNull();
  });
});

describe('a file of the wrong sort', () => {
  it('names what would work instead of just saying no', () => {
    const reason = rejectReason(fileOf('clip.webm', 'video/webm', 1024), RULES);
    // WebM looks like a video and Meta refuses it, which is exactly the confusing case.
    expect(reason).toContain('video/webm');
    expect(reason).toContain('MP4 or 3GPP');
  });

  it('copes with a file the browser could not type', () => {
    const reason = rejectReason(fileOf('notes', '', 1024), RULES);
    expect(reason).toContain('cannot be identified');
  });
});

describe('before the rules have loaded', () => {
  it('**lets it through, rather than guessing**', () => {
    // The server is the authority. Refusing on a hunch would block a perfectly good file
    // whenever `/media/rules` was slow.
    expect(rejectReason(fileOf('a.mp4', 'video/mp4', 999 * 1024 * 1024), undefined)).toBeNull();
  });
});
