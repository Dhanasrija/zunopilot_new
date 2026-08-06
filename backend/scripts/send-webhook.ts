#!/usr/bin/env tsx
import crypto from 'node:crypto';
import { env } from '../src/config/env.js';

// Post a signed WhatsApp webhook at the local server.
//
// The webhook now verifies Meta's X-Hub-Signature-256, which it must: the dev
// tunnel puts that endpoint on the public internet, so an unsigned endpoint is
// one anyone can inject messages into. That verification would otherwise break
// the established way of testing this system — posting a webhook with a
// `+1 555` sender, which Meta accepts and never delivers — so this signs the
// request the same way Meta does.
//
// Usage:
//   npx tsx scripts/send-webhook.ts "I want to book a cardiologist"
//   npx tsx scripts/send-webhook.ts --from 15550001234 --phone-id 109085305409874 "menu"
//   npx tsx scripts/send-webhook.ts --button CONFIRM_BOOKING
//   npx tsx scripts/send-webhook.ts --list "cat:8f2c…"      # tap a list row
//
// Defaults to 15550009911: the +1 555 range is reserved for fiction, never
// assigned, and is not on the test number's allowlist.

interface Args {
  text: string;
  from: string;
  phoneId: string;
  button: string | null;
  list: string | null;
  url: string;
  name: string;
}

const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    text: '',
    from: '15550009911',
    phoneId: process.env.TEST_PHONE_NUMBER_ID ?? '',
    button: null,
    list: null,
    url: `${env.appUrl}/api/webhook`,
    name: 'Test Sender',
  };

  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const next = () => argv[++i] ?? '';
    switch (arg) {
      case '--from': args.from = next(); break;
      case '--phone-id': args.phoneId = next(); break;
      case '--button': args.button = next(); break;
      case '--list': args.list = next(); break;
      case '--url': args.url = next(); break;
      case '--name': args.name = next(); break;
      default: rest.push(arg);
    }
  }
  args.text = rest.join(' ');
  return args;
};

const buildPayload = (args: Args) => {
  const timestamp = Math.floor(Date.now() / 1000);
  // Unique per run so the (source, externalEventId) dedupe gate does not
  // swallow a repeated test.
  const id = `wamid.test.${timestamp}.${Math.random().toString(36).slice(2, 8)}`;

  const base = { from: args.from, id, timestamp: String(timestamp) };

  // Meta's own shapes, not ours. `ordering.service.ts` and
  // `automation.service.ts` read `interactive.list_reply.id` straight off the
  // stored payload, so a helper that invented a tidier shape would test a path
  // production never takes.
  const message = args.button
    ? {
      ...base,
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: args.button, title: args.text || args.button } },
    }
    : args.list
      ? {
        ...base,
        type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: args.list, title: args.text || args.list } },
      }
      : {
        ...base,
        type: 'text',
        text: { body: args.text },
      };

  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'test-waba',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550292978', phone_number_id: args.phoneId },
          contacts: [{ profile: { name: args.name }, wa_id: args.from }],
          messages: [message],
        },
      }],
    }],
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  if (!args.text && !args.button && !args.list) {
    console.error('Give a message body, or --button <PAYLOAD>, or --list <ROW_ID>.\n');
    console.error('  npx tsx scripts/send-webhook.ts "I want to book a cardiologist"');
    process.exit(1);
  }

  if (!args.phoneId) {
    console.error('No phone number id. Pass --phone-id, or set TEST_PHONE_NUMBER_ID.');
    console.error('Find it with:');
    console.error('  psql -d whatsapp_automation -tAc \'SELECT "phoneNumberId" FROM "WhatsappAccount" LIMIT 1;\'');
    process.exit(1);
  }

  const body = JSON.stringify(buildPayload(args));

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.meta.appSecret) {
    // Signed over the exact bytes sent, which is what the server re-computes.
    const digest = crypto.createHmac('sha256', env.meta.appSecret).update(body).digest('hex');
    headers['X-Hub-Signature-256'] = `sha256=${digest}`;
  } else {
    console.warn('META_APP_SECRET is not set — sending unsigned (the server will accept it).');
  }

  const response = await fetch(args.url, { method: 'POST', headers, body });

  console.log(`${response.status} ${response.statusText}  →  ${args.url}`);
  if (response.status === 401) {
    console.error('Rejected: the signature did not match. Is META_APP_SECRET the same one the server loaded?');
    process.exit(1);
  }
  const what = args.button ? `button "${args.button}"`
    : args.list ? `list row "${args.list}"`
      : `"${args.text}"`;
  console.log(`sent ${what} from ${args.from}`);
};

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
