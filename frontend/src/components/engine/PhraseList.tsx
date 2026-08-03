import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, X } from 'lucide-react';

// Repeatable text input, used everywhere the capability contract needs a list:
// use-when, do-not-use-when, positive and negative examples, preconditions,
// side effects.
//
// `minimum` drives an inline counter rather than an error on submit — the point
// of the minimum is that a contract with two positive examples routes badly, so
// the author should see the shortfall while they are writing, not after.

export default function PhraseList({
  label, hint, value, onChange, placeholder, minimum,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  minimum?: number;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const text = draft.trim();
    if (!text || value.includes(text)) { setDraft(''); return; }
    onChange([...value, text]);
    setDraft('');
  };

  const short = minimum !== undefined && value.length < minimum;

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <Label>{label}</Label>
        {minimum !== undefined && (
          <span className={cn('text-caption', short ? 'font-medium text-ink-900' : 'text-ink-500')}>
            {value.length} / {minimum} minimum
          </span>
        )}
      </div>

      {hint && <p className="text-caption leading-snug text-ink-500">{hint}</p>}

      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((phrase, i) => (
            <li
              key={phrase}
              className="group flex items-start gap-2 rounded-md border border-ink-300 bg-surface-0 px-2 py-1"
            >
              <span className="mt-px text-caption font-semibold text-ink-300">{i + 1}</span>
              <span className="min-w-0 flex-1 break-words text-caption text-ink-700">{phrase}</span>
              <button
                type="button"
                aria-label={`Remove "${phrase}"`}
                className="shrink-0 text-ink-300 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                onClick={() => onChange(value.filter((p) => p !== phrase))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-1">
        <Input
          value={draft}
          placeholder={placeholder}
          autoComplete="off"
          className="text-caption"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add(); }
          }}
        />
        <Button
          type="button" variant="outline" size="icon"
          className="h-9 w-9 shrink-0"
          disabled={!draft.trim()}
          onClick={add}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
