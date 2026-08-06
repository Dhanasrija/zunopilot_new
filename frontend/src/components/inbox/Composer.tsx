import { SendHorizonal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// The reply box.
//
// **No emoji picker and no attachment button**, though the reference shows both. Sending
// media means an upload, a Meta media id and a `type` this thread cannot render — that is a
// feature, not a style. A control that does nothing is worse than an absent one, which is the
// same call made on the Customers page.

export function Composer({ value, onChange, onSend, sending }: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
}) {
  const canSend = !!value.trim() && !sending;

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-ink-300 bg-surface-1 p-3">
      <Input
        aria-label="Reply"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type a reply…"
        onKeyDown={(e) => { if (e.key === 'Enter' && canSend) onSend(); }}
      />
      {/* Icon plus word: the icon alone reads as "send" to anyone who has used a chat app,
          but the label is what makes it unambiguous the first time and readable to a screen
          reader without an `aria-label` that could drift from what is drawn. */}
      <Button className="shrink-0 gap-2" disabled={!canSend} onClick={onSend}>
        <SendHorizonal aria-hidden className="h-4 w-4" />
        {sending ? 'Sending…' : 'Send'}
      </Button>
    </div>
  );
}
