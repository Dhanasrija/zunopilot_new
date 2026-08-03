import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail, Phone, Info } from 'lucide-react';
import { sa, when, type Enquiry, type EnquiryStatus } from '../lib/api';
import { Badge, Button, Card, CardHeader, Empty, Input, cn } from '../components/ui';

// Contact enquiries from the marketing site.
//
// **These are platform-level, not tenant-level.** Somebody filling in the form on
// zunopilot.com wants to buy ZunoPilot — they have no workspace, so there is no
// tenant to attribute them to and they are deliberately not tenant `Lead`s. This
// console is the only place they are read.
//
// Worth knowing why this screen exists at all: until it did, the contact form ran a
// one-second `setTimeout`, told the visitor "we will be in touch shortly", and threw
// the submission away. Every enquiry ever made was lost.

const STATUSES: EnquiryStatus[] = ['NEW', 'CONTACTED', 'CLOSED', 'SPAM'];

const LABEL: Record<EnquiryStatus, string> = {
  NEW: 'New', CONTACTED: 'Contacted', CLOSED: 'Closed', SPAM: 'Spam',
};

const TONE: Record<EnquiryStatus, 'slate' | 'green' | 'amber' | 'red' | 'violet' | 'blue'> = {
  NEW: 'violet', CONTACTED: 'blue', CLOSED: 'green', SPAM: 'slate',
};

function EnquiryCard({ enquiry, onChanged }: { enquiry: Enquiry; onChanged: () => void }) {
  const [note, setNote] = useState(enquiry.internalNote ?? '');

  const update = useMutation({
    mutationFn: (body: { status?: EnquiryStatus; internalNote?: string | null }) =>
      sa.updateEnquiry(enquiry.id, body),
    onSuccess: () => { toast.success('Enquiry updated'); onChanged(); },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{enquiry.fullName}</span>
            <Badge tone={TONE[enquiry.status]}>{LABEL[enquiry.status]}</Badge>
            <span className="text-[11px] text-slate-400">{when(enquiry.createdAt)}</span>
          </div>
          {/* Both contact routes as real links: the whole job of this screen is to
              get someone to reply, so replying should be one click. */}
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <a href={`mailto:${enquiry.email}`} className="inline-flex items-center gap-1 hover:text-slate-800">
              <Mail className="h-3 w-3" /> {enquiry.email}
            </a>
            <a href={`tel:+${enquiry.phone}`} className="inline-flex items-center gap-1 hover:text-slate-800">
              <Phone className="h-3 w-3" /> +{enquiry.phone}
            </a>
            <span className="rounded-full bg-slate-100 px-2 py-0.5">{enquiry.interest}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {STATUSES.filter((s) => s !== enquiry.status).map((status) => (
            <Button
              key={status}
              variant="outline"
              disabled={update.isPending}
              onClick={() => update.mutate({ status })}
            >
              {LABEL[status]}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        {/* The message itself. Deliberately shown in full — see the note on the
            handler in super-admin.controller.ts about why this is not a breach of
            the "no message bodies" rule. */}
        <p className="whitespace-pre-wrap text-sm text-slate-700">{enquiry.message}</p>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label className="text-[11px] font-medium text-slate-500" htmlFor={`note-${enquiry.id}`}>
              Internal note
            </label>
            <Input
              value={note}
              onChange={setNote}
              placeholder="What happened when you followed up"
            />
          </div>
          <Button
            variant="outline"
            disabled={update.isPending || note === (enquiry.internalNote ?? '')}
            onClick={() => update.mutate({ internalNote: note.trim() || null })}
          >
            Save note
          </Button>
        </div>

        {(enquiry.handledAt || enquiry.ip) && (
          <p className="text-[11px] text-slate-400">
            {enquiry.handledAt ? `First picked up ${when(enquiry.handledAt)}. ` : ''}
            {enquiry.ip ? `From ${enquiry.ip}.` : ''}
          </p>
        )}
      </div>
    </Card>
  );
}

export default function Enquiries() {
  const qc = useQueryClient();
  // Defaults to the unhandled queue, because that is the only view with anything
  // to do in it.
  const [status, setStatus] = useState<EnquiryStatus | ''>('NEW');

  const { data, isLoading } = useQuery({
    queryKey: ['enquiries', status],
    queryFn: () => sa.enquiries(status ? { status } : {}),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['enquiries'] });
    // Refreshes the nav badge, which reads the same overview query.
    qc.invalidateQueries({ queryKey: ['overview'] });
  };

  const counts = data?.counts ?? {};

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Enquiries</h1>
        <p className="text-sm text-slate-500">
          From the contact form on the marketing site. These are people who want to
          buy ZunoPilot — not any workspace's customers.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant={status === '' ? 'default' : 'outline'} onClick={() => setStatus('')}>
          Everything
        </Button>
        {STATUSES.map((value) => (
          <Button
            key={value}
            variant={status === value ? 'default' : 'outline'}
            onClick={() => setStatus(value)}
          >
            {LABEL[value]}
            <span className={cn('ml-1.5 text-[11px]', status === value ? 'text-white/80' : 'text-slate-400')}>
              {counts[value] ?? 0}
            </span>
          </Button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (data?.enquiries ?? []).length === 0 ? (
        <Card>
          <CardHeader title="Nothing here" />
          <Empty>
            {status === 'NEW'
              ? 'No unhandled enquiries. Anything new from the contact form lands here.'
              : 'No enquiries with this status.'}
          </Empty>
        </Card>
      ) : (
        <div className="space-y-3">
          {(data?.enquiries ?? []).map((enquiry) => (
            <EnquiryCard key={enquiry.id} enquiry={enquiry} onChanged={invalidate} />
          ))}
        </div>
      )}

      <p className="flex items-start gap-1.5 text-[11px] text-slate-400">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        There is no email or WhatsApp alert yet — this screen and the sidebar badge
        are how you find out. The count refreshes every minute.
      </p>
    </div>
  );
}
