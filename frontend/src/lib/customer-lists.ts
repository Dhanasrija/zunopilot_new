import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// Curated customer lists.
//
// One module for the queries and mutations because both the Customers page and the
// Campaigns audience read them, and the invalidation is easy to get subtly wrong: adding
// members changes a list's count *and* what `?listId=` returns, so both keys have to go.

export interface CustomerList {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  _count: { members: number };
}

export interface ListMember {
  id: string;
  addedAt: string;
  customer: {
    id: string;
    name: string | null;
    waId: string;
    phone: string | null;
    lastSeenAt: string | null;
    /** Surfaced so a list screen can say who a campaign would actually reach. */
    marketingOptIn: boolean;
    optedOutAt: string | null;
  };
}

/** What a bulk add or remove actually did. `rejected` counts ids the server refused. */
export interface MembershipChange {
  changed: number;
  rejected: number;
}

export const useCustomerLists = () => useQuery({
  queryKey: ['customer-lists'],
  queryFn: async () => (await api.get<{ data: CustomerList[] }>('/customer-lists')).data.data,
});

export const useListMembers = (listId: string | null, page: number, pageSize: number) => useQuery({
  queryKey: ['customer-list-members', listId, page],
  enabled: !!listId,
  queryFn: async () => {
    const response = await api.get<{ data: ListMember[]; meta: { total: number } }>(
      `/customer-lists/${listId}/members`,
      { params: { take: pageSize, skip: (page - 1) * pageSize } },
    );
    return { members: response.data.data, total: response.data.meta.total };
  },
});

/**
 * Invalidate everything a membership change affects.
 *
 * `customers` as well as the lists: the customer table can be filtered by a list, so its
 * rows and its total are stale the moment somebody is added.
 */
const useRefreshLists = () => {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['customer-lists'] });
    qc.invalidateQueries({ queryKey: ['customer-list-members'] });
    qc.invalidateQueries({ queryKey: ['customers'] });
  };
};

export const useCreateList = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: async (body: { name: string; description?: string }) =>
      (await api.post<{ data: CustomerList }>('/customer-lists', body)).data.data,
    onSuccess: (list) => { toast.success(`List "${list.name}" created`); refresh(); },
    // Errors are already surfaced by the api client's interceptor with the server's own
    // message — which for a duplicate name is the readable one, not a Prisma index.
  });
};

export const useRenameList = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      (await api.patch<{ data: CustomerList }>(`/customer-lists/${id}`, { name })).data.data,
    onSuccess: () => { toast.success('List renamed'); refresh(); },
  });
};

export const useDeleteList = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: async (id: string) => api.delete(`/customer-lists/${id}`),
    // Says what did *not* happen, because "deleted" beside a list of people is exactly
    // where somebody fears the worst.
    onSuccess: () => { toast.success('List deleted — the customers are still there'); refresh(); },
  });
};

export const useAddToList = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: async ({ listId, customerIds }: { listId: string; customerIds: string[] }) =>
      (await api.post<{ data: MembershipChange }>(
        `/customer-lists/${listId}/members`, { customerIds },
      )).data.data,
    onSuccess: (result, { customerIds }) => {
      const already = customerIds.length - result.changed - result.rejected;
      // Distinguishing "added" from "was already on it" matters: selecting 10 and seeing
      // "3 added" is alarming unless it also says the other 7 were already there.
      toast.success(
        `${result.changed} added${already > 0 ? `, ${already} already on the list` : ''}`,
      );
      refresh();
    },
  });
};

export const useRemoveFromList = () => {
  const refresh = useRefreshLists();
  return useMutation({
    mutationFn: async ({ listId, customerIds }: { listId: string; customerIds: string[] }) =>
      (await api.delete<{ data: MembershipChange }>(
        `/customer-lists/${listId}/members`, { data: { customerIds } },
      )).data.data,
    onSuccess: (result) => {
      toast.success(`${result.changed} removed from the list`);
      refresh();
    },
  });
};
