import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { engine, type Connector, type ConnectorOperation } from '@/lib/engine/api';
import { cn } from '@/lib/utils';
import OperationEditor from '@/components/connectors/OperationEditor';
import {
  AlertTriangle, KeyRound, Loader2, Pencil, Plug, PlugZap, Plus, Trash2,
} from 'lucide-react';

/**
 * Inputs derived from the `{placeholders}` in a path.
 *
 * Not a guess: a placeholder in a path can only ever be filled by an input declared
 * `in: 'path'`, so there is exactly one correct declaration and typing it by hand would be
 * busywork. Without this the dialog would happily create an operation whose path names an
 * input that does not exist — refused on its first real call with "Missing required input".
 *
 * The label is title-cased from the key as a starting point; the operation editor is where
 * anyone who cares refines it.
 */
const pathInputsFor = (path: string) => [...new Set(
  [...path.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]),
)].map((key) => ({
  key,
  label: key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
  type: 'string' as const,
  required: true,
  in: 'path' as const,
}));

/** Methods whose body actually goes on the wire. Mirrors `SENDS_BODY` on the server. */
const SENDS_BODY = ['POST', 'PUT', 'PATCH'];
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// Connectors — registered ways to reach an outside system.
//
// The shape of this page follows the security model rather than the data model.
// A credential is write-only: it can be replaced, never read back, so the field
// shows a masked hint and an empty box means "leave it alone". A base URL is
// checked by the egress guard when it is saved, so a bad one is rejected here
// rather than at three in the morning inside a customer's conversation.

const AUTH_LABELS: Record<string, string> = {
  NONE: 'No authentication',
  API_KEY_HEADER: 'API key in a header',
  BEARER: 'Bearer token',
  BASIC: 'Basic auth',
};

function OperationRow({ connector, operation }: { connector: Connector; operation: ConnectorOperation }) {
  const qc = useQueryClient();
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const test = useMutation({
    mutationFn: () => engine.connectors.testOperation(connector.id, operation.id, {
      inputs,
      // A read is safe to run on a whim; a write is not. The server refuses a
      // side-effecting operation unless this is explicitly set.
      confirmSideEffect: operation.sideEffecting,
    }),
    onSuccess: (data) => setResult(JSON.stringify(data, null, 2)),
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: () => engine.connectors.removeOperation(connector.id, operation.id),
    onSuccess: () => {
      toast.success('Operation removed');
      qc.invalidateQueries({ queryKey: ['engine', 'connectors'] });
    },
  });

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-surface-0 px-1 py-px text-caption">{operation.key}</code>
        <span className="text-sm font-medium">{operation.name}</span>
        <Badge variant="outline" className="text-caption">{operation.method}</Badge>
        <code className="text-caption text-muted-foreground">{operation.path}</code>
        {operation.sideEffecting && (
          <Badge variant="outline" className="border-warning/40 bg-warning/15 text-caption text-ink-900">
            Changes data
          </Badge>
        )}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setEditing(true)}>
            <Pencil className="h-3 w-3" /> Edit
          </Button>
          <Button size="sm" variant="outline" className="h-7" disabled={test.isPending} onClick={() => test.mutate()}>
            {test.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Test'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-danger" onClick={() => remove.mutate()}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {operation.description && (
        <p className="mt-1 text-caption text-muted-foreground">{operation.description}</p>
      )}

      {/* An operation created through the "Operation" button starts as a shell:
          no inputs, a default mapping and no recorded sample. Saying so is the
          difference between "this is ready" and "this needs ten more seconds". */}
      {operation.inputs.length === 0 && operation.sampleResponse == null && (
        <p className="mt-1 text-caption text-ink-900">
          Not configured yet — no inputs declared and no sample response recorded. Open Edit to
          declare what it needs and where its records sit.
        </p>
      )}

      {operation.inputs.length > 0 && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {operation.inputs.map((input) => (
            <div key={input.key} className="space-y-1">
              <Label className="text-caption">
                {input.label}
                <span className="ml-1 text-muted-foreground">({input.in})</span>
              </Label>
              <Input
                className="h-7 text-caption"
                placeholder={input.required ? 'required' : 'optional'}
                value={inputs[input.key] ?? ''}
                onChange={(e) => setInputs((v) => ({ ...v, [input.key]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      )}

      {result && (
        <pre className="mt-2 max-h-56 overflow-auto rounded bg-surface-0 p-2 font-mono text-caption">
          {result}
        </pre>
      )}

      <OperationEditor
        connector={connector}
        operation={operation}
        open={editing}
        onOpenChange={setEditing}
      />
    </div>
  );
}

function ConnectorCard({ connector }: { connector: Connector }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ key: '', name: '', method: 'GET', path: '/', sideEffecting: false });

  const addOperation = useMutation({
    mutationFn: () => engine.connectors.createOperation(connector.id, draft),
    onSuccess: () => {
      toast.success('Operation added');
      setAdding(false);
      setDraft({ key: '', name: '', method: 'GET', path: '/', sideEffecting: false });
      qc.invalidateQueries({ queryKey: ['engine', 'connectors'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-body">
            {connector.kind === 'MOCK' ? <Plug className="h-4 w-4" /> : <PlugZap className="h-4 w-4" />}
            {connector.name}
            <code className="rounded bg-surface-0 px-1 py-px text-caption font-normal">{connector.key}</code>
          </CardTitle>
          <p className="mt-1 text-caption text-muted-foreground">
            {connector.kind === 'MOCK'
              ? 'Fixture-backed — never reaches a network.'
              : connector.baseUrl}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
            <Badge variant="outline" className="text-caption">{connector.kind}</Badge>
            <span>{AUTH_LABELS[connector.authType]}</span>
            {connector.secret && (
              <span className="inline-flex items-center gap-1">
                <KeyRound className="h-3 w-3" />
                {connector.secret.hint}
              </span>
            )}
            {connector.status === 'DISABLED' && (
              <Badge variant="outline" className="border-danger/30 bg-danger/10 text-caption text-danger">
                Disabled
              </Badge>
            )}
          </div>
        </div>
        <Button size="sm" variant="outline" className="shrink-0 gap-1" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" /> Operation
        </Button>
      </CardHeader>

      <CardContent className="space-y-2">
        {connector.operations.length === 0 ? (
          <p className="text-caption text-muted-foreground">
            No operations yet. A workflow node picks from these, so nothing can be called until one exists.
          </p>
        ) : (
          connector.operations.map((operation) => (
            <OperationRow key={operation.id} connector={connector} operation={operation} />
          ))
        )}
      </CardContent>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader><DialogTitle>New operation on {connector.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Key</Label>
                <Input
                  className="font-mono text-caption"
                  placeholder="list_students"
                  value={draft.key}
                  onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  placeholder="List students"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <div className="space-y-1">
                <Label>Method</Label>
                <Select value={draft.method} onValueChange={(v) => setDraft((d) => ({ ...d, method: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Path</Label>
                <Input
                  className="font-mono text-caption"
                  placeholder="/parents/{parent_id}/students"
                  value={draft.path}
                  onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value }))}
                />
              </div>
            </div>
            <label className="flex items-start gap-2 rounded-lg border p-2">
              <input
                type="checkbox"
                className="mt-px"
                checked={draft.sideEffecting}
                onChange={(e) => setDraft((d) => ({ ...d, sideEffecting: e.target.checked }))}
              />
              <span className="text-caption">
                <strong>This changes data on the far end.</strong>
                <span className="block text-muted-foreground">
                  A workflow using it must ask the customer to confirm before it can be published.
                </span>
              </span>
            </label>
            <p className="text-caption text-muted-foreground">
              This creates the operation. Declare its inputs and point at the records in its response
              with <strong>Edit</strong> on the row — that is also where you can call it once and
              record the reply.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              disabled={!draft.key || !draft.name || addOperation.isPending}
              onClick={() => addOperation.mutate()}
            >
              Add operation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function Connectors() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [typeId, setTypeId] = useState('');
  const [draft, setDraft] = useState({
    key: '', name: '', description: '', kind: 'HTTP', baseUrl: '',
    authType: 'NONE', header: '', username: '', secret: '',
  });
  /**
   * An optional first operation, so a custom HTTP connector arrives with something callable
   * instead of an empty card and a second trip to the operation editor.
   *
   * The method lives on the operation, not the connector — one connector has many operations
   * with different methods, which is why this is a nested thing rather than a field beside
   * the base URL.
   */
  const [op, setOp] = useState({ key: '', name: '', method: 'GET', path: '/', payload: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['engine', 'connectors'],
    queryFn: () => engine.connectors.list(),
  });

  /**
   * The operator's catalog. This is what turned "invent a kind" into "pick a system": the
   * list used to be two options hardcoded in this file, so supporting a new one meant a
   * deploy.
   */
  const types = useQuery({
    queryKey: ['engine', 'connector-types'],
    queryFn: () => engine.connectors.types(),
  });

  const chosen = types.data?.find((t) => t.id === typeId) ?? null;

  /**
   * What the chosen type accepts. Empty means it has no opinion — a custom HTTP API
   * authenticates however its owner decided, so all four stay on offer.
   */
  const authOptions = chosen && chosen.allowedAuthTypes.length > 0
    ? chosen.allowedAuthTypes
    : (Object.keys(AUTH_LABELS) as Array<keyof typeof AUTH_LABELS>);

  /** Adopt the type's defaults. The base URL and credential stay the tenant's to change. */
  const pickType = (id: string) => {
    const type = types.data?.find((t) => t.id === id);
    setTypeId(id);
    if (!type) return;
    const allowed = type.allowedAuthTypes;
    setDraft((d) => ({
      ...d,
      kind: type.kind,
      baseUrl: type.defaultBaseUrl ?? '',
      header: type.defaultHeader ?? d.header,
      // Keep the current choice when the type still permits it, so re-picking a type does
      // not silently discard a credential the person has already typed.
      authType: allowed.length === 0 || allowed.includes(d.authType as never)
        ? d.authType
        : allowed[0],
    }));
  };

  const closeDialog = () => {
    setCreating(false);
    setTypeId('');
    setDraft({
      key: '', name: '', description: '', kind: 'HTTP', baseUrl: '',
      authType: 'NONE', header: '', username: '', secret: '',
    });
    setOp({ key: '', name: '', method: 'GET', path: '/', payload: '' });
  };

  /** Parsed so a malformed payload is caught here rather than by the API. */
  const opPayload = (() => {
    if (!op.payload.trim()) return { ok: true as const, value: undefined };
    try {
      return { ok: true as const, value: JSON.parse(op.payload) as unknown };
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : 'Invalid JSON' };
    }
  })();

  const opDerived = pathInputsFor(op.path);
  /**
   * A path segment that is a bare run of digits — a phone number, an id — pasted straight from
   * a working request. It saves cleanly and then only ever fetches that one record, which is
   * the kind of mistake that is obvious in hindsight and invisible at the time.
   */
  const opLooksHardcoded = /\/\d{4,}(\/|$)/.test(op.path);

  const opStarted = !!(op.key.trim() || op.name.trim() || op.payload.trim() || op.path !== '/');
  const opReady = !!(op.key.trim() && op.name.trim());
  /** A half-filled first operation blocks the save; an untouched one does not. */
  const opBlocking = opStarted && (!opReady || !opPayload.ok);

  const create = useMutation({
    mutationFn: async () => {
      const connector = await engine.connectors.create({
        key: draft.key,
        name: draft.name,
        description: draft.description || null,
        ...(typeId ? { connectorTypeId: typeId } : {}),
        kind: draft.kind,
        baseUrl: draft.kind === 'HTTP' ? draft.baseUrl : null,
        authType: draft.authType,
        authConfig: { ...(draft.header ? { header: draft.header } : {}), ...(draft.username ? { username: draft.username } : {}) },
        ...(draft.secret ? { secret: draft.secret } : {}),
      });

      // A second call rather than a nested create, because the operation endpoint is where
      // the payload cross-check lives — a placeholder naming an undeclared input is refused
      // there, and duplicating that rule here would be a second thing to keep correct.
      if (opReady) {
        await engine.connectors.createOperation(connector.id, {
          key: op.key.trim(),
          name: op.name.trim(),
          method: op.method,
          path: op.path || '/',
          inputs: pathInputsFor(op.path),
          ...(opPayload.value !== undefined ? { bodyTemplate: opPayload.value } : {}),
        });
        return engine.connectors.get(connector.id);
      }
      return connector;
    },
    onSuccess: (connector) => {
      // Says how many operations arrived with it. The clone is the payoff of picking a
      // type, and silently landing four operations would leave someone wondering.
      const cloned = connector.operations?.length ?? 0;
      toast.success(cloned > 0
        ? `Connector created with ${cloned} operation${cloned === 1 ? '' : 's'}`
        : 'Connector created');
      closeDialog();
      qc.invalidateQueries({ queryKey: ['engine', 'connectors'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const connectors = data?.connectors ?? [];
  const needsKey = draft.authType !== 'NONE';

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h2 font-semibold">Connectors</h1>
          <p className="text-sm text-muted-foreground">
            Registered ways to reach an outside system. A workflow node names a connector and an
            operation — it never holds a URL or a credential.
          </p>
        </div>
        <Button className="gap-1" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New connector
        </Button>
      </div>

      {data && !data.meta.encryptionConfigured && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/15 p-3">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-ink-900" />
          <div className="text-caption text-ink-900">
            <p className="font-medium">Credentials cannot be stored yet</p>
            <p className="mt-px text-ink-900">
              The server has no <code>ENCRYPTION_KEY</code>, so an authenticated connector cannot be
              saved. Generate one with <code>openssl rand -base64 32</code> and restart the API.
              Connectors that need no authentication still work.
            </p>
          </div>
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && connectors.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <PlugZap className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">No connectors yet</p>
            <p className="mx-auto mt-1 max-w-md text-caption text-muted-foreground">
              Register the system you want your workflows to talk to, then declare the operations
              they may call. Everything else — the SSRF check, the credential, the audit trail — is
              handled once here rather than on every node.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {connectors.map((connector) => (
          <ConnectorCard key={connector.id} connector={connector} />
        ))}
      </div>

      <Dialog open={creating} onOpenChange={(open) => (open ? setCreating(true) : closeDialog())}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New connector</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Key</Label>
                <Input
                  className="font-mono text-caption"
                  placeholder="acme_lms"
                  value={draft.key}
                  onChange={(e) => setDraft((d) => ({ ...d, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                />
                <p className="text-caption text-muted-foreground">What nodes reference. Hard to change later.</p>
              </div>
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  placeholder="Acme LMS"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </div>

            <div className="space-y-1">
              <Label>System</Label>
              <Select value={typeId} onValueChange={pickType}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose what you are connecting to…" />
                </SelectTrigger>
                <SelectContent>
                  {(types.data ?? []).map((type) => (
                    <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {chosen?.description && (
                <p className="text-caption text-muted-foreground">{chosen.description}</p>
              )}
              {chosen && chosen.operationTemplates.length > 0 && (
                <p className="text-caption text-muted-foreground">
                  Comes with {chosen.operationTemplates.length} ready operation
                  {chosen.operationTemplates.length === 1 ? '' : 's'}:{' '}
                  {chosen.operationTemplates.map((o) => o.key).join(', ')}. They become yours to
                  edit once created.
                </p>
              )}
              {chosen?.docsUrl && (
                <a
                  className="inline-flex items-center gap-1 text-caption text-accent-600 underline"
                  href={chosen.docsUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Where to find your credential
                </a>
              )}
              {types.data?.length === 0 && (
                <p className="text-caption text-muted-foreground">
                  No connector types are available yet. An administrator adds them.
                </p>
              )}
            </div>

            {draft.kind === 'HTTP' && (
              <div className="space-y-1">
                <Label>Base URL</Label>
                <Input
                  className="font-mono text-caption"
                  placeholder="https://api.acme-lms.com/v1"
                  value={draft.baseUrl}
                  onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
                />
                <p className="text-caption text-muted-foreground">
                  Checked on save: https only in practice, and never a private or loopback address.
                </p>
              </div>
            )}

            <div className="space-y-1">
              <Label>Authentication</Label>
              <Select value={draft.authType} onValueChange={(v) => setDraft((d) => ({ ...d, authType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {authOptions.map((value) => (
                    <SelectItem key={value} value={value}>{AUTH_LABELS[value]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {chosen && chosen.allowedAuthTypes.length === 1 && (
                <p className="text-caption text-muted-foreground">
                  {chosen.label} only authenticates this way.
                </p>
              )}
            </div>

            {draft.authType === 'API_KEY_HEADER' && (
              <div className="space-y-1">
                <Label>Header name</Label>
                <Input
                  className="font-mono text-caption"
                  placeholder="X-API-Key"
                  value={draft.header}
                  onChange={(e) => setDraft((d) => ({ ...d, header: e.target.value }))}
                />
              </div>
            )}

            {draft.authType === 'BASIC' && (
              <div className="space-y-1">
                {/* The type's own words where it has them. Razorpay's basic auth is a
                    "Key ID" and a "Key Secret" — the same mechanism, named the way the
                    customer's own dashboard names it. */}
                <Label>{chosen?.usernameLabel || 'Username'}</Label>
                <Input value={draft.username} onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))} />
              </div>
            )}

            {needsKey && (
              <div className="space-y-1">
                <Label>{chosen?.secretLabel || 'Credential'}</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  value={draft.secret}
                  onChange={(e) => setDraft((d) => ({ ...d, secret: e.target.value }))}
                />
                <p className="text-caption text-muted-foreground">
                  Encrypted before it is stored, and never returned by the API — only the last four
                  characters are ever shown.
                </p>
              </div>
            )}

            {/* An optional first operation.
                Hidden when the chosen type already brings its own, since those are cloned and
                this would just be a second, competing way to end up with one. */}
            {typeId && chosen?.operationTemplates.length === 0 && (
              <div className="space-y-3 rounded-md border border-ink-300 bg-surface-0 p-3">
                <div>
                  <p className="text-sm font-medium text-ink-900">First operation (optional)</p>
                  <p className="text-caption text-muted-foreground">
                    One thing this connector can do. A workflow node names the connector and the
                    operation — never a URL. You can add more, and refine this one, afterwards.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Operation key</Label>
                    <Input
                      className="font-mono text-caption"
                      placeholder="fetch_payment"
                      value={op.key}
                      onChange={(e) => setOp((o) => ({
                        ...o, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                      }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Operation name</Label>
                    <Input
                      placeholder="Fetch a payment"
                      value={op.name}
                      onChange={(e) => setOp((o) => ({ ...o, name: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-[110px_1fr] gap-3">
                  <div className="space-y-1">
                    <Label>Type</Label>
                    <Select value={op.method} onValueChange={(v) => setOp((o) => ({ ...o, method: v }))}>
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
                      placeholder="/payments/{payment_id}"
                      value={op.path}
                      onChange={(e) => setOp((o) => ({ ...o, path: e.target.value }))}
                    />
                    {opDerived.length > 0 ? (
                      <p className="text-caption text-muted-foreground">
                        Appended to the base URL. Declares {opDerived.length === 1 ? 'an input' : 'inputs'}
                        {' '}for {opDerived.map((i) => i.key).join(', ')}, filled per call.
                      </p>
                    ) : (
                      <p className="text-caption text-muted-foreground">
                        Appended to the base URL. Put a value in{' '}
                        <code>{'{braces}'}</code> to have it supplied per call —{' '}
                        <code>/parents/mobile/{'{mobile_number}'}</code>.
                      </p>
                    )}
                    {opLooksHardcoded && (
                      <p className="text-caption text-ink-900">
                        This path ends in a literal value, so the operation would only ever
                        fetch that one record. Replace it with{' '}
                        <code>{'{mobile_number}'}</code> to pass it in per call.
                      </p>
                    )}
                  </div>
                </div>

                {/* Only for methods whose body is actually sent. On a GET a payload would be
                    dropped, so offering the box would invite writing one that does nothing. */}
                {SENDS_BODY.includes(op.method) && (
                  <div className="space-y-1">
                    <Label>Sample payload</Label>
                    <Textarea
                      rows={6}
                      className="font-mono text-caption"
                      placeholder={'{\n  "amount": 500,\n  "currency": "INR"\n}'}
                      value={op.payload}
                      onChange={(e) => setOp((o) => ({ ...o, payload: e.target.value }))}
                    />
                    {!opPayload.ok ? (
                      <p className="text-caption text-destructive">
                        Not valid JSON: {opPayload.message}
                      </p>
                    ) : (
                      <p className="text-caption text-muted-foreground">
                        The body this {op.method} sends. Add <code>{'{braces}'}</code> later in the
                        operation editor to fill fields from a workflow&apos;s values — a constant
                        payload like this one is sent exactly as written.
                      </p>
                    )}
                  </div>
                )}

                {opStarted && !opReady && (
                  <p className="text-caption text-muted-foreground">
                    An operation needs both a key and a name. Clear them both to skip this step.
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button
              className={cn(create.isPending && 'opacity-70')}
              disabled={!typeId || !draft.key || !draft.name || (needsKey && !draft.secret)
                || opBlocking || create.isPending}
              onClick={() => create.mutate()}
            >
              Create connector
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
