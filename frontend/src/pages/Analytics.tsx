import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/utils';

interface Overview {
  activeConversations: number;
  totalOrders: number;
  deliveredOrders: number;
  grossRevenue: number;
  humanTakeoverRate: number;
}
interface DayRow { day: string; orders: number; revenue: number }

export default function Analytics() {
  const overview = useQuery({
    queryKey: ['analytics.overview'],
    queryFn: async () => (await api.get<{ data: Overview }>('/analytics/overview')).data.data,
  });
  const byDay = useQuery({
    queryKey: ['analytics.byDay'],
    queryFn: async () => (await api.get<{ data: DayRow[] }>('/analytics/orders-by-day')).data.data,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-muted-foreground">Operational metrics for the last 30 days.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Active conversations" value={overview.data?.activeConversations ?? 0} />
        <Stat label="Total orders" value={overview.data?.totalOrders ?? 0} />
        <Stat label="Delivered" value={overview.data?.deliveredOrders ?? 0} />
        <Stat label="Revenue" value={formatCurrency(overview.data?.grossRevenue ?? 0)} />
      </div>
      <Card>
        <CardHeader><CardTitle>Orders by day</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Day</TableHead><TableHead>Orders</TableHead><TableHead>Revenue</TableHead></TableRow></TableHeader>
            <TableBody>
              {byDay.data?.map((d) => (
                <TableRow key={d.day}>
                  <TableCell>{new Date(d.day).toLocaleDateString()}</TableCell>
                  <TableCell>{d.orders}</TableCell>
                  <TableCell>{formatCurrency(d.revenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: number | string }) => (
  <Card>
    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle></CardHeader>
    <CardContent><div className="text-2xl font-semibold">{value}</div></CardContent>
  </Card>
);
