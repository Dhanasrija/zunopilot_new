import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PhoneField } from '@/components/ui/phone-field';
import {
  detectCountry, fullNumber, nationalNumberProblem, type Country,
} from '@/lib/countries';
import type { VariableValues } from './VariableFields';

// Send one message to yourself before sending it to everybody.
//
// **Everything about a broadcast is checkable on this screen except the thing that decides
// whether it works.** A placeholder count Meta disagrees with, an approved body that has
// drifted from our preview, a header needing media — none of it surfaces until the send, and
// by then it has already happened to the whole audience. That is not hypothetical: a campaign
// failed all of its recipients on a missing placeholder, and the first sign was a count on a
// screen nobody was watching.
//
// The rejection an operator would have seen here is the same one Meta returns per recipient.
// Reading it once, before committing, is the entire feature.

interface Props {
  templateId: string;
  variableValues: VariableValues;
  /** Filled in by the parent; the control refuses to send while anything is outstanding. */
  ready: boolean;
  headerMediaId?: string | null;
}

export function TestSend({ templateId, variableValues, ready, headerMediaId }: Props) {
  const [country, setCountry] = useState<Country>(detectCountry);
  const [national, setNational] = useState('');

  const problem = national ? nationalNumberProblem(national, country) : null;

  const send = useMutation({
    mutationFn: async () => (await api.post<{ data: { to: string; body: string } }>(
      '/campaigns/test',
      {
        templateId,
        to: fullNumber(country, national),
        variableValues,
        ...(headerMediaId ? { headerMediaId } : {}),
      },
    )).data.data,
    // A failure already reaches the operator: the API client toasts the server's message,
    // which now carries Meta's own words rather than "internal server error".
    onSuccess: (result) => toast.success(`Test sent to ${result.to}`),
  });

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div>
        <Label htmlFor="test-number">Send a test first</Label>
        <p className="text-caption text-muted-foreground">
          One message to a number of your own, so you see what WhatsApp does with it before
          the campaign goes out. It is not saved against a customer.
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-[15rem] flex-1">
          <PhoneField
            id="test-number"
            country={country}
            onCountryChange={setCountry}
            value={national}
            onChange={setNational}
            error={problem}
            placeholder="Your own number"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="gap-1"
          disabled={!templateId || !ready || !national || !!problem || send.isPending}
          onClick={() => send.mutate()}
        >
          <Send className="h-4 w-4" />
          {send.isPending ? 'Sending…' : 'Send a test'}
        </Button>
      </div>

      {!ready && templateId && (
        <p className="text-caption text-muted-foreground">
          Fill every placeholder above first — WhatsApp refuses a message with a blank in it,
          so there would be nothing to learn from the test.
        </p>
      )}

      {send.data && (
        <p className="text-caption text-muted-foreground">
          Sent: &ldquo;{send.data.body}&rdquo;
        </p>
      )}
    </div>
  );
}
