import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usePermissions, type Permission } from '@/lib/permissions';
import { useRoles, type RoleRow } from '@/lib/roles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, ArrowLeft, Check, Loader2, Lock, Plus, ShieldCheck, Trash2, Users,
} from 'lucide-react';

// Roles.
//
// The screen a workspace uses to decide what its own people can reach. Three things
// it does deliberately:
//
//   • **Shows what is not grantable, disabled, rather than hiding it.** Someone who
//     cannot hand out `settings:write` should see that it exists and that they
//     cannot give it, not wonder why the list is short.
//   • **Marks the owner role locked** instead of pretending it is editable and
//     failing on save. It holds everything by definition — that is the floor that
//     stops a workspace locking itself out.
//   • **Flags the sensitive ones.** "Delete a connector" and "Change settings, plan
//     and billing" are not the same kind of tick as "See orders".

export default function Roles() {
  const qc = useQueryClient();
  const { can } = usePermissions();
  const manage = can('roles:manage');

  const { data, isLoading } = useRoles();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    name: string; description: string; permissions: Set<Permission>;
  }>({ name: '', description: '', permissions: new Set() });
  const [creating, setCreating] = useState(false);

  const roles = data?.roles ?? [];
  const groups = data?.groups ?? [];
  const grantable = new Set(data?.grantable ?? []);
  const selected = roles.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && roles.length) setSelectedId(roles.find((r) => !r.isOwner)?.id ?? roles[0].id);
  }, [roles, selectedId]);

  // Reloaded from the server whenever the selection changes, so an abandoned edit
  // never leaks into the next role.
  useEffect(() => {
    if (creating) return;
    if (!selected) return;
    setDraft({
      name: selected.name,
      description: selected.description ?? '',
      permissions: new Set(selected.permissions),
    });
  }, [selected, creating]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['roles'] });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        permissions: [...draft.permissions],
      };
      return creating
        ? api.post<{ data: RoleRow }>('/roles', body).then((r) => r.data.data)
        : api.patch<{ data: RoleRow }>(`/roles/${selected!.id}`, body).then((r) => r.data.data);
    },
    onSuccess: (role) => {
      toast.success(creating ? `“${role.name}” created` : 'Role updated');
      setCreating(false);
      setSelectedId(role.id);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/roles/${id}`),
    onSuccess: () => {
      toast.success('Role deleted');
      setSelectedId(null);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const startCreating = () => {
    setCreating(true);
    setSelectedId(null);
    setDraft({ name: '', description: '', permissions: new Set() });
  };

  const toggle = (key: Permission) => setDraft((d) => {
    const next = new Set(d.permissions);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return { ...d, permissions: next };
  });

  const locked = !creating && (selected?.isOwner ?? false);
  const editable = manage && !locked;
  const dirty = creating || (selected && (
    draft.name !== selected.name
    || draft.description !== (selected.description ?? '')
    || draft.permissions.size !== selected.permissions.length
    || selected.permissions.some((p) => !draft.permissions.has(p))
  ));

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <div>
        <Link to="/team" className="mb-1 inline-flex items-center gap-1 text-caption text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Team
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-h2 font-semibold">Roles</h1>
            <p className="text-sm text-muted-foreground">
              What each kind of person in your workspace can reach. {roles.length} roles.
            </p>
          </div>
          {manage && (
            <Button className="gap-1" onClick={startCreating}>
              <Plus className="h-4 w-4" /> New role
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <Card className="h-fit">
          <CardContent className="p-2">
            {roles.map((role) => (
              <button
                key={role.id}
                onClick={() => { setCreating(false); setSelectedId(role.id); }}
                className={cn(
                  'w-full rounded-lg px-3 py-2 text-left transition-colors',
                  role.id === selectedId && !creating ? 'bg-accent-100' : 'hover:bg-surface-0',
                )}
              >
                <div className="flex items-center gap-1">
                  <span className="truncate text-sm font-medium">{role.name}</span>
                  {role.isOwner && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                </div>
                <div className="mt-px flex items-center gap-2 text-caption text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    {role.members}
                  </span>
                  <span>
                    {role.isOwner ? 'everything' : `${role.permissions.length} permissions`}
                  </span>
                </div>
              </button>
            ))}
            {creating && (
              <div className="rounded-lg bg-accent-100 px-3 py-2 text-sm font-medium text-accent-700">
                New role…
              </div>
            )}
          </CardContent>
        </Card>

        {(selected || creating) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-body">
                {creating ? 'New role' : selected!.name}
                {locked && <Badge variant="outline" className="gap-1 text-caption"><Lock className="h-2.5 w-2.5" /> locked</Badge>}
                {!creating && selected!.isSystem && !selected!.isOwner && (
                  <Badge variant="outline" className="text-caption">default</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {locked && (
                <div className="flex items-start gap-2 rounded-lg border border-ink-300 bg-surface-0 p-3">
                  <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-ink-500" />
                  <p className="text-caption leading-snug text-ink-700">
                    The owner role always has full access and cannot be narrowed. Without a role that
                    keeps every permission, a workspace could remove its own ability to manage the
                    team and lock itself out with no way back. Build another role instead.
                  </p>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="role-name">Name</Label>
                  <Input
                    id="role-name"
                    value={draft.name}
                    disabled={!editable}
                    placeholder="Kitchen staff"
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="role-desc">Description</Label>
                  <Input
                    id="role-desc"
                    value={draft.description}
                    disabled={!editable}
                    placeholder="Sees orders, changes nothing else."
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-3">
                {groups.map((group) => (
                  <div key={group.group} className="rounded-lg border">
                    <div className="flex items-baseline justify-between gap-2 border-b bg-surface-0/60 px-3 py-2">
                      <p className="text-caption font-semibold">{group.group}</p>
                      <p className="text-caption text-muted-foreground">{group.blurb}</p>
                    </div>
                    <div className="divide-y">
                      {group.permissions.map((permission) => {
                        const on = locked || draft.permissions.has(permission.key);
                        const allowed = grantable.has(permission.key);
                        return (
                          <label
                            key={permission.key}
                            className={cn(
                              'flex items-start gap-2 px-3 py-2',
                              editable && allowed ? 'cursor-pointer hover:bg-surface-0' : 'cursor-default',
                            )}
                          >
                            <input
                              type="checkbox"
                              className="mt-px"
                              checked={on}
                              disabled={!editable || !allowed}
                              onChange={() => toggle(permission.key)}
                            />
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-1 text-caption font-medium">
                                {permission.label}
                                {permission.sensitive && (
                                  <Badge variant="outline" className="border-warning/40 bg-warning/15 text-caption text-ink-900">
                                    sensitive
                                  </Badge>
                                )}
                              </span>
                              {permission.hint && (
                                <span className="mt-px block text-caption text-muted-foreground">
                                  {permission.hint}
                                </span>
                              )}
                              {!allowed && (
                                // Shown rather than hidden: a short list with no
                                // explanation reads as a bug.
                                <span className="mt-px block text-caption text-ink-900">
                                  You do not have this yourself, so you cannot grant it.
                                </span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {editable && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <Button
                    className="gap-1"
                    disabled={draft.name.trim().length < 2 || !dirty || save.isPending}
                    onClick={() => save.mutate()}
                  >
                    {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    {creating ? 'Create role' : 'Save changes'}
                  </Button>
                  {creating && (
                    <Button variant="ghost" onClick={() => { setCreating(false); setSelectedId(roles[0]?.id ?? null); }}>
                      Cancel
                    </Button>
                  )}
                  {!creating && selected && !selected.isOwner && (
                    <Button
                      variant="outline"
                      className="ml-auto gap-1 text-danger"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(
                          `Delete “${selected.name}”?\n\nThis cannot be undone. Anyone still on it has to be moved first.`,
                        )) remove.mutate(selected.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete role
                    </Button>
                  )}
                </div>
              )}

              {!creating && selected && selected.members > 0 && !selected.isOwner && (
                <p className="flex items-start gap-1 text-caption leading-snug text-muted-foreground">
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  {selected.members} {selected.members === 1 ? 'person is' : 'people are'} on this
                  role. Saving changes what they can reach on their next request.
                </p>
              )}

              {!manage && (
                <p className="flex items-center gap-1 text-caption text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  You can see the roles but not change them.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
