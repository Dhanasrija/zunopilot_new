import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import { Plus, Trash2 } from 'lucide-react';

interface Category { id: string; name: string; description?: string; sortOrder: number; isActive: boolean; _count?: { items: number } }
interface Item { id: string; categoryId: string; name: string; description?: string; basePrice: number | string; inStock: boolean; category?: { name: string } }

export default function MenuPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Menu</h1>
        <p className="text-sm text-muted-foreground">Manage categories, items and add-on groups.</p>
      </div>
      <Tabs defaultValue="items">
        <TabsList>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="items"><ItemsTab /></TabsContent>
        <TabsContent value="categories"><CategoriesTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function CategoriesTab() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<{ data: Category[] }>('/menu/categories')).data.data,
  });

  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: async () => api.post('/menu/categories', { name }),
    onSuccess: () => { setName(''); toast.success('Category added'); qc.invalidateQueries({ queryKey: ['categories'] }); },
  });
  const del = useMutation({
    mutationFn: async (id: string) => api.delete(`/menu/categories/${id}`),
    onSuccess: () => { toast.success('Removed'); qc.invalidateQueries({ queryKey: ['categories'] }); },
  });

  return (
    <Card>
      <CardHeader><CardTitle>Categories</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" />
          <Button onClick={() => name && create.mutate()} disabled={!name}><Plus className="h-4 w-4 mr-1" />Add</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Name</TableHead><TableHead>Items</TableHead><TableHead></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {data.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.name}</TableCell>
                <TableCell>{c._count?.items ?? 0}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => del.mutate(c.id)}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ItemsTab() {
  const qc = useQueryClient();
  const { data: items = [] } = useQuery({
    queryKey: ['items'],
    queryFn: async () => (await api.get<{ data: Item[] }>('/menu/items')).data.data,
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<{ data: Category[] }>('/menu/categories')).data.data,
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ categoryId: '', name: '', description: '', basePrice: '', inStock: true });

  const create = useMutation({
    mutationFn: async () => api.post('/menu/items', { ...form, basePrice: parseFloat(form.basePrice) }),
    onSuccess: () => {
      setOpen(false);
      setForm({ categoryId: '', name: '', description: '', basePrice: '', inStock: true });
      toast.success('Item added');
      qc.invalidateQueries({ queryKey: ['items'] });
    },
  });

  const toggleStock = useMutation({
    mutationFn: async ({ id, inStock }: { id: string; inStock: boolean }) =>
      api.patch(`/menu/items/${id}`, { inStock, name: items.find((i) => i.id === id)?.name, basePrice: items.find((i) => i.id === id)?.basePrice }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['items'] }); },
  });

  const del = useMutation({
    mutationFn: async (id: string) => api.delete(`/menu/items/${id}`),
    onSuccess: () => { toast.success('Removed'); qc.invalidateQueries({ queryKey: ['items'] }); },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Items</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" />Add item</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New menu item</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Category</Label>
                <Select value={form.categoryId} onValueChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Pick…" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
              <div><Label>Base price (₹)</Label><Input type="number" step="0.01" value={form.basePrice} onChange={(e) => setForm((f) => ({ ...f, basePrice: e.target.value }))} /></div>
              <Button onClick={() => create.mutate()} disabled={!form.categoryId || !form.name || !form.basePrice}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead>Price</TableHead><TableHead>In stock</TableHead><TableHead></TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.name}</TableCell>
                <TableCell>{i.category?.name || '—'}</TableCell>
                <TableCell>{formatCurrency(i.basePrice as number)}</TableCell>
                <TableCell>
                  <Switch checked={i.inStock} onCheckedChange={(v) => toggleStock.mutate({ id: i.id, inStock: v })} />
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => del.mutate(i.id)}><Trash2 className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
