import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth.store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { User, Bell, CreditCard, CheckCircle2, ShieldCheck } from 'lucide-react';

const CATEGORIES = [
  { value: 'RESTAURANT', label: 'Restaurant' },
  { value: 'ECOMMERCE_GROCERY', label: 'E-commerce (Grocery)' },
  { value: 'SALON', label: 'Salon' },
  { value: 'RETAIL', label: 'Retail' },
  { value: 'CLINIC', label: 'Clinic' },
  { value: 'OTHER', label: 'Other' },
];

export default function Settings() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [searchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') ?? 'profile';

  const { data } = useQuery({
    queryKey: ['tenant.me'],
    queryFn: async () => (await api.get('/tenant/me')).data.data,
  });

  const [form, setForm] = useState<any>({});
  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = useMutation({
    mutationFn: async () => api.patch('/tenant/me', {
      businessName: form.businessName,
      category: form.category,
      contactNumber: form.contactNumber,
      address: form.address,
      website: form.website,
      logoUrl: form.logoUrl,
    }),
    onSuccess: () => { toast.success('Saved'); qc.invalidateQueries({ queryKey: ['tenant.me'] }); },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your business profile and preferences.</p>
      </div>

      <Tabs defaultValue={tabFromUrl}>
        <TabsList className="mb-6">
          <TabsTrigger value="profile" className="">
            <User className="h-4 w-4" />Profile
          </TabsTrigger>
          <TabsTrigger value="notifications" className="">
            <Bell className="h-4 w-4" />Notifications
          </TabsTrigger>
          <TabsTrigger value="billing" className="">
            <CreditCard className="h-4 w-4" />Billing
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-6">
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader className="flex flex-row items-center gap-3 pb-4">
                  <div className="h-10 w-10 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                    <ShieldCheck className="h-5 w-5 text-violet-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Business Profile</CardTitle>
                    <CardDescription>Update your business information. These details will be used across the platform.</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Business Name <span className="text-red-500">*</span></Label>
                    <Input value={form.businessName || ''} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="Your business name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Category <span className="text-red-500">*</span></Label>
                    <Select value={form.category || ''} onValueChange={(v) => setForm({ ...form, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contact Number <span className="text-red-500">*</span></Label>
                    <Input value={form.contactNumber || ''} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} placeholder="+91 9999999999" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Website</Label>
                    <Input value={form.website || ''} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://example.com" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Address <span className="text-red-500">*</span></Label>
                    <Input value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="123 Main Street, City, State" />
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Logo URL <span className="text-muted-foreground text-xs font-normal">(Optional)</span></Label>
                    <Input value={form.logoUrl || ''} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://example.com/logo.png" />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Account Details</CardTitle>
                  <CardDescription>Your personal account information.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Full Name</Label>
                    <Input value={user?.fullName || ''} readOnly className="bg-muted cursor-not-allowed" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input value={user?.email || ''} readOnly className="bg-muted cursor-not-allowed" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Role</Label>
                    <Input value={user?.role || ''} readOnly className="bg-muted cursor-not-allowed" />
                  </div>
                </CardContent>
              </Card>

              <div className="flex gap-3">
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save Changes'}
                </Button>
                <Button variant="outline" onClick={() => { if (data) setForm(data); }}>Reset</Button>
              </div>
            </div>

            {/* Right info cards */}
            <div className="space-y-4">
              <div className="rounded-xl bg-slate-50 border p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-8 w-8 rounded-lg bg-violet-100 flex items-center justify-center">
                    <ShieldCheck className="h-4 w-4 text-violet-600" />
                  </div>
                  <h3 className="text-sm font-semibold text-slate-800">Why is this important?</h3>
                </div>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Your business profile helps customers recognize your brand and builds trust.
                  These details will be visible where applicable.
                </p>
              </div>

              <div className="rounded-xl bg-slate-50 border p-5">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">❖ Tips</h3>
                <ul className="space-y-2.5">
                  {[
                    'Use your official business name',
                    'Add a valid contact number',
                    'Keep your address up to date',
                    'Upload a clear logo for branding',
                  ].map((tip) => (
                    <li key={tip} className="flex items-start gap-2 text-sm text-slate-500">
                      <CheckCircle2 className="h-4 w-4 text-violet-500 shrink-0 mt-0.5" />
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>Stay updated with activity on your account.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Bell className="h-7 w-7 text-muted-foreground" />
                </div>
                <h3 className="text-base font-medium text-slate-700">No notifications yet</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                  You’re all caught up! Notifications about your orders, messages, and account activity will appear here.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Billing Tab */}
        <TabsContent value="billing">
          <Card>
            <CardHeader>
              <CardTitle>Billing &amp; Subscription</CardTitle>
              <CardDescription>Manage your plan and payment details.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
                  <CreditCard className="h-7 w-7 text-muted-foreground" />
                </div>
                <h3 className="text-base font-medium text-slate-700">No active subscription</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-xs">
                  You don’t have an active plan yet. Upgrade to unlock advanced features and higher message limits.
                </p>
                <Button className="mt-6 bg-violet-600 hover:bg-violet-700 rounded-full px-6">
                  View Plans
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
