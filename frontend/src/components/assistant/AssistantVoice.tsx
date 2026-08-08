import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, RotateCcw, Save } from 'lucide-react';
import { engine, type RoutingConfig } from '@/lib/engine/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/*
 * How the assistant sounds, and what it declines.
 *
 * ── Inherited text is shown, not pre-filled ─────────────────────────────────
 *
 * Every field here falls back to the workspace's business category and then to a ZunoPilot default,
 * so somebody who has set none of them still has an assistant with a whole personality. Two obvious
 * ways to render that, and both are wrong:
 *
 *   • Empty boxes — honest about what is stored, and useless: it tells a workspace nothing about what
 *     their assistant is actually saying to customers right now.
 *   • Boxes pre-filled with the inherited text — informative, and it quietly ends the inheritance the
 *     first time anybody presses Save. The category's wording gets copied into their row, and every
 *     later improvement to it never reaches them.
 *
 * So an unset field **displays** its inherited value as read-only text, with one button to take a copy
 * and start editing. Nothing is adopted by accident, and nobody has to guess what their bot says.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 *
 * The rules that stop the assistant quoting a price, promising a refund, giving medical advice or
 * discussing how it is configured are in the server's prompt and are not editable. A field long
 * enough to hold "ignore the rules below" would be a way around them, which is also why the caps
 * below come from the server rather than being typed here.
 */

interface Props {
  assistantId: string;
  assistant: RoutingConfig['assistant'];
}

/** The five copy fields, keyed as the API names them. */
type Field =
  | 'generalSystemPrompt' | 'outOfScopeTopics' | 'unknownAnswerReply' | 'outOfScopeReply'
  | 'replyWordLimit' | 'replyLanguage';

export default function AssistantVoice({ assistantId, assistant }: Props) {
  const qc = useQueryClient();
  const { resolvedCopy: resolved, categoryLabel, copyLimits: limits } = assistant;

  /**
   * Only the fields being edited.
   *
   * A field absent from this object is untouched — which is what keeps a save from writing five
   * columns when somebody changed one, and keeps "unset, inheriting" distinguishable from
   * "explicitly set to the same words".
   */
  const [draft, setDraft] = useState<Partial<Record<Field, string | number | null>>>({});
  const editing = (field: Field) => field in draft;
  const dirty = Object.keys(draft).length > 0;

  const save = useMutation({
    mutationFn: () => engine.assistants.update(assistantId, draft),
    onSuccess: () => {
      toast.success('Saved. New messages use it straight away.');
      setDraft({});
      qc.invalidateQueries({ queryKey: ['engine', 'routing', assistantId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  /** Start editing, taking the inherited wording as a starting point. */
  const customise = (field: Field, startFrom: string | number | null) =>
    setDraft((d) => ({ ...d, [field]: startFrom }));

  /** Go back to inheriting. `null` is the value that means that, all the way to the column. */
  const reset = (field: Field) => setDraft((d) => ({ ...d, [field]: null }));

  /** Stop editing without changing anything. */
  const cancelField = (field: Field) => setDraft((d) => {
    const next = { ...d };
    delete next[field];
    return next;
  });

  const sourceLabel = (field: keyof typeof resolved.sources) => {
    const source = resolved.sources[field];
    if (source === 'category') return `Inherited from ${categoryLabel ?? 'your category'}`;
    if (source === 'house') return 'ZunoPilot default';
    return 'Yours';
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-body">How the assistant sounds</CardTitle>
        <CardDescription>
          Tone, what it declines, and how it words the two things it cannot answer. The rules that
          stop it quoting prices, promising refunds or giving medical advice are ours and are not
          editable — this is voice and scope, not guardrails.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <FieldRow
          label="Persona"
          hint="Tone and manner. One or two sentences is usually enough."
          source={sourceLabel('persona')}
          editing={editing('generalSystemPrompt')}
          resolved={resolved.persona}
          onCustomise={() => customise('generalSystemPrompt', resolved.persona)}
          onReset={() => reset('generalSystemPrompt')}
          onCancel={() => cancelField('generalSystemPrompt')}
          isReset={draft.generalSystemPrompt === null}
        >
          <Textarea
            rows={3}
            maxLength={limits.personaChars}
            value={String(draft.generalSystemPrompt ?? '')}
            onChange={(e) => setDraft((d) => ({ ...d, generalSystemPrompt: e.target.value }))}
          />
        </FieldRow>

        <FieldRow
          label="Topics it declines"
          hint={'One per line. Added to what it already declines: personal matters, health, other '
            + 'companies, anything unrelated to your business.'}
          source={sourceLabel('outOfScopeTopics')}
          editing={editing('outOfScopeTopics')}
          resolved={resolved.outOfScopeTopics || 'Nothing beyond the topics every assistant declines.'}
          onCustomise={() => customise('outOfScopeTopics', resolved.outOfScopeTopics)}
          onReset={() => reset('outOfScopeTopics')}
          onCancel={() => cancelField('outOfScopeTopics')}
          isReset={draft.outOfScopeTopics === null}
        >
          <Textarea
            rows={4}
            value={String(draft.outOfScopeTopics ?? '')}
            placeholder={'recruitment enquiries\nrefund policy for other sellers'}
            onChange={(e) => setDraft((d) => ({ ...d, outOfScopeTopics: e.target.value }))}
          />
          <p className="text-caption text-ink-500">
            {limits.topicLines} lines at most, {limits.topicLineChars} characters each.
          </p>
        </FieldRow>

        <FieldRow
          label="When it doesn't know the answer"
          hint="Only for questions about your business that your material does not cover."
          source={sourceLabel('unknownAnswerReply')}
          editing={editing('unknownAnswerReply')}
          resolved={resolved.unknownAnswerReply}
          onCustomise={() => customise('unknownAnswerReply', resolved.unknownAnswerReply)}
          onReset={() => reset('unknownAnswerReply')}
          onCancel={() => cancelField('unknownAnswerReply')}
          isReset={draft.unknownAnswerReply === null}
        >
          <Input
            maxLength={limits.replyChars}
            value={String(draft.unknownAnswerReply ?? '')}
            onChange={(e) => setDraft((d) => ({ ...d, unknownAnswerReply: e.target.value }))}
          />
        </FieldRow>

        <FieldRow
          label="When it's asked something out of scope"
          hint={'For anything not about your business. It will not offer to pass these on — nobody '
            + 'here can follow them up, and saying otherwise leaves the customer waiting.'}
          source={sourceLabel('outOfScopeReply')}
          editing={editing('outOfScopeReply')}
          resolved={resolved.outOfScopeReply}
          onCustomise={() => customise('outOfScopeReply', resolved.outOfScopeReply)}
          onReset={() => reset('outOfScopeReply')}
          onCancel={() => cancelField('outOfScopeReply')}
          isReset={draft.outOfScopeReply === null}
        >
          <Input
            maxLength={limits.replyChars}
            value={String(draft.outOfScopeReply ?? '')}
            onChange={(e) => setDraft((d) => ({ ...d, outOfScopeReply: e.target.value }))}
          />
        </FieldRow>

        <div className="grid gap-6 sm:grid-cols-2">
          <FieldRow
            label="Reply length"
            hint="Roughly, in words. Short is right for most questions; raise it if yours need detail."
            source={sourceLabel('replyWordLimit')}
            editing={editing('replyWordLimit')}
            resolved={`About ${resolved.replyWordLimit} words`}
            onCustomise={() => customise('replyWordLimit', resolved.replyWordLimit)}
            onReset={() => reset('replyWordLimit')}
            onCancel={() => cancelField('replyWordLimit')}
            isReset={draft.replyWordLimit === null}
          >
            <Input
              type="number"
              min={limits.wordLimitMin}
              max={limits.wordLimitMax}
              value={String(draft.replyWordLimit ?? '')}
              onChange={(e) => setDraft((d) => ({
                ...d, replyWordLimit: e.target.value === '' ? null : Number(e.target.value),
              }))}
            />
            <p className="text-caption text-ink-500">
              Between {limits.wordLimitMin} and {limits.wordLimitMax}.
            </p>
          </FieldRow>

          <FieldRow
            label="Language"
            hint="Leave it mirroring the customer unless you only answer in one language."
            source={sourceLabel('replyLanguage')}
            editing={editing('replyLanguage')}
            resolved={resolved.replyLanguage ?? 'Whatever language the customer writes in'}
            onCustomise={() => customise('replyLanguage', resolved.replyLanguage ?? '')}
            onReset={() => reset('replyLanguage')}
            onCancel={() => cancelField('replyLanguage')}
            isReset={draft.replyLanguage === null}
          >
            <Input
              placeholder="English"
              value={String(draft.replyLanguage ?? '')}
              onChange={(e) => setDraft((d) => ({ ...d, replyLanguage: e.target.value }))}
            />
            <p className="text-caption text-ink-500">
              The language&apos;s name, not a code. Blank to go back to mirroring.
            </p>
          </FieldRow>
        </div>

        {dirty && (
          <div className="flex items-center gap-3 border-t border-ink-300 pt-4">
            <Button className="gap-2" disabled={save.isPending} onClick={() => save.mutate()}>
              <Save className="h-4 w-4" />
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="outline" disabled={save.isPending} onClick={() => setDraft({})}>
              Discard
            </Button>
            <span className="text-caption text-ink-500">
              Takes effect on the next message. Try it on the{' '}
              {/* The try-it box builds the identical prompt, so a preview there is the real thing. */}
              Knowledge page to hear it first.
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One field: either what it inherits, or the control for editing it.
 *
 * The two states are deliberately different shapes rather than an input that is sometimes greyed
 * out. "This is what your assistant says, and it came from your category" and "this is what you are
 * typing" are different facts, and a disabled input holding inherited text invites exactly the
 * misreading the comment at the top of this file is about.
 */
function FieldRow({
  label, hint, source, resolved, editing, isReset, onCustomise, onReset, onCancel, children,
}: {
  label: string;
  hint: string;
  source: string;
  /** What the assistant is using today, rendered when this field is not being edited. */
  resolved: string;
  editing: boolean;
  /** Being reset in this unsaved draft — the field will go back to inheriting on save. */
  isReset: boolean;
  onCustomise: () => void;
  onReset: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>{label}</Label>
        <span className="text-caption text-ink-500">{isReset ? 'Back to inherited' : source}</span>
      </div>

      {editing && !isReset ? (
        <>
          {children}
          <button
            type="button"
            className="inline-flex items-center gap-1 text-caption text-accent-600 hover:underline"
            onClick={onCancel}
          >
            <RotateCcw className="h-3 w-3" /> Leave it as it was
          </button>
        </>
      ) : (
        <div className="space-y-2">
          <div className="whitespace-pre-wrap rounded-md border border-ink-300 bg-surface-0 p-3 text-sm text-ink-700">
            {resolved}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-caption text-accent-600 hover:underline"
              onClick={onCustomise}
            >
              <Pencil className="h-3 w-3" /> {isReset ? 'Write your own again' : 'Write your own'}
            </button>
            {!isReset && source === 'Yours' && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-caption text-ink-500 hover:underline"
                onClick={onReset}
              >
                <RotateCcw className="h-3 w-3" /> Go back to the default
              </button>
            )}
          </div>
        </div>
      )}

      <p className="text-caption text-ink-500">{hint}</p>
    </div>
  );
}
