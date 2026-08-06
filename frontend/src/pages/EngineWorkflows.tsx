import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { engine, type WorkflowListItem } from '@/lib/engine/api';
import { cn, formatDateTime } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import CreateWorkflowDialog from '@/components/engine/CreateWorkflowDialog';
import GenerateWorkflowDialog from '@/components/engine/GenerateWorkflowDialog';
import TemplateGalleryDialog from '@/components/engine/TemplateGalleryDialog';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, LayoutTemplate, Loader2, Plus, Search,
  Sparkles, Workflow as WorkflowIcon, Zap,
} from 'lucide-react';

// Workflow list — /assistants/:assistantId/workflows

const STATUS_STYLE: Record<string, string> = {
  PUBLISHED: 'border-success/30 bg-success/10 text-success',
  DRAFT: 'border-ink-300 bg-surface-0 text-ink-700',
  ARCHIVED: 'border-warning/40 bg-warning/15 text-ink-900',
};

function Row({ workflow, onOpen }: { workflow: WorkflowListItem; onOpen: () => void }) {
  // "Published but not routable" is the failure worth surfacing loudest: the
  // operator believes the workflow is live, and the router cannot see it.
  const notRoutable = workflow.status === 'PUBLISHED'
    && (!workflow.slug || !workflow.hasCapability);

  return (
    <tr className="border-b last:border-0 hover:bg-surface-0/60">
      <td className="px-4 py-3">
        <button className="text-left" onClick={onOpen}>
          <div className="font-medium text-ink-700 hover:text-accent-700 hover:underline">
            {workflow.name}
          </div>
          {workflow.slug && <div className="font-mono text-caption text-ink-500">{workflow.slug}</div>}
        </button>
        {notRoutable && (
          <div className="mt-1 flex items-center gap-1 text-caption text-danger">
            <AlertTriangle className="h-3 w-3" />
            Published but the router can't select it — needs {!workflow.slug ? 'a slug' : 'a capability contract'}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge variant="outline" className="text-caption">
          {workflow.category === 'CONVERSATION' ? 'Conversation' : 'Event'}
        </Badge>
      </td>
      <td className="max-w-[22rem] px-4 py-3 text-sm text-ink-500">
        <span className="line-clamp-2">{workflow.purpose || <span className="text-ink-500">—</span>}</span>
      </td>
      <td className="px-4 py-3">
        <Badge variant="outline" className={cn('text-caption', STATUS_STYLE[workflow.status])}>
          {workflow.status === 'PUBLISHED' && workflow.publishedVersion
            ? `Published v${workflow.publishedVersion.version}`
            : workflow.status[0] + workflow.status.slice(1).toLowerCase()}
        </Badge>
      </td>
      <td className="px-4 py-3 text-center text-sm text-ink-700">{workflow.priority}</td>
      <td className="px-4 py-3 text-sm">
        {workflow.totalRuns === 0 ? (
          <span className="text-ink-500">—</span>
        ) : (
          <div className="space-y-px">
            <div className="text-ink-700">
              {workflow.successRate !== null ? `${workflow.successRate}%` : '—'}
              <span className="ml-1 text-caption text-ink-500">of {workflow.totalRuns}</span>
            </div>
            {workflow.active > 0 && (
              <div className="text-caption text-accent-600">{workflow.active} running</div>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right text-caption text-ink-500">
        {formatDateTime(workflow.updatedAt)}
      </td>
    </tr>
  );
}

export default function EngineWorkflows() {
  const { assistantId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [browsingTemplates, setBrowsingTemplates] = useState(false);

  const { data = [], isLoading } = useQuery({
    queryKey: ['engine', 'workflows', assistantId],
    queryFn: () => engine.workflows.list(assistantId),
    enabled: !!assistantId,
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => engine.workflows.create(assistantId, body),
    onSuccess: (created) => {
      toast.success('Workflow created');
      setCreating(false);
      qc.invalidateQueries({ queryKey: ['engine', 'workflows', assistantId] });
      navigate(`/workflows/${created.id}`);
    },
  });

  const filtered = search.trim()
    ? data.filter((w) => [w.name, w.slug, w.purpose].some(
      (field) => field?.toLowerCase().includes(search.toLowerCase()),
    ))
    : data;

  const published = data.filter((w) => w.status === 'PUBLISHED').length;
  const notRoutable = data.filter(
    (w) => w.status === 'PUBLISHED' && (!w.slug || !w.hasCapability),
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            className="mb-1 flex items-center gap-1 text-caption text-ink-500 hover:text-ink-700"
            onClick={() => navigate(`/assistants/${assistantId}/routing`)}
          >
            <ArrowLeft className="h-3 w-3" /> Routing
          </button>
          <h1 className="text-h2 font-semibold">Workflows</h1>
          <p className="text-sm text-muted-foreground">
            {data.length} total · {published} published
            {notRoutable > 0 && (
              <span className="text-danger"> · {notRoutable} published but not routable</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" className="gap-1" onClick={() => setBrowsingTemplates(true)}>
            <LayoutTemplate className="h-4 w-4" /> Use a template
          </Button>
          <Button variant="outline" className="gap-1" onClick={() => setGenerating(true)}>
            <Sparkles className="h-4 w-4" /> Describe it
          </Button>
          <Button className="gap-1 bg-accent-600 hover:bg-accent-700" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New workflow
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <Input
              className="pl-8"
              placeholder="Search by name, slug or purpose…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-accent-600" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <WorkflowIcon className="h-9 w-9 text-ink-300" />
            <div>
              <p className="text-sm font-medium text-ink-700">
                {search ? 'Nothing matches that search' : 'No workflows yet'}
              </p>
              <p className="text-sm text-muted-foreground">
                {search
                  ? 'Try a different term.'
                  : 'Start from a template, describe what you want, or build one node by node.'}
              </p>
            </div>
            {!search && (
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  className="gap-1 bg-accent-600 hover:bg-accent-700"
                  onClick={() => setBrowsingTemplates(true)}
                >
                  <LayoutTemplate className="h-4 w-4" /> Use a template
                </Button>
                <Button variant="outline" className="gap-1" onClick={() => setGenerating(true)}>
                  <Sparkles className="h-4 w-4" /> Describe it
                </Button>
                <Button variant="outline" className="gap-1" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> New workflow
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[54rem]">
              <thead>
                <tr className="border-b bg-surface-0/80 text-left text-caption font-semibold uppercase tracking-wide text-ink-500">
                  <th className="px-4 py-2">Workflow</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Purpose</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-center">Priority</th>
                  <th className="px-4 py-2">Success</th>
                  <th className="px-4 py-2 text-right">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((workflow) => (
                  <Row
                    key={workflow.id}
                    workflow={workflow}
                    onOpen={() => navigate(`/workflows/${workflow.id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {data.length > 0 && notRoutable === 0 && published > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3">
          <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-success" />
          <p className="text-caption text-success">
            All {published} published workflow{published === 1 ? ' is' : 's are'} routable — each has a
            slug and a capability contract, so the router can select {published === 1 ? 'it' : 'them'}.
          </p>
        </div>
      )}

      <TemplateGalleryDialog
        open={browsingTemplates}
        onOpenChange={setBrowsingTemplates}
        assistantId={assistantId}
        onCreated={(workflowId) => navigate(`/workflows/${workflowId}`)}
      />

      <GenerateWorkflowDialog
        open={generating}
        onOpenChange={setGenerating}
        assistantId={assistantId}
      />

      <CreateWorkflowDialog
        open={creating}
        onOpenChange={setCreating}
        pending={create.isPending}
        onCreate={(body) => create.mutate(body)}
      />
    </div>
  );
}
