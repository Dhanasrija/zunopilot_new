import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import PhraseList from './PhraseList';
import type { CapabilityContract } from '@/lib/engine/api';
import { AlertTriangle, ShieldAlert } from 'lucide-react';

// Routing metadata — the capability contract.
//
// This is the only thing the router is ever shown about a workflow. Not the
// node graph, not URLs, not credentials. Everything here is written for the
// person authoring it: the field labels are questions, and the two rules that
// actually block a publish are called out inline rather than saved for the
// error list.

export default function CapabilityEditor({
  value, onChange,
}: {
  value: CapabilityContract;
  onChange: (next: CapabilityContract) => void;
}) {
  const set = (patch: Partial<CapabilityContract>) => onChange({ ...value, ...patch });

  const hasSideEffects = value.sideEffects.length > 0;
  const unconfirmed = hasSideEffects && !value.requiresConfirmation;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ink-300 bg-surface-0 p-3">
        <p className="text-caption leading-snug text-ink-500">
          This is everything the router sees about this workflow. It never sees the node graph.
          The examples do most of the work — especially the negative ones.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="cap-purpose">Purpose</Label>
        <Textarea
          id="cap-purpose" rows={2}
          value={value.purpose}
          placeholder="Create a confirmed doctor appointment"
          onChange={(e) => set({ purpose: e.target.value })}
        />
        <p className="text-caption text-ink-500">
          One line saying what this achieves. Shown to the router and on the routing page.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="cap-desc">Description</Label>
        <Textarea
          id="cap-desc" rows={2}
          value={value.description ?? ''}
          placeholder="Collects requirements, checks slots and creates an appointment."
          onChange={(e) => set({ description: e.target.value })}
        />
      </div>

      <PhraseList
        label="Use this workflow when"
        value={value.useWhen}
        onChange={(useWhen) => set({ useWhen })}
        placeholder="The user explicitly wants to book an appointment"
      />

      <PhraseList
        label="Do NOT use this workflow when"
        hint="Name the neighbouring workflows here. This is how the router tells near-identical intents apart."
        value={value.doNotUseWhen}
        onChange={(doNotUseWhen) => set({ doNotUseWhen })}
        placeholder="The user only asks whether a doctor is available"
      />

      <PhraseList
        label="Positive examples"
        hint="Things a customer would actually type."
        minimum={3}
        value={value.positiveExamples}
        onChange={(positiveExamples) => set({ positiveExamples })}
        placeholder="I want to book a cardiologist appointment"
      />

      <PhraseList
        label="Negative examples"
        hint="Messages that look close but must NOT select this workflow. Quote what a customer would say when they mean a different one."
        minimum={2}
        value={value.negativeExamples}
        onChange={(negativeExamples) => set({ negativeExamples })}
        placeholder="Is Dr Rao available tomorrow?"
      />

      <div className="space-y-1 border-t pt-4">
        <Label>Required inputs</Label>
        <p className="text-caption text-ink-500">
          Values the router may extract from the message. It never invents them — a workflow still
          asks for anything that's missing.
        </p>
        <PhraseList
          label=""
          value={value.requiredInputs.map((i) => i.key)}
          onChange={(keys) => set({
            requiredInputs: keys.map((key) => value.requiredInputs.find((i) => i.key === key)
              ?? { key, label: key.replace(/_/g, ' '), type: 'string' }),
          })}
          placeholder="speciality"
        />
      </div>

      <PhraseList
        label="Preconditions"
        value={value.preconditions}
        onChange={(preconditions) => set({ preconditions })}
        placeholder="The user has indicated an intent to create an appointment"
      />

      <PhraseList
        label="Side effects"
        hint="Anything this workflow changes that the customer cannot undo."
        value={value.sideEffects}
        onChange={(sideEffects) => set({ sideEffects })}
        placeholder="Creates an appointment record"
      />

      {unconfirmed && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3">
          <ShieldAlert className="mt-px h-4 w-4 shrink-0 text-danger" />
          <div className="text-caption leading-snug text-danger">
            <strong>This will block publishing.</strong> A workflow with side effects must require
            confirmation. It is the rule that stops an availability question from booking an
            appointment.
          </div>
        </div>
      )}

      <div className="space-y-4 border-t pt-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label>Requires confirmation</Label>
            <p className="text-caption text-ink-500">
              The flow must confirm with the customer before acting.
            </p>
          </div>
          <Switch
            checked={value.requiresConfirmation}
            onCheckedChange={(v) => set({ requiresConfirmation: v })}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <Label>Allows interruption</Label>
            <p className="text-caption text-ink-500">
              Whether an unrelated message may abandon this mid-run.
            </p>
          </div>
          <Switch
            checked={value.allowsInterruption}
            onCheckedChange={(v) => set({ allowsInterruption: v })}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="cap-confidence">Minimum confidence</Label>
          <Input
            id="cap-confidence" type="number" step="0.05" min="0" max="1"
            value={value.minimumConfidence}
            onChange={(e) => set({ minimumConfidence: Number(e.target.value) })}
          />
          <p className="text-caption leading-snug text-ink-500">
            Applies on top of the assistant's threshold — whichever is stricter wins. Raise it for
            anything transactional.
          </p>
          {hasSideEffects && value.minimumConfidence < 0.7 && (
            <p className="flex items-start gap-1 text-caption leading-snug text-ink-900">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              Low for a workflow with side effects — a near-miss message could trigger a real action.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
