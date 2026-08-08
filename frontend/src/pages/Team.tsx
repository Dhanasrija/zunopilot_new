import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Link } from 'react-router-dom';
import { usePermissions } from '@/lib/permissions';
import { useRoles, type RoleRow } from '@/lib/roles';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PhoneField } from '@/components/ui/phone-field';
import { detectCountry, fullNumber, type Country } from '@/lib/countries';
import { cn, formatDateTime } from '@/lib/utils';
import { Copy, KeyRound, Loader2, ShieldCheck, UserPlus, Users } from 'lucide-react';

// Team.
//
// Deactivation, not deletion — a member is referenced by every conversation
// they were assigned and every note they wrote, and that history is the point
// of a shared inbox.

interface Member {
  id: string;
  /** The login identifier. Null only for accounts that predate OTP login. */
  phone: string | null;
  /** Optional now — nothing signs in with it. */
  email: string | null;
  fullName: string;
  roleId: string | null;
  assignedRole: { id: string; name: string; isOwner: boolean; permissions: string[] } | null;
  /** @deprecated The legacy enum. Only a fallback label for pre-roles accounts. */
  role: string;
  isActive: boolean;
  createdAt: string;
  openConversations: number;
  isYou: boolean;
}

const ROLE_STYLE: Record<string, string> = {
  OWNER: 'border-accent-100 bg-accent-100 text-accent-700',
  MANAGER: 'border-accent-100 bg-accent-100 text-accent-700',
  AGENT: 'border-ink-300 bg-surface-0 text-ink-700',
};

export default function Team() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const manage = can('team:manage');

  const [inviting, setInviting] = useState(false);
  /**
   * `draft.phone` is the **national part only**. The dial code lives in `inviteCountry` and is joined
   * on submit.
   *
   * It used to be seeded with the string `'+91 '` in a free-text field, which an inviter could
   * half-overwrite. **The consequence of a mistyped number has changed, and got worse.** It used to
   * fail: `User.phone` is unique platform-wide, so a number belonging to somebody else was refused.
   * Now that a person can be in several workspaces, a number belonging to a stranger **succeeds** —
   * it silently attaches their account to this workspace, and they are told so by a notification
   * naming whoever did it. That is why the dial code is not typed and the number is not free text.
   */
  const [draft, setDraft] = useState({
    fullName: '', phone: '', email: '', roleId: '',
  });
  const [inviteCountry, setInviteCountry] = useState<Country>(detectCountry);

  // The workspace's own roles, not three fixed ones.
  const { data: roleData } = useRoles();
  const roles: RoleRow[] = roleData?.roles ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['team'],
    queryFn: () => api.get<{ data: Member[] }>('/team')
      .then((r) => ({ members: r.data.data })),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['team'] });

  const invite = useMutation({
    mutationFn: () => api
      // The dial code is joined here rather than held in the field, so an invite
      // cannot be sent to a number missing its country code.
      .post<{ data: Member; meta?: { attached?: boolean } }>(
        '/team', { ...draft, phone: fullNumber(inviteCountry, draft.phone) },
      )
      .then((r) => r.data),
    onSuccess: (response) => {
      setInviting(false);
      setDraft({ fullName: '', phone: '', email: '', roleId: '' });
      // Reset the country too, so inviting a second person does not silently inherit
      // the first one's country.
      setInviteCountry(detectCountry());
      /*
       * Two different things happened, so there are two sentences.
       *
       * `attached` means that number already had a ZunoPilot account and has been added to this
       * workspace — they keep their own name and their own password-less sign-in, and "they can sign
       * in now" would be telling somebody about an account they have had for a year. Their real name
       * is what comes back, not the one typed on this form.
       */
      toast.success(response.meta?.attached
        ? `${response.data.fullName} already had a ZunoPilot account and now has access to this workspace.`
        : `${response.data.fullName} can sign in with their mobile number now.`);
      refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/team/${id}`, body),
    onSuccess: () => { toast.success('Team updated'); refresh(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const members = data?.members ?? [];
  /*
   * How many active people can still manage the team. Asked of their role's permissions rather than a
   * fixed "owner", because roles are the workspace's own now — an owner role counts implicitly.
   *
   * **Already correct under memberships, and needs no filter.** `GET /team` returns this workspace's
   * memberships and nothing else, so `members`, this count, `administers`, `lockedRole` and `isYou`
   * are all per-workspace by construction. Somebody who is an owner elsewhere appears here with the
   * role they hold *here*. Adding a tenant filter on the client would only be able to make that
   * wrong.
   */
  const activeAdmins = members.filter((m) => m.isActive && (
    m.assignedRole?.isOwner || m.assignedRole?.permissions.includes('team:manage')
  )).length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h2 font-semibold">Team</h1>
          <p className="text-sm text-muted-foreground">
            Everyone here shares one inbox. Roles decide what each person can change.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-1" asChild>
            <Link to="/roles"><ShieldCheck className="h-4 w-4" /> Roles</Link>
          </Button>
          {manage && (
            <Button className="gap-1" onClick={() => setInviting(true)}>
              <UserPlus className="h-4 w-4" /> Add someone
            </Button>
          )}
        </div>
      </div>

      {/* The workspace's own roles, whatever it has called them. */}
      {roles.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-3">
          {roles.map((role) => (
            <div key={role.id} className="rounded-lg border p-3">
              <div className="flex items-center gap-1">
                <Badge variant="outline" className="text-caption">{role.name}</Badge>
                <span className="text-caption text-muted-foreground">
                  {role.isOwner ? 'everything' : `${role.permissions.length} permissions`}
                </span>
              </div>
              <p className="mt-1 text-caption leading-snug text-muted-foreground">
                {role.description ?? 'No description.'}
              </p>
            </div>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <table className="table-stack w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-caption uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Member</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Open chats</th>
                  <th className="px-4 py-2 font-medium">Joined</th>
                  {manage && <th className="px-4 py-2 text-right font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  // The last active owner cannot be moved out of the role, and
                  // nobody can change their own — showing a control that always
                  // fails is worse than not showing it.
                  // Nobody changes their own role, and the last person who can
                  // manage the team cannot be moved off that role — showing a
                  // control that always fails is worse than not showing it.
                  const administers = member.assignedRole?.isOwner
                    || member.assignedRole?.permissions.includes('team:manage')
                    || false;
                  const lockedRole = member.isYou || (administers && activeAdmins === 1);

                  return (
                    <tr key={member.id} className={cn('border-b last:border-0', !member.isActive && 'opacity-50')}>
                      <td data-label="Member" className="px-4 py-3">
                        <div className="flex items-center gap-1 font-medium">
                          {member.fullName}
                          {member.isYou && (
                            <span className="rounded bg-surface-0 px-1 py-px text-caption text-ink-500">you</span>
                          )}
                          {!member.isActive && (
                            <span className="rounded bg-danger/10 px-1 py-px text-caption text-danger">deactivated</span>
                          )}
                        </div>
                        {/* The number first: it is how they sign in, so it is the
                            identifier a colleague needs to recognise. */}
                        <div className="text-caption text-muted-foreground">
                          {[member.phone ? `+${member.phone}` : null, member.email]
                            .filter(Boolean).join(' · ') || 'No sign-in details'}
                        </div>
                      </td>
                      <td data-label="Role" className="px-4 py-3">
                        {manage && !lockedRole ? (
                          <Select
                            value={member.roleId ?? ''}
                            onValueChange={(roleId) => update.mutate({ id: member.id, body: { roleId } })}
                          >
                            <SelectTrigger className="h-7 w-[9.5rem] text-caption"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {roles.map((role) => (
                                <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline" className="text-caption">
                            {member.assignedRole?.name ?? member.role}
                          </Badge>
                        )}
                      </td>
                      <td data-label="Open chats" className="px-4 py-3 text-muted-foreground">{member.openConversations}</td>
                      <td data-label="Joined" className="px-4 py-3 text-caption text-muted-foreground">
                        {formatDateTime(member.createdAt)}
                      </td>
                      {manage && (
                        <td className="px-4 py-3 text-right">
                          {/*
                            Your own row has no action, because locking yourself out
                            is always a mistake and — if you are the only owner — one
                            nobody left in the workspace can undo. Saying so beats an
                            empty cell that reads as a missing feature.
                          */}
                          {member.isYou ? (
                            <span className="text-caption text-muted-foreground">
                              Ask another owner
                            </span>
                          ) : administers && activeAdmins === 1 && member.isActive ? (
                            <span className="text-caption text-muted-foreground">
                              Only admin
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className={cn('h-7 text-caption', member.isActive && 'text-danger')}
                              disabled={update.isPending}
                              onClick={() => {
                                // Deactivating takes someone off a live inbox, so it
                                // says what happens rather than just doing it.
                                if (member.isActive && !window.confirm(
                                  `Remove ${member.fullName} from this workspace?\n\n`
                                  + `They lose access to this workspace immediately, and any `
                                  + `conversations assigned to them go back to the shared pool.\n\n`
                                  + `Their account and any other workspaces they belong to are `
                                  + `unaffected. Their notes and history here are kept, and you `
                                  + `can add them back later.`,
                                )) return;
                                update.mutate({
                                  id: member.id,
                                  body: { isActive: !member.isActive },
                                });
                              }}
                            >
                              {member.isActive ? 'Deactivate' : 'Reactivate'}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {manage && (
        // Said plainly, because the absence of a Remove button otherwise reads as a
        // missing feature rather than a decision.
        <p className="flex items-start gap-1 text-caption leading-snug text-muted-foreground">
          <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>Deactivating is how you remove someone.</strong> There is no permanent delete:
            a person is attached to every conversation they were assigned and every note they wrote,
            so removing the record would take that history with it. Deactivating revokes their access
            on their next request and hands their open conversations back to the shared pool.
          </span>
        </p>
      )}

      {!manage && (
        <p className="flex items-center gap-1 text-caption text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Only an owner can add people or change roles.
        </p>
      )}

      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add someone to the team</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Full name</Label>
              <Input
                value={draft.fullName}
                onChange={(e) => setDraft((d) => ({ ...d, fullName: e.target.value }))}
              />
              {/*
                Says where the name goes, because it does not always go anywhere. There is one profile
                per person: somebody who already has an account keeps their own name, and an admin
                here typing a different one must not rename them in the business they run.
              */}
              <p className="text-caption text-muted-foreground">
                Used only if this number is new to ZunoPilot. Someone who already has an account keeps
                their own name.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Mobile number</Label>
              <PhoneField
                country={inviteCountry}
                onCountryChange={setInviteCountry}
                value={draft.phone}
                onChange={(phone) => setDraft((d) => ({ ...d, phone }))}
              />
              <p className="text-caption text-muted-foreground">
                How they sign in. Pick their country if it is not yours.
              </p>
            </div>
            <div className="space-y-1">
              <Label>
                Email <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                type="email"
                autoComplete="off"
                placeholder="colleague@example.com"
                value={draft.email}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={draft.roleId} onValueChange={(roleId) => setDraft((d) => ({ ...d, roleId }))}>
                <SelectTrigger><SelectValue placeholder="Choose a role" /></SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}{role.description ? ` — ${role.description}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-caption text-muted-foreground">
                <Link to="/roles" className="underline">Manage roles</Link> to change what each can do.
              </p>
            </div>
            <p className="text-caption leading-snug text-muted-foreground">
              There is nothing to send them. They open ZunoPilot, enter this number, and a one-time
              code signs them in — so no password is created and none needs passing on.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviting(false)}>Cancel</Button>
            <Button
              disabled={
                !draft.fullName.trim()
                || draft.phone.replace(/[^\d]/g, '').length < 8
                || !draft.roleId
                || invite.isPending
              }
              onClick={() => invite.mutate()}
            >
              {invite.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Add to team
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {members.length === 0 && !isLoading && (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <Users className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No team members yet.</p>
        </div>
      )}
    </div>
  );
}
