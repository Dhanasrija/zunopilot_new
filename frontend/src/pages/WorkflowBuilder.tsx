import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FLOW_INK } from '@/lib/chart-tokens';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow,
  ReactFlowProvider, useEdgesState, useNodesInitialized, useNodesState, useReactFlow,
  type Connection, type Edge, type IsValidConnection, type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { engine, type CapabilityContract, type TestRunResult, type ValidationIssue } from '@/lib/engine/api';
import { PALETTE, specFor, type NodeType } from '@/lib/engine/nodes';
import {
  edgeIdFor, emptyDefinition, fingerprint, newNodeId, toDefinition, toFlow,
  type FlowNode,
} from '@/lib/engine/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import EngineNode from '@/components/engine/EngineNode';
import NodeConfigPanel from '@/components/engine/NodeConfigPanel';
import CapabilityEditor from '@/components/engine/CapabilityEditor';
import BottomPanel from '@/components/engine/BottomPanel';
import {
  AlertTriangle, ArrowLeft, FlaskConical, Loader2, Rocket, Save, Search, Undo2, X,
} from 'lucide-react';

// Workflow builder — /workflows/:workflowId
//
// The definition lives in React Flow while editing and is converted to the
// stored shape only on save, so the editor's coordinates and the engine's
// contract stay decoupled. Validation is the *server's* — `POST /validate`
// runs the same code the publish endpoint does, so what the panel shows is
// exactly what will block a publish.

const DND_MIME = 'application/x-zuno-node';
const nodeTypes = { engineNode: EngineNode };

const defaultEdgeOptions = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: FLOW_INK.edge },
  style: { stroke: FLOW_INK.edge, strokeWidth: 1.5 },
};

const EMPTY_CAPABILITY: CapabilityContract = {
  purpose: '', description: '', useWhen: [], doNotUseWhen: [],
  positiveExamples: [], negativeExamples: [],
  requiredInputs: [], optionalInputs: [], preconditions: [], sideEffects: [],
  requiresConfirmation: false, minimumConfidence: 0.8, allowsInterruption: false,
};

function Builder() {
  const { id: workflowId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const wrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const didFit = useRef(false);
  const hydrated = useRef(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'node' | 'routing'>('node');
  const [capability, setCapability] = useState<CapabilityContract>(EMPTY_CAPABILITY);
  const [savedPrint, setSavedPrint] = useState<string | null>(null);
  const [savedCapability, setSavedCapability] = useState<string>('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [run, setRun] = useState<TestRunResult | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [leaving, setLeaving] = useState(false);
  const [publishErrors, setPublishErrors] = useState<ValidationIssue[] | null>(null);
  const [paletteQuery, setPaletteQuery] = useState('');

  const { data: workflow, isLoading, isError } = useQuery({
    queryKey: ['engine', 'workflow', workflowId],
    queryFn: () => engine.workflows.get(workflowId),
    enabled: !!workflowId,
  });

  // The version the editor works on: the newest one, published or not.
  //
  // Not `publishedVersion` — Save writes a new *draft* version, so preferring
  // the published one meant an edit was written to the database and then never
  // shown again. You would reopen the builder, see the old graph, and
  // reasonably conclude the save had failed.
  const editing = workflow?.versions[0] ?? workflow?.publishedVersion ?? null;

  /** A saved draft newer than what customers are currently answering. */
  const unpublishedDraft = !!workflow?.publishedVersion
    && !!editing
    && editing.version > workflow.publishedVersion.version;

  // Seed once. Re-running on refetch would discard edits in progress.
  useEffect(() => {
    if (!workflow || hydrated.current) return;
    hydrated.current = true;

    const definition = editing?.definition ?? emptyDefinition();
    const flow = toFlow(definition);

    setNodes(flow.nodes);
    setEdges(flow.edges);
    // Baseline off the round-tripped definition, not the raw one: loading
    // normalises positions and drops dangling edges, and neither changes what
    // the engine would execute, so neither should read as an unsaved edit.
    setSavedPrint(fingerprint(toDefinition(flow.nodes, flow.edges, definition.entryNodeId)));

    const contract = workflow.capability
      ? { ...EMPTY_CAPABILITY, ...workflow.capability }
      : EMPTY_CAPABILITY;
    setCapability(contract);
    setSavedCapability(JSON.stringify(contract));
  }, [workflow, editing, setNodes, setEdges]);

  // `fitView` only fires on mount and the graph arrives after the query.
  useEffect(() => {
    if (!nodesInitialized || didFit.current || !nodes.length) return;
    didFit.current = true;
    fitView({ padding: 0.25, maxZoom: 1, duration: 200 });
  }, [nodesInitialized, nodes.length, fitView]);

  const definition = useMemo(
    () => toDefinition(nodes, edges, editing?.definition.entryNodeId),
    [nodes, edges, editing],
  );

  const graphDirty = savedPrint !== null && fingerprint(definition) !== savedPrint;
  const capabilityDirty = savedCapability !== '' && JSON.stringify(capability) !== savedCapability;
  const dirty = graphDirty || capabilityDirty;

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);
  const usedTypes = useMemo(() => new Set(nodes.map((n) => n.data.type)), [nodes]);

  /**
   * Palette filtering.
   *
   * 32 entries in a narrow column means the ACTIONS and INTEGRATIONS groups sit
   * below the fold, so the nodes someone is most likely to be hunting for are
   * the ones they cannot see. Matching covers the label, the blurb and the raw
   * type — "cart" should find Add to Basket, and someone who knows the engine
   * should be able to type `CREATE_ORDER`.
   */
  const filteredPalette = useMemo(() => {
    const query = paletteQuery.trim().toLowerCase();
    if (!query) return PALETTE;
    const words = query.split(/\s+/);
    const hit = (spec: { label: string; blurb: string; type: string }) => {
      const haystack = `${spec.label} ${spec.blurb} ${spec.type.replace(/_/g, ' ')}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    };
    return PALETTE
      .map(({ group, items }) => ({ group, items: items.filter(hit) }))
      .filter((g) => g.items.length > 0);
  }, [paletteQuery]);

  const paletteMatches = useMemo(
    () => filteredPalette.flatMap((g) => g.items),
    [filteredPalette],
  );

  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  // ── Editing ────────────────────────────────────────────────────────────────

  const addNode = useCallback((type: NodeType, position?: { x: number; y: number }) => {
    const spec = specFor(type);
    const id = newNodeId(type);
    const at = position ?? (() => {
      const rect = wrapper.current?.getBoundingClientRect();
      const centre = rect
        ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 })
        : { x: 360, y: 240 };
      const offset = (nodes.length % 5) * 28;
      return { x: centre.x - 124 + offset, y: centre.y + offset };
    })();

    setNodes((current) => [
      ...current.map((n) => ({ ...n, selected: false })),
      {
        id,
        type: 'engineNode' as const,
        position: at,
        selected: true,
        data: { type, name: spec.label, config: spec.defaults(), outputVariable: null },
      },
    ]);
    setSelectedId(id);
    setTab('node');
  }, [nodes.length, screenToFlowPosition, setNodes]);

  const patchNode = useCallback((id: string, patch: Partial<FlowNode['data']>) => {
    setNodes((current) => current.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  }, [setNodes]);

  const patchConfig = useCallback((id: string, patch: Record<string, unknown>) => {
    setNodes((current) => current.map((n) => (n.id === id
      ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } }
      : n)));
  }, [setNodes]);

  const deleteNode = useCallback((id: string) => {
    setNodes((current) => current.filter((n) => n.id !== id));
    setEdges((current) => current.filter((e) => e.source !== id && e.target !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, [setNodes, setEdges]);

  const isValidConnection: IsValidConnection = useCallback((c) => c.source !== c.target, []);

  const onConnect: OnConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    setEdges((current) => [
      // One edge per source handle: the engine takes a single next node per
      // branch, so a second edge off the same handle is silently dead.
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
    const type = event.dataTransfer.getData(DND_MIME) as NodeType;
    if (!type) return;
    if (specFor(type).once && usedTypes.has(type)) {
      toast.error(`Only one ${specFor(type).label} per workflow.`);
      return;
    }
    const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    addNode(type, { x: at.x - 124, y: at.y - 40 });
  }, [addNode, screenToFlowPosition, usedTypes]);

  // ── Persistence ────────────────────────────────────────────────────────────

  const save = useMutation({
    mutationFn: async () => {
      if (capabilityDirty && workflow?.category === 'CONVERSATION') {
        await engine.workflows.putCapability(workflowId, capability);
      }
      if (graphDirty) await engine.workflows.createVersion(workflowId, definition);
      return engine.workflows.validate(workflowId, definition);
    },
    onSuccess: (validation) => {
      setSavedPrint(fingerprint(definition));
      setSavedCapability(JSON.stringify(capability));
      setIssues(validation.issues);
      toast.success('Saved as a new version');
      qc.invalidateQueries({ queryKey: ['engine', 'workflow', workflowId] });
    },
  });

  const validate = useMutation({
    mutationFn: () => engine.workflows.validate(workflowId, definition),
    onSuccess: (result) => {
      setIssues(result.issues);
      setPanelOpen(true);
    },
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (dirty) await save.mutateAsync();
      return engine.workflows.publish(workflowId);
    },
    onSuccess: () => {
      toast.success('Workflow published');
      qc.invalidateQueries({ queryKey: ['engine', 'workflow', workflowId] });
      qc.invalidateQueries({ queryKey: ['engine', 'workflows'] });
    },
    onError: (err: { response?: { data?: { details?: ValidationIssue[]; message?: string } } }) => {
      const details = err.response?.data?.details;
      if (details?.length) {
        setPublishErrors(details);
        setIssues((current) => [...details, ...current.filter((i) => i.level === 'warning')]);
      }
    },
  });

  const test = useMutation({
    mutationFn: () => engine.workflows.test(workflowId, { dryRun: true }),
    onSuccess: (result) => {
      setRun(result);
      setPanelOpen(true);
      // Paint each node with what happened, so the canvas shows the path taken.
      const byNode = new Map(result.executions.map((e) => [e.nodeId, e.status]));
      setNodes((current) => current.map((n) => ({
        ...n,
        data: { ...n.data, runStatus: byNode.get(n.id) ?? null },
      })));
      toast.success(`Test run ${result.status.replace(/_/g, ' ').toLowerCase()}`);
    },
  });

  const back = () => {
    if (dirty) setLeaving(true);
    else navigate(workflow?.assistantId ? `/assistants/${workflow.assistantId}/workflows` : '/assistants');
  };

  if (isLoading) {
    return <div className="grid h-full place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent-600" /></div>;
  }
  if (isError || !workflow) {
    return (
      <div className="grid h-full place-items-center">
        <div className="space-y-3 text-center">
          <p className="text-sm text-ink-700">This workflow could not be loaded.</p>
          <Button variant="outline" onClick={() => navigate('/assistants')}>Back</Button>
        </div>
      </div>
    );
  }

  const errorCount = issues.filter((i) => i.level === 'error').length;
  const busy = save.isPending || publish.isPending || test.isPending || validate.isPending;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-surface-1 px-4">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={back}>
          <ArrowLeft className="h-4 w-4" />
        </Button>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-ink-700">{workflow.name}</h1>
            <Badge
              variant="outline"
              className={cn('shrink-0 text-caption', workflow.status === 'PUBLISHED'
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-ink-300 bg-surface-0 text-ink-700')}
            >
              {workflow.status === 'PUBLISHED' && workflow.publishedVersion
                ? `Published v${workflow.publishedVersion.version}`
                : 'Draft'}
            </Badge>
            {unpublishedDraft && (
              <Badge variant="outline" className="shrink-0 border-warning/40 bg-warning/15 text-caption text-ink-900">
                Editing draft v{editing!.version}
              </Badge>
            )}
          </div>
          <p className="text-caption text-ink-500">
            {nodes.length} nodes · {edges.length} connections
            {dirty && <span className="ml-1 font-medium text-ink-900">• Unsaved changes</span>}
            {!dirty && unpublishedDraft && (
              <span className="ml-1 font-medium text-ink-900">
                • Saved, not live yet — publish to use it
              </span>
            )}
          </p>
        </div>

        <div className="flex-1" />

        {errorCount > 0 && (
          <button
            className="hidden items-center gap-1 rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-caption font-medium text-danger sm:inline-flex"
            onClick={() => setPanelOpen(true)}
          >
            <AlertTriangle className="h-3 w-3" /> {errorCount} error{errorCount === 1 ? '' : 's'}
          </button>
        )}

        <Button variant="outline" size="sm" className="h-8 gap-1" disabled={busy} onClick={() => validate.mutate()}>
          Check
        </Button>
        <Button variant="outline" size="sm" className="h-8 gap-1" disabled={busy} onClick={() => test.mutate()}>
          {test.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
          Test flow
        </Button>
        <Button variant="outline" size="sm" className="h-8 gap-1" disabled={!dirty || busy} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
        {workflow.status === 'PUBLISHED' && (
          <Button
            variant="outline" size="sm" className="h-8 gap-1" disabled={busy}
            onClick={async () => {
              await engine.workflows.unpublish(workflowId);
              toast.success('Moved to draft — runs already in flight will finish on the published version.');
              qc.invalidateQueries({ queryKey: ['engine', 'workflow', workflowId] });
            }}
          >
            <Undo2 className="h-3.5 w-3.5" /> Unpublish
          </Button>
        )}
        {/*
          Publish stays available on an already-published workflow whenever
          there is something newer to publish. Without this, saving an edit to a
          live flow left it stranded: the only route to making it live was to
          unpublish first, which takes the workflow out of service in between.
        */}
        {(workflow.status !== 'PUBLISHED' || unpublishedDraft || dirty) && (
          <Button
            size="sm" className="h-8 gap-1 bg-accent-600 hover:bg-accent-700"
            disabled={busy} onClick={() => publish.mutate()}
          >
            {publish.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
            {workflow.status === 'PUBLISHED' ? 'Publish update' : 'Publish'}
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Node library */}
        <aside className="flex w-56 shrink-0 flex-col border-r bg-surface-0/60">
          {/* Sticky, because the point of the search is to reach the groups
              below the fold — scrolling it away would defeat it. */}
          <div className="shrink-0 border-b bg-surface-1/60 px-3 py-2">
            <h2 className="text-caption font-semibold uppercase tracking-wide text-ink-500">Nodes</h2>
            <p className="mt-px text-caption text-ink-500">Drag onto the canvas, or click.</p>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
              <input
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setPaletteQuery('');
                  // Enter adds the node when the filter has narrowed to one.
                  if (e.key === 'Enter' && paletteMatches.length === 1) {
                    const only = paletteMatches[0]!;
                    if (!(only.once && usedTypes.has(only.type))) addNode(only.type);
                  }
                }}
                placeholder="Search nodes"
                aria-label="Search nodes"
                className="h-7 w-full rounded-md border border-ink-300 bg-surface-1 pl-6 pr-6 text-caption text-ink-700 placeholder:text-ink-500 focus:border-accent-100 focus:outline-none focus:ring-1 focus:ring-accent-100"
              />
              {paletteQuery && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setPaletteQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-px text-ink-500 hover:bg-surface-0"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            {paletteQuery && !paletteMatches.length && (
              <p className="px-px text-caption text-ink-500">
                No node matches “{paletteQuery}”.
              </p>
            )}
            {filteredPalette.map(({ group, items }) => (
              <div key={group} className="space-y-1">
                <div className="px-px text-caption font-semibold uppercase tracking-wide text-ink-500">
                  {group}
                </div>
                {items.map((spec) => {
                  const disabled = !!spec.once && usedTypes.has(spec.type);
                  const Icon = spec.icon;
                  return (
                    <button
                      key={spec.type}
                      type="button"
                      draggable={!disabled}
                      disabled={disabled}
                      title={spec.blurb}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DND_MIME, spec.type);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onClick={() => !disabled && addNode(spec.type)}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-lg border p-2 text-left transition-colors',
                        disabled
                          ? 'cursor-not-allowed border-ink-300 opacity-45'
                          : 'cursor-grab border-ink-300 bg-surface-1 hover:border-accent-100 hover:bg-accent-100/50 active:cursor-grabbing',
                      )}
                    >
                      <div className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-md', spec.accent)}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className="truncate text-sm font-medium text-ink-700">{spec.label}</span>
                          {!spec.implemented && (
                            <span className="shrink-0 rounded bg-surface-0 px-1 py-px text-caption font-semibold uppercase text-ink-500">
                              Soon
                            </span>
                          )}
                        </div>
                        <p className="line-clamp-2 text-caption leading-tight text-ink-500">{spec.blurb}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>

        {/* Canvas + bottom panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1" ref={wrapper}>
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
              onNodeClick={(_e, n) => { setSelectedId(n.id); setTab('node'); }}
              onPaneClick={() => setSelectedId(null)}
              deleteKeyCode={['Backspace', 'Delete']}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              minZoom={0.2}
              maxZoom={1.75}
              className="bg-surface-0"
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} color={FLOW_INK.dots} />
              <Controls showInteractive={false} className="!shadow-none" />
              <MiniMap
                pannable zoomable
                className="!h-24 !w-40 !rounded-lg !border !border-ink-300"
                nodeColor={() => FLOW_INK.minimapNode}
                maskColor={FLOW_INK.minimapMask}
              />
            </ReactFlow>
          </div>

          <BottomPanel
            run={run}
            issues={issues}
            open={panelOpen}
            onToggle={() => setPanelOpen((v) => !v)}
            onSelectNode={(nodeId) => { setSelectedId(nodeId); setTab('node'); }}
          />
        </div>

        {/* Inspector */}
        <aside className="flex w-80 shrink-0 flex-col border-l bg-surface-1">
          <div className="flex shrink-0 gap-1 border-b px-3 py-2">
            {(['node', 'routing'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded px-2 py-1 text-caption font-medium transition-colors',
                  tab === t ? 'bg-accent-100 text-accent-700' : 'text-ink-500 hover:bg-surface-0',
                )}
              >
                {t === 'node' ? 'Node' : 'Routing metadata'}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === 'routing' ? (
              workflow.category === 'CONVERSATION' ? (
                <CapabilityEditor value={capability} onChange={setCapability} />
              ) : (
                <p className="text-caption text-ink-500">
                  Event workflows aren't selected by the router, so they have no capability contract.
                </p>
              )
            ) : selected ? (
              <NodeConfigPanel
                node={selected}
                issues={issues.filter((i) => i.nodeId === selected.id)}
                onPatch={(patch) => patchNode(selected.id, patch)}
                onPatchConfig={(patch) => patchConfig(selected.id, patch)}
                onDelete={() => deleteNode(selected.id)}
                canDelete={specFor(selected.data.type).group !== 'Entry'}
              />
            ) : (
              <div className="space-y-3">
                <p className="text-caption leading-snug text-ink-500">
                  Select a node to configure it. Drag from a node's bottom dot to another node's top
                  dot to connect them.
                </p>
                <div className="rounded-lg border border-ink-300 bg-surface-0 p-3">
                  <p className="text-caption leading-snug text-ink-500">
                    This is a <strong>conversation workflow</strong>: it starts when the Assistant
                    Router selects it, not on a raw WhatsApp trigger. What makes the router pick it
                    lives in <strong>Routing metadata</strong>.
                  </p>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Unsaved changes */}
      <Dialog open={leaving} onOpenChange={setLeaving}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Leave without saving?</DialogTitle></DialogHeader>
          <p className="text-sm text-ink-700">
            This workflow has changes that haven't been saved as a version.
          </p>
          <DialogFooter className="gap-2">
            <DialogClose asChild><Button variant="outline">Stay</Button></DialogClose>
            <Button
              variant="outline"
              onClick={async () => {
                await save.mutateAsync();
                navigate(workflow.assistantId ? `/assistants/${workflow.assistantId}/workflows` : '/assistants');
              }}
            >
              Save and leave
            </Button>
            <Button
              className="bg-danger hover:bg-danger"
              onClick={() => navigate(workflow.assistantId ? `/assistants/${workflow.assistantId}/workflows` : '/assistants')}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish blocked */}
      <Dialog open={!!publishErrors} onOpenChange={(o) => !o && setPublishErrors(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Fix these before publishing</DialogTitle></DialogHeader>
          <p className="text-sm text-ink-700">
            A published workflow answers real customers, so these would break a live run:
          </p>
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {(publishErrors ?? []).map((issue, i) => (
              <li key={i} className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 p-2 text-caption text-danger">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-danger" />
                {issue.message}
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

export default function WorkflowBuilder() {
  return (
    <ReactFlowProvider>
      <Builder />
    </ReactFlowProvider>
  );
}
