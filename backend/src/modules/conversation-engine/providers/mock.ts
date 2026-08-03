import type {
  HttpCaller, LlmCompleter, MockIntegration, NodeServices, WhatsAppSender,
} from '../engine/types.js';

// Mock providers.
//
// These exist so the engine, the routing suite and the simulator can be
// exercised with no Meta credentials, no OpenAI key, no network, and no cost —
// and, more importantly, so a test run can never message a real person. `env.ts`
// selects them automatically under NODE_ENV=test.
//
// Everything here is deterministic. A mock that returned random or time-varying
// data would make the tests that depend on it flaky, which is worse than no
// test at all.

export interface RecordedMessage {
  to: string;
  kind: 'text' | 'buttons' | 'list' | 'template';
  body: string;
  meta?: Record<string, unknown>;
}

/**
 * Records outbound messages instead of sending them.
 *
 * The recording is the assertion surface: a test says "the flow asked for a
 * speciality" by inspecting `sent`, which is far more robust than asserting on
 * internal state.
 */
export class MockWhatsAppProvider implements WhatsAppSender {
  readonly sent: RecordedMessage[] = [];
  private counter = 0;

  private nextId(): string {
    this.counter += 1;
    return `wamid.mock.${this.counter}`;
  }

  async sendText({ to, body }: { to: string; body: string }) {
    this.sent.push({ to, kind: 'text', body });
    return { messageId: this.nextId() };
  }

  async sendButtons({ to, body, buttons }: {
    to: string; body: string; buttons: Array<{ id: string; title: string }>;
  }) {
    this.sent.push({ to, kind: 'buttons', body, meta: { buttons } });
    return { messageId: this.nextId() };
  }

  async sendList({ to, body, button, sections }: {
    to: string;
    body: string;
    button: string;
    sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
  }) {
    this.sent.push({ to, kind: 'list', body, meta: { button, sections } });
    return { messageId: this.nextId() };
  }

  async sendTemplate({ to, templateName, language, params }: {
    to: string; templateName: string; language: string; params: string[];
  }) {
    this.sent.push({ to, kind: 'template', body: templateName, meta: { language, params } });
    return { messageId: this.nextId() };
  }

  /** Message bodies in order — the usual thing a test wants to assert on. */
  bodies(): string[] {
    return this.sent.map((m) => m.body);
  }

  reset(): void {
    this.sent.length = 0;
    this.counter = 0;
  }
}

/** Returns a canned reply. Deterministic so AI_AGENT nodes are testable. */
export class MockLlmProvider implements LlmCompleter {
  readonly calls: Array<{ systemPrompt: string; userPrompt: string }> = [];

  constructor(private readonly reply = 'This is a mock assistant reply.') {}

  async complete({ systemPrompt, userPrompt }: { systemPrompt: string; userPrompt: string }) {
    this.calls.push({ systemPrompt, userPrompt });
    return {
      text: this.reply,
      model: 'mock-llm',
      tokenUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
  }
}

/** Refuses every call — the engine should never reach real HTTP in a test. */
export class MockHttpCaller implements HttpCaller {
  async request(): Promise<{ status: number; body: unknown; ok: boolean }> {
    throw new Error('Real HTTP is disabled in this environment; use a mockService');
  }
}

// ── Domain mock integrations ─────────────────────────────────────────────────

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const readInput = (input: Record<string, unknown>): Record<string, unknown> => {
  const body = input.body;
  const query = input.query;
  return {
    ...(body && typeof body === 'object' ? body as Record<string, unknown> : {}),
    ...(query && typeof query === 'object' ? query as Record<string, unknown> : {}),
  };
};

export const mockDoctorAvailability: MockIntegration = {
  name: 'doctorAvailability',
  async call(input) {
    const args = readInput(input);
    const speciality = asString(args.speciality, 'General Medicine');
    const date = asString(args.date, '2026-08-05');
    // Fixed slots: a test asserting "the customer was offered 10:00" must not
    // depend on when it ran.
    return {
      doctor: speciality.toLowerCase().includes('cardio') ? 'Dr Rao' : 'Dr Mehta',
      speciality,
      date,
      slots: ['10:00', '11:30', '16:00'],
    };
  },
};

export const mockAppointmentService: MockIntegration = {
  name: 'appointments',
  async call(input) {
    const args = readInput(input);
    return {
      appointmentId: 'APT-100234',
      status: 'CONFIRMED',
      doctor: asString(args.doctor, 'Dr Rao'),
      date: asString(args.date, '2026-08-05'),
      slot: asString(args.slot, '10:00'),
      patientName: asString(args.patient_name, 'Patient'),
    };
  },
};

export const mockBillingService: MockIntegration = {
  name: 'billing',
  async call(input) {
    const args = readInput(input);
    const invoice = asString(args.invoice_number, 'INV-0001');
    return {
      invoiceNumber: invoice,
      status: 'UNPAID',
      amount: 4850,
      currency: 'INR',
      dueDate: '2026-08-15',
      breakdown: [
        { item: 'Consultation', amount: 800 },
        { item: 'Diagnostics', amount: 3200 },
        { item: 'Pharmacy', amount: 850 },
      ],
    };
  },
};

export const mockLabReportService: MockIntegration = {
  name: 'labReports',
  async call(input) {
    const args = readInput(input);
    const reference = asString(args.test_reference, 'LAB-77120');
    // Keyed off the reference so a test can deterministically pick the
    // ready and not-ready branches.
    const ready = !reference.toUpperCase().endsWith('X');
    return {
      testReference: reference,
      patientId: asString(args.patient_id, 'PID-4471'),
      ready,
      ...(ready
        ? { reportUrl: `https://reports.acme-hospital.test/${reference}.pdf`, completedAt: '2026-07-30' }
        : { expectedAt: '2026-08-02' }),
    };
  },
};

export const mockCrmService: MockIntegration = {
  name: 'crm',
  async call(input) {
    const args = readInput(input);
    return { ok: true, updated: Object.keys(args), recordId: 'CRM-9001' };
  },
};

export const MOCK_INTEGRATIONS: Record<string, MockIntegration> = {
  doctorAvailability: mockDoctorAvailability,
  appointments: mockAppointmentService,
  billing: mockBillingService,
  labReports: mockLabReportService,
  crm: mockCrmService,
};

/** A fully-mocked service bundle for tests, the simulator and dry runs. */
export const mockServices = (overrides: Partial<NodeServices> = {}): NodeServices & {
  whatsapp: MockWhatsAppProvider;
} => ({
  whatsapp: new MockWhatsAppProvider(),
  llm: new MockLlmProvider(),
  http: new MockHttpCaller(),
  integrations: MOCK_INTEGRATIONS,
  ...overrides,
}) as NodeServices & { whatsapp: MockWhatsAppProvider };
