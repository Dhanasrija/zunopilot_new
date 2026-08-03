import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import PhraseList from './PhraseList';
import { emptyDefinition } from '@/lib/engine/types';
import { Bot, CalendarClock, Loader2 } from 'lucide-react';

// Create workflow.
//
// A conversation workflow cannot be created without its capability contract,
// because a workflow the router cannot select is not a workflow — it is a graph
// nobody will ever reach. The minimums (3 positive, 2 negative examples) are
// the backend's, enforced here so the failure arrives while the author is still
// thinking about intent rather than at publish time.

const slugify = (name: string) => name
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 64);

export default function CreateWorkflowDialog({
  open, onOpenChange, pending, onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pending: boolean;
  onCreate: (body: Record<string, unknown>) => void;
}) {
  const [step, setStep] = useState<'type' | 'details'>('type');
  const [category, setCategory] = useState<'CONVERSATION' | 'EVENT'>('CONVERSATION');
  const [name, setName] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slug, setSlug] = useState('');
  const [purpose, setPurpose] = useState('');
  const [useWhen, setUseWhen] = useState<string[]>([]);
  const [doNotUseWhen, setDoNotUseWhen] = useState<string[]>([]);
  const [positive, setPositive] = useState<string[]>([]);
  const [negative, setNegative] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setStep('type');
    setCategory('CONVERSATION');
    setName(''); setSlug(''); setSlugTouched(false); setPurpose('');
    setUseWhen([]); setDoNotUseWhen([]); setPositive([]); setNegative([]);
  }, [open]);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  const isConversation = category === 'CONVERSATION';

  const problems: string[] = [];
  if (!name.trim()) problems.push('Name is required');
  if (isConversation) {
    if (purpose.trim().length < 10) problems.push('Purpose must say what the workflow achieves');
    if (useWhen.length < 1) problems.push('Add at least one "use when" condition');
    if (positive.length < 3) problems.push(`${3 - positive.length} more positive example${3 - positive.length === 1 ? '' : 's'} needed`);
    if (negative.length < 2) problems.push(`${2 - negative.length} more negative example${2 - negative.length === 1 ? '' : 's'} needed`);
  }

  const submit = () => {
    onCreate({
      name: name.trim(),
      slug: slug || undefined,
      category,
      description: purpose.trim() || null,
      definition: emptyDefinition(),
      ...(isConversation
        ? {
          capability: {
            purpose: purpose.trim(),
            useWhen,
            doNotUseWhen,
            positiveExamples: positive,
            negativeExamples: negative,
            requiredInputs: [],
            optionalInputs: [],
            preconditions: [],
            sideEffects: [],
            requiresConfirmation: false,
            minimumConfidence: 0.8,
            allowsInterruption: false,
          },
        }
        : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(38rem,92vw)] max-w-none flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-body">New workflow</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {step === 'type' ? (
            <div className="space-y-3">
              {([
                {
                  value: 'CONVERSATION' as const,
                  icon: Bot,
                  title: 'Conversation Workflow',
                  blurb: 'Started when the assistant identifies the user\'s intent. Begins with an Assistant Route Entry node.',
                },
                {
                  value: 'EVENT' as const,
                  icon: CalendarClock,
                  title: 'Event Workflow',
                  blurb: 'Started by a webhook, a schedule or a business event — not by something the customer says.',
                },
              ]).map((option) => (
                <button
                  key={option.value}
                  onClick={() => setCategory(option.value)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                    category === option.value
                      ? 'border-accent-600 bg-accent-100/60 ring-1 ring-accent-100'
                      : 'border-ink-300 hover:border-ink-300',
                  )}
                >
                  <div className={cn(
                    'grid h-9 w-9 shrink-0 place-items-center rounded-lg',
                    category === option.value ? 'bg-accent-100 text-accent-700' : 'bg-surface-0 text-ink-500',
                  )}
                  >
                    <option.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-ink-700">{option.title}</div>
                    <p className="mt-px text-caption leading-snug text-ink-500">{option.blurb}</p>
                  </div>
                </button>
              ))}

              {category === 'EVENT' && (
                <div className="rounded-md border border-warning/40 bg-warning/15 p-3 text-caption text-ink-900">
                  Event triggers have no runtime yet — the engine will skip the trigger node. You can
                  build and save the flow, but it will not fire.
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="wf-name">Name</Label>
                  <Input
                    id="wf-name" value={name} autoComplete="off"
                    placeholder="Appointment Booking"
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="wf-slug">Slug</Label>
                  <Input
                    id="wf-slug" value={slug} autoComplete="off"
                    className="font-mono text-caption"
                    placeholder="appointment_booking"
                    onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }}
                  />
                  <p className="text-caption text-ink-500">What the router selects by.</p>
                </div>
              </div>

              {isConversation && (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="wf-purpose">Purpose</Label>
                    <Textarea
                      id="wf-purpose" rows={2} value={purpose}
                      placeholder="Create a confirmed doctor appointment"
                      onChange={(e) => setPurpose(e.target.value)}
                    />
                    <p className="text-caption text-ink-500">
                      One line saying what this achieves. The router reads it.
                    </p>
                  </div>

                  <PhraseList
                    label="Use this workflow when"
                    value={useWhen}
                    onChange={setUseWhen}
                    placeholder="The user explicitly wants to book an appointment"
                  />
                  <PhraseList
                    label="Do NOT use this workflow when"
                    value={doNotUseWhen}
                    onChange={setDoNotUseWhen}
                    placeholder="The user only asks whether a doctor is available"
                  />
                  <PhraseList
                    label="Positive examples"
                    hint="Things a customer would actually type. At least 3."
                    value={positive}
                    onChange={setPositive}
                    minimum={3}
                    placeholder="I want to book a cardiologist appointment"
                  />
                  <PhraseList
                    label="Negative examples"
                    hint="Messages that look close but must NOT select this. At least 2 — this is what stops the router confusing near-neighbours."
                    value={negative}
                    onChange={setNegative}
                    minimum={2}
                    placeholder="Is Dr Rao available tomorrow?"
                  />
                </>
              )}

              {problems.length > 0 && (
                <ul className="space-y-1 rounded-md border border-warning/40 bg-warning/15 p-3">
                  {problems.map((problem) => (
                    <li key={problem} className="text-caption text-ink-900">• {problem}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 border-t px-4 py-3">
          {step === 'type' ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button className="bg-accent-600 hover:bg-accent-700" onClick={() => setStep('details')}>
                Continue
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('type')}>Back</Button>
              <Button
                className="gap-1 bg-accent-600 hover:bg-accent-700"
                disabled={problems.length > 0 || pending}
                onClick={submit}
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Create workflow
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
