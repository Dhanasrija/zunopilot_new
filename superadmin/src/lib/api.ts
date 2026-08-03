import axios from 'axios';

// The operator console's API client.
//
// One token, one key, one place that reads it — deliberately unlike the customer
// app, which ended up with `localStorage.token` and a zustand store under
// `wa-auth` able to disagree with each other. The lesson is cheap to apply here
// from the start.

const TOKEN_KEY = 'zp-sa-token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export const api = axios.create({ baseURL: '/sa' });

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // A 401 anywhere means the token is gone or revoked. Clearing it here rather
    // than in each screen means a deactivated operator cannot keep clicking
    // around a stale, half-broken console.
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      tokenStore.clear();
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    const message = error.response?.data?.message
      || error.response?.data?.error
      || error.message
      || 'Something went wrong';
    return Promise.reject(new Error(message));
  },
);

const unwrap = <T>(promise: Promise<{ data: { data: T } }>): Promise<T> =>
  promise.then((r) => r.data.data);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Overview {
  tenants: { total: number; active: number; suspended: number };
  users: number;
  /** Unhandled contact-form enquiries. Drives the Enquiries nav badge. */
  newEnquiries: number;
  whatsappNumbers: number;
  last24h: { messages: number; aiRoutedMessages: number };
  publishedWorkflows: number;
  openHandoffs: number;
  plans: Array<{ plan: string; status: string; count: number }>;
  revenue: {
    allTimePaise: number; invoiceCount: number;
    thisMonthPaise: number; thisMonthInvoices: number;
  };
}

/** An optional module a workspace can be given. Mirrors the `ModuleKey` enum. */
export type ModuleKey = 'MARKETING' | 'LEADS' | 'SUPPORT';

export interface ModuleSetting {
  module: ModuleKey;
  enabled: boolean;
  note: string | null;
  updatedByAdminId: string | null;
  updatedAt: string | null;
}

export type EnquiryStatus = 'NEW' | 'CONTACTED' | 'CLOSED' | 'SPAM';

export interface Enquiry {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  interest: string;
  message: string;
  status: EnquiryStatus;
  ip: string | null;
  userAgent: string | null;
  handledByAdminId: string | null;
  handledAt: string | null;
  internalNote: string | null;
  createdAt: string;
}

export interface TenantRow {
  id: string;
  businessName: string;
  category: string;
  isActive: boolean;
  createdAt: string;
  gstin: string | null;
  plan: string | null;
  interval: string | null;
  subscriptionStatus: string | null;
  periodEnd: string | null;
  numbers: string[];
  users: number;
  customers: number;
  orders: number;
}

export interface TenantDetail {
  tenant: {
    id: string; businessName: string; category: string; contactNumber: string | null;
    address: string | null; website: string | null; isActive: boolean;
    createdAt: string; gstin: string | null; gstStateCode: string | null;
    users: Array<{
      id: string; email: string; fullName: string; role: string;
      isActive: boolean; emailVerified: boolean; createdAt: string;
    }>;
    whatsappAccounts: Array<{
      id: string; displayPhone: string | null; phoneNumberId: string; wabaId: string;
      businessName: string | null; tokenExpiresAt: string | null; connectedAt: string;
    }>;
    subscription: Record<string, unknown> | null;
    _count: Record<string, number>;
  };
  entitlements: Record<string, unknown>;
  /** Mirrors `UsageSnapshot` in the backend's billing service. */
  usage: {
    used: number;
    limit: number | null;
    remaining: number | null;
    periodStart: string;
    periodEnd: string;
    overQuota: boolean;
    overageInteractions: number;
    overagePaise: number;
    overageRatePaise: number;
    overageCapPaise: number;
    capReached: boolean;
  };
  invoices: Array<{
    id: string; number: string; planName: string; intervalLabel: string;
    periodStart: string; periodEnd: string; subtotalPaise: number; overagePaise: number;
    taxPaise: number; totalPaise: number; currency: string; issuedAt: string;
    billedToGstin: string | null; placeOfSupply: string | null;
  }>;
  payments: Array<{
    id: string; plan: string; interval: string; amountPaise: number; status: string;
    createdAt: string; paidAt: string | null; failureReason: string | null;
    razorpayPaymentId: string | null;
  }>;
  connectors: Array<{ id: string; key: string; name: string; kind: string; status: string }>;
  pricing: { gstRatePercent: number; payableTodayPaise: number | null };
}

export interface ActivityEntry {
  at: string;
  kind: string;
  title: string;
  detail?: string;
}

export interface PlansResponse {
  editable: boolean;
  source: string;
  howToChange: string[];
  gst: { ratePercent: number } | null;
  plans: Array<{
    code: string; name: string; tagline: string; includes: string[];
    entitlements: Record<string, unknown>; selfServe: boolean; badges: string[];
    subscribers: number;
    overage: { ratePaise: number; defaultCapPaise: number };
    prices: Array<{
      interval: string; catalogueAmountPaise: number; livePriceId: string | null;
      liveAmountPaise: number | null; payablePaise: number; razorpayPlanId: string | null;
      outOfSync: boolean; notSynced: boolean;
    }>;
  }>;
  archivedPrices: Array<{
    id: string; plan: string; interval: string; amountPaise: number; archivedAt: string;
  }>;
}

export interface Grant {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'REVOKED' | 'EXPIRED';
  reason: string;
  requestedAt: string;
  requestExpiresAt: string;
  respondedAt: string | null;
  approvedUntil: string | null;
  revokedAt: string | null;
  revokedBySelf: boolean;
  startedAt: string | null;
  lastUsedAt: string | null;
  requestCount: number;
  active: boolean;
  requestedBy: { name: string; email: string } | null;
  respondedBy: string | null;
  viewAs: { name: string; email: string } | null;
}

export interface CategoryRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  workspaces: number;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  action: string;
  summary: string;
  tenantId: string | null;
  tenantName: string | null;
  targetType: string | null;
  ip: string | null;
  createdAt: string;
  superAdmin: { fullName: string; email: string } | null;
}

// ── Calls ─────────────────────────────────────────────────────────────────────

export const sa = {
  login: (email: string, password: string) => unwrap<{
    token: string; admin: { id: string; email: string; fullName: string };
  }>(api.post('/auth/login', { email, password })),

  me: () => unwrap<{ id: string; email: string; fullName: string; lastLoginAt: string | null }>(
    api.get('/auth/me'),
  ),

  overview: () => unwrap<Overview>(api.get('/overview')),

  tenants: (params: Record<string, string | number | undefined>) =>
    api.get<{ data: TenantRow[]; meta: { total: number } }>('/tenants', { params })
      .then((r) => ({ rows: r.data.data, total: r.data.meta.total })),

  tenant: (id: string) => unwrap<TenantDetail>(api.get(`/tenants/${id}`)),

  activity: (id: string) => unwrap<{
    entries: ActivityEntry[];
    dailyMessages: Array<{ date: string; inbound: number; outbound: number }>;
  }>(api.get(`/tenants/${id}/activity`)),

  setTenantActive: (id: string, isActive: boolean, reason?: string) =>
    unwrap<{ isActive: boolean }>(api.patch(`/tenants/${id}/active`, { isActive, reason })),

  assignPlan: (id: string, body: Record<string, unknown>) =>
    unwrap<Record<string, unknown>>(api.post(`/tenants/${id}/plan`, body)),

  // Module 23: contact enquiries. Platform-level, so no tenant in the path.
  enquiries: (params: { status?: EnquiryStatus; take?: number; skip?: number } = {}) =>
    unwrap<{ enquiries: Enquiry[]; total: number; counts: Partial<Record<EnquiryStatus, number>> }>(
      api.get('/enquiries', { params }),
    ),

  updateEnquiry: (id: string, body: { status?: EnquiryStatus; internalNote?: string | null }) =>
    unwrap<Enquiry>(api.patch(`/enquiries/${id}`, body)),

  tenantModules: (id: string) =>
    unwrap<ModuleSetting[]>(api.get(`/tenants/${id}/modules`)),

  setTenantModule: (id: string, body: { module: ModuleKey; enabled: boolean; note?: string }) =>
    unwrap<ModuleSetting>(api.patch(`/tenants/${id}/modules`, body)),

  updateUser: (userId: string, body: { isActive?: boolean; role?: string }) =>
    unwrap<Record<string, unknown>>(api.patch(`/users/${userId}`, body)),

  resetPassword: (userId: string) =>
    unwrap<{ temporaryPassword: string }>(api.post(`/users/${userId}/reset-password`)),

  plans: () => unwrap<PlansResponse>(api.get('/plans')),

  categories: {
    list: () => unwrap<CategoryRow[]>(api.get('/business-categories')),
    create: (body: { key: string; label: string; description?: string; sortOrder?: number }) =>
      unwrap<CategoryRow>(api.post('/business-categories', body)),
    update: (id: string, body: Record<string, unknown>) =>
      unwrap<CategoryRow>(api.patch(`/business-categories/${id}`, body)),
    remove: (id: string) => api.delete(`/business-categories/${id}`),
  },

  // Support access. The console can request, watch and end — never grant.
  impersonation: {
    list: (tenantId: string) => unwrap<Grant[]>(api.get(`/tenants/${tenantId}/impersonation`)),
    request: (tenantId: string, reason: string) =>
      unwrap<Grant>(api.post(`/tenants/${tenantId}/impersonation`, { reason })),
    token: (tenantId: string, grantId: string) => unwrap<{
      token: string; tokenExpiresAt: string; approvedUntil: string; readOnly: true;
    }>(api.post(`/tenants/${tenantId}/impersonation/${grantId}/token`)),
    end: (tenantId: string, grantId: string) =>
      api.post(`/tenants/${tenantId}/impersonation/${grantId}/end`),
  },

  audit: (params: Record<string, string | number | undefined>) =>
    api.get<{ data: AuditRow[]; meta: { total: number } }>('/audit', { params })
      .then((r) => ({ rows: r.data.data, total: r.data.meta.total })),
};

// ── Formatting ────────────────────────────────────────────────────────────────

export const rupees = (paise: number, decimals = false): string => `₹${(paise / 100).toLocaleString('en-IN', {
  minimumFractionDigits: decimals ? 2 : 0,
  maximumFractionDigits: decimals ? 2 : 0,
})}`;

export const when = (iso: string | null | undefined): string => (iso
  ? new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  : '—');

export const day = (iso: string | null | undefined): string => (iso
  ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');
