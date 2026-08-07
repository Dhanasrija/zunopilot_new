import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/ui/empty-state';
import { useHasModule } from '@/stores/auth.store';

// Auto-replies: the workspace's keyword rules, and the line a customer gets when nothing
// matched.
//
// **Two halves, and only one of them is a module.** `KEYWORD_RULES` gates the keyword rules —
// an operator switch, off for a business whose conversations all run through workflows. The
// fallback message is not gated, because it is what every customer gets when nothing else
// answered, and a workspace that cannot edit it is stuck with a seeded default written for
// somebody else's business. That asymmetry is the whole reason this page renders the two
// sections independently rather than gating itself at the route.
//
// The server enforces both halves; this file only decides what is worth showing.

interface Rule {
  id: string;
  keywords: string[];
  response: string;
  isActive: boolean;
  priority: number;
}

/** What the row is currently editing, or null when it is just being displayed. */
interface Draft {
  keywords: string;
  response: string;
  priority: string;
}

const draftOf = (rule: Rule): Draft => ({
  keywords: rule.keywords.join(', '),
  response: rule.response,
  priority: String(rule.priority),
});

const splitKeywords = (value: string): string[] =>
  value.split(',').map((word) => word.trim()).filter(Boolean);

export default function Automation() {
  const qc = useQueryClient();
  const keywordsEnabled = useHasModule('KEYWORD_RULES');

  const { data: rules = [], isLoading: loadingRules } = useQuery({
    queryKey: ['keyword-rules'],
    queryFn: async () => (await api.get<{ data: Rule[] }>('/automation/keywords')).data.data,
    // A workspace without the module gets a 404 from this route by design. Asking anyway would
    // fire the interceptor's error toast on every page load.
    enabled: keywordsEnabled,
  });

  const { data: fallback } = useQuery({
    queryKey: ['fallback'],
    queryFn: async () => (
      await api.get<{ data: { response: string } | null }>('/automation/fallback')
    ).data.data,
  });

  const [kw, setKw] = useState('');
  const [resp, setResp] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ keywords: '', response: '', priority: '0' });
  const [fbDraft, setFbDraft] = useState('');

  /*
   * The fallback box, synced from the server.
   *
   * This used to be a bare `if (fallback?.response && fbDraft === '') setFbDraft(...)` in the
   * render body, which had two faults: it never re-synced after a refetch, so an edit made in
   * another tab was silently overwritten by whatever was still in this box, and clearing the
   * field to empty re-populated it on the next render because empty was its "not loaded yet"
   * signal. Keying the effect on the server value fixes both.
   */
  useEffect(() => { setFbDraft(fallback?.response ?? ''); }, [fallback?.response]);

  const createRule = useMutation({
    mutationFn: async () => api.post('/automation/keywords', {
      keywords: splitKeywords(kw),
      response: resp,
    }),
    onSuccess: () => {
      setKw(''); setResp('');
      toast.success('Rule added');
      qc.invalidateQueries({ queryKey: ['keyword-rules'] });
    },
  });

  // One mutation for every partial change — the toggle, the inline edit, the priority. The API
  // used to demand the whole rule on a PATCH, so a toggle had to read the row out of the cache
  // and write it all back, which is a lost update the moment two people edit one rule.
  const patchRule = useMutation({
    mutationFn: async ({ id, ...fields }: { id: string } & Partial<Omit<Rule, 'id'>>) =>
      api.patch(`/automation/keywords/${id}`, fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['keyword-rules'] }),
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => api.delete(`/automation/keywords/${id}`),
    onSuccess: () => {
      toast.success('Removed');
      qc.invalidateQueries({ queryKey: ['keyword-rules'] });
    },
  });

  const saveFallback = useMutation({
    mutationFn: async () => api.put('/automation/fallback', { response: fbDraft }),
    onSuccess: () => {
      toast.success('Fallback updated');
      qc.invalidateQueries({ queryKey: ['fallback'] });
    },
  });

  const startEditing = (rule: Rule) => { setEditing(rule.id); setDraft(draftOf(rule)); };

  const commitEdit = (id: string) => {
    const keywords = splitKeywords(draft.keywords);
    if (!keywords.length || !draft.response.trim()) return;
    patchRule.mutate(
      {
        id,
        keywords,
        response: draft.response.trim(),
        priority: Number(draft.priority) || 0,
      },
      { onSuccess: () => setEditing(null) },
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h2 font-semibold">Auto-replies</h1>
        <p className="text-sm text-muted-foreground">
          Stock answers for the questions you get most, and what to say when none of them fit.
        </p>
      </div>

      {keywordsEnabled ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>New keyword rule</CardTitle>
              <CardDescription>
                If a message mentions any of these words, this is the reply. Case does not matter.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="new-keywords">Keywords</Label>
                <Input
                  id="new-keywords"
                  value={kw}
                  onChange={(e) => setKw(e.target.value)}
                  placeholder="timings, open, hours"
                />
                <p className="text-caption text-muted-foreground">Separate them with commas.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-response">Reply</Label>
                <Textarea
                  id="new-response"
                  value={resp}
                  onChange={(e) => setResp(e.target.value)}
                  placeholder="We are open daily from 11:00 AM to 11:00 PM."
                />
              </div>
              <Button
                // Outline until it can do something — a half-faded solid accent button reads as
                // a live control that is failing. Same rule as the catalogue's Add.
                variant={kw && resp ? 'default' : 'outline'}
                disabled={!kw || !resp || createRule.isPending}
                onClick={() => createRule.mutate()}
              >
                {createRule.isPending ? 'Adding…' : 'Add rule'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your rules</CardTitle>
              <CardDescription>
                Checked from the top down. The first rule that matches is the one that answers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingRules ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
              ) : rules.length === 0 ? (
                <EmptyState>
                  No rules yet. Add one above and the assistant will answer that question
                  without anyone having to be at a keyboard.
                </EmptyState>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Keywords</TableHead>
                      <TableHead>Reply</TableHead>
                      <TableHead>Order</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map((rule) => (editing === rule.id ? (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <Input
                            aria-label={`Keywords for ${rule.keywords.join(', ')}`}
                            value={draft.keywords}
                            autoFocus
                            onChange={(e) => setDraft({ ...draft, keywords: e.target.value })}
                            onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                          />
                        </TableCell>
                        <TableCell>
                          <Textarea
                            aria-label={`Reply for ${rule.keywords.join(', ')}`}
                            value={draft.response}
                            onChange={(e) => setDraft({ ...draft, response: e.target.value })}
                            onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            aria-label={`Order for ${rule.keywords.join(', ')}`}
                            value={draft.priority}
                            inputMode="numeric"
                            className="w-16"
                            onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setEditing(null);
                              if (e.key === 'Enter') commitEdit(rule.id);
                            }}
                          />
                        </TableCell>
                        <TableCell />
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Save changes"
                            disabled={patchRule.isPending}
                            onClick={() => commitEdit(rule.id)}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Cancel"
                            onClick={() => setEditing(null)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={rule.id}>
                        <TableCell className="font-mono text-caption">
                          {rule.keywords.join(', ')}
                        </TableCell>
                        <TableCell className="max-w-md truncate">{rule.response}</TableCell>
                        <TableCell className="text-caption text-muted-foreground">
                          {rule.priority}
                        </TableCell>
                        <TableCell>
                          <Switch
                            aria-label={`${rule.keywords.join(', ')} active`}
                            checked={rule.isActive}
                            onCheckedChange={(isActive) => patchRule.mutate({ id: rule.id, isActive })}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Edit ${rule.keywords.join(', ')}`}
                            onClick={() => startEditing(rule)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Delete ${rule.keywords.join(', ')}`}
                            disabled={deleteRule.isPending}
                            onClick={() => deleteRule.mutate(rule.id)}
                          >
                            <Trash2 className="h-4 w-4 text-danger" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Keyword replies are switched off</CardTitle>
            <CardDescription>
              Keyword replies are not turned on for this workspace, so the assistant answers
              through your workflows and the message below instead. Contact us if you would like
              them enabled — any rules you had before are still saved.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>When nothing matches</CardTitle>
          <CardDescription>
            The reply a customer gets when no rule, workflow or order step fits what they said.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            aria-label="Fallback message"
            value={fbDraft}
            onChange={(e) => setFbDraft(e.target.value)}
          />
          <Button
            disabled={!fbDraft.trim() || saveFallback.isPending}
            onClick={() => saveFallback.mutate()}
          >
            {saveFallback.isPending ? 'Saving…' : 'Save'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
