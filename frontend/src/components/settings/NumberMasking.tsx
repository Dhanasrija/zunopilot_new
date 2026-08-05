import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useCan } from '@/stores/auth.store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { EyeOff, Lock } from 'lucide-react';

// Settings → hiding customer phone numbers from team members.
//
// **What this switch actually does is server-side.** Turning it on makes every endpoint that
// returns a customer redact the number before responding — the browser never receives the
// digits. That is the only version of this feature that works: masking in React would leave
// the number in the JSON, one devtools panel away.
//
// **Who is exempt** is a permission, not a role check: `customers:view_full_number` sits on
// the Owner role, and owners resolve to every permission. A workspace that wants one trusted
// manager to keep seeing numbers grants that key on a custom role in Team → Roles, rather
// than making them an owner.

interface TenantProfile {
  maskCustomerNumbers?: boolean;
}

export default function NumberMasking() {
  const queryClient = useQueryClient();
  const canWrite = useCan('settings:write');

  // **`['tenant.me']`, matching the key `Settings.tsx` already uses.** A second key for the
  // same resource meant saving the business profile left this card showing stale state, and
  // toggling this left the profile form stale — two caches for one row.
  const profile = useQuery({
    queryKey: ['tenant.me'],
    queryFn: async () => (await api.get<{ data: TenantProfile }>('/tenant/me')).data.data,
  });

  const save = useMutation({
    mutationFn: async (maskCustomerNumbers: boolean) =>
      (await api.patch<{ data: TenantProfile }>('/tenant/me', { maskCustomerNumbers })).data.data,
    onSuccess: (tenant) => {
      queryClient.invalidateQueries({ queryKey: ['tenant.me'] });
      // Every screen showing a customer is now returning different data, so their caches are
      // stale in a way no refetch interval will fix quickly enough to avoid confusion.
      for (const key of ['customers', 'conversations', 'orders', 'tickets']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      toast.success(
        tenant.maskCustomerNumbers
          ? 'Phone numbers are now hidden from your team'
          : 'Phone numbers are visible to your team again',
      );
    },
    onError: () => toast.error('That setting could not be saved'),
  });

  const on = Boolean(profile.data?.maskCustomerNumbers);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <EyeOff className="h-4 w-4 text-ink-500" />
          Customer phone numbers
        </CardTitle>
        <CardDescription>
          Who on your team can see the numbers your customers message you from.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Label htmlFor="mask-numbers" className="text-sm text-ink-900">
              Hide numbers from team members
            </Label>
            <p className="mt-px text-caption leading-snug text-ink-500">
              Your team sees only the last four digits — <span className="font-mono">+••••••••6670</span> —
              across Customers, the Inbox, Orders and Support. You keep seeing the full number.
            </p>
          </div>
          <Switch
            id="mask-numbers"
            checked={on}
            disabled={!canWrite || profile.isLoading || save.isPending}
            onCheckedChange={(checked) => save.mutate(checked)}
          />
        </div>

        {!canWrite && (
          <p className="flex items-start gap-2 text-caption leading-snug text-ink-500">
            <Lock className="mt-px h-3.5 w-3.5 shrink-0" />
            Only the workspace owner can change this.
          </p>
        )}

        {on && (
          // Said plainly, because the two things people assume are wrong: that this hides
          // numbers from WhatsApp too, and that a team member could dig them out anyway.
          <div className="rounded-lg border border-ink-300 bg-surface-0 p-3">
            <p className="text-caption leading-snug text-ink-700">
              Messages still send normally — the number is hidden from the screen, not from
              WhatsApp. Numbers are removed on the server, so they are not in the page for
              anyone to find. To let one person keep full access, grant them
              <span className="font-medium"> See full phone numbers</span> in Team → Roles.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
