import { PrismaClient, Prisma, UserRole } from '@prisma/client';
import type { WorkflowDefinition } from '../src/modules/conversation-engine/domain/definition.js';
import type { CapabilityContract } from '../src/modules/conversation-engine/domain/capability.js';
import { validateWorkflowDefinition } from '../src/modules/conversation-engine/validation/definition-validator.js';
import { assertSeedable } from './guard.js';

// Acme Hospital — the conversation engine demo.
//
// Seeded as a SECOND tenant, alongside Demo Biryani House, which keeps the
// restaurant tenant on the legacy path untouched. Running this is safe and
// idempotent: it deletes and recreates only its own tenant.
//
// Every workflow here is validated against the real publish validator before it
// is written. A seed that produces a graph the product would refuse to publish
// is worse than no seed — it teaches the wrong shape and hides regressions.
//
// Every integration is a mock. Nothing seeded can reach the public internet.

const prisma = new PrismaClient();

const TENANT_ID = '22222222-2222-2222-2222-222222222222';
const CHANNEL_PHONE_ID = 'acme-hospital-mock-channel';
/** Owner's sign-in number. Reserved US 555 range — see the `phone` comment below. */
const OWNER_PHONE = '15550002001';

const node = (
  id: string,
  type: string,
  config: Record<string, unknown>,
  position: { x: number; y: number },
  name?: string,
) => ({ id, type, config, position, ...(name ? { name } : {}) });

const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}->${target}${sourceHandle ? `:${sourceHandle}` : ''}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});

// ── 1. Appointment Booking ────────────────────────────────────────────────────

const appointmentBooking: { definition: WorkflowDefinition; capability: CapabilityContract } = {
  definition: {
    schemaVersion: '1.0',
    entryNodeId: 'entry',
    nodes: [
      node('entry', 'ASSISTANT_ROUTE_ENTRY', { acceptedIntents: ['book_appointment'] }, { x: 400, y: 40 }, 'Assistant Route Entry'),
      node('ask_speciality', 'ASK_USER_INPUT', {
        prompt: 'Which speciality or doctor would you like to consult?',
        variableName: 'speciality',
        inputType: 'string',
        required: true,
        validation: { minLength: 3 },
        retryMessage: 'Please give a speciality or doctor name, for example "Cardiology" or "Dr Rao".',
        maxRetries: 3,
      }, { x: 400, y: 170 }, 'Ask Speciality'),
      node('ask_date', 'ASK_USER_INPUT', {
        prompt: 'What date works for you? (for example 2026-08-05)',
        variableName: 'preferred_date',
        inputType: 'date',
        required: true,
        retryMessage: "I couldn't read that as a date. Please use a format like 2026-08-05.",
        maxRetries: 3,
      }, { x: 400, y: 300 }, 'Ask Preferred Date'),
      node('check_availability', 'HTTP_REQUEST', {
        method: 'GET',
        url: 'https://api.acme-hospital.test/availability',
        query: { speciality: '{{vars.speciality}}', date: '{{vars.preferred_date}}' },
        mockService: 'doctorAvailability',
        outputVariable: 'availability',
      }, { x: 400, y: 430 }, 'Check Availability'),
      node('send_slots', 'SEND_WHATSAPP_MESSAGE', {
        body: '{{vars.availability.doctor}} ({{vars.availability.speciality}}) has these slots on {{vars.availability.date}}: {{vars.availability.slots}}',
      }, { x: 400, y: 560 }, 'Send Available Slots'),
      node('ask_slot', 'ASK_USER_INPUT', {
        prompt: 'Which time would you like? Reply with one of the slots above.',
        variableName: 'slot',
        inputType: 'string',
        required: true,
        validation: { minLength: 4 },
        retryMessage: 'Please reply with one of the times listed above, for example 10:00.',
        maxRetries: 3,
      }, { x: 400, y: 690 }, 'Ask Preferred Slot'),
      node('ask_name', 'ASK_USER_INPUT', {
        prompt: "And the patient's full name?",
        variableName: 'patient_name',
        inputType: 'string',
        required: true,
        validation: { minLength: 2 },
        maxRetries: 3,
      }, { x: 400, y: 820 }, 'Ask Patient Name'),
      // The confirmation step. The capability declares a side effect, so the
      // publish validator requires this — and it is the reason an availability
      // question can never silently become a booking.
      node('confirm', 'ASK_USER_INPUT', {
        prompt: 'Please confirm: {{vars.patient_name}} with {{vars.availability.doctor}} on {{vars.preferred_date}} at {{vars.slot}}. Reply YES to confirm or NO to cancel.',
        variableName: 'confirmation',
        inputType: 'choice',
        required: true,
        validation: { choices: ['yes', 'no'] },
        retryMessage: 'Please reply YES to confirm or NO to cancel.',
        maxRetries: 3,
      }, { x: 400, y: 950 }, 'Show Confirmation'),
      node('confirmed', 'CONDITION', {
        left: '{{vars.confirmation}}', op: 'equals', right: 'yes',
      }, { x: 400, y: 1080 }, 'Confirmed?'),
      node('create_appointment', 'HTTP_REQUEST', {
        method: 'POST',
        url: 'https://api.acme-hospital.test/appointments',
        body: {
          doctor: '{{vars.availability.doctor}}',
          date: '{{vars.preferred_date}}',
          slot: '{{vars.slot}}',
          patient_name: '{{vars.patient_name}}',
        },
        mockService: 'appointments',
        outputVariable: 'appointment',
      }, { x: 200, y: 1210 }, 'Create Appointment'),
      node('send_confirmation', 'SEND_WHATSAPP_MESSAGE', {
        body: 'Booked. Reference {{vars.appointment.appointmentId}} — {{vars.appointment.doctor}} on {{vars.appointment.date}} at {{vars.appointment.slot}}. See you then.',
      }, { x: 200, y: 1340 }, 'Send Confirmation'),
      node('end_booked', 'END_WORKFLOW', { outcome: 'COMPLETED' }, { x: 200, y: 1470 }, 'End'),
      node('end_cancelled', 'END_WORKFLOW', {
        outcome: 'CANCELLED',
        message: "No problem, I haven't booked anything. Let me know if you'd like to try a different time.",
      }, { x: 620, y: 1210 }, 'Cancelled'),
      // The error branch of the availability lookup. Without it a failed lookup
      // would just end the run silently.
      node('lookup_failed', 'HUMAN_HANDOFF', {
        reason: 'Availability lookup failed',
        message: "I'm having trouble checking the schedule. Let me get a colleague to help.",
      }, { x: 760, y: 560 }, 'Lookup Failed'),
    ],
    edges: [
      edge('entry', 'ask_speciality'),
      edge('ask_speciality', 'ask_date'),
      edge('ask_date', 'check_availability'),
      edge('check_availability', 'send_slots', 'success'),
      edge('check_availability', 'lookup_failed', 'error'),
      edge('send_slots', 'ask_slot'),
      edge('ask_slot', 'ask_name'),
      edge('ask_name', 'confirm'),
      edge('confirm', 'confirmed'),
      edge('confirmed', 'create_appointment', 'yes'),
      edge('confirmed', 'end_cancelled', 'no'),
      edge('create_appointment', 'send_confirmation', 'success'),
      edge('create_appointment', 'lookup_failed', 'error'),
      edge('send_confirmation', 'end_booked'),
    ],
  },
  capability: {
    purpose: 'Create a confirmed doctor appointment',
    description: 'Collects appointment requirements, checks available slots and creates an appointment.',
    useWhen: [
      'The user explicitly wants to book an appointment',
      'The user wants to schedule a consultation',
      'The user wants to reserve a doctor and time slot',
    ],
    doNotUseWhen: [
      'The user only asks whether a doctor is available',
      'The user asks to reschedule an existing appointment',
      'The user asks about billing',
    ],
    positiveExamples: [
      'I want to book a cardiologist appointment',
      'Schedule a consultation for tomorrow',
      'Can you book Dr Rao for Friday?',
    ],
    negativeExamples: [
      'Is Dr Rao available tomorrow?',
      'I want to change my existing appointment',
      'How much is my hospital bill?',
    ],
    requiredInputs: [
      { key: 'speciality', label: 'Speciality', type: 'string' },
      { key: 'preferred_date', label: 'Preferred Date', type: 'date' },
      { key: 'patient_name', label: 'Patient Name', type: 'string' },
    ],
    optionalInputs: [{ key: 'doctor_name', label: 'Doctor Name', type: 'string' }],
    preconditions: ['The user has indicated an intent to create an appointment'],
    sideEffects: ['Creates an appointment record'],
    requiresConfirmation: true,
    minimumConfidence: 0.8,
    allowsInterruption: false,
  },
};

// ── 2. Doctor Availability ────────────────────────────────────────────────────

const doctorAvailability: { definition: WorkflowDefinition; capability: CapabilityContract } = {
  definition: {
    schemaVersion: '1.0',
    entryNodeId: 'entry',
    nodes: [
      node('entry', 'ASSISTANT_ROUTE_ENTRY', { acceptedIntents: ['check_availability'] }, { x: 400, y: 40 }, 'Assistant Route Entry'),
      node('ask_who', 'ASK_USER_INPUT', {
        prompt: 'Which doctor or speciality are you asking about?',
        variableName: 'speciality',
        inputType: 'string',
        required: true,
        validation: { minLength: 3 },
        maxRetries: 3,
      }, { x: 400, y: 170 }, 'Ask Doctor or Speciality'),
      node('ask_date', 'ASK_USER_INPUT', {
        prompt: 'For which date?',
        variableName: 'preferred_date',
        inputType: 'date',
        required: true,
        maxRetries: 3,
      }, { x: 400, y: 300 }, 'Ask Date'),
      node('lookup', 'HTTP_REQUEST', {
        method: 'GET',
        url: 'https://api.acme-hospital.test/availability',
        query: { speciality: '{{vars.speciality}}', date: '{{vars.preferred_date}}' },
        mockService: 'doctorAvailability',
        outputVariable: 'availability',
      }, { x: 400, y: 430 }, 'Check Availability'),
      // Deliberately ends after showing slots. Booking is a separate workflow
      // with its own confirmation step; this one has no side effect at all.
      node('send_slots', 'SEND_WHATSAPP_MESSAGE', {
        body: '{{vars.availability.doctor}} is available on {{vars.availability.date}} at: {{vars.availability.slots}}. Say "book" if you would like me to reserve one.',
      }, { x: 400, y: 560 }, 'Send Available Slots'),
      node('end', 'END_WORKFLOW', { outcome: 'COMPLETED' }, { x: 400, y: 690 }, 'End'),
      node('lookup_failed', 'HUMAN_HANDOFF', {
        reason: 'Availability lookup failed',
        message: "I'm having trouble checking the schedule. Let me get a colleague to help.",
      }, { x: 760, y: 560 }, 'Lookup Failed'),
    ],
    edges: [
      edge('entry', 'ask_who'),
      edge('ask_who', 'ask_date'),
      edge('ask_date', 'lookup'),
      edge('lookup', 'send_slots', 'success'),
      edge('lookup', 'lookup_failed', 'error'),
      edge('send_slots', 'end'),
    ],
  },
  capability: {
    purpose: 'Show available doctors and slots without creating an appointment',
    description: 'Read-only lookup of doctor availability. Never books anything.',
    useWhen: [
      'The user asks whether a doctor is available',
      'The user asks which doctors are free at a given time',
      'The user asks what slots are open',
    ],
    doNotUseWhen: [
      'The user wants to actually book or reserve a slot',
      'The user is confirming an appointment',
    ],
    positiveExamples: [
      'Is Dr Rao available tomorrow?',
      'Which cardiologists are free this evening?',
      'What slots are open on Friday?',
    ],
    negativeExamples: [
      'I want to book a cardiologist appointment',
      'Schedule a consultation for Friday',
    ],
    requiredInputs: [
      { key: 'speciality', label: 'Speciality or Doctor', type: 'string' },
      { key: 'preferred_date', label: 'Date', type: 'date' },
    ],
    optionalInputs: [],
    preconditions: [],
    sideEffects: [],
    requiresConfirmation: false,
    minimumConfidence: 0.7,
    allowsInterruption: true,
  },
};

// ── 3. Billing Support ────────────────────────────────────────────────────────

const billingSupport: { definition: WorkflowDefinition; capability: CapabilityContract } = {
  definition: {
    schemaVersion: '1.0',
    entryNodeId: 'entry',
    nodes: [
      node('entry', 'ASSISTANT_ROUTE_ENTRY', {}, { x: 400, y: 40 }, 'Assistant Route Entry'),
      node('ask_invoice', 'ASK_USER_INPUT', {
        prompt: 'What is your invoice number? (for example INV-0042)',
        variableName: 'invoice_number',
        inputType: 'string',
        required: true,
        validation: { minLength: 3 },
        maxRetries: 3,
      }, { x: 400, y: 170 }, 'Ask Invoice Number'),
      node('lookup', 'HTTP_REQUEST', {
        method: 'GET',
        url: 'https://api.acme-hospital.test/billing',
        query: { invoice_number: '{{vars.invoice_number}}' },
        mockService: 'billing',
        outputVariable: 'invoice',
      }, { x: 400, y: 300 }, 'Billing Lookup'),
      node('send_summary', 'SEND_WHATSAPP_MESSAGE', {
        body: 'Invoice {{vars.invoice.invoiceNumber}}: {{vars.invoice.currency}} {{vars.invoice.amount}}, status {{vars.invoice.status}}, due {{vars.invoice.dueDate}}.',
      }, { x: 400, y: 430 }, 'Send Billing Summary'),
      node('ask_resolved', 'ASK_USER_INPUT', {
        prompt: 'Does that answer your question? Reply YES or NO.',
        variableName: 'resolved',
        inputType: 'choice',
        required: true,
        validation: { choices: ['yes', 'no'] },
        maxRetries: 3,
      }, { x: 400, y: 560 }, 'Resolved?'),
      node('is_resolved', 'CONDITION', {
        left: '{{vars.resolved}}', op: 'equals', right: 'yes',
      }, { x: 400, y: 690 }, 'Unresolved?'),
      node('end', 'END_WORKFLOW', {
        outcome: 'COMPLETED', message: 'Glad that helped. Anything else?',
      }, { x: 200, y: 820 }, 'End'),
      node('handoff', 'HUMAN_HANDOFF', {
        reason: 'Billing question not resolved by the workflow',
        message: 'Let me put you through to our billing team.',
      }, { x: 620, y: 820 }, 'Human Handover'),
      node('lookup_failed', 'HUMAN_HANDOFF', {
        reason: 'Billing lookup failed',
        message: "I can't reach the billing system right now. Let me get someone to help.",
      }, { x: 760, y: 300 }, 'Lookup Failed'),
    ],
    edges: [
      edge('entry', 'ask_invoice'),
      edge('ask_invoice', 'lookup'),
      edge('lookup', 'send_summary', 'success'),
      edge('lookup', 'lookup_failed', 'error'),
      edge('send_summary', 'ask_resolved'),
      edge('ask_resolved', 'is_resolved'),
      edge('is_resolved', 'end', 'yes'),
      edge('is_resolved', 'handoff', 'no'),
    ],
  },
  capability: {
    purpose: 'Help with invoices, payments and refund questions',
    useWhen: [
      'The user asks about an invoice or bill',
      'The user asks about a payment or refund',
      'The user questions a charge',
    ],
    doNotUseWhen: ['The user wants to book or check an appointment', 'The user asks about a lab report'],
    positiveExamples: [
      'Why is my invoice higher?',
      'I need a copy of my bill',
      'When is my payment due?',
    ],
    negativeExamples: ['I want to book an appointment', 'Is my blood report ready?'],
    requiredInputs: [{ key: 'invoice_number', label: 'Invoice Number', type: 'string' }],
    optionalInputs: [],
    preconditions: [],
    sideEffects: [],
    requiresConfirmation: false,
    minimumConfidence: 0.7,
    allowsInterruption: true,
  },
};

// ── 4. Lab Report Assistance ──────────────────────────────────────────────────

const labReports: { definition: WorkflowDefinition; capability: CapabilityContract } = {
  definition: {
    schemaVersion: '1.0',
    entryNodeId: 'entry',
    nodes: [
      node('entry', 'ASSISTANT_ROUTE_ENTRY', {}, { x: 400, y: 40 }, 'Assistant Route Entry'),
      node('ask_patient', 'ASK_USER_INPUT', {
        prompt: 'What is your patient ID?',
        variableName: 'patient_id',
        inputType: 'string',
        required: true,
        validation: { minLength: 3 },
        maxRetries: 3,
      }, { x: 400, y: 170 }, 'Ask Patient ID'),
      node('ask_reference', 'ASK_USER_INPUT', {
        prompt: 'And the test reference number?',
        variableName: 'test_reference',
        inputType: 'string',
        required: true,
        validation: { minLength: 3 },
        maxRetries: 3,
      }, { x: 400, y: 300 }, 'Ask Test Reference'),
      node('lookup', 'HTTP_REQUEST', {
        method: 'GET',
        url: 'https://api.acme-hospital.test/lab-reports',
        query: { patient_id: '{{vars.patient_id}}', test_reference: '{{vars.test_reference}}' },
        mockService: 'labReports',
        outputVariable: 'report',
      }, { x: 400, y: 430 }, 'Report Lookup'),
      node('is_ready', 'CONDITION', {
        left: '{{vars.report.ready}}', op: 'equals', right: 'true',
      }, { x: 400, y: 560 }, 'Ready?'),
      node('send_link', 'SEND_WHATSAPP_MESSAGE', {
        body: 'Your report {{vars.report.testReference}} is ready: {{vars.report.reportUrl}}',
      }, { x: 200, y: 690 }, 'Send Report Link'),
      node('send_status', 'SEND_WHATSAPP_MESSAGE', {
        body: 'Report {{vars.report.testReference}} is not ready yet. Expected {{vars.report.expectedAt}}.',
      }, { x: 620, y: 690 }, 'Send Status'),
      node('end_ready', 'END_WORKFLOW', { outcome: 'COMPLETED' }, { x: 200, y: 820 }, 'End'),
      node('end_pending', 'END_WORKFLOW', { outcome: 'COMPLETED' }, { x: 620, y: 820 }, 'End'),
      node('lookup_failed', 'HUMAN_HANDOFF', {
        reason: 'Lab report lookup failed',
        message: "I can't reach the lab system right now. Let me get someone to help.",
      }, { x: 760, y: 430 }, 'Lookup Failed'),
    ],
    edges: [
      edge('entry', 'ask_patient'),
      edge('ask_patient', 'ask_reference'),
      edge('ask_reference', 'lookup'),
      edge('lookup', 'is_ready', 'success'),
      edge('lookup', 'lookup_failed', 'error'),
      edge('is_ready', 'send_link', 'yes'),
      edge('is_ready', 'send_status', 'no'),
      edge('send_link', 'end_ready'),
      edge('send_status', 'end_pending'),
    ],
  },
  capability: {
    purpose: 'Retrieve lab-report status and download information',
    useWhen: ['The user asks about a lab or test report', 'The user asks whether results are ready'],
    doNotUseWhen: ['The user asks about billing', 'The user wants to book an appointment'],
    positiveExamples: [
      'Is my blood report ready?',
      'Send me my test result',
      'Has my lab report come back?',
    ],
    negativeExamples: ['Why is my invoice higher?', 'I want to book an appointment'],
    requiredInputs: [
      { key: 'patient_id', label: 'Patient ID', type: 'string' },
      { key: 'test_reference', label: 'Test Reference', type: 'string' },
    ],
    optionalInputs: [],
    preconditions: [],
    sideEffects: [],
    requiresConfirmation: false,
    minimumConfidence: 0.7,
    allowsInterruption: true,
  },
};

// ── 5. Human Handoff ──────────────────────────────────────────────────────────

const humanHandoff: { definition: WorkflowDefinition; capability: CapabilityContract } = {
  definition: {
    schemaVersion: '1.0',
    entryNodeId: 'entry',
    nodes: [
      node('entry', 'ASSISTANT_ROUTE_ENTRY', {}, { x: 400, y: 40 }, 'Assistant Route Entry'),
      node('handoff', 'HUMAN_HANDOFF', {
        reason: 'Customer asked for a human',
        message: 'Of course — connecting you with a team member now. They will reply shortly.',
      }, { x: 400, y: 170 }, 'Human Handover'),
    ],
    edges: [edge('entry', 'handoff')],
  },
  capability: {
    purpose: 'Transfer the conversation to a human support agent',
    useWhen: ['The user explicitly asks to speak to a person', 'The user is frustrated and wants escalation'],
    doNotUseWhen: ['The user mentions staff in passing', 'The user says they do not need an agent'],
    positiveExamples: [
      'I want to speak with a person',
      'Connect me to your manager',
      'Can I talk to someone real?',
    ],
    negativeExamples: ['Your agent was lovely last time', 'No need for an agent, thanks'],
    requiredInputs: [],
    optionalInputs: [],
    preconditions: [],
    sideEffects: [],
    requiresConfirmation: false,
    minimumConfidence: 0.75,
    allowsInterruption: true,
  },
};

const WORKFLOWS = [
  { slug: 'appointment_booking', name: 'Appointment Booking', priority: 70, ...appointmentBooking },
  { slug: 'doctor_availability', name: 'Doctor Availability', priority: 60, ...doctorAvailability },
  { slug: 'billing_support', name: 'Billing Support', priority: 50, ...billingSupport },
  { slug: 'lab_reports', name: 'Lab Report Assistance', priority: 50, ...labReports },
  { slug: 'human_handoff', name: 'Human Handoff', priority: 90, ...humanHandoff },
];

const ROUTING_TESTS: Array<{ message: string; expect: string | null; decision: 'START_WORKFLOW' | 'HUMAN_HANDOFF' | 'ASK_CLARIFICATION' }> = [
  { message: 'I want to book a cardiologist tomorrow', expect: 'appointment_booking', decision: 'START_WORKFLOW' },
  { message: 'Schedule a consultation for Friday', expect: 'appointment_booking', decision: 'START_WORKFLOW' },
  { message: 'Is Dr Rao available tomorrow?', expect: 'doctor_availability', decision: 'START_WORKFLOW' },
  { message: 'Which cardiologists are free this evening?', expect: 'doctor_availability', decision: 'START_WORKFLOW' },
  { message: 'Why is my invoice higher?', expect: 'billing_support', decision: 'START_WORKFLOW' },
  { message: 'I need a copy of my bill', expect: 'billing_support', decision: 'START_WORKFLOW' },
  { message: 'Is my blood report ready?', expect: 'lab_reports', decision: 'START_WORKFLOW' },
  { message: 'Send me my test result', expect: 'lab_reports', decision: 'START_WORKFLOW' },
  { message: 'I want to speak with a person', expect: null, decision: 'HUMAN_HANDOFF' },
  { message: 'Connect me to your manager', expect: null, decision: 'HUMAN_HANDOFF' },
  { message: 'Can I see available doctors and book one?', expect: null, decision: 'ASK_CLARIFICATION' },
  { message: 'I have a billing issue and also need an appointment', expect: null, decision: 'ASK_CLARIFICATION' },
];

const main = async () => {
  assertSeedable({ script: 'seed-hospital' });
  // Idempotent, and scoped: only Acme Hospital is removed and rebuilt.
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });

  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT_ID,
      businessName: 'Acme Hospital',
      businessCategory: { connect: { key: 'ECOMMERCE_GROCERY' } },
      // Onboarding is not part of a demo; these workspaces are set up by definition.
      onboardingCompletedAt: new Date(),
      contactNumber: '+911140001234',
      address: '4 Nehru Place, New Delhi',
      users: {
        create: {
          // The login identifier. Drawn from the reserved US 555 range, which is
          // set aside for fiction and routes to no handset — so a seed that runs
          // on every reset can never send a real person a code, and can never
          // collide with a real customer's number on the global unique index.
          phone: OWNER_PHONE,
          email: 'owner@acmehospital.test',
          // No passwordHash: customers sign in with a phone and a one-time code,
          // and no login path accepts a password. Seeding one would only suggest
          // a credential that does not work.
          fullName: 'Acme Owner',
          role: UserRole.OWNER,
          emailVerified: true,
        },
      },
    },
  });

  const channel = await prisma.whatsappAccount.create({
    data: {
      tenantId: tenant.id,
      wabaId: 'acme-hospital-mock-waba',
      phoneNumberId: CHANNEL_PHONE_ID,
      displayPhone: '+1 555 010 2030',
      businessName: 'Acme Hospital',
      // Not a real credential. This channel is only ever served by the mock
      // provider, which ignores it entirely.
      accessToken: 'mock-token-not-a-credential',
    },
  });

  const assistant = await prisma.assistant.create({
    data: {
      tenantId: tenant.id,
      whatsappChannelId: channel.id,
      name: 'Acme Hospital WhatsApp Assistant',
      description: 'Answers patient enquiries on WhatsApp and routes them to the right journey.',
      generalSystemPrompt: 'You are the WhatsApp assistant for Acme Hospital. Be brief, warm and factual. Never give medical advice.',
      generalResponseEnabled: true,
      highConfidenceThreshold: 0.8,
      mediumConfidenceThreshold: 0.55,
      maxRecentMessages: 8,
      status: 'ACTIVE',
    },
  });

  const created: Record<string, string> = {};

  for (const spec of WORKFLOWS) {
    // Validate with the real publish validator before writing. A seeded graph
    // the product would reject is a bug in the seed, not something to discover
    // the first time someone opens the canvas.
    const result = validateWorkflowDefinition({
      definition: spec.definition,
      category: 'CONVERSATION',
      capability: spec.capability,
      slug: spec.slug,
      siblingSlugs: Object.keys(created),
    });

    const errors = result.issues.filter((i) => i.level === 'error');
    if (errors.length) {
      throw new Error(
        `Seed workflow "${spec.slug}" would fail validation:\n`
        + errors.map((e) => `  • [${e.code}] ${e.message}`).join('\n'),
      );
    }
    for (const warning of result.issues.filter((i) => i.level === 'warning')) {
      console.warn(`  ⚠ ${spec.slug}: ${warning.message}`);
    }

    const workflow = await prisma.workflow.create({
      data: {
        tenantId: tenant.id,
        assistantId: assistant.id,
        name: spec.name,
        slug: spec.slug,
        description: spec.capability.purpose,
        category: 'CONVERSATION',
        status: 'PUBLISHED',
        priority: spec.priority,
        publishedAt: new Date(),
        capability: {
          create: {
            purpose: spec.capability.purpose,
            description: spec.capability.description ?? null,
            useWhen: spec.capability.useWhen,
            doNotUseWhen: spec.capability.doNotUseWhen,
            positiveExamples: spec.capability.positiveExamples,
            negativeExamples: spec.capability.negativeExamples,
            requiredInputs: spec.capability.requiredInputs as unknown as Prisma.InputJsonValue,
            optionalInputs: spec.capability.optionalInputs as unknown as Prisma.InputJsonValue,
            preconditions: spec.capability.preconditions,
            sideEffects: spec.capability.sideEffects,
            requiresConfirmation: spec.capability.requiresConfirmation,
            minimumConfidence: spec.capability.minimumConfidence,
            allowsInterruption: spec.capability.allowsInterruption,
          },
        },
      },
    });

    const version = await prisma.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        version: 1,
        definition: spec.definition as unknown as Prisma.InputJsonValue,
        createdBy: 'seed',
        publishedAt: new Date(),
      },
    });

    await prisma.workflow.update({
      where: { id: workflow.id },
      data: { publishedVersionId: version.id },
    });

    created[spec.slug] = workflow.id;
    console.log(`  ✓ ${spec.name} (${spec.definition.nodes.length} nodes)`);
  }

  await prisma.assistant.update({
    where: { id: assistant.id },
    data: {
      humanHandoffWorkflowId: created.human_handoff!,
      defaultFallbackWorkflowId: created.human_handoff!,
    },
  });

  // Deterministic rules. The button payloads are the ones the booking flow's
  // confirmation step emits, so a tap never reaches the model.
  await prisma.routingRule.createMany({
    data: [
      {
        assistantId: assistant.id,
        name: 'Confirm booking button',
        type: 'BUTTON_PAYLOAD',
        configuration: { payloads: ['CONFIRM_BOOKING', 'CANCEL_AND_SWITCH', 'CONTINUE_CURRENT_WORKFLOW'] },
        workflowId: created.appointment_booking!,
        priority: 100,
      },
      {
        assistantId: assistant.id,
        name: '/agent command',
        type: 'COMMAND',
        configuration: { commands: ['/agent', '/human', '/support'] },
        workflowId: created.human_handoff!,
        priority: 95,
      },
      {
        assistantId: assistant.id,
        name: 'Explicit booking keyword',
        type: 'KEYWORD',
        configuration: { keywords: ['book appointment', 'book an appointment'], match: 'word' },
        workflowId: created.appointment_booking!,
        priority: 80,
      },
    ],
  });

  await prisma.routingTestCase.createMany({
    data: ROUTING_TESTS.map((test) => ({
      tenantId: tenant.id,
      assistantId: assistant.id,
      message: test.message,
      expectedDecision: test.decision,
      expectedWorkflowId: test.expect ? created[test.expect]! : null,
    })),
  });

  console.log(`
Acme Hospital seeded.
  tenant       ${tenant.id}
  sign in      phone ${OWNER_PHONE} — needs OTP_ECHO=true, which returns the code:
               curl -s -XPOST localhost:4000/api/auth/otp \\
                 -H 'Content-Type: application/json' -d '{"phone":"${OWNER_PHONE}"}'
  channel      ${CHANNEL_PHONE_ID} (mock provider — nothing is ever sent)
  assistant    ${assistant.name} [ACTIVE]
  workflows    ${Object.keys(created).length} published
  rules        3 deterministic
  test cases   ${ROUTING_TESTS.length}

Drive it with:
  npx tsx scripts/send-webhook.ts --phone-id ${CHANNEL_PHONE_ID} "I want to book a cardiologist"
`);
};

main()
  .catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
