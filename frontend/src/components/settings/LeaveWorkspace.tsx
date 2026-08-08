import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth.store';
import { leaveWorkspace } from '@/lib/workspace';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

/**
 * Leaving a workspace you no longer want to be in.
 *
 * ── Why this exists, and why here ────────────────────────────────────────────
 *
 * An invitation needs no acceptance. That is the right trade for a small team adding a colleague, and
 * it means somebody can be given access to a business they have never heard of. The only thing that
 * makes that defensible is being able to leave without asking the people who added you.
 *
 * On the Profile tab rather than in the account menu, deliberately: the menu is a list of where you
 * can be, and this is a decision with consequences that wants room to say what they are. It is only
 * shown to somebody with more than one workspace — the server refuses to let anybody leave their
 * only one, because a login with no workspaces cannot sign in anywhere.
 */
export default function LeaveWorkspace() {
  const workspaces = useAuthStore((s) => s.workspaces);
  const tenant = useAuthStore((s) => s.tenant);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);

  if (workspaces.length < 2 || !tenant) return null;

  const next = workspaces.find((workspace) => workspace.id !== tenant.id && !workspace.isSuspended);

  const leave = async () => {
    setLeaving(true);
    try {
      // Resolves only if it failed, or if the workspace left was not the open one — otherwise the
      // page is already reloading into the next workspace.
      await leaveWorkspace(tenant.id);
    } catch {
      // The interceptor has already said what went wrong. The two refusals worth reading are
      // "you are the last person who can manage this" and "this is your only workspace".
      setLeaving(false);
      return;
    }
    setConfirming(false);
    setLeaving(false);
    toast.success(`You have left ${tenant.businessName}.`);
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-body">Leave this workspace</CardTitle>
        <CardDescription>
          You will lose access to {tenant.businessName} — its inbox, customers and orders. Your other
          workspaces are unaffected, and someone there can add you back.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={() => setConfirming(true)}>
          <LogOut className="mr-2 h-4 w-4" />
          Leave {tenant.businessName}
        </Button>
      </CardContent>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave {tenant.businessName}?</DialogTitle>
            <DialogDescription>
              {/*
                Says what happens next rather than only what is lost. Somebody about to leave wants to
                know where they land, and the answer is a workspace they can name.
              */}
              You will be signed into {next ? next.businessName : 'another workspace'} instead. Any
              conversations assigned to you here go back to the team, and your reminders for this
              workspace are removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={leaving}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={leave} disabled={leaving}>
              {leaving ? 'Leaving…' : 'Leave workspace'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
