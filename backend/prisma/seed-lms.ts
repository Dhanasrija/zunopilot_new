import { PrismaClient, Prisma, UserRole } from '@prisma/client';
import type { WorkflowDefinition } from '../src/modules/conversation-engine/domain/definition.js';
import type { CapabilityContract } from '../src/modules/conversation-engine/domain/capability.js';
import { validateWorkflowDefinition } from '../src/modules/conversation-engine/validation/definition-validator.js';

// Bright Minds Academy — the connectors demo.
//
// This is the proof that the connector abstraction is the right shape: the
// class-cancellation journey Venky described, built entirely out of registered
// operations and existing node types, with no LMS-specific code anywhere in the
// engine.
//
// The connector is kind MOCK, so it is answered from in-process fixtures
// (`connectors/mock-connectors.ts`). Nothing here can reach a network, and the
// channel is `mock-token-` prefixed so nothing can reach a phone.
//
// Idempotent and scoped: deletes and rebuilds only this tenant.

const prisma = new PrismaClient();

const TENANT_ID = '66666666-6666-6666-6666-666666666666';
const CHANNEL_PHONE_ID = 'bright-minds-mock-channel';
/** Owner's sign-in number. Reserved US 555 range — see the `phone` comment below. */
const OWNER_PHONE = '15550003001';
const CONNECTOR_KEY = 'acme_lms';

const node = (
  id: string,
  type: string,
  config: Record<string, unknown>,
  y: number,
  name: string,
  x = 380,
) => ({ id, type, config, position: { x, y }, name });

const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}->${target}${sourceHandle ? `:${sourceHandle}` : ''}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});

// ── The connector's operations ────────────────────────────────────────────────
//
// Each declares its own inputs and where the useful data sits in the response.
// The builder generates its form from these, and the invoker drops anything a
// node supplies that is not declared here.

const OPERATIONS = [
  {
    key: 'find_parent_by_phone',
    name: 'Find parent by phone',
    description: 'Checks whether a WhatsApp number belongs to a registered parent.',
    method: 'GET',
    path: '/parents/lookup',
    inputs: [
      { key: 'phone', label: 'WhatsApp number', type: 'string', required: true, in: 'query' },
    ],
    responseMapping: { itemsPath: '', idField: 'id', titleField: 'name' },
    sideEffecting: false,
    sampleResponse: { registered: true, parent: { id: 'P-1001', name: 'Anita Sharma' } },
  },
  {
    key: 'list_students',
    name: 'List students',
    description: 'The children registered under one parent account.',
    method: 'GET',
    path: '/parents/{parent_id}/students',
    inputs: [
      { key: 'parent_id', label: 'Parent id', type: 'string', required: true, in: 'path' },
    ],
    responseMapping: {
      itemsPath: 'students', idField: 'id', titleField: 'name', descriptionField: 'grade',
    },
    sideEffecting: false,
    sampleResponse: { students: [{ id: 'S-2001', name: 'Ishaan Sharma', grade: 'Grade 6' }] },
  },
  {
    key: 'upcoming_classes',
    name: 'Upcoming classes',
    description: 'The next few scheduled classes for a student.',
    method: 'GET',
    path: '/students/{student_id}/classes',
    inputs: [
      { key: 'student_id', label: 'Student id', type: 'string', required: true, in: 'path' },
      { key: 'limit', label: 'How many', type: 'number', required: false, in: 'query' },
    ],
    responseMapping: {
      itemsPath: 'classes', idField: 'id', titleField: 'subject', descriptionField: 'label',
    },
    sideEffecting: false,
    sampleResponse: {
      classes: [{
        id: 'C-3001', subject: 'Mathematics', startsAt: '2026-08-03 16:00', label: 'Mathematics · 2026-08-03 16:00',
      }],
    },
  },
  {
    key: 'cancel_class',
    name: 'Cancel a class',
    description: 'Cancels one scheduled class. Refused inside the notice window.',
    method: 'POST',
    path: '/classes/{class_id}/cancel',
    inputs: [
      { key: 'class_id', label: 'Class id', type: 'string', required: true, in: 'path' },
      { key: 'reason', label: 'Reason', type: 'string', required: false, in: 'body' },
    ],
    responseMapping: { itemsPath: '', idField: 'classId', titleField: 'reference' },
    // The flag that makes the publish validator demand a confirmation step.
    sideEffecting: true,
    sampleResponse: { cancelled: true, classId: 'C-3001', reference: 'CAN-C-3001' },
  },
];

// ── The workflow ──────────────────────────────────────────────────────────────

const capability: CapabilityContract = {
  purpose: 'Cancel a scheduled class for a parent',
  description:
    'Verifies the caller is a registered parent, then walks them through choosing a student and a '
    + 'class, confirms, and cancels it in the LMS.',
  useWhen: [
    'A parent wants to cancel or skip a scheduled class',
    'A parent says their child cannot attend a session',
    'A parent asks to remove a class from the timetable',
  ],
  doNotUseWhen: [
    'The parent wants to reschedule to a different time rather than cancel',
    'The parent is asking what classes are scheduled, without wanting to change anything',
    'The person is enquiring about enrolling for the first time',
  ],
  positiveExamples: [
    'I need to cancel my son\'s class tomorrow',
    'Please cancel the maths class this week',
    'My daughter cannot attend her session on Monday',
  ],
  negativeExamples: [
    'What classes does my son have this week?',
    'Can I move the class to Friday instead?',
    'How much are your courses?',
  ],
  requiredInputs: [],
  optionalInputs: [],
  preconditions: ['The caller\'s WhatsApp number is registered against a parent account'],
  sideEffects: ['Cancels a scheduled class'],
  // Satisfied by `confirm_cancel`. Without it the publish validator refuses,
  // which is exactly the rule that stops "what classes does my son have?" from
  // cancelling one.
  requiresConfirmation: true,
  minimumConfidence: 0.75,
  allowsInterruption: false,
};

const definition: WorkflowDefinition = {
  schemaVersion: '1.0',
  entryNodeId: 'entry',
  nodes: [
    node('entry', 'ASSISTANT_ROUTE_ENTRY', { acceptedIntents: [] }, 40, 'Assistant Route Entry'),

    // 1. Is this number a registered parent?
    node('find_parent', 'CONNECTOR_QUERY', {
      connectorKey: CONNECTOR_KEY,
      operationKey: 'find_parent_by_phone',
      inputs: [{ key: 'phone', value: '{{customer.waId}}' }],
      outputVariable: 'parent_lookup',
    }, 160, 'Look Up Parent'),

    // 2. Their students. A 404 from the lookup takes the error branch instead.
    node('load_students', 'CONNECTOR_QUERY', {
      connectorKey: CONNECTOR_KEY,
      operationKey: 'list_students',
      inputs: [{ key: 'parent_id', value: '{{vars.parent_lookup.parent.id}}' }],
      outputVariable: 'students_response',
      itemsVariable: 'students',
    }, 280, 'Load Students'),

    node('pick_student', 'LIST_MESSAGE', {
      header: 'Your students',
      body: 'Hello {{vars.parent_lookup.parent.name}} — which student is this for?',
      buttonLabel: 'Choose student',
      // Rendered from what the query above fetched. Fetching and showing stay
      // separate nodes so either can be edited without touching the other.
      source: 'variable',
      itemsVariable: 'students',
      rows: [],
      variableName: 'student_id',
      labelVariable: 'student_name',
      retryMessage: 'Please pick one of the students from the list.',
      maxRetries: 3,
    }, 400, 'Pick a Student'),

    // 3. The next three classes.
    node('load_classes', 'CONNECTOR_QUERY', {
      connectorKey: CONNECTOR_KEY,
      operationKey: 'upcoming_classes',
      inputs: [
        { key: 'student_id', value: '{{vars.student_id}}' },
        { key: 'limit', value: '3' },
      ],
      outputVariable: 'classes_response',
      itemsVariable: 'classes',
    }, 520, 'Load Next Classes'),

    node('pick_class', 'LIST_MESSAGE', {
      header: 'Upcoming classes',
      body: 'Here are the next classes for {{vars.student_name}}. Which one should I cancel?',
      buttonLabel: 'Choose class',
      source: 'variable',
      itemsVariable: 'classes',
      rows: [],
      variableName: 'class_id',
      labelVariable: 'class_name',
      retryMessage: 'Please pick one of the classes from the list.',
      maxRetries: 3,
    }, 640, 'Pick a Class'),

    // 4. Confirm before anything is changed.
    node('confirm_cancel', 'BUTTON_MESSAGE', {
      body: 'Just to confirm — cancel *{{vars.class_name}}* for {{vars.student_name}}?',
      buttons: [
        { id: 'confirm_cancel', title: 'Yes, cancel it' },
        { id: 'keep_class', title: 'No, keep it' },
      ],
      variableName: 'cancel_confirmation',
      retryMessage: 'Please tap "Yes, cancel it" or "No, keep it".',
      maxRetries: 3,
    }, 760, 'Confirm Cancellation'),

    node('is_confirmed', 'CONDITION', {
      left: '{{vars.cancel_confirmation}}', op: 'equals', right: 'confirm_cancel',
    }, 880, 'Confirmed?'),

    // 5. The write.
    node('do_cancel', 'CONNECTOR_ACTION', {
      connectorKey: CONNECTOR_KEY,
      operationKey: 'cancel_class',
      inputs: [
        { key: 'class_id', value: '{{vars.class_id}}' },
        { key: 'reason', value: 'Cancelled by parent on WhatsApp' },
      ],
      outputVariable: 'cancellation',
    }, 1000, 'Cancel the Class'),

    node('cancelled_ok', 'SEND_WHATSAPP_MESSAGE', {
      body: 'Done — {{vars.class_name}} is cancelled for {{vars.student_name}}. '
        + 'Your reference is {{vars.cancellation.reference}}.',
    }, 1120, 'Confirm to Parent'),

    node('done', 'END_WORKFLOW', { outcome: 'COMPLETED' }, 1240, 'End'),

    // ── Off-ramps ───────────────────────────────────────────────────────────
    node('not_registered', 'HUMAN_HANDOFF', {
      reason: 'WhatsApp number is not a registered parent',
      message: "I could not find an account for this number. Let me get a colleague to help you.",
    }, 280, 'Not Registered', 760),

    node('no_students', 'HUMAN_HANDOFF', {
      reason: 'Parent account has no students',
      message: "I could not find any students on your account — let me get someone to check.",
    }, 400, 'No Students', 760),

    node('no_classes', 'SEND_WHATSAPP_MESSAGE', {
      body: 'There are no upcoming classes scheduled for {{vars.student_name}} right now.',
    }, 520, 'Nothing to Cancel', 760),

    node('no_classes_end', 'END_WORKFLOW', { outcome: 'COMPLETED' }, 640, 'End', 760),

    node('nothing_cancelled', 'END_WORKFLOW', {
      outcome: 'CANCELLED',
      message: 'No problem — I have left the class as it is.',
    }, 1000, 'Left As Is', 40),

    // The LMS refusing the cancellation is a real, expected answer — a class
    // inside its notice window. It gets its own branch rather than a crash.
    node('cancel_refused', 'HUMAN_HANDOFF', {
      reason: 'LMS refused the cancellation',
      message: "I could not cancel that one automatically — let me get a colleague to sort it out.",
    }, 1120, 'Cancellation Refused', 760),
  ],
  edges: [
    edge('entry', 'find_parent'),
    edge('find_parent', 'load_students', 'success'),
    edge('find_parent', 'not_registered', 'error'),
    edge('load_students', 'pick_student', 'success'),
    edge('load_students', 'no_students', 'error'),
    edge('pick_student', 'load_classes'),
    edge('load_classes', 'pick_class', 'success'),
    edge('load_classes', 'no_classes', 'error'),
    edge('no_classes', 'no_classes_end'),
    edge('pick_class', 'confirm_cancel'),
    edge('confirm_cancel', 'is_confirmed'),
    edge('is_confirmed', 'do_cancel', 'yes'),
    edge('is_confirmed', 'nothing_cancelled', 'no'),
    edge('do_cancel', 'cancelled_ok', 'success'),
    edge('do_cancel', 'cancel_refused', 'error'),
    edge('cancelled_ok', 'done'),
  ],
};

const main = async () => {
  const result = validateWorkflowDefinition({
    definition, category: 'CONVERSATION', capability, slug: 'cancel_class', siblingSlugs: [],
  });
  const errors = result.issues.filter((i) => i.level === 'error');
  if (errors.length) {
    throw new Error(
      'The class-cancellation workflow would fail validation:\n'
      + errors.map((e) => `  • [${e.code}] ${e.message}`).join('\n'),
    );
  }
  for (const warning of result.issues.filter((i) => i.level === 'warning')) {
    console.warn(`  ⚠ ${warning.message}`);
  }

  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });

  const tenant = await prisma.tenant.create({
    data: {
      id: TENANT_ID,
      businessName: 'Bright Minds Academy',
      businessCategory: { connect: { key: 'RESTAURANT' } }, // no LMS category in the enum yet
      // Onboarding is not part of a demo; these workspaces are set up by definition.
      onboardingCompletedAt: new Date(),
      contactNumber: '+914466001234',
      address: '9 Anna Salai, Chennai',
      users: {
        create: {
          // The login identifier. Drawn from the reserved US 555 range, which is
          // set aside for fiction and routes to no handset — so a seed that runs
          // on every reset can never send a real person a code, and can never
          // collide with a real customer's number on the global unique index.
          // Distinct from the 1555000700x parent fixtures below, which are
          // *customers* of this workspace rather than people who sign in to it.
          phone: OWNER_PHONE,
          email: 'owner@brightminds.test',
          // No passwordHash: customers sign in with a phone and a one-time code,
          // and no login path accepts a password. Seeding one would only suggest
          // a credential that does not work.
          fullName: 'Bright Minds Owner',
          role: UserRole.OWNER,
          emailVerified: true,
        },
      },
    },
  });

  const channel = await prisma.whatsappAccount.create({
    data: {
      tenantId: tenant.id,
      wabaId: 'bright-minds-mock-waba',
      phoneNumberId: CHANNEL_PHONE_ID,
      displayPhone: '+1 555 010 6060',
      businessName: 'Bright Minds Academy',
      accessToken: 'mock-token-not-a-credential',
    },
  });

  const connector = await prisma.connector.create({
    data: {
      tenantId: tenant.id,
      key: CONNECTOR_KEY,
      name: 'Acme LMS',
      description: 'The academy\'s learning platform. Fixture-backed for the demo.',
      // MOCK, so no base URL, no credential, and no possibility of traffic
      // leaving the process. Switching this to HTTP with a base URL and a
      // bearer token is the only change needed to point it at a real LMS.
      kind: 'MOCK',
      authType: 'NONE',
      operations: {
        create: OPERATIONS.map((op) => ({
          key: op.key,
          name: op.name,
          description: op.description,
          method: op.method,
          path: op.path,
          inputs: op.inputs as unknown as Prisma.InputJsonValue,
          responseMapping: op.responseMapping as unknown as Prisma.InputJsonValue,
          sideEffecting: op.sideEffecting,
          sampleResponse: op.sampleResponse as unknown as Prisma.InputJsonValue,
        })),
      },
    },
  });

  const assistant = await prisma.assistant.create({
    data: {
      tenantId: tenant.id,
      whatsappChannelId: channel.id,
      name: 'Bright Minds WhatsApp Assistant',
      description: 'Helps parents manage their children\'s classes.',
      generalSystemPrompt:
        'You are the WhatsApp assistant for Bright Minds Academy, a tutoring centre. '
        + 'Be brief, warm and factual. Never discuss a student with someone who has not been verified.',
      generalResponseEnabled: true,
      highConfidenceThreshold: 0.8,
      mediumConfidenceThreshold: 0.55,
      maxRecentMessages: 8,
      status: 'ACTIVE',
    },
  });

  const workflow = await prisma.workflow.create({
    data: {
      tenantId: tenant.id,
      assistantId: assistant.id,
      name: 'Cancel a Class',
      slug: 'cancel_class',
      description: capability.purpose,
      category: 'CONVERSATION',
      status: 'PUBLISHED',
      priority: 80,
      publishedAt: new Date(),
      capability: {
        create: {
          purpose: capability.purpose,
          description: capability.description ?? null,
          useWhen: capability.useWhen,
          doNotUseWhen: capability.doNotUseWhen,
          positiveExamples: capability.positiveExamples,
          negativeExamples: capability.negativeExamples,
          requiredInputs: capability.requiredInputs as unknown as Prisma.InputJsonValue,
          optionalInputs: capability.optionalInputs as unknown as Prisma.InputJsonValue,
          preconditions: capability.preconditions,
          sideEffects: capability.sideEffects,
          requiresConfirmation: capability.requiresConfirmation,
          minimumConfidence: capability.minimumConfidence,
          allowsInterruption: capability.allowsInterruption,
        },
      },
    },
  });

  const version = await prisma.workflowVersion.create({
    data: {
      workflowId: workflow.id,
      version: 1,
      definition: definition as unknown as Prisma.InputJsonValue,
      createdBy: 'seed',
      publishedAt: new Date(),
    },
  });
  await prisma.workflow.update({
    where: { id: workflow.id },
    data: { publishedVersionId: version.id },
  });

  // So the demo can be driven without spending a router call.
  await prisma.routingRule.create({
    data: {
      assistantId: assistant.id,
      name: 'Explicit cancellation keyword',
      type: 'KEYWORD',
      configuration: { keywords: ['cancel class', 'cancel a class'], match: 'word' },
      workflowId: workflow.id,
      priority: 90,
    },
  });

  console.log(`
Bright Minds Academy seeded.
  tenant      ${tenant.id}
  sign in     phone ${OWNER_PHONE} — needs OTP_ECHO=true, which returns the code:
              curl -s -XPOST localhost:4000/api/auth/otp \\
                -H 'Content-Type: application/json' -d '{"phone":"${OWNER_PHONE}"}'
  channel     ${CHANNEL_PHONE_ID} (mock provider — nothing is ever sent)
  connector   ${connector.name} [MOCK] with ${OPERATIONS.length} operations
  workflow    ${workflow.name} (${definition.nodes.length} nodes) PUBLISHED

Registered parents in the fixture:
  15550007001  Anita Sharma  — 2 students, 4 classes on the first
  15550007002  Rahul Verma   — 1 student
  anything else is an unregistered number, which takes the handoff branch.

Drive it:
  npx tsx scripts/send-webhook.ts --phone-id ${CHANNEL_PHONE_ID} --from 15550007001 "I want to cancel a class"
`);
};

main()
  .catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
