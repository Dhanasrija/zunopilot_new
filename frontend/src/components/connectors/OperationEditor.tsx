import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  engine, type Connector, type ConnectorOperation, type ConnectorOperationInput,
} from '@/lib/engine/api';
import {
  AlertTriangle, ArrowDown, ArrowUp, Download, Loader2, Plus, Trash2, Wand2,
} from 'lucide-react';

// Editing one connector operation: what it calls, what it needs, and where the
// useful data sits in the reply.
//
// Until this existed an operation could only be declared through the API or a
// seed script, which meant one person in the company could set up a connector.
// The design goal is therefore not "expose the JSON" but "make the two hard
// parts checkable":
//
//   • Inputs are cross-checked against the `{placeholders}` in the path, because
//     a mismatch there is not a typo — it is a call that throws MISSING_INPUT
//     every time, in a customer's conversation, and never before.
//   • The response mapping is resolved against a recorded sample *in the
//     browser*, so an author sees the rows their dotted paths actually produce
//     instead of guessing and finding out from an empty WhatsApp list.
//
// Every rule enforced here mirrors `connectors/invoke.ts`. Where the two could
// drift, the runtime wins and this is only ever an earlier, kinder copy of it.

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const INPUT_TYPES = ['string', 'number', 'boolean'] as const;
const INPUT_LOCATIONS = ['path', 'query', 'body', 'header'] as const;

/** Methods whose body `invoke.ts` actually sends. Anything else drops body inputs. */
const SENDS_BODY = ['POST', 'PUT', 'PATCH'];

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const PLACEHOLDER_RE = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * The same whitelisted walker the server uses, including the prototype refusal.
 * Kept deliberately identical so the preview cannot promise a row the runtime
 * would drop.
 */
const readPath = (source: unknown, path: string): unknown => {
  if (!path) return source;
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (!segment) continue;
    if (segment === '__proto__' || segment === 'constructor' || segment === 'prototype') return undefined;
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

interface Draft {
  key: string;
  name: string;
  description: string;
  method: string;
  path: string;
  inputs: ConnectorOperationInput[];
  itemsPath: string;
  idField: string;
  titleField: string;
  descriptionField: string;
  sideEffecting: boolean;
  timeoutMs: string;
  sampleText: string;
}

const draftFrom = (operation: ConnectorOperation): Draft => ({
  key: operation.key,
  name: operation.name,
  description: operation.description ?? '',
  method: operation.method,
  path: operation.path,
  inputs: operation.inputs.map((i) => ({ ...i })),
  itemsPath: operation.responseMapping?.itemsPath ?? '',
  idField: operation.responseMapping?.idField ?? 'id',
  titleField: operation.responseMapping?.titleField ?? 'name',
  descriptionField: operation.responseMapping?.descriptionField ?? '',
  sideEffecting: operation.sideEffecting,
  timeoutMs: operation.timeoutMs == null ? '' : String(operation.timeoutMs),
  sampleText: operation.sampleResponse == null ? '' : JSON.stringify(operation.sampleResponse, null, 2),
});

const placeholdersIn = (path: string): string[] => {
  const found = new Set<string>();
  for (const match of path.matchAll(PLACEHOLDER_RE)) found.add(match[1]);
  return [...found];
};

/**
 * Guess a mapping from a recorded response.
 *
 * A suggestion, never a silent write: it fills the fields and the author still
 * sees the resolved row count before saving. It walks breadth-first for the
 * first array of objects, because that is where a list endpoint keeps its
 * records — `{ data: { students: [...] } }` far more often than the root.
 */
const suggestMapping = (sample: unknown): Partial<Draft> | null => {
  const queue: Array<{ value: unknown; path: string }> = [{ value: sample, path: '' }];
  const ID_HINTS = ['id', 'code', 'key', 'uuid', 'ref', 'number'];
  const TITLE_HINTS = ['name', 'title', 'label', 'subject', 'description'];

  while (queue.length) {
    const { value, path } = queue.shift()!;
    if (Array.isArray(value)) {
      const first = value.find((entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry));
      if (!first) continue;
      const keys = Object.keys(first as Record<string, unknown>);
      const pick = (hints: string[]) => keys.find((k) => hints.some((h) => k.toLowerCase() === h))
        ?? keys.find((k) => hints.some((h) => k.toLowerCase().includes(h)));
      const idField = pick(ID_HINTS) ?? keys[0];
      const titleField = pick(TITLE_HINTS) ?? keys.find((k) => k !== idField) ?? keys[0];
      return {
        itemsPath: path,
        ...(idField ? { idField } : {}),
        ...(titleField ? { titleField } : {}),
      };
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        queue.push({ value: child, path: path ? `${path}.${key}` : key });
      }
    }
  }
  return null;
};

export default function OperationEditor({
  connector, operation, open, onOpenChange,
}: {
  connector: Connector;
  operation: ConnectorOperation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(operation));
  const [confirmedFetch, setConfirmedFetch] = useState(false);
  const [fetchInputs, setFetchInputs] = useState<Record<string, string>>({});

  // Reopening must show what is stored, not whatever was abandoned last time.
  useEffect(() => {
    if (open) {
      setDraft(draftFrom(operation));
      setConfirmedFetch(false);
      setFetchInputs({});
    }
  }, [open, operation]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const setInput = (index: number, patch: Partial<ConnectorOperationInput>) => setDraft((d) => ({
    ...d,
    inputs: d.inputs.map((input, i) => (i === index ? { ...input, ...patch } : input)),
  }));

  const moveInput = (index: number, by: number) => setDraft((d) => {
    const next = [...d.inputs];
    const target = index + by;
    if (target < 0 || target >= next.length) return d;
    [next[index], next[target]] = [next[target], next[index]];
    return { ...d, inputs: next };
  });

  const sample = useMemo(() => {
    if (!draft.sampleText.trim()) return { ok: true as const, value: undefined };
    try {
      return { ok: true as const, value: JSON.parse(draft.sampleText) as unknown };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : 'Invalid JSON' };
    }
  }, [draft.sampleText]);

  /** What `extractItems` would return for this mapping against the sample. */
  const preview = useMemo(() => {
    if (!sample.ok || sample.value === undefined) return null;
    const located = readPath(sample.value, draft.itemsPath);
    if (!Array.isArray(located)) return { located: false as const, rows: [], total: 0 };
    const rows = located.flatMap((entry) => {
      const id = readPath(entry, draft.idField);
      const title = readPath(entry, draft.titleField);
      if (id === undefined || title === undefined) return [];
      const description = draft.descriptionField ? readPath(entry, draft.descriptionField) : undefined;
      return [{
        id: String(id),
        title: String(title),
        description: description === undefined || description === null ? undefined : String(description),
      }];
    });
    return { located: true as const, rows: rows.slice(0, 5), total: rows.length, of: located.length };
  }, [sample, draft.itemsPath, draft.idField, draft.titleField, draft.descriptionField]);

  const { errors, warnings } = useMemo(() => {
    const e: string[] = [];
    const w: string[] = [];

    if (!draft.key.trim()) e.push('The operation needs a key.');
    else if (!KEY_RE.test(draft.key)) {
      e.push('Key must start with a letter and hold only lowercase letters, digits and underscores.');
    }
    if (!draft.name.trim()) e.push('The operation needs a name.');
    if (!draft.path.trim()) e.push('The path cannot be empty. Use "/" for the base URL itself.');

    const seen = new Set<string>();
    for (const input of draft.inputs) {
      if (!input.key.trim()) { e.push('Every input needs a key.'); continue; }
      if (!KEY_RE.test(input.key)) e.push(`Input "${input.key}" is not a valid key.`);
      if (seen.has(input.key)) e.push(`Two inputs share the key "${input.key}".`);
      seen.add(input.key);
      if (!input.label.trim()) e.push(`Input "${input.key}" needs a label.`);
    }

    // The mismatch that costs a live conversation: buildPath() throws when a
    // placeholder has no value, and only an input declared `in: path` can
    // supply one.
    const pathInputs = new Set(draft.inputs.filter((i) => i.in === 'path').map((i) => i.key));
    for (const name of placeholdersIn(draft.path)) {
      if (!pathInputs.has(name)) {
        e.push(`The path needs {${name}}, but no input declares "${name}" in the path. Every call would fail.`);
      }
    }
    for (const key of pathInputs) {
      if (!draft.path.includes(`{${key}}`)) {
        w.push(`Input "${key}" is declared in the path but the path never uses {${key}} — its value is discarded.`);
      }
    }

    if (!SENDS_BODY.includes(draft.method.toUpperCase())) {
      const bodyInputs = draft.inputs.filter((i) => i.in === 'body').map((i) => i.key);
      if (bodyInputs.length) {
        w.push(`A ${draft.method} request sends no body, so ${bodyInputs.join(', ')} will be dropped. Use query instead.`);
      }
    }

    if (draft.timeoutMs.trim()) {
      const ms = Number(draft.timeoutMs);
      if (!Number.isInteger(ms) || ms < 100 || ms > 30_000) {
        e.push('Timeout must be a whole number of milliseconds between 100 and 30,000.');
      }
    }

    if (!sample.ok) e.push(`The sample response is not valid JSON: ${sample.message}`);

    if (preview && !preview.located) {
      w.push(draft.itemsPath
        ? `"${draft.itemsPath}" is not an array in the sample, so a list node would render nothing.`
        : 'The sample is not an array at its root. Set an items path, or leave the mapping alone if this operation returns a single record.');
    } else if (preview?.located && preview.total === 0) {
      w.push(`The mapping resolves to 0 rows from ${preview.of} records — check the id and title fields.`);
    }

    if (draft.key !== operation.key) {
      w.push(`Renaming the key breaks every workflow node pointing at "${operation.key}". Fix those nodes too.`);
    }

    return { errors: e, warnings: w };
  }, [draft, sample, preview, operation.key]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(draftFrom(operation)),
    [draft, operation],
  );

  const save = useMutation({
    mutationFn: () => engine.connectors.updateOperation(connector.id, operation.id, {
      key: draft.key,
      name: draft.name,
      description: draft.description.trim() || null,
      method: draft.method,
      path: draft.path,
      inputs: draft.inputs,
      responseMapping: {
        itemsPath: draft.itemsPath,
        idField: draft.idField || 'id',
        titleField: draft.titleField || 'name',
        ...(draft.descriptionField ? { descriptionField: draft.descriptionField } : {}),
      },
      sideEffecting: draft.sideEffecting,
      timeoutMs: draft.timeoutMs.trim() ? Number(draft.timeoutMs) : null,
      sampleResponse: sample.ok && sample.value !== undefined ? sample.value : null,
    }),
    onSuccess: () => {
      toast.success('Operation saved');
      qc.invalidateQueries({ queryKey: ['engine', 'connectors'] });
      onOpenChange(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Recording a sample by calling the thing for real. The server tests the
  // *saved* operation, so offering this against an edited draft would show a
  // response the draft did not ask for.
  const fetchSample = useMutation({
    mutationFn: () => engine.connectors.testOperation(connector.id, operation.id, {
      inputs: fetchInputs,
      confirmSideEffect: operation.sideEffecting && confirmedFetch,
    }),
    onSuccess: (data) => {
      const result = data as { ok?: boolean; body?: unknown; error?: { message?: string } };
      if (result.ok === false) {
        toast.error(result.error?.message ?? 'The call failed');
        return;
      }
      const body = result.body;
      set({ sampleText: JSON.stringify(body, null, 2) });
      const suggestion = suggestMapping(body);
      if (suggestion) {
        set(suggestion);
        toast.success('Recorded the response and suggested a mapping');
      } else {
        toast.success('Recorded the response');
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const applySuggestion = () => {
    if (!sample.ok || sample.value === undefined) return;
    const suggestion = suggestMapping(sample.value);
    if (!suggestion) {
      toast.error('No array of records found in the sample');
      return;
    }
    set(suggestion);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{operation.name}</span>
            <code className="rounded bg-surface-0 px-1 py-px text-caption font-normal">
              {connector.key}.{operation.key}
            </code>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="request">
          <TabsList>
            <TabsTrigger value="request">Request</TabsTrigger>
            <TabsTrigger value="inputs">
              Inputs
              {draft.inputs.length > 0 && (
                <Badge variant="outline" className="ml-1 text-caption">{draft.inputs.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="response">Response</TabsTrigger>
          </TabsList>

          {/* ── Request ─────────────────────────────────────────────────── */}
          <TabsContent value="request" className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Key</Label>
                <Input
                  className="font-mono text-caption"
                  value={draft.key}
                  onChange={(e) => set({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                />
                <p className="text-caption text-muted-foreground">What a workflow node stores.</p>
              </div>
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea
                rows={2}
                placeholder="What this returns, in the words the person building a workflow would use."
                value={draft.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-[110px_1fr] gap-3">
              <div className="space-y-1">
                <Label>Method</Label>
                <Select value={draft.method} onValueChange={(v) => set({ method: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Path</Label>
                <Input
                  className="font-mono text-caption"
                  placeholder="/parents/{parent_id}/students"
                  value={draft.path}
                  onChange={(e) => set({ path: e.target.value })}
                />
                <p className="text-caption text-muted-foreground">
                  Appended to <code>{connector.baseUrl || connector.kind.toLowerCase()}</code>.
                  {' '}
                  <code>{'{braces}'}</code> are filled from inputs declared in the path.
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Timeout</Label>
              <Input
                className="w-40 font-mono text-caption"
                placeholder="server default"
                value={draft.timeoutMs}
                onChange={(e) => set({ timeoutMs: e.target.value.replace(/[^0-9]/g, '') })}
              />
              <p className="text-caption text-muted-foreground">
                Milliseconds, 100–30,000. A customer is waiting on this, so keep it short.
              </p>
            </div>

            <label className="flex items-start gap-3 rounded-lg border p-3">
              <Switch
                className="mt-px"
                checked={draft.sideEffecting}
                onCheckedChange={(v) => set({ sideEffecting: v })}
              />
              <span className="text-caption">
                <strong>This changes data on the far end.</strong>
                <span className="mt-px block text-muted-foreground">
                  A workflow using it cannot be published without a confirmation step, and it must be
                  placed in an Action node rather than a Query node.
                </span>
              </span>
            </label>
          </TabsContent>

          {/* ── Inputs ──────────────────────────────────────────────────── */}
          <TabsContent value="inputs" className="space-y-3 pt-3">
            <p className="text-caption leading-snug text-muted-foreground">
              What a workflow node may supply. Anything not declared here is dropped before the call —
              that is what stops a node smuggling a parameter the connector's owner never approved.
            </p>

            {draft.inputs.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-center text-caption text-muted-foreground">
                No inputs. This operation is called with nothing but its path.
              </p>
            )}

            <div className="space-y-2">
              {draft.inputs.map((input, index) => (
                <div key={index} className="space-y-2 rounded-lg border p-2">
                  <div className="grid grid-cols-[1fr_1fr_90px_110px] gap-2">
                    <div className="space-y-1">
                      <Label className="text-caption">Key</Label>
                      <Input
                        className="h-7 font-mono text-caption"
                        placeholder="parent_id"
                        value={input.key}
                        onChange={(e) => setInput(index, {
                          key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                        })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-caption">Label</Label>
                      <Input
                        className="h-7 text-caption"
                        placeholder="Parent id"
                        value={input.label}
                        onChange={(e) => setInput(index, { label: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-caption">Type</Label>
                      <Select value={input.type} onValueChange={(v) => setInput(index, { type: v as ConnectorOperationInput['type'] })}>
                        <SelectTrigger className="h-7 text-caption"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {INPUT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-caption">Sent in</Label>
                      <Select value={input.in} onValueChange={(v) => setInput(index, { in: v as ConnectorOperationInput['in'] })}>
                        <SelectTrigger className="h-7 text-caption"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {INPUT_LOCATIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <Label className="text-caption">Description</Label>
                      <Input
                        className="h-7 text-caption"
                        placeholder="Optional — shown to whoever configures the node."
                        value={input.description ?? ''}
                        onChange={(e) => setInput(index, { description: e.target.value })}
                      />
                    </div>
                    <label className="flex h-7 items-center gap-1 text-caption">
                      <input
                        type="checkbox"
                        checked={input.required}
                        onChange={(e) => setInput(index, { required: e.target.checked })}
                      />
                      Required
                    </label>
                    <div className="flex gap-px">
                      <Button
                        size="sm" variant="ghost" className="h-7 w-7 p-0"
                        disabled={index === 0}
                        onClick={() => moveInput(index, -1)}
                      >
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-7 w-7 p-0"
                        disabled={index === draft.inputs.length - 1}
                        onClick={() => moveInput(index, 1)}
                      >
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                      <Button
                        size="sm" variant="ghost" className="h-7 w-7 p-0 text-danger"
                        onClick={() => set({ inputs: draft.inputs.filter((_, i) => i !== index) })}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm" variant="outline" className="gap-1"
                disabled={draft.inputs.length >= 25}
                onClick={() => set({
                  inputs: [...draft.inputs, { key: '', label: '', type: 'string', required: true, in: 'query' }],
                })}
              >
                <Plus className="h-3.5 w-3.5" /> Add input
              </Button>

              {/* Declaring the placeholders the path already names is pure
                  transcription, and getting it wrong breaks every call. */}
              {placeholdersIn(draft.path)
                .filter((name) => !draft.inputs.some((i) => i.key === name))
                .map((name) => (
                  <Button
                    key={name} size="sm" variant="outline" className="gap-1"
                    onClick={() => set({
                      inputs: [...draft.inputs, {
                        key: name,
                        label: name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
                        type: 'string',
                        required: true,
                        in: 'path',
                      }],
                    })}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Declare
                    {' '}
                    <code>{`{${name}}`}</code>
                  </Button>
                ))}
            </div>
          </TabsContent>

          {/* ── Response ────────────────────────────────────────────────── */}
          <TabsContent value="response" className="space-y-3 pt-3">
            <p className="text-caption leading-snug text-muted-foreground">
              Where the records sit in the reply. A Query node fetches them into a variable and a list
              node renders them, so these four paths are what turns a JSON body into WhatsApp rows.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Items path</Label>
                <Input
                  className="font-mono text-caption"
                  placeholder="data.students"
                  value={draft.itemsPath}
                  onChange={(e) => set({ itemsPath: e.target.value })}
                />
                <p className="text-caption text-muted-foreground">Dotted. Empty means the response itself is the array.</p>
              </div>
              <div className="space-y-1">
                <Label>Id field</Label>
                <Input
                  className="font-mono text-caption"
                  placeholder="id"
                  value={draft.idField}
                  onChange={(e) => set({ idField: e.target.value })}
                />
                <p className="text-caption text-muted-foreground">What comes back when the customer taps the row.</p>
              </div>
              <div className="space-y-1">
                <Label>Title field</Label>
                <Input
                  className="font-mono text-caption"
                  placeholder="name"
                  value={draft.titleField}
                  onChange={(e) => set({ titleField: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Description field</Label>
                <Input
                  className="font-mono text-caption"
                  placeholder="optional second line"
                  value={draft.descriptionField}
                  onChange={(e) => set({ descriptionField: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Label className="flex-1">Sample response</Label>
                <Button
                  size="sm" variant="outline" className="h-7 gap-1"
                  disabled={!sample.ok || sample.value === undefined}
                  onClick={applySuggestion}
                >
                  <Wand2 className="h-3 w-3" /> Suggest mapping
                </Button>
                <Button
                  size="sm" variant="outline" className="h-7 gap-1"
                  disabled={
                    fetchSample.isPending
                    || dirty
                    || (operation.sideEffecting && !confirmedFetch)
                  }
                  onClick={() => fetchSample.mutate()}
                >
                  {fetchSample.isPending
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Download className="h-3 w-3" />}
                  Call it and record
                </Button>
              </div>

              {dirty && (
                <p className="text-caption text-ink-900">
                  The test endpoint calls the operation as it is <em>saved</em>. Save first to record a
                  response against these edits.
                </p>
              )}

              {operation.sideEffecting && (
                <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/15 p-2">
                  <input
                    type="checkbox"
                    className="mt-px"
                    checked={confirmedFetch}
                    onChange={(e) => setConfirmedFetch(e.target.checked)}
                  />
                  <span className="text-caption text-ink-900">
                    This operation changes data. Recording a response means <strong>really running
                    it</strong> — tick to confirm.
                  </span>
                </label>
              )}

              {operation.inputs.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {operation.inputs.map((input) => (
                    <div key={input.key} className="space-y-1">
                      <Label className="text-caption">
                        {input.label}
                        <span className="ml-1 text-muted-foreground">({input.in})</span>
                      </Label>
                      <Input
                        className="h-7 text-caption"
                        placeholder={input.required ? 'required' : 'optional'}
                        value={fetchInputs[input.key] ?? ''}
                        onChange={(e) => setFetchInputs((v) => ({ ...v, [input.key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              )}

              <Textarea
                rows={8}
                className="font-mono text-caption"
                placeholder='{ "data": { "students": [ { "id": "S-1", "name": "Anita" } ] } }'
                value={draft.sampleText}
                onChange={(e) => set({ sampleText: e.target.value })}
              />
              <p className="text-caption text-muted-foreground">
                Stored on the operation. A dry run returns this instead of calling anything, which is
                what lets the simulator show the real shape without the side effect.
              </p>
            </div>

            {preview?.located && (
              <div className="rounded-lg border bg-surface-0 p-2">
                <p className="text-caption font-medium">
                  {preview.total === 0
                    ? `0 rows from ${preview.of} records`
                    : `${preview.total} row${preview.total === 1 ? '' : 's'} from ${preview.of} record${preview.of === 1 ? '' : 's'}`}
                </p>
                <div className="mt-1 space-y-1">
                  {preview.rows.map((row, i) => (
                    <div key={i} className="rounded border bg-surface-1 px-2 py-1">
                      <p className="text-caption font-medium">{row.title}</p>
                      {row.description && <p className="text-caption text-muted-foreground">{row.description}</p>}
                      <code className="text-caption text-muted-foreground">{row.id}</code>
                    </div>
                  ))}
                  {preview.total > preview.rows.length && (
                    <p className="text-caption text-muted-foreground">
                      …and {preview.total - preview.rows.length} more
                    </p>
                  )}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {(errors.length > 0 || warnings.length > 0) && (
          <div className="space-y-1">
            {errors.map((message) => (
              <div key={message} className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-2">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-danger" />
                <p className="text-caption text-danger">{message}</p>
              </div>
            ))}
            {warnings.map((message) => (
              <div key={message} className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/15 p-2">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-ink-900" />
                <p className="text-caption text-ink-900">{message}</p>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={errors.length > 0 || !dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save operation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
