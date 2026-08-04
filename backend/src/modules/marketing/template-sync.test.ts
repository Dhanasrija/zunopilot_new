import { describe, expect, it } from 'vitest';
import {
  bodyOf, buttonsOf, categoryOf, footerTextOf, headerFormatOf, headerTextOf, statusOf,
  variablesOf,
} from './template-sync.service.js';

// Reading an approved template out of Meta's `components` array.
//
// These are the pure parsers, tested without a database because that is all they need. They
// had no coverage at all until the campaign screen started rendering a preview from them —
// and a preview is a claim about what several hundred people are about to receive, so being
// quietly wrong here is worse than being obviously broken.

describe('the header format', () => {
  it('reads the format off the HEADER component', () => {
    expect(headerFormatOf([{ type: 'HEADER', format: 'IMAGE' }])).toBe('IMAGE');
    expect(headerFormatOf([{ type: 'HEADER', format: 'TEXT' }])).toBe('TEXT');
  });

  it('is NONE when there is no header', () => {
    expect(headerFormatOf([{ type: 'BODY', text: 'Hello' }])).toBe('NONE');
  });

  it('maps a LOCATION header to NONE rather than guessing', () => {
    // Nothing here can supply a lat/long, so such a template must simply not be pickable.
    // Mapping it to a media slot would offer a file it will never accept.
    expect(headerFormatOf([{ type: 'HEADER', format: 'LOCATION' }])).toBe('NONE');
  });

  it('tolerates Meta returning lower case', () => {
    expect(headerFormatOf([{ type: 'header', format: 'document' }])).toBe('DOCUMENT');
  });
});

describe('the header text', () => {
  it('is the text of a TEXT header', () => {
    expect(headerTextOf([{ type: 'HEADER', format: 'TEXT', text: 'Diwali week' }]))
      .toBe('Diwali week');
  });

  it('**is null for a media header, even when Meta sends text**', () => {
    // A media header's `text` is sometimes the approval sample's filename. Rendering it
    // would put "sample-diwali-banner.png" at the top of the preview as though the customer
    // would read it.
    expect(headerTextOf([
      { type: 'HEADER', format: 'IMAGE', text: 'sample-diwali-banner.png' },
    ])).toBeNull();
  });

  it('is null when there is no header at all', () => {
    expect(headerTextOf([{ type: 'BODY', text: 'Hello' }])).toBeNull();
  });

  it('treats a whitespace-only header as absent', () => {
    expect(headerTextOf([{ type: 'HEADER', format: 'TEXT', text: '   ' }])).toBeNull();
  });
});

describe('the body', () => {
  it('is the BODY component text', () => {
    expect(bodyOf([{ type: 'HEADER', format: 'TEXT', text: 'Hi' }, { type: 'BODY', text: 'Offer' }]))
      .toBe('Offer');
  });

  it('is empty when there is no body — the caller skips such a template', () => {
    expect(bodyOf([{ type: 'FOOTER', text: 'Reply STOP' }])).toBe('');
  });
});

describe('the footer', () => {
  it('is the FOOTER component text', () => {
    expect(footerTextOf([{ type: 'FOOTER', text: 'Reply STOP to opt out' }]))
      .toBe('Reply STOP to opt out');
  });

  it('is null when absent', () => {
    expect(footerTextOf([{ type: 'BODY', text: 'Hello' }])).toBeNull();
  });
});

describe('the buttons', () => {
  const group = (buttons: Array<{ type?: string; text?: string }>) =>
    buttonsOf([{ type: 'BUTTONS', buttons }]);

  it('keeps the label and the kind, in order', () => {
    expect(group([
      { type: 'QUICK_REPLY', text: 'Order now' },
      { type: 'URL', text: 'See the menu' },
    ])).toEqual([
      { type: 'QUICK_REPLY', text: 'Order now' },
      { type: 'URL', text: 'See the menu' },
    ]);
  });

  it('**keeps a kind it does not recognise**', () => {
    // The customer really will see that button. A preview missing a row is a preview that
    // lies about the shape of the message.
    expect(group([{ type: 'SOMETHING_NEW', text: 'Tap here' }]))
      .toEqual([{ type: 'SOMETHING_NEW', text: 'Tap here' }]);
  });

  it('drops a button with no label, which would render as an empty row', () => {
    expect(group([{ type: 'QUICK_REPLY', text: '  ' }, { type: 'URL', text: 'Menu' }]))
      .toEqual([{ type: 'URL', text: 'Menu' }]);
  });

  it('names a missing type rather than storing undefined', () => {
    expect(group([{ text: 'Tap' }])).toEqual([{ type: 'UNKNOWN', text: 'Tap' }]);
  });

  it('is empty when there is no BUTTONS component', () => {
    expect(buttonsOf([{ type: 'BODY', text: 'Hello' }])).toEqual([]);
  });

  it('caps at ten, which is Meta\'s own limit', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ type: 'QUICK_REPLY', text: `B${i}` }));
    expect(group(many)).toHaveLength(10);
  });
});

describe('the placeholders', () => {
  it('are de-duplicated and sorted numerically', () => {
    // `{{10}}` must not sort between `{{1}}` and `{{2}}`, which a lexical sort would do.
    expect(variablesOf('Hi {{2}}, {{10}} off at {{1}} — {{2}}'))
      .toEqual(['1', '2', '10']);
  });

  it('tolerates spaces inside the braces', () => {
    expect(variablesOf('Hi {{ 1 }}')).toEqual(['1']);
  });

  it('is empty for a body with none', () => {
    expect(variablesOf('20% off this week')).toEqual([]);
  });
});

describe('the category', () => {
  it('passes MARKETING through', () => {
    expect(categoryOf('MARKETING')).toBe('MARKETING');
  });

  it('**maps AUTHENTICATION to UTILITY, never MARKETING**', () => {
    // The campaign picker only offers MARKETING, so this is what stops an OTP template from
    // ever being broadcast to a list.
    expect(categoryOf('AUTHENTICATION')).toBe('UTILITY');
  });

  it('maps an unknown category to UTILITY', () => {
    expect(categoryOf(undefined)).toBe('UTILITY');
    expect(categoryOf('SOMETHING_NEW')).toBe('UTILITY');
  });
});

describe('the status', () => {
  it('passes APPROVED through', () => {
    expect(statusOf('APPROVED')).toBe('APPROVED');
  });

  it('treats DISABLED and PAUSED as REJECTED', () => {
    expect(statusOf('DISABLED')).toBe('REJECTED');
    expect(statusOf('PAUSED')).toBe('REJECTED');
  });

  it('**fails closed: anything unrecognised is PENDING, never APPROVED**', () => {
    // `startCampaign` refuses a template that is not APPROVED. Guessing APPROVED for a status
    // we do not understand would let a campaign start against a template Meta rejects on
    // every single message.
    expect(statusOf('SOMETHING_NEW')).toBe('PENDING');
    expect(statusOf(undefined)).toBe('PENDING');
  });
});
