// Fixture-backed connectors.
//
// A connector of kind MOCK is answered from here instead of over the network.
// That exists for the same reason `mockService` does on HTTP_REQUEST: a demo
// and a test suite must be able to exercise the whole connector path — auth
// config, input mapping, response mapping, side-effect rules — without any
// outbound traffic and without a credential to leak.
//
// Deterministic on purpose. A fixture that varied by clock or random number
// would make every test that depends on it flaky.

export interface MockOperationHandler {
  (inputs: Record<string, unknown>): Promise<{ status: number; body: unknown }>;
}

const ok = (body: unknown) => Promise.resolve({ status: 200, body });
const notFound = (body: unknown) => Promise.resolve({ status: 404, body });

// ── Acme LMS ─────────────────────────────────────────────────────────────────
//
// Backs the class-cancellation journey. Two parents exist; anything else is an
// unregistered number, which is the branch that matters most in that flow.

const PARENTS: Record<string, { parentId: string; name: string }> = {
  '15550007001': { parentId: 'P-1001', name: 'Anita Sharma' },
  '15550007002': { parentId: 'P-1002', name: 'Rahul Verma' },
};

const STUDENTS: Record<string, Array<{ id: string; name: string; grade: string }>> = {
  'P-1001': [
    { id: 'S-2001', name: 'Ishaan Sharma', grade: 'Grade 6' },
    { id: 'S-2002', name: 'Meera Sharma', grade: 'Grade 3' },
  ],
  'P-1002': [
    { id: 'S-2003', name: 'Kabir Verma', grade: 'Grade 8' },
  ],
};

const CLASSES: Record<string, Array<{ id: string; subject: string; startsAt: string; teacher: string }>> = {
  'S-2001': [
    { id: 'C-3001', subject: 'Mathematics', startsAt: '2026-08-03 16:00', teacher: 'Ms Iyer' },
    { id: 'C-3002', subject: 'Physics', startsAt: '2026-08-04 17:00', teacher: 'Mr Bose' },
    { id: 'C-3003', subject: 'Chemistry', startsAt: '2026-08-05 16:30', teacher: 'Ms Rao' },
    { id: 'C-3004', subject: 'Biology', startsAt: '2026-08-06 16:00', teacher: 'Mr Nair' },
  ],
  'S-2002': [
    { id: 'C-3010', subject: 'English Reading', startsAt: '2026-08-03 11:00', teacher: 'Ms Fernandes' },
    { id: 'C-3011', subject: 'Art', startsAt: '2026-08-05 11:00', teacher: 'Mr Dutt' },
  ],
  'S-2003': [
    { id: 'C-3020', subject: 'History', startsAt: '2026-08-04 09:00', teacher: 'Ms Kapoor' },
  ],
};

/** Classes that cannot be cancelled, so the unhappy path is reachable in a demo. */
const LOCKED = new Set(['C-3004']);

const asString = (value: unknown): string => String(value ?? '').trim();

const acmeLms: Record<string, MockOperationHandler> = {
  find_parent_by_phone: async (inputs) => {
    // The flow passes the customer's WhatsApp id. Match on the trailing digits
    // so a leading country code or a `+` does not miss.
    const phone = asString(inputs.phone).replace(/\D/g, '');
    const found = Object.entries(PARENTS).find(([number]) => phone.endsWith(number.slice(-10)));
    return found
      ? ok({ registered: true, parent: { id: found[1].parentId, name: found[1].name } })
      : notFound({ registered: false, message: 'No parent account for that number' });
  },

  list_students: async (inputs) => {
    const students = STUDENTS[asString(inputs.parent_id)];
    return students
      ? ok({ students })
      : notFound({ students: [], message: 'No students for that parent' });
  },

  upcoming_classes: async (inputs) => {
    const all = CLASSES[asString(inputs.student_id)] ?? [];
    const limit = Number(inputs.limit ?? 3);
    const classes = all.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 3)
      .map((c) => ({ ...c, label: `${c.subject} · ${c.startsAt}` }));
    return classes.length
      ? ok({ classes })
      : notFound({ classes: [], message: 'No upcoming classes' });
  },

  cancel_class: async (inputs) => {
    const classId = asString(inputs.class_id);
    if (LOCKED.has(classId)) {
      // A real LMS refuses a cancellation inside its notice window. The flow
      // needs a way to reach that branch or nobody ever tests it.
      return { status: 409, body: { cancelled: false, reason: 'Too late to cancel this class' } };
    }
    const known = Object.values(CLASSES).flat().some((c) => c.id === classId);
    return known
      ? ok({ cancelled: true, classId, reference: `CAN-${classId}` })
      : notFound({ cancelled: false, reason: 'Unknown class' });
  },
};

export const MOCK_CONNECTORS: Record<string, Record<string, MockOperationHandler>> = {
  acme_lms: acmeLms,
};

export const mockHandlerFor = (
  connectorKey: string,
  operationKey: string,
): MockOperationHandler | null => MOCK_CONNECTORS[connectorKey]?.[operationKey] ?? null;
