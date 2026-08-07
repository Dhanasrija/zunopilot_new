import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore, useCatalogueNouns } from '@/stores/auth.store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import {
  BookOpen, ChevronLeft, ChevronRight, Eye, LayoutGrid, PackageCheck, PackageX, Pencil, Plus, Search, ShoppingBag, Tag, Trash2, UtensilsCrossed,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  _count?: { items: number };
}

interface GroceryAttributes {
  sku?: string;
  brand?: string;
  unit?: string;
  stockQty?: number | null;
}

interface Item {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  basePrice: number | string;
  inStock: boolean;
  category?: { name: string };
  attributes?: GroceryAttributes | Record<string, unknown> | null;
}

const GROCERY_UNITS = ['piece', 'kg', 'g', 'litre', 'ml', 'pack', 'dozen', 'box', 'bundle'];
const PAGE_SIZE = 10;

const isGrocery = (cat: string) => cat === 'ECOMMERCE_GROCERY';

// ── Stats cards ───────────────────────────────────────────────────────────────

function StatsCards({ items, categories, grocery }: { items: Item[]; categories: Category[]; grocery: boolean }) {
  const stats = useMemo(() => {
    const inStock = items.filter((i) => i.inStock).length;
    const outOfStock = items.filter((i) => !i.inStock).length;
    const lowStock = grocery
      ? items.filter((i) => {
        const qty = ((i.attributes ?? {}) as GroceryAttributes).stockQty;
        return qty != null && qty > 0 && qty <= 5;
      }).length
      : 0;

    return { total: items.length, cats: categories.length, inStock, outOfStock, lowStock };
  }, [items, categories, grocery]);

  const cards = grocery
    ? [
      { label: 'Total Products', value: stats.total, icon: ShoppingBag, iconBg: 'bg-accent-100', iconColor: 'text-accent-600' },
      { label: 'Categories', value: stats.cats, icon: LayoutGrid, iconBg: 'bg-accent-100', iconColor: 'text-accent-600' },
      { label: 'In Stock', value: stats.inStock, icon: PackageCheck, iconBg: 'bg-success/10', iconColor: 'text-success' },
      { label: 'Out of Stock', value: stats.outOfStock, icon: PackageX, iconBg: 'bg-danger/10', iconColor: 'text-danger' },
    ]
    : [
      { label: 'Total Items', value: stats.total, icon: UtensilsCrossed, iconBg: 'bg-warning/15', iconColor: 'text-warning' },
      { label: 'Categories', value: stats.cats, icon: Tag, iconBg: 'bg-accent-100', iconColor: 'text-accent-600' },
      { label: 'Available', value: stats.inStock, icon: PackageCheck, iconBg: 'bg-success/10', iconColor: 'text-success' },
      { label: 'Out of Stock', value: stats.outOfStock, icon: PackageX, iconBg: 'bg-danger/10', iconColor: 'text-danger' },
    ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(({ label, value, icon: Icon, iconBg, iconColor }) => (
        <div key={label} className="rounded-lg border bg-surface-1 shadow-none p-4 flex items-center gap-4">
          <div className={`w-11 h-11 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
          <div>
            <p className="text-caption text-muted-foreground">{label}</p>
            <p className="text-h2 font-semibold mt-px">{value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Restaurant items tab ──────────────────────────────────────────────────────

function RestaurantItemsTab({ items, categories, isLoading, qc, addOpen, onAddOpenChange }: {
  items: Item[]; categories: Category[]; isLoading: boolean; qc: ReturnType<typeof useQueryClient>;
  addOpen: boolean; onAddOpenChange: (v: boolean) => void;
}) {
  const open = addOpen;
  const setOpen = onAddOpenChange;
  const [form, setForm] = useState({ categoryId: '', name: '', description: '', basePrice: '', inStock: true });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const resetForm = () => setForm({ categoryId: '', name: '', description: '', basePrice: '', inStock: true });

  const [viewItem, setViewItem] = useState<Item | null>(null);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [editForm, setEditForm] = useState({ categoryId: '', name: '', description: '', basePrice: '', inStock: true });
  const setEdit = <K extends keyof typeof editForm>(k: K, v: (typeof editForm)[K]) => setEditForm((f) => ({ ...f, [k]: v }));
  const openEdit = (item: Item) => {
    setEditItem(item);
    setEditForm({ categoryId: item.categoryId, name: item.name, description: item.description ?? '', basePrice: String(item.basePrice), inStock: item.inStock });
  };

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('ALL');
  const [stockFilter, setStockFilter] = useState('ALL');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let rows = items;
    if (catFilter !== 'ALL') rows = rows.filter((i) => i.categoryId === catFilter);
    if (stockFilter === 'IN') rows = rows.filter((i) => i.inStock);
    if (stockFilter === 'OUT') rows = rows.filter((i) => !i.inStock);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((i) => i.name.toLowerCase().includes(q) || i.category?.name.toLowerCase().includes(q));
    }
    return rows;
  }, [items, catFilter, stockFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageNumbers: (number | '...')[] = useMemo(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (page <= 3) return [1, 2, 3, '...', totalPages];
    if (page >= totalPages - 2) return [1, '...', totalPages - 2, totalPages - 1, totalPages];
    return [1, '...', page, '...', totalPages];
  }, [page, totalPages]);

  const create = useMutation({
    mutationFn: async () => api.post('/catalogue/items', { ...form, basePrice: parseFloat(form.basePrice) }),
    onSuccess: () => { setOpen(false); resetForm(); toast.success('Item added'); qc.invalidateQueries({ queryKey: ['items'] }); },
  });

  const toggleStock = useMutation({
    mutationFn: async ({ id, inStock }: { id: string; inStock: boolean }) => {
      const item = items.find((i) => i.id === id)!;
      return api.patch(`/catalogue/items/${id}`, { inStock, name: item.name, basePrice: item.basePrice });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => api.delete(`/catalogue/items/${id}`),
    onSuccess: () => { toast.success('Removed'); qc.invalidateQueries({ queryKey: ['items'] }); },
  });

  const update = useMutation({
    mutationFn: async () => api.patch(`/catalogue/items/${editItem!.id}`, { ...editForm, basePrice: parseFloat(editForm.basePrice) }),
    onSuccess: () => { setEditItem(null); toast.success('Item updated'); qc.invalidateQueries({ queryKey: ['items'] }); },
  });

  const handleSearch = (v: string) => { setSearch(v); setPage(1); };

  return (
    <div className="rounded-lg border bg-surface-1 shadow-none overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-4 border-b">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search items…" className="pl-8 h-9 text-sm" value={search}
            onChange={(e) => handleSearch(e.target.value)} />
        </div>
        <Select value={catFilter} onValueChange={(v) => { setCatFilter(v); setPage(1); }}>
          <SelectTrigger className="h-9 w-40 text-sm"><SelectValue placeholder="All Categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Categories</SelectItem>
            {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={stockFilter} onValueChange={(v) => { setStockFilter(v); setPage(1); }}>
          <SelectTrigger className="h-9 w-36 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="IN">In Stock</SelectItem>
            <SelectItem value="OUT">Out of Stock</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Menu Item</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label>Category</Label>
              <Select value={form.categoryId} onValueChange={(v) => set('categoryId', v)}>
                <SelectTrigger><SelectValue placeholder="Select category…" /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Name</Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Chicken Biryani" />
            </div>
            <div><Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} placeholder="Optional" />
            </div>
            <div><Label>Price (₹)</Label>
              <Input type="number" step="0.01" value={form.basePrice} onChange={(e) => set('basePrice', e.target.value)} placeholder="0.00" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.inStock} onCheckedChange={(v) => set('inStock', v)} />
              <Label>In Stock</Label>
            </div>
            <Button className="w-full" onClick={() => create.mutate()}
              disabled={!form.categoryId || !form.name || !form.basePrice || create.isPending}>
              {create.isPending ? 'Adding…' : 'Add Item'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Table */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">No items found</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-surface-0/60">
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>In Stock</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-ink-300">
                {paginated.map((i) => (
                  <TableRow key={i.id} className="hover:bg-surface-0/50">
                    <TableCell className="font-medium">{i.name}
                      {i.description && <p className="text-caption text-muted-foreground font-normal truncate max-w-[200px]">{i.description}</p>}
                    </TableCell>
                    <TableCell>{i.category?.name || '—'}</TableCell>
                    <TableCell className="font-medium">{formatCurrency(i.basePrice as number)}</TableCell>
                    <TableCell>
                      <Switch checked={i.inStock} onCheckedChange={(v) => toggleStock.mutate({ id: i.id, inStock: v })} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" title="View" onClick={() => setViewItem(i)}>
                          <Eye className="h-4 w-4 text-ink-500" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Edit" onClick={() => openEdit(i)}>
                          <Pencil className="h-4 w-4 text-ink-500" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Delete" onClick={() => del.mutate(i.id)}>
                          <Trash2 className="h-4 w-4 text-danger" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t bg-surface-0/40">
            <p className="text-caption text-ink-500">
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)} to{' '}
              {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} items
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="w-7 h-7"
                disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              {pageNumbers.map((n, i) =>
                n === '...' ? (
                  <span key={`dots-${i}`} className="w-7 text-center text-caption text-ink-500">…</span>
                ) : (
                  <Button key={n} variant={page === n ? 'default' : 'outline'} size="icon"
                    className={`w-7 h-7 text-caption ${page === n ? 'bg-accent-600 hover:bg-accent-700 border-accent-600' : ''}`}
                    onClick={() => setPage(n as number)}>
                    {n}
                  </Button>
                )
              )}
              <Button variant="outline" size="icon" className="w-7 h-7"
                disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* View Dialog */}
      <Dialog open={!!viewItem} onOpenChange={(v) => !v && setViewItem(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>View Item</DialogTitle></DialogHeader>
          {viewItem && (
            <div className="space-y-3 py-1">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-caption text-muted-foreground mb-1">Name</p><p className="font-medium">{viewItem.name}</p></div>
                <div><p className="text-caption text-muted-foreground mb-1">Category</p><p>{viewItem.category?.name || '—'}</p></div>
                <div><p className="text-caption text-muted-foreground mb-1">Price</p><p className="font-medium">{formatCurrency(viewItem.basePrice as number)}</p></div>
                <div><p className="text-caption text-muted-foreground mb-1">Status</p>
                  <span className={`inline-flex items-center px-2 py-px rounded-full text-caption font-semibold ${viewItem.inStock ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                    {viewItem.inStock ? 'In Stock' : 'Out of Stock'}
                  </span>
                </div>
                {viewItem.description && (
                  <div className="col-span-2"><p className="text-caption text-muted-foreground mb-1">Description</p><p>{viewItem.description}</p></div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editItem} onOpenChange={(v) => !v && setEditItem(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Item</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <Label>Category</Label>
              <Select value={editForm.categoryId} onValueChange={(v) => setEdit('categoryId', v)}>
                <SelectTrigger><SelectValue placeholder="Select category…" /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Name</Label>
              <Input value={editForm.name} onChange={(e) => setEdit('name', e.target.value)} />
            </div>
            <div><Label>Description</Label>
              <Textarea value={editForm.description} onChange={(e) => setEdit('description', e.target.value)} rows={2} />
            </div>
            <div><Label>Price (₹)</Label>
              <Input type="number" step="0.01" value={editForm.basePrice} onChange={(e) => setEdit('basePrice', e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={editForm.inStock} onCheckedChange={(v) => setEdit('inStock', v)} />
              <Label>In Stock</Label>
            </div>
            <Button className="w-full" onClick={() => update.mutate()}
              disabled={!editForm.categoryId || !editForm.name || !editForm.basePrice || update.isPending}>
              {update.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Grocery items tab ─────────────────────────────────────────────────────────

type GroceryForm = {
  categoryId: string; name: string; brand: string; sku: string;
  unit: string; basePrice: string; stockQty: string; description: string; inStock: boolean;
};

const EMPTY_GROCERY: GroceryForm = {
  categoryId: '', name: '', brand: '', sku: '',
  unit: 'piece', basePrice: '', stockQty: '', description: '', inStock: true,
};

function GroceryItemsTab({ items, categories, isLoading, qc, addOpen, onAddOpenChange }: {
  items: Item[]; categories: Category[]; isLoading: boolean; qc: ReturnType<typeof useQueryClient>;
  addOpen: boolean; onAddOpenChange: (v: boolean) => void;
}) {
  const open = addOpen;
  const setOpen = onAddOpenChange;
  const [form, setForm] = useState<GroceryForm>(EMPTY_GROCERY);
  const set = <K extends keyof GroceryForm>(k: K, v: GroceryForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const resetForm = () => setForm(EMPTY_GROCERY);

  const [viewItem, setViewItem] = useState<Item | null>(null);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [editForm, setEditForm] = useState<GroceryForm>(EMPTY_GROCERY);
  const setEditF = <K extends keyof GroceryForm>(k: K, v: GroceryForm[K]) => setEditForm((f) => ({ ...f, [k]: v }));
  const openEdit = (item: Item) => {
    const attr = (item.attributes ?? {}) as GroceryAttributes;
    setEditItem(item);
    setEditForm({
      categoryId: item.categoryId, name: item.name,
      description: item.description ?? '', basePrice: String(item.basePrice),
      inStock: item.inStock, brand: attr.brand ?? '', sku: attr.sku ?? '',
      unit: attr.unit ?? 'piece', stockQty: attr.stockQty != null ? String(attr.stockQty) : '',
    });
  };

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('ALL');
  const [stockFilter, setStockFilter] = useState('ALL');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let rows = items;
    if (catFilter !== 'ALL') rows = rows.filter((i) => i.categoryId === catFilter);
    if (stockFilter === 'IN') rows = rows.filter((i) => i.inStock);
    if (stockFilter === 'OUT') rows = rows.filter((i) => !i.inStock);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((i) => {
        const attr = (i.attributes ?? {}) as GroceryAttributes;
        return (
          i.name.toLowerCase().includes(q) ||
          i.category?.name.toLowerCase().includes(q) ||
          attr.brand?.toLowerCase().includes(q) ||
          attr.sku?.toLowerCase().includes(q)
        );
      });
    }
    return rows;
  }, [items, catFilter, stockFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageNumbers: (number | '...')[] = useMemo(() => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (page <= 3) return [1, 2, 3, '...', totalPages];
    if (page >= totalPages - 2) return [1, '...', totalPages - 2, totalPages - 1, totalPages];
    return [1, '...', page, '...', totalPages];
  }, [page, totalPages]);

  const create = useMutation({
    mutationFn: async () => api.post('/catalogue/items', {
      categoryId: form.categoryId,
      name: form.name,
      description: form.description || undefined,
      basePrice: parseFloat(form.basePrice),
      inStock: form.inStock,
      attributes: {
        sku: form.sku || undefined,
        brand: form.brand || undefined,
        unit: form.unit,
        stockQty: form.stockQty ? parseInt(form.stockQty) : null,
      },
    }),
    onSuccess: () => { setOpen(false); resetForm(); toast.success('Product added'); qc.invalidateQueries({ queryKey: ['items'] }); },
  });

  const toggleStock = useMutation({
    mutationFn: async ({ id, inStock }: { id: string; inStock: boolean }) => {
      const item = items.find((i) => i.id === id)!;
      return api.patch(`/catalogue/items/${id}`, { inStock, name: item.name, basePrice: item.basePrice });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => api.delete(`/catalogue/items/${id}`),
    onSuccess: () => { toast.success('Removed'); qc.invalidateQueries({ queryKey: ['items'] }); },
  });

  const updateGrocery = useMutation({
    mutationFn: async () => api.patch(`/catalogue/items/${editItem!.id}`, {
      categoryId: editForm.categoryId,
      name: editForm.name,
      description: editForm.description || undefined,
      basePrice: parseFloat(editForm.basePrice),
      inStock: editForm.inStock,
      attributes: {
        sku: editForm.sku || undefined,
        brand: editForm.brand || undefined,
        unit: editForm.unit,
        stockQty: editForm.stockQty ? parseInt(editForm.stockQty) : null,
      },
    }),
    onSuccess: () => { setEditItem(null); toast.success('Product updated'); qc.invalidateQueries({ queryKey: ['items'] }); },
  });

  const handleSearch = (v: string) => { setSearch(v); setPage(1); };

  return (
    <div className="rounded-lg border bg-surface-1 shadow-none overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-4 border-b">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search by name, brand or SKU…" className="pl-8 h-9 text-sm" value={search}
            onChange={(e) => handleSearch(e.target.value)} />
        </div>
        <Select value={catFilter} onValueChange={(v) => { setCatFilter(v); setPage(1); }}>
          <SelectTrigger className="h-9 w-44 text-sm"><SelectValue placeholder="All Categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Categories</SelectItem>
            {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={stockFilter} onValueChange={(v) => { setStockFilter(v); setPage(1); }}>
          <SelectTrigger className="h-9 w-36 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="IN">Available</SelectItem>
            <SelectItem value="OUT">Unavailable</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Product</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1 max-h-[70vh] overflow-y-auto pr-1">
            <div>
              <Label>Category <span className="text-danger">*</span></Label>
              <Select value={form.categoryId} onValueChange={(v) => set('categoryId', v)}>
                <SelectTrigger><SelectValue placeholder="Select category…" /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Product Name <span className="text-danger">*</span></Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Basmati Rice" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Brand</Label>
                <Input value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="e.g. India Gate" />
              </div>
              <div><Label>SKU</Label>
                <Input value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder="e.g. RICE-001" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Unit <span className="text-danger">*</span></Label>
                <Select value={form.unit} onValueChange={(v) => set('unit', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{GROCERY_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Price (₹) <span className="text-danger">*</span></Label>
                <Input type="number" step="0.01" value={form.basePrice}
                  onChange={(e) => set('basePrice', e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Stock Quantity</Label>
                <Input type="number" min={0} value={form.stockQty}
                  onChange={(e) => set('stockQty', e.target.value)} placeholder="0" />
              </div>
              <div className="flex items-end pb-1">
                <div className="flex items-center gap-2">
                  <Switch checked={form.inStock} onCheckedChange={(v) => set('inStock', v)} />
                  <Label>Available</Label>
                </div>
              </div>
            </div>
            <div><Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} placeholder="Optional" />
            </div>
            <Button className="w-full" onClick={() => create.mutate()}
              disabled={!form.categoryId || !form.name || !form.basePrice || !form.unit || create.isPending}>
              {create.isPending ? 'Adding…' : 'Add Product'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Table */}
      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">No products found</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-surface-0/60">
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-ink-300">
                {paginated.map((i) => {
                  const attr = (i.attributes ?? {}) as GroceryAttributes;
                  return (
                    <TableRow key={i.id} className="hover:bg-surface-0/50">
                      <TableCell className="font-medium">{i.name}
                        {i.description && <p className="text-caption text-muted-foreground font-normal truncate max-w-[180px]">{i.description}</p>}
                      </TableCell>
                      <TableCell>{i.category?.name || '—'}</TableCell>
                      <TableCell>{attr.brand || '—'}</TableCell>
                      <TableCell className="font-mono text-caption">{attr.sku || '—'}</TableCell>
                      <TableCell>
                        {attr.unit ? <Badge variant="outline" className="text-caption">{attr.unit}</Badge> : '—'}
                      </TableCell>
                      <TableCell className="font-medium">{formatCurrency(i.basePrice as number)}</TableCell>
                      <TableCell>
                        {attr.stockQty != null
                          ? <span className={attr.stockQty === 0 ? 'text-danger font-semibold' : attr.stockQty <= 5 ? 'text-warning font-medium' : ''}>{attr.stockQty}</span>
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Switch checked={i.inStock} onCheckedChange={(v) => toggleStock.mutate({ id: i.id, inStock: v })} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="ghost" title="View" onClick={() => setViewItem(i)}>
                              <Eye className="h-4 w-4 text-ink-500" />
                            </Button>
                            <Button size="sm" variant="ghost" title="Edit" onClick={() => openEdit(i)}>
                              <Pencil className="h-4 w-4 text-ink-500" />
                            </Button>
                            <Button size="sm" variant="ghost" title="Delete" onClick={() => del.mutate(i.id)}>
                              <Trash2 className="h-4 w-4 text-danger" />
                            </Button>
                          </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t bg-surface-0/40">
            <p className="text-caption text-ink-500">
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)} to{' '}
              {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} products
            </p>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="w-7 h-7"
                disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              {pageNumbers.map((n, i) =>
                n === '...' ? (
                  <span key={`dots-${i}`} className="w-7 text-center text-caption text-ink-500">…</span>
                ) : (
                  <Button key={n} variant={page === n ? 'default' : 'outline'} size="icon"
                    className={`w-7 h-7 text-caption ${page === n ? 'bg-accent-600 hover:bg-accent-700 border-accent-600' : ''}`}
                    onClick={() => setPage(n as number)}>
                    {n}
                  </Button>
                )
              )}
              <Button variant="outline" size="icon" className="w-7 h-7"
                disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* View Dialog */}
      <Dialog open={!!viewItem} onOpenChange={(v) => !v && setViewItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>View Product</DialogTitle></DialogHeader>
          {viewItem && (() => {
            const a = (viewItem.attributes ?? {}) as GroceryAttributes;
            return (
              <div className="space-y-3 py-1">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-caption text-muted-foreground mb-1">Name</p><p className="font-medium">{viewItem.name}</p></div>
                  <div><p className="text-caption text-muted-foreground mb-1">Category</p><p>{viewItem.category?.name || '—'}</p></div>
                  <div><p className="text-caption text-muted-foreground mb-1">Brand</p><p>{a.brand || '—'}</p></div>
                  <div><p className="text-caption text-muted-foreground mb-1">SKU</p><p className="font-mono text-caption">{a.sku || '—'}</p></div>
                  <div><p className="text-caption text-muted-foreground mb-1">Unit</p><p>{a.unit || '—'}</p></div>
                  <div><p className="text-caption text-muted-foreground mb-1">Stock Qty</p><p>{a.stockQty != null ? a.stockQty : '—'}</p></div>
                  <div><p className="text-caption text-muted-foreground mb-1">Price</p><p className="font-medium">{formatCurrency(viewItem.basePrice as number)}</p></div>
                  <div><p className="text-caption text-muted-foreground mb-1">Status</p>
                    <span className={`inline-flex items-center px-2 py-px rounded-full text-caption font-semibold ${viewItem.inStock ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                      {viewItem.inStock ? 'Available' : 'Unavailable'}
                    </span>
                  </div>
                  {viewItem.description && (
                    <div className="col-span-2"><p className="text-caption text-muted-foreground mb-1">Description</p><p>{viewItem.description}</p></div>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editItem} onOpenChange={(v) => !v && setEditItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Edit Product</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1 max-h-[70vh] overflow-y-auto pr-1">
            <div>
              <Label>Category <span className="text-danger">*</span></Label>
              <Select value={editForm.categoryId} onValueChange={(v) => setEditF('categoryId', v)}>
                <SelectTrigger><SelectValue placeholder="Select category…" /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Product Name <span className="text-danger">*</span></Label>
              <Input value={editForm.name} onChange={(e) => setEditF('name', e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Brand</Label>
                <Input value={editForm.brand} onChange={(e) => setEditF('brand', e.target.value)} />
              </div>
              <div><Label>SKU</Label>
                <Input value={editForm.sku} onChange={(e) => setEditF('sku', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Unit <span className="text-danger">*</span></Label>
                <Select value={editForm.unit} onValueChange={(v) => setEditF('unit', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{GROCERY_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Price (₹) <span className="text-danger">*</span></Label>
                <Input type="number" step="0.01" value={editForm.basePrice} onChange={(e) => setEditF('basePrice', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Stock Quantity</Label>
                <Input type="number" min={0} value={editForm.stockQty} onChange={(e) => setEditF('stockQty', e.target.value)} />
              </div>
              <div className="flex items-end pb-1">
                <div className="flex items-center gap-2">
                  <Switch checked={editForm.inStock} onCheckedChange={(v) => setEditF('inStock', v)} />
                  <Label>Available</Label>
                </div>
              </div>
            </div>
            <div><Label>Description</Label>
              <Textarea value={editForm.description} onChange={(e) => setEditF('description', e.target.value)} rows={2} />
            </div>
            <Button className="w-full" onClick={() => updateGrocery.mutate()}
              disabled={!editForm.categoryId || !editForm.name || !editForm.basePrice || !editForm.unit || updateGrocery.isPending}>
              {updateGrocery.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Categories tab ────────────────────────────────────────────────────────────

// Exported for its test. The whole page needs a router, an auth store and a query client to
// render; this tab needs a query client and nothing else, and it is the piece that was
// reported broken.
export function CategoriesTab({ label, categories, isLoading, qc }: {
  label: string; categories: Category[]; isLoading: boolean; qc: ReturnType<typeof useQueryClient>;
}) {
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: async () => api.post('/catalogue/categories', { name }),
    onSuccess: () => { setName(''); toast.success(`${label} added`); qc.invalidateQueries({ queryKey: ['categories'] }); },
  });
  const del = useMutation({
    mutationFn: async (id: string) => api.delete(`/catalogue/categories/${id}`),
    onSuccess: () => { toast.success('Removed'); qc.invalidateQueries({ queryKey: ['categories'] }); },
  });

  return (
    <div className="rounded-lg border bg-surface-1 shadow-none overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-4 border-b">
        <Input value={name} onChange={(e) => setName(e.target.value)}
          placeholder={`New ${label.toLowerCase()} name`} className="max-w-xs h-9 text-sm"
          onKeyDown={(e) => e.key === 'Enter' && name && create.mutate()} />
        {/*
          Outline until there is a name, solid once there is.

          Both states are disabled the same way; what changes is what the disabled state
          *looks like*. A solid accent button at 50% opacity reads as a live control that is
          failing — it was reported as "the Add button got disabled", as a fault, when the
          field was simply empty. An outline button greys into the row and reads as waiting.

          `default` already is `bg-accent-600 hover:bg-accent-700`, so the explicit classes
          this replaces were duplicating the variant.

          Only this one. The other seven buttons with the same `disabled={!x || pending}`
          shape are dialog submits, where a disabled primary sits under a form the person is
          already filling in and is understood.
        */}
        <Button variant={name ? 'default' : 'outline'} className="h-9 gap-1"
          onClick={() => name && create.mutate()} disabled={!name || create.isPending}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>
      {isLoading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-0/60">
              <TableHead>Name</TableHead>
              <TableHead>{label === 'Menu Category' ? 'Items' : 'Products'}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-ink-300">
            {categories.map((c) => (
              <TableRow key={c.id} className="hover:bg-surface-0/50">
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>{c._count?.items ?? 0}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => del.mutate(c.id)}>
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MenuPage() {
  const tenant = useAuthStore((s) => s.tenant);
  const businessCategory = tenant?.category ?? 'RESTAURANT';
  const grocery = isGrocery(businessCategory);
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('items');
  const [addOpen, setAddOpen] = useState(false);

  const { data: items = [], isLoading: loadingItems } = useQuery({
    queryKey: ['items'],
    queryFn: async () => (await api.get<{ data: Item[] }>('/catalogue/items')).data.data,
  });
  const { data: categories = [], isLoading: loadingCats } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<{ data: Category[] }>('/catalogue/categories')).data.data,
  });

  /*
   * The words come from the workspace's category, not from a guess here.
   *
   * This block used to be `grocery ? 'Products' : 'Menu'`, which told an IT consultancy it had
   * a Menu and — worse — disagreed with the sidebar, which said "Menu" to everybody. Both now
   * read `useCatalogueNouns`, so they cannot drift apart again.
   *
   * Note what is deliberately *not* driven by the noun: `grocery` still decides which stats and
   * which item editor to show. Stock quantities and add-on groups are different features, not
   * different words for the same one, and collapsing that distinction into a label would give a
   * grocery an add-on group editor.
   */
  const { noun: pageTitle, item: itemNoun, items: itemsNoun } = useCatalogueNouns();
  const pageDesc = `Manage your ${pageTitle.toLowerCase()}, categories and what is in stock.`;
  const categoryLabel = `${itemNoun} Category`;
  const addLabel = `Add ${itemNoun}`;
  // Neutral on purpose: crossed cutlery for a consultancy is worse than no opinion, and this is
  // the same icon the sidebar already uses for this entry.
  const Icon = BookOpen;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${grocery ? 'bg-success/10' : 'bg-warning/15'}`}>
            <Icon className={`w-5 h-5 ${grocery ? 'text-success' : 'text-warning'}`} />
          </div> */}
          <div>
            <h1 className="text-h2 font-semibold">{pageTitle}</h1>
            <p className="text-sm text-muted-foreground">{pageDesc}</p>
          </div>
        </div>
        {activeTab === 'items' && (
          <Button className="gap-1 bg-accent-600 hover:bg-accent-700" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> {addLabel}
          </Button>
        )}
      </div>

      {/* Stats */}
      <StatsCards items={items} categories={categories} grocery={grocery} />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setAddOpen(false); }}>
        <TabsList>
          <TabsTrigger value="items">{itemsNoun}</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="items" className="mt-4">
          {grocery
            ? <GroceryItemsTab items={items} categories={categories} isLoading={loadingItems} qc={qc} addOpen={addOpen} onAddOpenChange={setAddOpen} />
            : <RestaurantItemsTab items={items} categories={categories} isLoading={loadingItems} qc={qc} addOpen={addOpen} onAddOpenChange={setAddOpen} />}
        </TabsContent>
        <TabsContent value="categories" className="mt-4">
          <CategoriesTab label={categoryLabel} categories={categories} isLoading={loadingCats} qc={qc} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
