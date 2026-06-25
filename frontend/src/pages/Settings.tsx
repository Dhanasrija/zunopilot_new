import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

const CATEGORIES = ['RESTAURANT', 'SALON', 'RETAIL', 'CLINIC', 'OTHER'];

export default function Settings() {
  const qc = useQueryClient();
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
      <div><h1 className="text-2xl font-semibold">Settings</h1></div>
      <Card>
        <CardHeader><CardTitle>Business profile</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div><Label>Business name</Label><Input value={form.businessName || ''} onChange={(e) => setForm({ ...form, businessName: e.target.value })} /></div>
          <div><Label>Category</Label>
            <Select value={form.category || ''} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Contact number</Label><Input value={form.contactNumber || ''} onChange={(e) => setForm({ ...form, contactNumber: e.target.value })} /></div>
          <div><Label>Website</Label><Input value={form.website || ''} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>Address</Label><Input value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="md:col-span-2"><Label>Logo URL</Label><Input value={form.logoUrl || ''} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} /></div>
          <div className="md:col-span-2"><Button onClick={() => save.mutate()}>Save</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}
