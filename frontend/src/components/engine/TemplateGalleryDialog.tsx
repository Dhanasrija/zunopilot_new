import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { engine, type WorkflowTemplateSummary } from '@/lib/engine/api';
import { useAuthStore } from '@/stores/auth.store';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, Blocks, Copy, LayoutTemplate, Loader2, ShieldAlert, Sparkles,
} from 'lucide-react';

// The template gallery.
//
// Two things about templates are easy to get wrong in a UI, and both are called
// out here rather than left implicit:
//
//   • Instantiating is a **copy, not a subscription**. Nothing links back, so a
//     later change to the template will never reach a workflow someone has
//     customised. Someone choosing a template should know that up front, because
//     it is the difference between "customise freely" and "don't touch it".
//   • Availability is **computed** against the live executor registry, not
//     declared. A template can be listed and still be unusable, so the missing
//     node runtimes are named instead of the button just being dead.
//
// The result is always a DRAFT whatever the template says, so the author reviews
// and publishes deliberately.

const CATEGORY_LABEL: Record<string, string> = {
  RESTAURANT: 'restaurants',
  ECOMMERCE_GROCERY: 'grocery and ecommerce',
};

const slugify = (name: string) => name
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 64);

export default function TemplateGalleryDialog({
  open, onOpenChange, assistantId, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assistantId: string;
  onCreated: (workflowId: string) => void;
}) {
  const qc = useQueryClient();
  const tenantCategory = useAuthStore((s) => s.tenant?.category);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState({ name: false, slug: false });

  const { data, isLoading } = useQuery({
    queryKey: ['engine', 'workflow-templates'],
    queryFn: () => engine.templates.list(),
    enabled: open,
  });

  const templates = data ?? [];
  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  );

  // The server already sorted by relevance, so the first one is the best
  // starting point for this workspace.
  useEffect(() => {
    if (open && !selectedId && templates.length) setSelectedId(templates[0].id);
  }, [open, selectedId, templates]);

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setTouched({ name: false, slug: false });
    }
  }, [open]);

  // Switching template resets whatever the author had not deliberately typed.
  useEffect(() => {
    if (!selected) return;
    if (!touched.name) setName(selected.name);
    if (!touched.slug) setSlug(selected.suggestedSlug);
  }, [selected, touched]);

  const create = useMutation({
    mutationFn: () => engine.workflows.createFromTemplate(assistantId, {
      templateId: selected!.id,
      ...(name.trim() && name.trim() !== selected!.name ? { name: name.trim() } : {}),
      ...(slug && slug !== selected!.suggestedSlug ? { slug } : {}),
    }),
    onSuccess: (workflow) => {
      // The slug may have been suffixed server-side if it was taken. Saying so
      // beats an author later wondering why the router names `order_place_2`.
      toast.success(
        workflow.slug === (slug || selected?.suggestedSlug)
          ? `${workflow.name} added as a draft`
          : `${workflow.name} added as a draft, with the slug ${workflow.slug}`,
      );
      qc.invalidateQueries({ queryKey: ['engine', 'workflows'] });
      onOpenChange(false);
      onCreated(workflow.id);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const suitsThisBusiness = (template: WorkflowTemplateSummary) => Boolean(
    tenantCategory && template.suitedTo.includes(tenantCategory),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] w-[min(56rem,94vw)] max-w-none flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-body">
            <LayoutTemplate className="h-4 w-4" /> Start from a template
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="grid place-items-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-accent-600" />
          </div>
        ) : templates.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-muted-foreground">
            No templates are available.
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[15rem_1fr]">
            {/* ── The list ──────────────────────────────────────────────── */}
            <div className="min-h-0 overflow-y-auto border-b sm:border-b-0 sm:border-r">
              {templates.map((template) => (
                <button
                  key={template.id}
                  onClick={() => setSelectedId(template.id)}
                  className={cn(
                    'w-full border-b px-3 py-2 text-left transition-colors last:border-b-0',
                    template.id === selectedId ? 'bg-accent-100/70' : 'hover:bg-surface-0',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className={cn(
                      'mt-px h-1.5 w-1.5 shrink-0 rounded-full',
                      template.id === selectedId ? 'bg-accent-600' : 'bg-transparent',
                    )}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink-700">{template.name}</div>
                      <p className="mt-px line-clamp-2 text-caption leading-snug text-ink-500">
                        {template.tagline}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {suitsThisBusiness(template) && (
                          <Badge
                            variant="outline"
                            className="border-accent-100 bg-accent-100 text-caption text-accent-700"
                          >
                            <Sparkles className="mr-px h-2.5 w-2.5" /> For you
                          </Badge>
                        )}
                        {!template.available && (
                          <Badge
                            variant="outline"
                            className="border-warning/40 bg-warning/15 text-caption text-ink-900"
                          >
                            Unavailable
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* ── The detail ────────────────────────────────────────────── */}
            <div className="min-h-0 overflow-y-auto px-4 py-4">
              {selected && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-h3 font-semibold text-ink-700">{selected.name}</h3>
                    <p className="mt-px text-sm text-ink-500">{selected.tagline}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-caption text-ink-500">
                    <Badge variant="outline" className="gap-1 text-caption">
                      <Blocks className="h-3 w-3" />
                      {selected.nodeCount} nodes
                    </Badge>
                    <Badge variant="outline" className="text-caption">{selected.category}</Badge>
                    {selected.suitedTo.length > 0 && (
                      <span>
                        Written for
                        {' '}
                        {selected.suitedTo.map((c) => CATEGORY_LABEL[c] ?? c.toLowerCase()).join(' and ')}
                      </span>
                    )}
                    {selected.suitedTo.length === 0 && <span>Suits any business</span>}
                  </div>

                  <p className="text-sm leading-relaxed text-ink-700">{selected.description}</p>

                  {selected.hasSideEffects && (
                    <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/15 p-2">
                      <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0 text-ink-900" />
                      <p className="text-caption text-ink-900">
                        This workflow changes data — it places orders or writes records. It ships with a
                        confirmation step, which the publish check requires and you should not remove.
                      </p>
                    </div>
                  )}

                  {!selected.available && (
                    <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-2">
                      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-danger" />
                      <div className="text-caption text-danger">
                        <p className="font-medium">This template cannot run yet</p>
                        <p className="mt-px">
                          It uses node types with no runtime:
                          {' '}
                          <code>{selected.missingRuntimes.join(', ')}</code>. It will become available
                          the moment those are built — nothing here needs changing.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-2 rounded-lg border bg-surface-0 p-2">
                    <Copy className="mt-px h-3.5 w-3.5 shrink-0 text-ink-500" />
                    <p className="text-caption leading-snug text-ink-500">
                      This copies the graph and its routing contract into your workspace as a
                      <strong> draft</strong>. Nothing links back to the template, so you can change
                      anything — and a later change to the template will never touch your copy.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="tpl-name">Name</Label>
                      <Input
                        id="tpl-name"
                        value={name}
                        autoComplete="off"
                        onChange={(e) => {
                          setTouched((t) => ({ ...t, name: true }));
                          setName(e.target.value);
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="tpl-slug">Slug</Label>
                      <Input
                        id="tpl-slug"
                        className="font-mono text-caption"
                        value={slug}
                        autoComplete="off"
                        onChange={(e) => {
                          setTouched((t) => ({ ...t, slug: true }));
                          setSlug(slugify(e.target.value));
                        }}
                      />
                      <p className="text-caption text-ink-500">
                        What the router selects by. Suffixed automatically if taken.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 border-t px-4 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="gap-1 bg-accent-600 hover:bg-accent-700"
            disabled={!selected || !selected.available || !name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Add as draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
