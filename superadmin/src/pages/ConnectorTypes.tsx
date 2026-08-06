import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Info, Plus, Trash2 } from 'lucide-react';
import { sa, type ConnectorTypeRow } from '../lib/api';
import { Badge, Button, Card, CardHeader, Empty, Input, Td, Th } from '../components/ui';

// Connector types — the catalog of outside systems a workspace can connect to.
//
// These used to be a `z.enum` in the backend and two hardcoded options in the tenant's
// picker, so supporting Razorpay meant a deploy. Now they are rows, and this is where
// they are managed.
//
// Two rules worth knowing, both mirroring business categories:
//
//   • **The key is immutable after creation.** A workspace's connector records which
//     type it came from, so renaming one orphans that link with no error anywhere.
//   • **A type in use is hidden, not deleted.** Delete is refused while any connector
//     references it — the foreign key is SET NULL, so a forced delete would not break
//     those connectors but would erase where they came from and make this list lie.
//
// And one thing this page cannot do: hand a workspace a credential. A type says *how* to
// authenticate, never with what. The workspace supplies its own secret when it creates
// the connector, which is why nothing here is sensitive.

const KINDS = ['HTTP', 'MOCK', 'GOOGLE_SHEETS', 'EMAIL'] as const;
const AUTH_TYPES = ['NONE', 'API_KEY_HEADER', 'BEARER', 'BASIC'] as const;

const AUTH_LABELS: Record<string, string> = {
  NONE: 'No authentication',
  API_KEY_HEADER: 'API key in a header',
  BEARER: 'Bearer token',
  BASIC: 'Basic auth',
};

const emptyDraft = {
  key: '',
  label: '',
  description: '',
  kind: 'HTTP' as (typeof KINDS)[number],
  allowedAuthTypes: [] as string[],
  defaultBaseUrl: '',
  secretLabel: '',
  usernameLabel: '',
  defaultHeader: '',
  docsUrl: '',
  sortOrder: '100',
};

const emptyOperation = {
  key: '',
  name: '',
  method: 'GET',
  path: '/',
  sideEffecting: false,
};

/** The operation templates on one type, and the form to add another. */
function Templates({ type }: { type: ConnectorTypeRow }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(emptyOperation);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['connector-types'] });

  const add = useMutation({
    mutationFn: () => sa.connectorTypes.addOperation(type.id, {
      key: draft.key,
      name: draft.name.trim(),
      method: draft.method,
      path: draft.path,
      sideEffecting: draft.sideEffecting,
    }),
    onSuccess: () => {
      toast.success('Operation added');
      setDraft(emptyOperation);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (operationId: string) => sa.connectorTypes.removeOperation(type.id, operationId),
    onSuccess: () => { toast.success('Operation removed'); invalidate(); },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-2 border-t border-slate-100 bg-slate-50/50 p-4">
      <p className="text-xs text-slate-600">
        Copied into a workspace&apos;s connector when they connect. It is a{' '}
        <strong>one-time snapshot</strong> — editing these changes what future connections
        receive, and never rewrites an operation a workspace already owns and may have edited.
      </p>

      {type.operationTemplates.length === 0 ? (
        <p className="text-xs text-slate-500">
          None yet. A type with no operations gives a workspace a credential and nothing to call.
        </p>
      ) : (
        <table className="w-full">
          <tbody>
            {type.operationTemplates.map((op) => (
              <tr key={op.id} className="border-b border-slate-100 last:border-0">
                <Td>
                  <code className="rounded bg-white px-1.5 py-0.5 text-[11px]">{op.key}</code>
                  {op.sideEffecting && (
                    <span className="ml-1.5"><Badge tone="amber">changes data</Badge></span>
                  )}
                </Td>
                <Td className="text-xs">{op.name}</Td>
                <Td className="text-xs text-slate-500">
                  <code>{op.method} {op.path}</code>
                </Td>
                <Td>
                  <div className="flex justify-end">
                    <Button
                      variant="danger"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`Remove "${op.key}"? Workspaces already connected keep their copy.`)) {
                          remove.mutate(op.id);
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="grid gap-2 sm:grid-cols-5">
        <Input
          value={draft.key}
          onChange={(v) => setDraft((d) => ({ ...d, key: v.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
          placeholder="fetch_payment"
          className="font-mono text-xs"
        />
        <Input
          value={draft.name}
          onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
          placeholder="Fetch a payment"
        />
        <select
          value={draft.method}
          onChange={(e) => setDraft((d) => ({ ...d, method: e.target.value }))}
          className="rounded-md border border-slate-300 px-2 text-sm"
        >
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <Input
          value={draft.path}
          onChange={(v) => setDraft((d) => ({ ...d, path: v }))}
          placeholder="/payments/{id}"
          className="font-mono text-xs"
        />
        <Button
          disabled={!draft.key || draft.name.trim().length < 1 || add.isPending}
          onClick={() => add.mutate()}
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={draft.sideEffecting}
          onChange={(e) => setDraft((d) => ({ ...d, sideEffecting: e.target.checked }))}
        />
        {/* Drives the publish rule that a side-effecting workflow must confirm first, and
            stops "Test" on a refund actually issuing one. */}
        Changes something the customer cannot undo
      </label>
    </div>
  );
}

export default function ConnectorTypes() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['connector-types'],
    queryFn: () => sa.connectorTypes.list(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['connector-types'] });

  const create = useMutation({
    mutationFn: () => sa.connectorTypes.create({
      key: draft.key,
      label: draft.label.trim(),
      description: draft.description.trim() || undefined,
      kind: draft.kind,
      allowedAuthTypes: draft.allowedAuthTypes,
      defaultBaseUrl: draft.defaultBaseUrl.trim() || undefined,
      secretLabel: draft.secretLabel.trim() || undefined,
      usernameLabel: draft.usernameLabel.trim() || undefined,
      defaultHeader: draft.defaultHeader.trim() || undefined,
      docsUrl: draft.docsUrl.trim() || undefined,
      sortOrder: Number(draft.sortOrder) || 100,
    }),
    onSuccess: () => {
      toast.success('Connector type added');
      setAdding(false);
      setDraft(emptyDraft);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      sa.connectorTypes.update(id, body),
    onSuccess: () => { toast.success('Connector type updated'); invalidate(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => sa.connectorTypes.remove(id),
    onSuccess: () => { toast.success('Connector type deleted'); invalidate(); },
    onError: (err: Error) => toast.error(err.message),
  });

  const rows = data ?? [];
  const toggleAuth = (value: string) => setDraft((d) => ({
    ...d,
    allowedAuthTypes: d.allowedAuthTypes.includes(value)
      ? d.allowedAuthTypes.filter((a) => a !== value)
      : [...d.allowedAuthTypes, value],
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Connector types</h1>
          <p className="text-sm text-slate-500">
            What a workspace can connect to. {rows.filter((r) => r.isActive).length} offered.
          </p>
        </div>
        <Button onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add type</Button>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p className="text-xs leading-snug text-slate-600">
          A type says <strong>how</strong> to authenticate, never with what — the workspace
          supplies its own credential and base URL when it creates the connector. The{' '}
          <strong>key</strong> cannot be changed afterwards, because a workspace&apos;s connector
          records which type it came from. A type in use is hidden rather than deleted.
        </p>
      </div>

      {adding && (
        <Card>
          <CardHeader title="New connector type" />
          <div className="space-y-2 p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Input
                  value={draft.key}
                  onChange={(v) => setDraft((d) => ({
                    ...d,
                    key: v.toLowerCase().replace(/[^a-z0-9_]/g, ''),
                  }))}
                  placeholder="razorpay"
                  className="font-mono text-xs"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Lowercase, digits and underscores. Permanent — choose carefully.
                </p>
              </div>
              <Input
                value={draft.label}
                onChange={(v) => setDraft((d) => ({ ...d, label: v }))}
                placeholder="Razorpay"
              />
            </div>

            <Input
              value={draft.description}
              onChange={(v) => setDraft((d) => ({ ...d, description: v }))}
              placeholder="One line shown under the picker in the workspace"
            />

            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <select
                  value={draft.kind}
                  onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value as typeof d.kind }))}
                  className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                >
                  {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  How the call is made. GOOGLE_SHEETS and EMAIL are not implemented yet.
                </p>
              </div>
              <div>
                <Input
                  value={draft.defaultBaseUrl}
                  onChange={(v) => setDraft((d) => ({ ...d, defaultBaseUrl: v }))}
                  placeholder="https://api.razorpay.com/v1"
                  className="font-mono text-xs"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Prefilled for the workspace, and editable by them. Checked on save.
                </p>
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium text-slate-700">Authentication offered</p>
              <div className="flex flex-wrap gap-3">
                {AUTH_TYPES.map((value) => (
                  <label key={value} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={draft.allowedAuthTypes.includes(value)}
                      onChange={() => toggleAuth(value)}
                    />
                    {AUTH_LABELS[value]}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                Tick none to offer all four — which is what a generic HTTP type wants, since
                someone else&apos;s API authenticates however its owner decided.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <Input
                  value={draft.usernameLabel}
                  onChange={(v) => setDraft((d) => ({ ...d, usernameLabel: v }))}
                  placeholder="Key ID"
                />
                <p className="mt-1 text-[11px] text-slate-500">Label for the basic-auth username.</p>
              </div>
              <div>
                <Input
                  value={draft.secretLabel}
                  onChange={(v) => setDraft((d) => ({ ...d, secretLabel: v }))}
                  placeholder="Key Secret"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Label for the credential field. Use the words their own dashboard uses.
                </p>
              </div>
              <div>
                <Input
                  value={draft.defaultHeader}
                  onChange={(v) => setDraft((d) => ({ ...d, defaultHeader: v }))}
                  placeholder="X-Api-Key"
                  className="font-mono text-xs"
                />
                <p className="mt-1 text-[11px] text-slate-500">Prefilled header name.</p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={draft.docsUrl}
                onChange={(v) => setDraft((d) => ({ ...d, docsUrl: v }))}
                placeholder="https://dashboard.razorpay.com/app/keys"
                className="font-mono text-xs"
              />
              <Input
                value={draft.sortOrder}
                onChange={(v) => setDraft((d) => ({ ...d, sortOrder: v.replace(/[^0-9]/g, '') }))}
                placeholder="Sort order (lower shows first)"
              />
            </div>

            <div className="flex gap-2">
              <Button
                disabled={!draft.key || draft.label.trim().length < 2 || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? 'Adding…' : 'Add'}
              </Button>
              <Button variant="ghost" onClick={() => { setAdding(false); setDraft(emptyDraft); }}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {isLoading ? <Empty>Loading…</Empty> : rows.length === 0 ? (
          <Empty>
            No connector types. Workspaces have nothing to pick, so no connector can be created.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem]">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <Th>Key</Th><Th>Label</Th><Th>Kind</Th><Th>Auth</Th>
                  <Th className="text-right">Ops</Th>
                  <Th className="text-right">Connectors</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="border-b border-slate-50 last:border-0">
                      <Td>
                        <button
                          className="inline-flex items-center gap-1"
                          onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                        >
                          {expanded === row.id
                            ? <ChevronDown className="h-3 w-3 text-slate-400" />
                            : <ChevronRight className="h-3 w-3 text-slate-400" />}
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{row.key}</code>
                        </button>
                        {!row.isActive && <span className="ml-1.5"><Badge tone="slate">hidden</Badge></span>}
                      </Td>
                      <Td className="font-medium">{row.label}</Td>
                      <Td className="text-xs text-slate-500">{row.kind}</Td>
                      <Td className="text-xs text-slate-500">
                        {row.allowedAuthTypes.length === 0
                          ? 'any'
                          : row.allowedAuthTypes.map((a) => AUTH_LABELS[a] ?? a).join(', ')}
                      </Td>
                      <Td className="text-right tabular-nums">{row.operationTemplates.length}</Td>
                      <Td className="text-right tabular-nums">{row.connectors}</Td>
                      <Td>
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="outline"
                            disabled={update.isPending}
                            onClick={() => update.mutate({ id: row.id, body: { isActive: !row.isActive } })}
                          >
                            {row.isActive ? 'Hide from new' : 'Offer again'}
                          </Button>
                          <Button
                            variant="danger"
                            disabled={row.connectors > 0 || remove.isPending}
                            onClick={() => {
                              if (window.confirm(`Delete "${row.label}"? Nothing is using it.`)) {
                                remove.mutate(row.id);
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        {row.connectors > 0 && (
                          <p className="mt-1 text-right text-[10px] text-slate-400">
                            In use — hide it instead
                          </p>
                        )}
                      </Td>
                    </tr>
                    {expanded === row.id && (
                      <tr>
                        <td colSpan={7} className="p-0"><Templates type={row} /></td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
