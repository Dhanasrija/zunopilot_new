import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { MessageSquare, ShoppingCart, TrendingUp, Bot } from 'lucide-react';

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics.overview'],
    queryFn: async () => (await api.get('/analytics/overview')).data.data,
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Operational snapshot for the last 30 days.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Active conversations" icon={MessageSquare} value={isLoading ? '—' : String(data?.activeConversations ?? 0)} />
        <Stat label="Orders placed" icon={ShoppingCart} value={isLoading ? '—' : String(data?.totalOrders ?? 0)} />
        <Stat label="Gross revenue" icon={TrendingUp} value={isLoading ? '—' : formatCurrency(data?.grossRevenue ?? 0)} />
        <Stat label="Human takeover rate" icon={Bot} value={isLoading ? '—' : `${Math.round((data?.humanTakeoverRate ?? 0) * 100)}%`} />
      </div>
    </div>
  );
}

const Stat = ({ label, icon: Icon, value }: { label: string; icon: any; value: string }) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between pb-2">
      <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      <Icon className="h-4 w-4 text-muted-foreground" />
    </CardHeader>
    <CardContent><div className="text-2xl font-semibold">{value}</div></CardContent>
  </Card>
);
