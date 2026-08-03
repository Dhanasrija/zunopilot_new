import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore, type AuthTenant, type AuthUser } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneField } from '@/components/ui/phone-field';
import { detectCountry, fullNumber, splitNumber, type Country } from '@/lib/countries';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';

// The profile form, shown once after the first sign-in.
//
// Two things it deliberately does **not** ask for:
//
//   • **A password.** The phone number is the identifier and a code is the
//     credential.
//   • **An address.** Nobody signing up knows or cares yet; it is needed at the
//     moment they pay, so it is collected on the billing page instead. Four fields
//     between a person and the product is four reasons to close the tab.
//
// Email is optional and stays optional. Nothing signs in with it, so requiring it
// would be asking for a detail purely to have it.
//
// Categories come from the API, not a hardcoded list — an operator manages them in
// the console, so adding "Pharmacy" must not need a frontend deploy.

interface Category {
  id: string;
  key: string;
  label: string;
  description: string | null;
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, tenant, profileComplete, setSession, token } = useAuthStore();

  const [businessName, setBusinessName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [fullName, setFullName] = useState('');
  // Display-only — this is what customers see, not an identity. It still uses the
  // picker because it defaults from the login number, and a free-text field here
  // would reintroduce the missing-country-code mismatch one screen later.
  const [contactCountry, setContactCountry] = useState<Country>(detectCountry);
  const [contactNumber, setContactNumber] = useState('');
  const [website, setWebsite] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: categories } = useQuery({
    queryKey: ['business-categories'],
    queryFn: () => api.get<{ data: Category[] }>('/auth/business-categories')
      .then((r) => r.data.data),
  });

  // Prefill from whatever is already known, so this doubles as an edit form rather
  // than making someone retype what they gave us at sign-in.
  useEffect(() => {
    if (tenant?.businessName) setBusinessName(tenant.businessName);
    if (tenant?.categoryId) setCategoryId(tenant.categoryId);
    if (user?.fullName) setFullName(user.fullName);
    if (user?.email) setEmail(user.email);
    // Their login number is almost always the business number too. It has to be
    // **split** before it goes in: the field holds the national part only now, so
    // dropping the whole stored `917702000351` into it would submit the dial code
    // twice as `+91 917702000351`.
    if (user?.phone) {
      const parts = splitNumber(user.phone);
      if (parts) {
        setContactCountry(parts.country);
        setContactNumber((current) => current || parts.national);
      }
    }
  }, [tenant, user]);

  useEffect(() => {
    if (!token) navigate('/login', { replace: true });
  }, [token, navigate]);

  const save = useMutation({
    mutationFn: () => api.put<{
      data: { user: AuthUser; tenant: AuthTenant; profileComplete: boolean };
    }>('/auth/profile', {
      businessName: businessName.trim(),
      businessCategoryId: categoryId,
      fullName: fullName.trim(),
      contactNumber: contactNumber.trim() ? fullNumber(contactCountry, contactNumber) : undefined,
      website: website.trim() || undefined,
      email: email.trim() || undefined,
    }).then((r) => r.data.data),
    onSuccess: (result) => {
      setSession({ token: token!, ...result });
      toast.success('You are all set.');
      navigate('/dashboard', { replace: true });
    },
    onError: (err: Error) => setError(err.message),
  });

  const ready = businessName.trim().length >= 2 && fullName.trim().length >= 2 && categoryId;

  return (
    <div className="min-h-screen bg-gradient-to-br from-accent-100 via-surface-1 to-surface-0 px-4 py-8">
      <div className="mx-auto w-full max-w-xl">
        <div className="text-center">
          <h1 className="text-h2 font-semibold tracking-tight">
            Get Started with <span className="text-accent-600">ZunoPilot</span>
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {profileComplete
              ? 'Update your business details.'
              : 'A few details and your workspace is ready. You can change all of this later.'}
          </p>
        </div>

        <form
          className="mt-6 space-y-4 rounded-lg border bg-surface-1 p-6 shadow-none"
          onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}
        >
          <div className="space-y-1">
            <Label htmlFor="business">Business name</Label>
            <Input
              id="business"
              autoFocus
              value={businessName}
              placeholder="Zuno Kitchen"
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder="Choose one" /></SelectTrigger>
                <SelectContent>
                  {(categories ?? []).map((category) => (
                    <SelectItem key={category.id} value={category.id}>{category.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {categoryId && (
                <p className="text-caption text-muted-foreground">
                  {categories?.find((c) => c.id === categoryId)?.description}
                </p>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="contact">Contact number</Label>
              <PhoneField
                id="contact"
                country={contactCountry}
                onCountryChange={setContactCountry}
                value={contactNumber}
                onChange={setContactNumber}
              />
              <p className="text-caption text-muted-foreground">
                What customers see. Defaults to your login number.
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              value={website}
              placeholder="https://example.com"
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="fullName">Your full name</Label>
              <Input
                id="fullName"
                value={fullName}
                placeholder="Ravi Kumar"
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="email">
                Email <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                placeholder="you@example.com"
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-caption text-muted-foreground">
                For invoices and receipts. You sign in with your number, so this is never needed to
                get in.
              </p>
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-caption text-danger">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={!ready || save.isPending}>
            {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {profileComplete ? 'Save changes' : 'Finish setup'}
          </Button>

          <p className="text-center text-caption text-muted-foreground">
            We ask for your billing address only when you pick a paid plan.
          </p>
        </form>
      </div>
    </div>
  );
}
