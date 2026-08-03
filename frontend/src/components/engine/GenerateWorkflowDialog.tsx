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
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, XCircle } from 'lucide-react';

// Generate a workflow from a description.
//
// The result is always a DRAFT, and the gaps come back with it. That framing is
// the point of the screen: this saves the typing, it does not remove the review.
// Showing "here is what I could not work out" next to "here is what I built" is
// what keeps someone from publishing a graph they never read.

interface GenerationResponse {
  workflow: { id: string; name: string; slug: string | null };
  gaps: string[];
  issues: ValidationIssue[];
  stepCount: number;
  model: string;
  latencyMs: number;
}

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

  const errors = (result?.issues ?? []).filter((i) => i.level === 'error');
  const warnings = (result?.issues ?? []).filter((i) => i.level === 'warning');
  const clean = result && !errors.length && !result.gaps.length;

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

              {errors.length > 0 && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 p-3">
                  <p className="flex items-center gap-1 text-caption font-medium text-danger">
                    <XCircle className="h-3.5 w-3.5" />
                    {errors.length} thing{errors.length === 1 ? '' : 's'} blocking publish
                  </p>
                  <ul className="mt-1 space-y-1">
                    {errors.map((issue, i) => (
                      <li key={`${issue.code}-${i}`} className="text-caption leading-snug text-danger">
                        • {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {warnings.length > 0 && (
                <p className="text-caption text-ink-500">
                  {warnings.length} warning{warnings.length === 1 ? '' : 's'} — see Flow Check in the builder.
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
