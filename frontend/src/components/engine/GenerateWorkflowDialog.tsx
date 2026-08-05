import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import type { ValidationIssue } from '@/lib/engine/api';
import {
  AlertTriangle, CheckCircle2, Loader2, PlayCircle, Sparkles, Wrench, XCircle,
} from 'lucide-react';

// Generate a workflow from a description.
//
// The result is always a DRAFT, and the gaps come back with it. That framing is
// the point of the screen: this saves the typing, it does not remove the review.
// Showing "here is what I could not work out" next to "here is what I built" is
// what keeps someone from publishing a graph they never read.

interface RepairAttempt {
  attempt: number;
  issues: ValidationIssue[];
}

interface JourneyReport {
  /** Mirrors the backend's union, including `RUNNING` — a real draft produced it. */
  outcome:
    | 'COMPLETED' | 'CANCELLED' | 'FAILED' | 'HUMAN_HANDOFF' | 'PAUSED'
    | 'RUNNING' | 'PENDING' | 'WAITING_FOR_APPROVAL'
    | 'STALLED';
  reached: string[];
  failures: Array<{ nodeId: string; status: string; error: unknown }>;
  emptyChoices: string[];
  turns: number;
  endedAt: string | null;
}

interface GenerationResponse {
  workflow: { id: string; name: string; slug: string | null };
  gaps: string[];
  issues: ValidationIssue[];
  /** What each repair turn was asked to fix. Empty when the first plan worked. */
  repairs: RepairAttempt[];
  /**
   * Still broken after the last attempt — and the authoritative "blocks publish" list.
   *
   * A superset of the validation errors, because it also carries the warnings a
   * *generator* is not allowed to leave behind. Eight unreachable nodes are only a
   * warning to the validator, and reading them as advisory here is precisely how a
   * draft with a dead second half got published.
   */
  unresolved: ValidationIssue[];
  /** What walking the draft found. Advisory. Null when it could not be run. */
  dryRun: JourneyReport | null;
  dryRunSkipped: string | null;
  stepCount: number;
  model: string;
  latencyMs: number;
}

const sameIssue = (a: ValidationIssue, b: ValidationIssue) =>
  a.code === b.code && a.nodeId === b.nodeId && a.message === b.message;

/**
 * What each non-completed outcome means to someone reading it.
 *
 * `RUNNING` is the one worth spelling out: the walk returned with the run neither
 * finished nor waiting on anything, which is what the first real generated draft did.
 */
const DRY_RUN_OUTCOME: Record<JourneyReport['outcome'], string> = {
  COMPLETED: 'Ran the whole way through.',
  STALLED: 'Kept asking the same question without moving on.',
  RUNNING: 'Stopped part-way, without finishing or asking anything.',
  PENDING: 'Never started.',
  PAUSED: 'Paused part-way and nothing would resume it.',
  WAITING_FOR_APPROVAL: 'Stopped to wait for an approval.',
  HUMAN_HANDOFF: 'Ended by handing the customer to a person.',
  FAILED: 'Failed part-way.',
  CANCELLED: 'The run was cancelled.',
};

const EXAMPLE = 'When a parent asks to cancel a class, check whether their WhatsApp number is '
  + 'registered. If registered, show their students. After they choose a student, fetch the next '
  + 'three classes, ask them to select one, confirm, then cancel it and send the result.';

export default function GenerateWorkflowDialog({
  open, onOpenChange, assistantId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assistantId: string;
}) {
  const navigate = useNavigate();
  const [description, setDescription] = useState('');
  const [result, setResult] = useState<GenerationResponse | null>(null);

  useEffect(() => {
    if (open) { setDescription(''); setResult(null); }
  }, [open]);

  const generate = useMutation({
    mutationFn: async () => {
      const response = await api.post<{ data: GenerationResponse }>(
        `/assistants/${assistantId}/workflows/generate`,
        { description },
      );
      return response.data.data;
    },
    onSuccess: setResult,
  });

  // `unresolved` is the blocking list, not `issues.filter(level === 'error')`.
  //
  // The old code split on `level`, which put the largest generation fault — nodes that
  // can never run — under a one-line "N warnings, see Flow Check" footnote. Eight of
  // those meant the whole second half of the flow was dead, and it published.
  const blocking = result?.unresolved ?? [];
  // Whatever is left is genuinely advisory: warnings the generator was allowed to
  // leave. Filtered against `blocking` so nothing is listed twice.
  const advisory = (result?.issues ?? []).filter(
    (i) => i.level === 'warning' && !blocking.some((b) => sameIssue(b, i)),
  );
  const repaired = result?.repairs.length ?? 0;
  const clean = result && !blocking.length && !result.gaps.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(40rem,92vw)] max-w-none flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-body">
            <Sparkles className="h-4 w-4 text-accent-600" />
            Describe a workflow
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {!result && (
            <>
              <div className="space-y-1">
                <Label>What should happen, and in what order?</Label>
                <Textarea
                  rows={7}
                  value={description}
                  placeholder={EXAMPLE}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <p className="text-caption leading-snug text-ink-500">
                  It can only use connectors you have registered. Anything it cannot work out comes
                  back as a gap for you to fill in rather than a guess.
                </p>
              </div>

              {generate.isError && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-caption text-danger">
                  {(generate.error as Error).message}
                </div>
              )}
            </>
          )}

          {result && (
            <div className="space-y-3">
              <div className="rounded-lg border p-3">
                <p className="text-sm font-medium text-ink-700">{result.workflow.name}</p>
                <p className="mt-px text-caption text-ink-500">
                  {result.stepCount} steps · saved as a draft · {result.model}
                </p>
              </div>

              {clean && (
                <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3">
                  <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-success" />
                  <p className="text-caption text-success">
                    Nothing missing — this would pass the publish check as it stands. Open it, read
                    it through, and test the flow before publishing.
                  </p>
                </div>
              )}

              {result.gaps.length > 0 && (
                <div className="rounded-lg border border-warning/40 bg-warning/15 p-3">
                  <p className="flex items-center gap-1 text-caption font-medium text-ink-900">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {result.gaps.length} thing{result.gaps.length === 1 ? '' : 's'} to fill in
                  </p>
                  <ul className="mt-1 space-y-1">
                    {result.gaps.map((gap) => (
                      <li key={gap} className="text-caption leading-snug text-ink-900">• {gap}</li>
                    ))}
                  </ul>
                </div>
              )}

              {blocking.length > 0 && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 p-3">
                  <p className="flex items-center gap-1 text-caption font-medium text-danger">
                    <XCircle className="h-3.5 w-3.5" />
                    {blocking.length} thing{blocking.length === 1 ? '' : 's'} blocking publish
                  </p>
                  <p className="mt-1 text-caption leading-snug text-danger">
                    {repaired > 0
                      ? `Asked for a fix ${repaired === 1 ? 'once' : `${repaired} times`} and these still stand. `
                      : ''}
                    Fix them in the builder — publishing is refused until you do.
                  </p>
                  <ul className="mt-2 space-y-1">
                    {blocking.map((issue, i) => (
                      <li key={`${issue.code}-${i}`} className="text-caption leading-snug text-danger">
                        • {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Only worth saying when it worked. A failed repair is already covered
                  by the blocking panel above, which says how many times it tried. */}
              {repaired > 0 && blocking.length === 0 && (
                <p className="flex items-start gap-1 text-caption text-ink-500">
                  <Wrench className="mt-px h-3.5 w-3.5 shrink-0" />
                  The first attempt had problems; asked again and
                  {repaired === 1 ? ' the second' : ` attempt ${repaired + 1}`} came back clean.
                </p>
              )}

              {result.dryRun && (
                <div className="rounded-lg border p-3">
                  <p className="flex items-center gap-1 text-caption font-medium text-ink-700">
                    <PlayCircle className="h-3.5 w-3.5" />
                    Test run
                  </p>
                  <p className="mt-1 text-caption leading-snug text-ink-500">
                    {/* Named per outcome rather than printing the enum. "Stopped at
                        step5 (running)" was the first thing a real draft produced,
                        and it reads as a contradiction. */}
                    {result.dryRun.outcome === 'COMPLETED'
                      ? `Walked the whole flow — ${result.dryRun.reached.length} steps ran, `
                        + `${result.dryRun.turns} repl${result.dryRun.turns === 1 ? 'y' : 'ies'}, nothing failed.`
                      : `${DRY_RUN_OUTCOME[result.dryRun.outcome]} `
                        + `Got as far as ${result.dryRun.endedAt ?? 'an unknown step'}, `
                        + `${result.dryRun.reached.length} step${result.dryRun.reached.length === 1 ? '' : 's'} in.`}
                  </p>
                  {result.dryRun.failures.length > 0 && (
                    <ul className="mt-1 space-y-1">
                      {result.dryRun.failures.map((f) => (
                        <li key={f.nodeId} className="text-caption leading-snug text-ink-900">
                          • {f.nodeId} failed
                        </li>
                      ))}
                    </ul>
                  )}
                  {result.dryRun.emptyChoices.length > 0 && (
                    <p className="mt-1 text-caption leading-snug text-ink-900">
                      {result.dryRun.emptyChoices.join(', ')} had nothing to offer. A test run uses
                      each operation&rsquo;s recorded sample response — add one and this can go further.
                    </p>
                  )}
                  {/* The honest limit, stated where someone might otherwise over-read
                      a clean result. */}
                  <p className="mt-2 text-caption leading-snug text-ink-500">
                    A test run calls nothing real, so every step gets its sample answer. It shows the
                    flow can run, not that it decides correctly.
                  </p>
                </div>
              )}

              {result.dryRunSkipped && (
                <p className="text-caption leading-snug text-ink-500">
                  Could not test-run this draft: {result.dryRunSkipped}
                </p>
              )}

              {advisory.length > 0 && (
                <p className="text-caption text-ink-500">
                  {advisory.length} warning{advisory.length === 1 ? '' : 's'} — see Flow Check in the builder.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t px-4 py-3">
          {!result ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                disabled={description.trim().length < 20 || generate.isPending}
                onClick={() => generate.mutate()}
              >
                {generate.isPending
                  ? <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Building…</>
                  : 'Generate draft'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button onClick={() => navigate(`/workflows/${result.workflow.id}`)}>
                Open in the builder
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
