import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FLOW_INK } from '@/lib/chart-tokens';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import FlowNodeCard from '@/components/workflow/FlowNode';
import NodePalette, { DND_MIME } from '@/components/workflow/NodePalette';
import NodeInspector from '@/components/workflow/NodeInspector';
import {
  EMPTY_GRAPH, edgeIdFor, fingerprint, newNodeId, specFor, toFlow, toGraph, validateGraph,
  type FlowNode, type NodeKind, type WorkflowGraph,
} from '@/lib/workflow';
import { toast } from 'sonner';
import {
  AlertTriangle, ArrowLeft, FlaskConical, Loader2, Rocket, Save, Undo2,
} from 'lucide-react';

// The workflow canvas at /workflows/:id.
//
// Graph state lives in React Flow while editing and is converted to the stored
// `{nodes, edges}` shape only on save, so the editor's coordinates and the
// engine's contract stay decoupled (see lib/workflow.ts).

type Status = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  status: Status;
  trigger: string;
  version: number;
  graph: WorkflowGraph | null;
  updatedAt: string;
}

const STATUS_STYLE: Record<Status, string> = {
  DRAFT: 'bg-surface-0 text-ink-700 border-ink-300',
  PUBLISHED: 'bg-success/10 text-success border-success/30',
  ARCHIVED: 'bg-warning/15 text-ink-900 border-warning/40',
};

const nodeTypes = { flowNode: FlowNodeCard };

const defaultEdgeOptions = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: FLOW_INK.edge },
  style: { stroke: FLOW_INK.edge, strokeWidth: 1.5 },
};

function Canvas() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canEdit = role === 'OWNER' || role === 'MANAGER';

  const wrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const didFit = useRef(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [publishIssues, setPublishIssues] = useState<string[] | null>(null);

  // Fingerprint of what the server last confirmed, so "unsaved changes" means
  // the graph actually differs rather than "React Flow re-rendered".
  const [savedPrint, setSavedPrint] = useState<string | null>(null);
  const hydrated = useRef(false);

  const { data: workflow, isLoading, isError } = useQuery({
    queryKey: ['workflow', id],
    queryFn: async () => (await api.get<{ data: Workflow }>(`/workflows/${id}`)).data.data,
    enabled: !!id,
  });

  // Seed the editor once. Re-running on every refetch would throw away edits.
  useEffect(() => {
    if (!workflow || hydrated.current) return;
    hydrated.current = true;

    const stored = workflow.graph ?? EMPTY_GRAPH;
    const flow = toFlow(stored);
    const empty = !flow.nodes.length;

    // Baseline off the round-tripped graph, not the raw one. Loading normalises
    // a graph authored elsewhere — laying out nodes that carry no position,
    // dropping edges that point at nothing — and none of that changes what the
    // engine would execute, so it should not read as an unsaved edit.
    setSavedPrint(fingerprint(toGraph(flow.nodes, flow.edges)));

    if (empty && canEdit) {
      // A brand new workflow opens with its entry point already placed — the
      // engine needs one, and an empty grid is a poor first screen. This one
      // *is* an unsaved change, so it lands after the baseline is taken. Not
      // for a read-only viewer, who would see a node that can never be saved.
      flow.nodes.push({
        id: newNodeId(),
        type: 'flowNode',
        position: { x: 320, y: 80 },
        data: { kind: 'trigger', label: 'Trigger', config: {}, outputVariable: null },
      });
    }

    setNodes(flow.nodes);
    setEdges(flow.edges);
  }, [workflow, canEdit, setNodes, setEdges]);

  // The `fitView` prop only fires on mount, and the graph arrives after the
  // query resolves — so frame the flow once its nodes have been measured.
  useEffect(() => {
    if (!nodesInitialized || didFit.current || !nodes.length) return;
    didFit.current = true;
    fitView({ padding: 0.25, maxZoom: 1, duration: 200 });
  }, [nodesInitialized, nodes.length, fitView]);

  const graph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);
  const issues = useMemo(() => validateGraph(graph), [graph]);
  const dirty = savedPrint !== null && fingerprint(graph) !== savedPrint;
  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);
  const usedKinds = useMemo(() => new Set(nodes.map((n) => n.data.kind)), [nodes]);

  // Browser-level guard. The in-app guard is the dialog below.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // ── Graph editing ───────────────────────────────────────────────────────────

  const addNode = useCallback((kind: NodeKind, position?: { x: number; y: number }) => {
    const spec = specFor(kind);
    const id = newNodeId();
    const at = position ?? (() => {
      // Drop into the middle of what the operator is looking at, nudged by the
      // node count so repeated clicks don't stack into one pile.
      const rect = wrapper.current?.getBoundingClientRect();
      const centre = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 })
        : { x: 320, y: 240 };
      const offset = (nodes.length % 5) * 28;
      return { x: centre.x - 118 + offset, y: centre.y + offset };
    })();

    setNodes((current) => [
      ...current.map((n) => ({ ...n, selected: false })),
      {
        id,
        type: 'flowNode' as const,
        position: at,
        selected: true,
        data: { kind, label: spec.label, config: spec.defaults(), outputVariable: null },
      },
    ]);
    setSelectedId(id);
  }, [nodes.length, screenToFlowPosition, setNodes]);

  const patchNode = useCallback((nodeId: string, patch: { label?: string; outputVariable?: string | null }) => {
    setNodes((current) => current.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)));
  }, [setNodes]);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((current) => current.filter((n) => n.id !== nodeId));
    setEdges((current) => current.filter((e) => e.source !== nodeId && e.target !== nodeId));
    setSelectedId((cur) => (cur === nodeId ? null : cur));
  }, [setNodes, setEdges]);

  const isValidConnection: IsValidConnection = useCallback((c) => c.source !== c.target, []);

  const onConnect: OnConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    setEdges((current) => [
      // One edge per source handle. The engine picks a single next node per
      // branch (exact match, else the unlabelled edge), so a second edge off the
      // same handle would be silently ignored — replace instead of adding.
      ...current.filter((e) => !(e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null))),
      {
        id: edgeIdFor(c.source, c.target, c.sourceHandle),
        source: c.source,
        target: c.target,
        sourceHandle: c.sourceHandle ?? null,
        label: c.sourceHandle ? c.sourceHandle.toUpperCase() : undefined,
        ...defaultEdgeOptions,
      },
    ]);
  }, [setEdges]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData(DND_MIME) as NodeKind;
    if (!kind || !specFor(kind).label) return;
    if (specFor(kind).once && usedKinds.has(kind)) {
      toast.error('A workflow can only have one Trigger.');
      return;
    }
    const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addNode(kind, { x: at.x - 118, y: at.y - 40 });
  }, [addNode, screenToFlowPosition, usedKinds]);

  // ── Persistence ─────────────────────────────────────────────────────────────

  const save = useMutation({
    mutationFn: async (next: WorkflowGraph) => {
      await api.patch(`/workflows/${id}`, { graph: next });
      return next;
    },
    onSuccess: (next) => {
      setSavedPrint(fingerprint(next));
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
  });

  const setStatus = useMutation({
    mutationFn: (status: Status) => api.post(`/workflows/${id}/status`, { status }),
    onSuccess: (_r, status) => {
      toast.success(status === 'PUBLISHED' ? 'Workflow published' : 'Workflow moved to draft');
      qc.invalidateQueries({ queryKey: ['workflow', id] });
      qc.invalidateQueries({ queryKey: ['workflows'] });
    },
  });

  // Both of these are click handlers, so a rejection has nowhere to go — the api
  // interceptor has already shown the error toast. Swallow it and report false
  // so callers (the leave dialog) don't navigate away from unsaved work.
  const onSave = useCallback(async () => {
    try {
      await save.mutateAsync(graph);
      toast.success('Canvas saved');
      return true;
    } catch {
      return false;
    }
  }, [graph, save]);

  const onPublish = useCallback(async () => {
    const errors = issues.filter((i) => i.level === 'error');
    if (errors.length) {
      setSelectedId(null);
      setPublishIssues(errors.map((e) => e.message));
      return;
    }
    try {
      // Publish always ships what is on screen, so a save comes first.
      if (dirty) await save.mutateAsync(graph);
      await setStatus.mutateAsync('PUBLISHED');
    } catch {
      // Already surfaced by the api error interceptor.
    }
  }, [dirty, graph, issues, save, setStatus]);

  const goBack = useCallback(() => {
    if (dirty) setLeaveTo('/workflows');
    else navigate('/workflows');
  }, [dirty, navigate]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent-600" />
      </div>
    );
  }

  if (isError || !workflow) {
    return (
      <div className="grid h-full place-items-center">
        <div className="space-y-3 text-center">
          <p className="text-sm text-ink-700">This workflow could not be loaded.</p>
          <Button variant="outline" onClick={() => navigate('/workflows')}>Back to workflows</Button>
        </div>
      </div>
    );
  }

  const errorCount = issues.filter((i) => i.level === 'error').length;
  const busy = save.isPending || setStatus.isPending;

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-surface-1 px-4">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={goBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-ink-700">{workflow.name}</h1>
            <span className={cn('shrink-0 rounded-full border px-2 py-px text-caption font-semibold', STATUS_STYLE[workflow.status])}>
              {workflow.status === 'PUBLISHED' ? `Published · v${workflow.version}` : workflow.status[0] + workflow.status.slice(1).toLowerCase()}
            </span>
          </div>
          <p className="text-caption text-ink-500">
            {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'} · {edges.length} {edges.length === 1 ? 'connection' : 'connections'}
            {dirty && <span className="ml-1 font-medium text-ink-900">• Unsaved changes</span>}
          </p>
        </div>

        <div className="flex-1" />

        {errorCount > 0 && (
          <span className="hidden items-center gap-1 rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-caption font-medium text-danger sm:inline-flex">
            <AlertTriangle className="h-3 w-3" />
            {errorCount} {errorCount === 1 ? 'error' : 'errors'}
          </span>
        )}

        <Button
          variant="outline" size="sm" className="h-8 gap-1" disabled
          title="Test runs are the next piece of work — the engine already records every step."
        >
          <FlaskConical className="h-3.5 w-3.5" /> Test flow
        </Button>

        {canEdit && (
          <>
            <Button
              variant="outline" size="sm" className="h-8 gap-1"
              disabled={!dirty || busy} onClick={() => { void onSave(); }}
            >
              {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </Button>

            {workflow.status === 'PUBLISHED' ? (
              <Button
                variant="outline" size="sm" className="h-8 gap-1"
                disabled={busy} onClick={() => setStatus.mutate('DRAFT')}
              >
                <Undo2 className="h-3.5 w-3.5" /> Unpublish
              </Button>
            ) : (
              <Button
                size="sm" className="h-8 gap-1 bg-accent-600 hover:bg-accent-700"
                disabled={busy} onClick={() => { void onPublish(); }}
              >
                {setStatus.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
                Publish
              </Button>
            )}
          </>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {canEdit && <NodePalette usedKinds={usedKinds} onAdd={(k) => addNode(k)} />}

        <div className="relative min-w-0 flex-1" ref={wrapper}>
          <ReactFlow<FlowNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
            onNodeClick={(_e, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            elementsSelectable
            deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            minZoom={0.2}
            maxZoom={1.75}
            proOptions={{ hideAttribution: false }}
            className="bg-surface-0"
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color={FLOW_INK.dots} />
            <Controls showInteractive={false} className="!shadow-none" />
            <MiniMap
              pannable zoomable
              className="!bottom-3 !right-3 !h-24 !w-40 !rounded-lg !border !border-ink-300"
              nodeColor={() => FLOW_INK.minimapNode}
              maskColor={FLOW_INK.minimapMask}
            />
          </ReactFlow>

          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <p className="max-w-xs text-center text-sm text-ink-500">
                {canEdit
                  ? 'Nothing on the canvas. Drag a node in from the left to start building.'
                  : 'This workflow has no steps yet.'}
              </p>
            </div>
          )}

          {!canEdit && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-ink-300 bg-surface-1/95 px-3 py-1 text-caption text-ink-500 shadow-none">
              Read-only — only an owner or manager can edit workflows.
            </div>
          )}
        </div>

        <NodeInspector
          node={selected}
          issues={issues}
          onPatch={patchNode}
          onDelete={deleteNode}
          onSelect={setSelectedId}
        />
      </div>

      {/* Leaving with unsaved work */}
      <Dialog open={!!leaveTo} onOpenChange={(o) => !o && setLeaveTo(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Leave without saving?</DialogTitle></DialogHeader>
          <p className="text-sm text-ink-700">
            The canvas has changes that haven't been saved. Leaving now discards them.
          </p>
          <DialogFooter className="gap-2">
            <DialogClose asChild><Button variant="outline">Stay</Button></DialogClose>
            <Button
              variant="outline"
              onClick={async () => { if (await onSave()) navigate(leaveTo!); }}
            >
              Save and leave
            </Button>
            <Button className="bg-danger hover:bg-danger" onClick={() => navigate(leaveTo!)}>
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish blocked */}
      <Dialog open={!!publishIssues} onOpenChange={(o) => !o && setPublishIssues(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Fix these before publishing</DialogTitle></DialogHeader>
          <p className="text-sm text-ink-700">
            A published workflow answers real customers, so these would break a live run:
          </p>
          <ul className="space-y-1">
            {(publishIssues ?? []).map((m, i) => (
              <li key={i} className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-2 text-caption text-danger">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-danger" />
                {m}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Got it</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
