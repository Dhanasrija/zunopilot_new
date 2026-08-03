import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

// Editing one customer's tags.
//
// Sends the full set rather than a diff, matching the endpoint: the customer ends up with
// exactly the tags shown here, so removing one is just submitting a shorter list.

export function TagEditor({ customer, open, onOpenChange }: {
  customer: { id: string; name?: string | null; waId: string; tags?: string[] } | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (open) { setTags(customer?.tags ?? []); setDraft(''); }
  }, [open, customer]);

  const save = useMutation({
    mutationFn: () => api.patch(`/customers/${customer!.id}`, { tags }),
    onSuccess: () => {
      toast.success('Tags saved');
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customer-tags'] });
      onOpenChange(false);
    },
  });

  /**
   * Lowercased here as well as on the server.
   *
   * Not redundant: it means the chip you see is the tag that gets stored, so adding "VIP"
   * next to an existing "vip" visibly collapses instead of looking accepted and then
   * silently merging on save.
   */
  const add = () => {
    const tag = draft.trim().toLowerCase();
    if (!tag) return;
    setTags((current) => (current.includes(tag) ? current : [...current, tag]));
    setDraft('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tags for {customer?.name || customer?.waId}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={draft}
              placeholder="vip"
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            />
            <Button variant="outline" onClick={add} disabled={!draft.trim()}>Add</Button>
          </div>

          {tags.length === 0 ? (
            <p className="text-caption text-muted-foreground">
              No tags. Tags group people for filtering, and a routing rule can send tagged
              customers to a different workflow.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1">
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remove ${tag}`}
                    onClick={() => setTags((current) => current.filter((t) => t !== tag))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}

          <p className="text-caption text-muted-foreground">
            Stored lowercase, so “VIP” and “vip” are one tag. Up to 20 per customer.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save tags'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
