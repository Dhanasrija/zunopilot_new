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
  const [draft, setDraft] = useState({
    key: '', name: '', description: '', kind: 'HTTP', baseUrl: '',
    authType: 'NONE', header: '', username: '', secret: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['engine', 'connectors'],
    queryFn: () => engine.connectors.list(),
  });

  const create = useMutation({
    mutationFn: () => engine.connectors.create({
      key: draft.key,
      name: draft.name,
      description: draft.description || null,
      kind: draft.kind,
      baseUrl: draft.kind === 'HTTP' ? draft.baseUrl : null,
      authType: draft.authType,
      authConfig: { ...(draft.header ? { header: draft.header } : {}), ...(draft.username ? { username: draft.username } : {}) },
      ...(draft.secret ? { secret: draft.secret } : {}),
    }),
    onSuccess: () => {
      toast.success('Connector created');
      setCreating(false);
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

      <Dialog open={creating} onOpenChange={setCreating}>
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
              <Label>Kind</Label>
              <Select value={draft.kind} onValueChange={(v) => setDraft((d) => ({ ...d, kind: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="HTTP">HTTP API</SelectItem>
                  <SelectItem value="MOCK">Mock (fixtures, no network)</SelectItem>
                </SelectContent>
              </Select>
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
                  {Object.entries(AUTH_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                <Label>Username</Label>
                <Input value={draft.username} onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))} />
              </div>
            )}

            {needsKey && (
              <div className="space-y-1">
                <Label>Credential</Label>
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              className={cn(create.isPending && 'opacity-70')}
              disabled={!draft.key || !draft.name || (needsKey && !draft.secret) || create.isPending}
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
