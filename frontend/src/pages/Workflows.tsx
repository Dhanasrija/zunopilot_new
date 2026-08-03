import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDateTime } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Plus, Search, MoreVertical, Workflow as WorkflowIcon, Copy, Pencil,
  Rocket, Archive, Trash2, RefreshCw, Info, ArchiveRestore,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Status = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
type Trigger = 'MESSAGE_RECEIVED' | 'ORDER_STATUS_CHANGED' | 'MANUAL';

interface Flow {
  id: string;
  name: string;
  description?: string | null;
  status: Status;
  trigger: Trigger;
  version: number;
  nodeCount: number;
  publishedAt?: string | null;
  updatedAt: string;
}

const STATUS_STYLE: Record<Status, string> = {
  DRAFT: 'bg-surface-0 text-ink-700 border-ink-300',
  PUBLISHED: 'bg-success/10 text-success border-success/30',
  ARCHIVED: 'bg-warning/15 text-ink-900 border-warning/40',
};

const TRIGGER_LABEL: Record<Trigger, string> = {
  MESSAGE_RECEIVED: 'Message received',
  ORDER_STATUS_CHANGED: 'Order status changed',
  MANUAL: 'Manual only',
};

// ── Create / edit dialog ──────────────────────────────────────────────────────

function FlowFormDialog({
  mode, flow, open, onOpenChange, onSaved,
}: {
  mode: 'create' | 'edit';
  flow?: Flow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: (created?: Flow) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [trigger, setTrigger] = useState<Trigger>('MESSAGE_RECEIVED');

  useEffect(() => {
    if (!open) return;
    setName(flow?.name ?? '');
    setDescription(flow?.description ?? '');
    setTrigger(flow?.trigger ?? 'MESSAGE_RECEIVED');
  }, [open, flow]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name, description: description || null, trigger };
      if (mode === 'create') {
        return (await api.post<{ data: Flow }>('/workflows', payload)).data.data;
      }
      return (await api.patch<{ data: Flow }>(`/workflows/${flow!.id}`, payload)).data.data;
    },
    onSuccess: (saved) => {
      toast.success(mode === 'create' ? 'Workflow created' : 'Workflow updated');
      onOpenChange(false);
      onSaved(mode === 'create' ? saved : undefined);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New workflow' : 'Workflow settings'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="wf-name">Name</Label>
            <Input id="wf-name" value={name} autoComplete="off"
              placeholder="Lead qualification"
              onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="wf-desc">Description</Label>
            <Textarea id="wf-desc" rows={3} value={description}
              placeholder="What this workflow does, and when it should run."
              onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label>Trigger</Label>
            <Select value={trigger} onValueChange={(v) => setTrigger(v as Trigger)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(TRIGGER_LABEL) as Trigger[]).map((t) => (
                  <SelectItem key={t} value={t}>{TRIGGER_LABEL[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mode === 'create' && (
            <div className="flex gap-2 rounded-md border border-ink-300 bg-surface-0 p-3 text-caption text-ink-700">
              <Info className="w-4 h-4 shrink-0 mt-px" />
              <span>
                Created as a <strong>draft</strong>. You build the steps on the canvas, then publish
                when you're ready — a draft never handles live messages.
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
            {save.isPending ? 'Saving…' : mode === 'create' ? 'Create workflow' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Workflows() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Flow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Flow | null>(null);

  const { data = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['workflows', showArchived],
    queryFn: async () =>
      (await api.get<{ data: Flow[] }>('/workflows', {
        params: showArchived ? { status: 'ARCHIVED' } : undefined,
      })).data.data,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['workflows'] });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Status }) =>
      api.post(`/workflows/${id}/status`, { status }),
    onSuccess: (_r, { status }) => {
      toast.success(
        status === 'PUBLISHED' ? 'Workflow published'
          : status === 'ARCHIVED' ? 'Workflow archived'
            : 'Workflow moved to draft',
      );
      invalidate();
    },
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.post(`/workflows/${id}/duplicate`),
    onSuccess: () => { toast.success('Workflow duplicated'); invalidate(); },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/workflows/${id}`),
    onSuccess: () => { toast.success('Workflow deleted'); setConfirmDelete(null); invalidate(); },
  });

  const filtered = search.trim()
    ? data.filter((f) =>
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      (f.description ?? '').toLowerCase().includes(search.toLowerCase()))
    : data;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h2 font-semibold">Workflows</h1>
          <p className="text-sm text-muted-foreground">
            Multi-step automations built from triggers, conditions and actions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1 h-9"
            onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Refresh
          </Button>
          <Button className="gap-1 bg-accent-600 hover:bg-accent-700"
            onClick={() => { setEditing(null); setFormMode('create'); }}>
            <Plus className="w-4 h-4" /> New workflow
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
            <Input className="pl-8" placeholder="Search workflows…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Button variant={showArchived ? 'default' : 'outline'} size="sm" className="gap-1 h-9"
            onClick={() => setShowArchived((v) => !v)}>
            <Archive className="w-3.5 h-3.5" /> {showArchived ? 'Viewing archived' : 'Show archived'}
          </Button>
        </CardContent>
      </Card>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-6 h-6 animate-spin text-accent-600" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <WorkflowIcon className="w-9 h-9 text-ink-300" />
            <div>
              <p className="text-sm font-medium text-ink-700">
                {showArchived ? 'No archived workflows' : 'No workflows yet'}
              </p>
              <p className="text-sm text-muted-foreground">
                {showArchived
                  ? 'Archived workflows will appear here.'
                  : 'Create one to automate a multi-step conversation.'}
              </p>
            </div>
            {!showArchived && (
              <Button className="gap-1 bg-accent-600 hover:bg-accent-700"
                onClick={() => { setEditing(null); setFormMode('create'); }}>
                <Plus className="w-4 h-4" /> New workflow
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((f) => (
            <Card key={f.id} className="flex flex-col">
              <CardContent className="pt-4 flex-1 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    className="text-left font-semibold text-ink-700 hover:text-accent-700 hover:underline"
                    onClick={() => navigate(`/workflows/${f.id}`)}
                  >
                    {f.name}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="w-8 h-8 shrink-0">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem className="gap-2" onClick={() => navigate(`/workflows/${f.id}`)}>
                        <WorkflowIcon className="w-3.5 h-3.5" /> Open canvas
                      </DropdownMenuItem>
                      <DropdownMenuItem className="gap-2"
                        onClick={() => { setEditing(f); setFormMode('edit'); }}>
                        <Pencil className="w-3.5 h-3.5" /> Settings
                      </DropdownMenuItem>
                      <DropdownMenuItem className="gap-2" onClick={() => duplicate.mutate(f.id)}>
                        <Copy className="w-3.5 h-3.5" /> Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {f.status !== 'PUBLISHED' && f.status !== 'ARCHIVED' && (
                        <DropdownMenuItem className="gap-2"
                          onClick={() => setStatus.mutate({ id: f.id, status: 'PUBLISHED' })}>
                          <Rocket className="w-3.5 h-3.5" /> Publish
                        </DropdownMenuItem>
                      )}
                      {f.status === 'PUBLISHED' && (
                        <DropdownMenuItem className="gap-2"
                          onClick={() => setStatus.mutate({ id: f.id, status: 'DRAFT' })}>
                          <Pencil className="w-3.5 h-3.5" /> Unpublish
                        </DropdownMenuItem>
                      )}
                      {f.status === 'ARCHIVED' ? (
                        <DropdownMenuItem className="gap-2"
                          onClick={() => setStatus.mutate({ id: f.id, status: 'DRAFT' })}>
                          <ArchiveRestore className="w-3.5 h-3.5" /> Restore
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem className="gap-2"
                          onClick={() => setStatus.mutate({ id: f.id, status: 'ARCHIVED' })}>
                          <Archive className="w-3.5 h-3.5" /> Archive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem className="gap-2 text-danger focus:text-danger"
                        onClick={() => setConfirmDelete(f)}>
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <p className="text-sm text-ink-500 line-clamp-2 min-h-[2.5rem]">
                  {f.description || <span className="text-ink-500">No description</span>}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center px-2 py-px rounded-full text-caption font-semibold border ${STATUS_STYLE[f.status]}`}>
                    {f.status === 'PUBLISHED' ? `Published · v${f.version}` : f.status[0] + f.status.slice(1).toLowerCase()}
                  </span>
                  <span className="text-caption text-ink-500">{TRIGGER_LABEL[f.trigger]}</span>
                </div>
              </CardContent>
              <div className="border-t px-4 py-2 flex items-center justify-between text-caption text-ink-500">
                <span>{f.nodeCount} {f.nodeCount === 1 ? 'step' : 'steps'}</span>
                <span>Updated {formatDateTime(f.updatedAt)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <FlowFormDialog
        mode={formMode ?? 'create'}
        flow={editing}
        open={formMode !== null}
        onOpenChange={(v) => { if (!v) setFormMode(null); }}
        onSaved={(created) => {
          invalidate();
          // Straight into the canvas after creating — the settings form is only
          // the metadata half of "create a workflow".
          if (created) navigate(`/workflows/${created.id}`);
        }}
      />

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Delete “{confirmDelete?.name}”?</DialogTitle></DialogHeader>
          <p className="text-sm text-ink-700">
            This permanently removes the workflow and its steps. Archive it instead if you might
            want it back.
          </p>
          <DialogFooter className="gap-2">
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button className="bg-danger hover:bg-danger" disabled={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}>
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
