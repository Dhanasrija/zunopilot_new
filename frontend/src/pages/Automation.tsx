import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';

interface Rule { id: string; keywords: string[]; response: string; isActive: boolean; priority: number }

export default function Automation() {
  const qc = useQueryClient();
  const { data: rules = [] } = useQuery({
    queryKey: ['rules'],
    queryFn: async () => (await api.get<{ data: Rule[] }>('/automation/keywords')).data.data,
  });
  const { data: fallback } = useQuery({
    queryKey: ['fallback'],
    queryFn: async () => (await api.get<{ data: { response: string } | null }>('/automation/fallback')).data.data,
  });

  const [kw, setKw] = useState('');
  const [resp, setResp] = useState('');
  const [fbDraft, setFbDraft] = useState(fallback?.response ?? '');
  // Sync once fallback loads.
  if (fallback?.response && fbDraft === '') setFbDraft(fallback.response);

  const createRule = useMutation({
    mutationFn: async () => api.post('/automation/keywords', {
      keywords: kw.split(',').map((s) => s.trim()).filter(Boolean),
      response: resp,
    }),
    onSuccess: () => { setKw(''); setResp(''); toast.success('Rule added'); qc.invalidateQueries({ queryKey: ['rules'] }); },
  });

  const toggleRule = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const rule = rules.find((r) => r.id === id)!;
      return api.patch(`/automation/keywords/${id}`, { keywords: rule.keywords, response: rule.response, isActive });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });

  const deleteRule = useMutation({
    mutationFn: async (id: string) => api.delete(`/automation/keywords/${id}`),
    onSuccess: () => { toast.success('Removed'); qc.invalidateQueries({ queryKey: ['rules'] }); },
  });

  const saveFallback = useMutation({
    mutationFn: async () => api.put('/automation/fallback', { response: fbDraft }),
    onSuccess: () => { toast.success('Fallback updated'); qc.invalidateQueries({ queryKey: ['fallback'] }); },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-h2 font-semibold">Automation</h1>
        <p className="text-sm text-muted-foreground">Keyword rules and fallback message.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>New keyword rule</CardTitle>
          <CardDescription>Comma-separated keywords trigger the response (case-insensitive).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Keywords</Label><Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="timings, open, hours" /></div>
          <div><Label>Response</Label><Textarea value={resp} onChange={(e) => setResp(e.target.value)} placeholder="We are open daily from 11:00 AM to 11:00 PM." /></div>
          <Button onClick={() => createRule.mutate()} disabled={!kw || !resp}>Add rule</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Existing rules</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Keywords</TableHead><TableHead>Response</TableHead><TableHead>Active</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-caption">{r.keywords.join(', ')}</TableCell>
                  <TableCell className="max-w-md truncate">{r.response}</TableCell>
                  <TableCell><Switch checked={r.isActive} onCheckedChange={(v) => toggleRule.mutate({ id: r.id, isActive: v })} /></TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => deleteRule.mutate(r.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Fallback</CardTitle><CardDescription>Shown when no rule or order flow matches.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={fbDraft} onChange={(e) => setFbDraft(e.target.value)} />
          <Button onClick={() => saveFallback.mutate()}>Save</Button>
        </CardContent>
      </Card>
    </div>
  );
}
