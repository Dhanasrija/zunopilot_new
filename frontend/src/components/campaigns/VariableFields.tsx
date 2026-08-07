import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Filling a template's `{{1}}`, `{{2}}` placeholders.
//
// **This is the input that did not exist.** A campaign went out against a template opening
// `Hi {{1}},` and every recipient was rejected by Meta — `variableValues` was empty because
// the composer read the template's `variables` array and then never asked for anything. Any
// template with a placeholder was undeliverable to its entire audience.
//
// Two kinds of value, because a placeholder is used for two different things: one string for
// everybody, or a field off each recipient. The second is the common case — `Hi {{1}},` is
// written that way precisely so it can say the customer's name.

export type CustomerField = 'name' | 'phone';

export type VariableValue =
  | { kind: 'TEXT'; value: string }
  | { kind: 'CUSTOMER'; field: CustomerField; fallback: string };

export type VariableValues = Record<string, VariableValue>;

/** What each source is called on screen, and what it stands in for in the preview. */
const CUSTOMER_LABEL: Record<CustomerField, string> = {
  name: "customer's name",
  phone: "customer's number",
};

export const emptyValue = (): VariableValue => ({ kind: 'TEXT', value: '' });

/**
 * The placeholders still waiting for something.
 *
 * A CUSTOMER value is never missing: its fallback is required, so it always resolves to
 * something. Only a blank literal counts — and it must, because Meta refuses an empty
 * parameter exactly as it refuses a missing one.
 */
export const missingVariables = (variables: string[], values: VariableValues): string[] =>
  variables.filter((name) => {
    const value = values[name];
    if (!value) return true;
    return value.kind === 'TEXT' && value.value.trim() === '';
  });

/**
 * What to show in each slot of the preview.
 *
 * A per-recipient field cannot be previewed truthfully — there is no one answer — so it is
 * shown as a bracketed label rather than a guess. Seeing `Hi [customer's name],` is the
 * point: it tells the operator the message is personalised without implying every customer
 * is called whatever the fallback happens to be.
 */
export const previewParams = (variables: string[], values: VariableValues): string[] =>
  variables.map((name) => {
    const value = values[name];
    if (!value) return `{{${name}}}`;
    if (value.kind === 'CUSTOMER') return `[${CUSTOMER_LABEL[value.field]}]`;
    return value.value.trim() || `{{${name}}}`;
  });

/** Body text with the filled placeholders substituted. Unfilled ones are left alone. */
export const renderBody = (body: string, params: string[]): string =>
  body.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, token: string) => {
    const index = Number(token);
    if (!Number.isInteger(index) || index < 1 || index > params.length) return whole;
    return params[index - 1] ?? whole;
  });

interface Props {
  variables: string[];
  values: VariableValues;
  onChange: (values: VariableValues) => void;
}

export function VariableFields({ variables, values, onChange }: Props) {
  if (variables.length === 0) return null;

  const set = (name: string, value: VariableValue) => onChange({ ...values, [name]: value });

  return (
    <div className="space-y-3">
      <div>
        <Label>Placeholders</Label>
        <p className="text-caption text-muted-foreground">
          This template has {variables.length === 1 ? 'a blank' : `${variables.length} blanks`} to
          fill. WhatsApp rejects the message if any is left empty.
        </p>
      </div>

      {variables.map((name) => {
        const value = values[name] ?? emptyValue();
        const selectId = `var-${name}-source`;
        const inputId = `var-${name}-value`;

        return (
          <div key={name} className="rounded-md border p-3 space-y-2">
            <div className="flex items-center gap-2">
              {/* The same chip the preview uses for an unfilled placeholder, so the field
                  and the bubble above it are visibly the same thing. */}
              <code className="rounded-sm bg-accent-100 px-1 text-caption font-medium text-accent-700">
                {`{{${name}}}`}
              </code>
              <select
                id={selectId}
                aria-label={`What fills {{${name}}}`}
                className="h-9 flex-1 rounded-md border border-ink-400 bg-surface-1 px-2 text-sm text-ink-900"
                value={value.kind === 'CUSTOMER' ? `customer.${value.field}` : 'text'}
                onChange={(e) => {
                  const choice = e.target.value;
                  set(name, choice === 'text'
                    ? { kind: 'TEXT', value: '' }
                    : {
                      kind: 'CUSTOMER',
                      field: choice.split('.')[1] as CustomerField,
                      // A fallback is offered rather than demanded blank: the one contact
                      // with no profile name would otherwise fail on its own, which is the
                      // hardest kind of failure to notice.
                      fallback: 'there',
                    });
                }}
              >
                <option value="text">The same for everyone</option>
                <option value="customer.name">Each customer&rsquo;s name</option>
                <option value="customer.phone">Each customer&rsquo;s number</option>
              </select>
            </div>

            {value.kind === 'TEXT' ? (
              <Input
                id={inputId}
                value={value.value}
                placeholder="Diwali"
                aria-label={`Value for {{${name}}}`}
                onChange={(e) => set(name, { kind: 'TEXT', value: e.target.value })}
              />
            ) : (
              <div className="space-y-1">
                <Label htmlFor={inputId} className="text-caption font-normal text-muted-foreground">
                  If a customer has no {value.field === 'name' ? 'name' : 'number'} on record,
                  use
                </Label>
                <Input
                  id={inputId}
                  value={value.fallback}
                  placeholder="there"
                  aria-label={`Fallback for {{${name}}}`}
                  onChange={(e) => set(name, { ...value, fallback: e.target.value })}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
