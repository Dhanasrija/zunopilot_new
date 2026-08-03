import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  DB_RESOURCE_LABELS, INPUT_TYPES, MOCK_SERVICES, OPERATORS, specFor, type NodeConfig,
} from '@/lib/engine/nodes';
import type { FlowNode } from '@/lib/engine/types';
import type { ValidationIssue } from '@/lib/engine/api';
import { useQuery } from '@tanstack/react-query';
import { engine } from '@/lib/engine/api';
import { AlertTriangle, Info, Trash2, XCircle } from 'lucide-react';

// Per-node-type configuration.
//
// Each type's fields mirror its Zod schema on the backend, so what the panel
// lets you enter is what the engine will accept. The panel deliberately does
// not re-implement validation beyond input affordances — `POST /validate` is
// the authority, and duplicating its rules here is how the two drift.

interface Props {
  node: FlowNode;
  issues: ValidationIssue[];
  onPatch: (patch: Partial<FlowNode['data']>) => void;
  onPatchConfig: (patch: NodeConfig) => void;
  onDelete: () => void;
  canDelete: boolean;
}

const VARIABLE_HINT = 'Letters, digits and underscores; must start with a letter.';

const cleanVariable = (raw: string) => raw.replace(/[^a-zA-Z0-9_]/g, '');

/** A labelled field with optional helper text. */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-caption leading-snug text-ink-500">{hint}</p>}
    </div>
  );
}

function TemplateHint() {
  return (
    <p className="text-caption leading-snug text-ink-500">
      Use <code className="rounded bg-surface-0 px-1 font-mono">{'{{customer.name}}'}</code>,{' '}
      <code className="rounded bg-surface-0 px-1 font-mono">{'{{vars.x}}'}</code>,{' '}
      <code className="rounded bg-surface-0 px-1 font-mono">{'{{now.date}}'}</code>.
    </p>
  );
}

function ConfigFields({ node, onPatchConfig }: Pick<Props, 'node' | 'onPatchConfig'>) {
  const config = node.data.config ?? {};
  const set = (patch: NodeConfig) => onPatchConfig(patch);

  switch (node.data.type) {
    case 'ASSISTANT_ROUTE_ENTRY':
      return (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3">
          <p className="text-caption font-medium text-success">Started by the Assistant Router</p>
          <p className="mt-1 text-caption leading-snug text-success">
            This workflow runs when the router selects it — there is no trigger to configure here.
            What decides that lives in the Routing tab: the purpose, the examples, and the minimum
            confidence.
          </p>
        </div>
      );

    case 'SEND_WHATSAPP_MESSAGE':
      return (
        <Field label="Message">
          <Textarea
            rows={5}
            value={String(config.body ?? '')}
            placeholder="Hi {{customer.name}}, here's what I found…"
            onChange={(e) => set({ body: e.target.value })}
          />
          <TemplateHint />
        </Field>
      );

    case 'ASK_USER_INPUT': {
      const validation = (config.validation ?? {}) as Record<string, unknown>;
      const setValidation = (patch: Record<string, unknown>) =>
        set({ validation: { ...validation, ...patch } });

      return (
        <>
          <Field label="Question">
            <Textarea
              rows={3}
              value={String(config.prompt ?? '')}
              placeholder="Which speciality would you like to consult?"
              onChange={(e) => set({ prompt: e.target.value })}
            />
            <TemplateHint />
          </Field>

          <Field label="Store the answer as" hint={VARIABLE_HINT}>
            <Input
              className="font-mono text-caption"
              value={String(config.variableName ?? '')}
              placeholder="speciality"
              onChange={(e) => set({ variableName: cleanVariable(e.target.value) })}
            />
          </Field>

          <Field label="Answer type">
            <Select
              value={String(config.inputType ?? 'string')}
              onValueChange={(v) => set({ inputType: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INPUT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {config.inputType === 'choice' && (
            <Field label="Allowed answers" hint="Comma separated. Matched case-insensitively.">
              <Input
                value={(validation.choices as string[] | undefined)?.join(', ') ?? ''}
                placeholder="yes, no"
                onChange={(e) => setValidation({
                  choices: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                })}
              />
            </Field>
          )}

          {(config.inputType === 'string' || !config.inputType) && (
            <Field label="Minimum length">
              <Input
                type="number" min={0}
                value={String(validation.minLength ?? '')}
                onChange={(e) => setValidation({
                  minLength: e.target.value === '' ? undefined : Number(e.target.value),
                })}
              />
            </Field>
          )}

          <Field
            label="Retry message"
            hint="Sent when the answer doesn't validate. Falls back to the question itself."
          >
            <Textarea
              rows={2}
              value={String(config.retryMessage ?? '')}
              placeholder="Please give a speciality, e.g. Cardiology."
              onChange={(e) => set({ retryMessage: e.target.value })}
            />
          </Field>

          <Field
            label="Give up after"
            hint="After this many invalid answers the run hands off to a human rather than asking again."
          >
            <Input
              type="number" min={1} max={10}
              value={Number(config.maxRetries ?? 3)}
              onChange={(e) => set({ maxRetries: Number(e.target.value) })}
            />
          </Field>
        </>
      );
    }

    case 'CONDITION': {
      const unary = config.op === 'is_empty' || config.op === 'is_not_empty';
      return (
        <>
          <Field label="Compare">
            <Input
              className="font-mono text-caption"
              value={String(config.left ?? '')}
              placeholder="{{message.text}}"
              onChange={(e) => set({ left: e.target.value })}
            />
          </Field>
          <Field label="Test">
            <Select value={String(config.op ?? 'equals')} onValueChange={(v) => set({ op: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {OPERATORS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {!unary && (
            <Field
              label="Against"
              hint="Text comparisons ignore case. Numeric tests fail rather than coerce a non-number."
            >
              <Input
                className="font-mono text-caption"
                value={String(config.right ?? '')}
                onChange={(e) => set({ right: e.target.value })}
              />
            </Field>
          )}
        </>
      );
    }

    case 'SET_VARIABLE':
      return (
        <>
          <Field label="Variable name" hint={VARIABLE_HINT}>
            <Input
              className="font-mono text-caption"
              value={String(config.variableName ?? '')}
              onChange={(e) => set({ variableName: cleanVariable(e.target.value) })}
            />
          </Field>
          <Field label="Value">
            <Input
              value={String(config.value ?? '')}
              placeholder="{{vars.availability.doctor}}"
              onChange={(e) => set({ value: e.target.value })}
            />
            <TemplateHint />
          </Field>
        </>
      );

    case 'DELAY': {
      const seconds = Number(config.seconds ?? 60);
      return (
        <Field
          label="Wait for"
          hint="Capped at 30 days. The run is parked in the database, so a restart doesn't lose the wait."
        >
          <div className="flex gap-2">
            <Input
              type="number" min={0}
              value={seconds}
              onChange={(e) => set({ seconds: Number(e.target.value) })}
            />
            <Select
              value="seconds"
              onValueChange={(unit) => {
                const factor = unit === 'minutes' ? 60 : unit === 'hours' ? 3600 : unit === 'days' ? 86400 : 1;
                set({ seconds: seconds * factor });
              }}
            >
              <SelectTrigger className="w-32"><SelectValue placeholder="seconds" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="seconds">seconds</SelectItem>
                <SelectItem value="minutes">× minutes</SelectItem>
                <SelectItem value="hours">× hours</SelectItem>
                <SelectItem value="days">× days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Field>
      );
    }

    case 'HUMAN_HANDOFF':
      return (
        <>
          <Field label="Message to the customer">
            <Textarea
              rows={3}
              value={String(config.message ?? '')}
              onChange={(e) => set({ message: e.target.value })}
            />
          </Field>
          <Field label="Reason" hint="Recorded on the handoff for the agent picking it up.">
            <Input
              value={String(config.reason ?? '')}
              placeholder="Billing question not resolved"
              onChange={(e) => set({ reason: e.target.value })}
            />
          </Field>
        </>
      );

    case 'END_WORKFLOW':
      return (
        <>
          <Field label="Outcome">
            <Select
              value={String(config.outcome ?? 'COMPLETED')}
              onValueChange={(v) => set({ outcome: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Final message" hint="Optional. Sent before the run ends.">
            <Textarea
              rows={2}
              value={String(config.message ?? '')}
              onChange={(e) => set({ message: e.target.value })}
            />
          </Field>
        </>
      );

    case 'AI_AGENT':
      return (
        <>
          <Field
            label="System prompt"
            hint="Operator-authored only. The customer's message goes in the user prompt below, never here — that's what stops a customer rewriting the node's instructions."
          >
            <Textarea
              rows={5}
              value={String(config.systemPrompt ?? '')}
              placeholder="You are the assistant for Acme Hospital. Be brief and factual. Never give medical advice."
              onChange={(e) => set({ systemPrompt: e.target.value })}
            />
          </Field>
          <Field label="User prompt">
            <Textarea
              rows={2}
              className="font-mono text-caption"
              value={String(config.userPrompt ?? '{{message.text}}')}
              onChange={(e) => set({ userPrompt: e.target.value })}
            />
          </Field>
          <Field label="Store reply as" hint={VARIABLE_HINT}>
            <Input
              className="font-mono text-caption"
              value={String(config.outputVariable ?? 'ai_reply')}
              onChange={(e) => set({ outputVariable: cleanVariable(e.target.value) })}
            />
          </Field>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label>Send the reply to the customer</Label>
              <p className="text-caption text-ink-500">Off means store it only.</p>
            </div>
            <Switch
              checked={config.sendToCustomer !== false}
              onCheckedChange={(v) => set({ sendToCustomer: v })}
            />
          </div>
        </>
      );

    case 'HTTP_REQUEST': {
      const mock = String(config.mockService ?? '');
      return (
        <>
          <Field
            label="Mock service"
            hint="Real outbound HTTP is not enabled yet — the egress allowlist isn't built, so a node without a mock fails at runtime rather than dialling an arbitrary URL."
          >
            <Select value={mock || 'none'} onValueChange={(v) => set({ mockService: v === 'none' ? '' : v })}>
              <SelectTrigger><SelectValue placeholder="Choose a mock" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None (will fail at runtime)</SelectItem>
                {MOCK_SERVICES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {!mock && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/15 p-2">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-ink-900" />
              <span className="text-caption leading-snug text-ink-900">
                Without a mock service this node throws when it runs.
              </span>
            </div>
          )}

          <Field label="Method">
            <Select value={String(config.method ?? 'GET')} onValueChange={(v) => set({ method: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(config.method)) && (
              <p className="text-caption leading-snug text-ink-900">
                A write method counts as a side effect — the workflow will need a confirmation step
                before it can be published.
              </p>
            )}
          </Field>

          <Field label="URL">
            <Input
              className="font-mono text-caption"
              value={String(config.url ?? '')}
              placeholder="https://api.example.com/slots"
              onChange={(e) => set({ url: e.target.value })}
            />
          </Field>

          <Field label="Store response as" hint={VARIABLE_HINT}>
            <Input
              className="font-mono text-caption"
              value={String(config.outputVariable ?? 'http_response')}
              onChange={(e) => set({ outputVariable: cleanVariable(e.target.value) })}
            />
          </Field>
        </>
      );
    }

    case 'LIST_MESSAGE': {
      const source = String(config.source ?? 'menu_categories');
      return (
        <>
          <Field label="Message above the list">
            <Textarea
              rows={2}
              value={String(config.body ?? '')}
              placeholder="Tap to pick a category."
              onChange={(e) => set({ body: e.target.value })}
            />
            <TemplateHint />
          </Field>

          <Field
            label="Where the rows come from"
            hint="Reading the catalogue keeps the list current. Fixed rows go stale the day the menu changes."
          >
            <Select value={source} onValueChange={(v) => set({ source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="menu_categories">Menu categories (live)</SelectItem>
                <SelectItem value="menu_items">Menu items (live)</SelectItem>
                <SelectItem value="static">Fixed rows I type</SelectItem>
                <SelectItem value="variable">Rows from a variable</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {source === 'variable' && (
            <Field
              label="Variable holding the rows"
              hint="Normally the “Store the rows in” variable of a Connector Query above this node."
            >
              <Input
                className="font-mono text-caption"
                value={String(config.itemsVariable ?? '')}
                placeholder="students"
                onChange={(e) => set({ itemsVariable: cleanVariable(e.target.value) })}
              />
            </Field>
          )}

          {source === 'menu_items' && (
            <Field
              label="Filter by the category in"
              hint="Usually the variable the previous list wrote. Leave blank to list every item."
            >
              <Input
                className="font-mono text-caption"
                value={String(config.categoryVariable ?? '')}
                placeholder="chosen_category"
                onChange={(e) => set({ categoryVariable: cleanVariable(e.target.value) })}
              />
            </Field>
          )}

          {source === 'static' && (
            <Field label="Rows" hint="One per line, as id | label. WhatsApp allows at most 10.">
              <Textarea
                rows={4}
                className="font-mono text-caption"
                value={(config.rows as Array<{ id: string; title: string }> ?? [])
                  .map((r) => `${r.id} | ${r.title}`).join('\n')}
                placeholder={'delivery | Delivery\npickup | Pickup'}
                onChange={(e) => set({
                  rows: e.target.value.split('\n').map((line) => {
                    const [id, title] = line.split('|').map((part) => part.trim());
                    return id ? { id, title: title || id } : null;
                  }).filter(Boolean).slice(0, 10),
                })}
              />
            </Field>
          )}

          <Field label="Button label" hint="What the customer taps to open the list. Max 20 characters.">
            <Input
              value={String(config.buttonLabel ?? 'View options')}
              onChange={(e) => set({ buttonLabel: e.target.value.slice(0, 20) })}
            />
          </Field>

          <Field label="Store the choice as" hint={VARIABLE_HINT}>
            <Input
              className="font-mono text-caption"
              value={String(config.variableName ?? '')}
              placeholder="chosen_category"
              onChange={(e) => set({ variableName: cleanVariable(e.target.value) })}
            />
          </Field>

          <Field
            label="Store the label as"
            hint="Optional. The visible text they tapped, for use in later messages."
          >
            <Input
              className="font-mono text-caption"
              value={String(config.labelVariable ?? '')}
              placeholder="chosen_category_name"
              onChange={(e) => set({ labelVariable: cleanVariable(e.target.value) || undefined })}
            />
          </Field>
        </>
      );
    }

    case 'BUTTON_MESSAGE': {
      const buttons = (config.buttons as Array<{ id: string; title: string }>) ?? [];
      return (
        <>
          <Field label="Message">
            <Textarea
              rows={2}
              value={String(config.body ?? '')}
              placeholder="How many would you like?"
              onChange={(e) => set({ body: e.target.value })}
            />
            <TemplateHint />
          </Field>

          <Field
            label="Buttons"
            hint="One per line, as id | label. WhatsApp allows at most three; a fourth is rejected."
          >
            <Textarea
              rows={3}
              className="font-mono text-caption"
              value={buttons.map((b) => `${b.id} | ${b.title}`).join('\n')}
              placeholder={'qty:1 | 1\nqty:2 | 2\nqty:3 | 3'}
              onChange={(e) => set({
                buttons: e.target.value.split('\n').map((line) => {
                  const [id, title] = line.split('|').map((part) => part.trim());
                  return id ? { id, title: (title || id).slice(0, 20) } : null;
                }).filter(Boolean).slice(0, 3),
              })}
            />
            {buttons.length > 3 && (
              <p className="text-caption text-danger">Only the first three will be sent.</p>
            )}
          </Field>

          <Field label="Store the choice as" hint={VARIABLE_HINT}>
            <Input
              className="font-mono text-caption"
              value={String(config.variableName ?? '')}
              onChange={(e) => set({ variableName: cleanVariable(e.target.value) })}
            />
          </Field>
        </>
      );
    }

    case 'START_ORDERING':
      return (
        <>
          <Field label="Message before the menu" hint="Optional.">
            <Textarea
              rows={2}
              value={String(config.introMessage ?? '')}
              placeholder="Happy to help you order — here is what we have today."
              onChange={(e) => set({ introMessage: e.target.value })}
            />
          </Field>
          <div className="rounded-lg border border-warning/40 bg-warning/15 p-3">
            <p className="text-caption leading-snug text-ink-900">
              The built-in checkout takes over here — menu, quantities, address and order creation —
              and the workflow ends. Nothing after this node will run. To build those steps yourself
              instead, use List Message, Buttons, Add to Basket and Place the Order.
            </p>
          </div>
        </>
      );

    case 'CART_ADD_ITEM':
      return (
        <>
          <Field label="Item chosen in" hint="The variable a List Message wrote. Accepts item:<id> or a bare id.">
            <Input
              className="font-mono text-caption"
              value={String(config.itemVariable ?? '')}
              placeholder="chosen_item"
              onChange={(e) => set({ itemVariable: cleanVariable(e.target.value) })}
            />
          </Field>
          <Field label="Quantity in" hint="Optional. Defaults to 1.">
            <Input
              className="font-mono text-caption"
              value={String(config.quantityVariable ?? '')}
              placeholder="quantity"
              onChange={(e) => set({ quantityVariable: cleanVariable(e.target.value) || undefined })}
            />
          </Field>
          <Field label="Basket variable" hint="Keep this the same across every basket node in the flow.">
            <Input
              className="font-mono text-caption"
              value={String(config.cartVariable ?? 'cart')}
              onChange={(e) => set({ cartVariable: cleanVariable(e.target.value) })}
            />
          </Field>
          <div className="rounded-lg border border-ink-300 bg-surface-0 p-3">
            <p className="text-caption leading-snug text-ink-500">
              The price is read from your catalogue, never from the conversation.
            </p>
          </div>
        </>
      );

    case 'CART_SUMMARY':
      return (
        <>
          <Field label="Basket variable">
            <Input
              className="font-mono text-caption"
              value={String(config.cartVariable ?? 'cart')}
              onChange={(e) => set({ cartVariable: cleanVariable(e.target.value) })}
            />
          </Field>
          <Field
            label="Write the summary to"
            hint="Then show it with a Send WhatsApp node."
          >
            <Input
              className="font-mono text-caption"
              value={String(config.outputVariable ?? 'cart_summary')}
              onChange={(e) => set({ outputVariable: cleanVariable(e.target.value) })}
            />
          </Field>
          <Field label="If the basket is empty">
            <Input
              value={String(config.emptyText ?? '')}
              placeholder="Your basket is empty."
              onChange={(e) => set({ emptyText: e.target.value })}
            />
          </Field>
        </>
      );

    case 'CREATE_ORDER':
      return (
        <>
          <Field label="Basket variable">
            <Input
              className="font-mono text-caption"
              value={String(config.cartVariable ?? 'cart')}
              onChange={(e) => set({ cartVariable: cleanVariable(e.target.value) })}
            />
          </Field>
          <Field label="Customer name in" hint="Optional. Falls back to their WhatsApp profile name.">
            <Input
              className="font-mono text-caption"
              value={String(config.customerNameVariable ?? '')}
              placeholder="customer_name"
              onChange={(e) => set({ customerNameVariable: cleanVariable(e.target.value) || undefined })}
            />
          </Field>
          <Field label="Delivery address in" hint="Optional.">
            <Input
              className="font-mono text-caption"
              value={String(config.addressVariable ?? '')}
              placeholder="delivery_address"
              onChange={(e) => set({ addressVariable: cleanVariable(e.target.value) || undefined })}
            />
          </Field>
          <Field label="Store the order as" hint="Then use {{vars.order.orderNumber}} in your confirmation.">
            <Input
              className="font-mono text-caption"
              value={String(config.outputVariable ?? 'order')}
              onChange={(e) => set({ outputVariable: cleanVariable(e.target.value) })}
            />
          </Field>
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/15 p-2">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-ink-900" />
            <span className="text-caption leading-snug text-ink-900">
              This creates a real order. The workflow must confirm with the customer first, or it
              won't publish.
            </span>
          </div>
        </>
      );

    case 'SEND_WHATSAPP_TEMPLATE':
      return (
        <>
          <Field label="Template name" hint="Must be approved in your WhatsApp Business account.">
            <Input
              value={String(config.templateName ?? '')}
              onChange={(e) => set({ templateName: e.target.value })}
            />
          </Field>
          <Field label="Language">
            <Input
              value={String(config.language ?? 'en')}
              onChange={(e) => set({ language: e.target.value })}
            />
          </Field>
        </>
      );

    case 'DATABASE_LOOKUP':
      return (
        <>
          <Field
            label="What to read"
            hint="A closed list, not a query. Order lookups are always limited to the customer in this conversation."
          >
            <Select
              value={String(config.resource ?? 'order')}
              onValueChange={(v) => set({ resource: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(DB_RESOURCE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {config.resource !== 'recent_orders' && (
            <Field
              label={config.resource === 'menu_item' ? 'Search for' : 'Order number'}
              hint="Usually a variable an earlier question stored."
            >
              <Input
                value={String(config.query ?? '')}
                placeholder="{{vars.order_number}}"
                onChange={(e) => set({ query: e.target.value })}
              />
              <TemplateHint />
            </Field>
          )}
          <Field label="Store the result in" hint={VARIABLE_HINT}>
            <Input
              className="font-mono text-caption"
              value={String(config.outputVariable ?? '')}
              placeholder="record"
              onChange={(e) => set({ outputVariable: cleanVariable(e.target.value) })}
            />
          </Field>
          <Field
            label="Store the rows in"
            hint="For a list result. A List Message set to “Rows from a variable” renders these."
          >
            <Input
              className="font-mono text-caption"
              value={String(config.itemsVariable ?? '')}
              placeholder="orders"
              onChange={(e) => set({ itemsVariable: cleanVariable(e.target.value) })}
            />
          </Field>
        </>
      );

    case 'DATABASE_WRITE':
      return (
        <>
          <div className="rounded-lg border border-warning/40 bg-warning/15 p-2">
            <p className="text-caption leading-snug text-ink-900">
              This changes a real order, so the workflow cannot be published without a
              confirmation step before it. Only the customer's own orders can be reached, and only
              while they are still cancellable.
            </p>
          </div>
          <Field label="Order number to cancel" hint="Usually the variable the lookup above used.">
            <Input
              value={String(config.target ?? '')}
              placeholder="{{vars.order_number}}"
              onChange={(e) => set({ target: e.target.value })}
            />
            <TemplateHint />
          </Field>
          <Field label="Store the outcome in" hint={VARIABLE_HINT}>
            <Input
              className="font-mono text-caption"
              value={String(config.outputVariable ?? '')}
              placeholder="write_result"
              onChange={(e) => set({ outputVariable: cleanVariable(e.target.value) })}
            />
          </Field>
        </>
      );

    case 'CONNECTOR_QUERY':
    case 'CONNECTOR_ACTION':
      return <ConnectorFields config={config} set={set} action={node.data.type === 'CONNECTOR_ACTION'} />;

    default:
      return (
        <div className="rounded-lg border border-warning/40 bg-warning/15 p-3">
          <p className="text-caption font-medium text-ink-900">No runtime yet</p>
          <p className="mt-1 text-caption leading-snug text-ink-900">
            The engine skips this node type and continues to the next one. You can place it to sketch
            the flow, but it will do nothing when the workflow runs.
          </p>
        </div>
      );
  }
}

export default function NodeConfigPanel({
  node, issues, onPatch, onPatchConfig, onDelete, canDelete,
}: Props) {
  const spec = specFor(node.data.type);
  const Icon = spec.icon;
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <div className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', spec.accent)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink-700">{spec.label}</h2>
          <p className="text-caption leading-tight text-ink-500">{spec.blurb}</p>
        </div>
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="space-y-1">
          {[...errors, ...warnings].map((issue, i) => (
            <li
              key={i}
              className={cn(
                'flex items-start gap-2 rounded-md border p-2 text-caption leading-snug',
                issue.level === 'error'
                  ? 'border-danger/30 bg-danger/10 text-danger'
                  : 'border-warning/40 bg-warning/15 text-ink-900',
              )}
            >
              {issue.level === 'error'
                ? <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-danger" />
                : <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-ink-900" />}
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      <Field label="Name on the canvas">
        <Input
          value={node.data.name}
          placeholder={spec.label}
          onChange={(e) => onPatch({ name: e.target.value })}
        />
      </Field>

      <div className="space-y-4 border-t pt-4">
        <ConfigFields node={node} onPatchConfig={onPatchConfig} />
      </div>

      <div className="border-t pt-4">
        <Field
          label="Save this node's output as"
          hint={node.data.outputVariable
            ? `Later nodes can read {{vars.${node.data.outputVariable}}}.`
            : "Leave blank if nothing downstream needs this node's result."}
        >
          <Input
            className="font-mono text-caption"
            value={node.data.outputVariable ?? ''}
            placeholder="e.g. reply_id"
            onChange={(e) => onPatch({ outputVariable: cleanVariable(e.target.value) || null })}
          />
        </Field>
      </div>

      <div className="border-t pt-3">
        <div className="mb-3 font-mono text-caption text-ink-300">{node.id}</div>
        {canDelete ? (
          <Button
            variant="outline" size="sm"
            className="w-full gap-1 border-danger/30 text-danger hover:bg-danger/10 hover:text-danger"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete node
          </Button>
        ) : (
          <p className="flex items-start gap-1 text-caption text-ink-500">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" />
            The entry node can't be deleted — every workflow needs somewhere to start.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Connector node fields.
 *
 * The operation is chosen from what is actually registered, never typed. That
 * is the same property that makes the router safe: a node can only name
 * something that exists, so a graph cannot reference an operation nobody
 * defined, and the input fields below are generated from that operation's own
 * declaration rather than from a free-form JSON box.
 */
function ConnectorFields({
  config, set, action,
}: {
  config: NodeConfig;
  set: (patch: NodeConfig) => void;
  action: boolean;
}) {
  const { data } = useQuery({
    queryKey: ['engine', 'connectors'],
    queryFn: () => engine.connectors.list(),
    staleTime: 30_000,
  });

  const connectors = data?.connectors ?? [];
  const connector = connectors.find((c) => c.key === config.connectorKey);
  const operations = connector?.operations ?? [];
  const operation = operations.find((o) => o.key === config.operationKey);

  const values = Array.isArray(config.inputs)
    ? (config.inputs as Array<{ key: string; value: string }>)
    : [];
  const valueFor = (key: string) => values.find((v) => v.key === key)?.value ?? '';

  const setValue = (key: string, value: string) => {
    const next = values.filter((v) => v.key !== key);
    next.push({ key, value });
    // Keep the declared order, so the node config reads the way the operation
    // is documented rather than in the order someone happened to type.
    const order = (operation?.inputs ?? []).map((i) => i.key);
    next.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    set({ inputs: next });
  };

  if (!connectors.length) {
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/15 p-3">
        <p className="text-caption font-medium text-ink-900">No connectors yet</p>
        <p className="mt-1 text-caption leading-snug text-ink-900">
          Register one under Connectors first. A node names a connector and an operation — it never
          holds a URL or a credential.
        </p>
      </div>
    );
  }

  return (
    <>
      <Field label="Connector">
        <Select
          value={String(config.connectorKey ?? '')}
          onValueChange={(v) => set({ connectorKey: v, operationKey: '', inputs: [] })}
        >
          <SelectTrigger><SelectValue placeholder="Choose a connector" /></SelectTrigger>
          <SelectContent>
            {connectors.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.name}
                {c.status === 'DISABLED' ? ' (disabled)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {connector && (
        <Field label="Operation">
          <Select
            value={String(config.operationKey ?? '')}
            onValueChange={(v) => set({ operationKey: v, inputs: [] })}
          >
            <SelectTrigger><SelectValue placeholder="Choose an operation" /></SelectTrigger>
            <SelectContent>
              {operations.map((o) => (
                <SelectItem key={o.key} value={o.key}>
                  {o.name}
                  {o.sideEffecting ? ' · changes data' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      {/*
        A mismatch between the node type and the operation is worth saying out
        loud: a read placed in an Action node is only untidy, but a write placed
        in a Query node escapes the confirmation rule the validator enforces.
      */}
      {operation && operation.sideEffecting && !action && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-2">
          <p className="text-caption leading-snug text-danger">
            <strong>{operation.name}</strong> changes data on the far end. Use a Connector Action
            node instead, so publishing requires a confirmation step.
          </p>
        </div>
      )}

      {operation?.inputs.map((input) => (
        <Field
          key={input.key}
          label={`${input.label}${input.required ? '' : ' (optional)'}`}
          hint={input.description ?? `Sent in the ${input.in}.`}
        >
          <Input
            value={valueFor(input.key)}
            placeholder={input.key === 'phone' ? '{{customer.waId}}' : `{{vars.${input.key}}}`}
            onChange={(e) => setValue(input.key, e.target.value)}
          />
        </Field>
      ))}

      {operation && <TemplateHint />}

      <Field label="Store the response in" hint={VARIABLE_HINT}>
        <Input
          className="font-mono text-caption"
          value={String(config.outputVariable ?? '')}
          placeholder="connector_result"
          onChange={(e) => set({ outputVariable: cleanVariable(e.target.value) })}
        />
      </Field>

      <Field
        label="Store the rows in"
        hint="For an operation that returns a list. A List Message set to “Rows from a variable” renders these."
      >
        <Input
          className="font-mono text-caption"
          value={String(config.itemsVariable ?? '')}
          placeholder="students"
          onChange={(e) => set({ itemsVariable: cleanVariable(e.target.value) })}
        />
      </Field>
    </>
  );
}
