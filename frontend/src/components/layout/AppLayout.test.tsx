import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderInApp } from '@/test/render';
import { useAuthStore, type ModuleKey, type Permission } from '@/stores/auth.store';

// The sidebar, as a permission and module gate.
//
// **This is the most valuable thing in the frontend to have a test for**, because both failure
// directions are silent and neither is caught by the backend suite:
//
//   - Too many links: the item renders, the user clicks it, and the API returns 403 or 404.
//     Nothing crashes, so nothing is noticed until a support ticket arrives. This file used to
//     render all fourteen entries to everyone regardless of role.
//   - Too few: someone who genuinely holds the permission cannot find the screen at all, and
//     there is no error anywhere to explain it.
//
// The server is still the enforcement point; `requirePermission` and `requireModule` refuse
// whatever the client renders. What is tested here is that the menu does not lie about it.

// The notifications hook owns polling, the tab title and desktop popups. Left real, it would
// fetch on an interval for the lifetime of the suite.
vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: [],
    unread: 0,
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    open: vi.fn(),
  }),
}));

// Reaches for the support-access session over HTTP; not what this file is about.
vi.mock('./SupportAccessBanner', () => ({ default: () => null }));

const { default: AppLayout } = await import('./AppLayout');

/** Sign in with exactly these capabilities and nothing else. */
const signIn = (permissions: Permission[], modules: ModuleKey[] = [], tenant: Record<string, unknown> = {}) => {
  useAuthStore.setState({
    token: 'test-token',
    user: { id: 'user-me', fullName: 'Venky Test', email: 'v@x.test', role: 'OWNER' } as never,
    tenant: { id: 'ten-1', businessName: 'Zuno Kitchen', ...tenant } as never,
    profileComplete: true,
    permissions,
    modules,
  });
};

/** Link labels currently in the sidebar. */
const navLabels = () => within(screen.getByRole('navigation'))
  .getAllByRole('link')
  .map((a) => a.textContent?.trim())
  .filter(Boolean);

beforeEach(() => {
  useAuthStore.setState({ permissions: [], modules: [], token: null, user: null, tenant: null });
});

describe('what a permission buys', () => {
  it('**shows nothing but the Dashboard to someone holding no permissions**', () => {
    // The shape a workspace builds when it wants a restricted seat. Every other entry names a
    // permission, and this person has none of them.
    signIn([]);
    renderInApp(<AppLayout />);
    expect(navLabels()).toEqual(['Dashboard']);
  });

  it('adds exactly the entry a permission unlocks, and no others', () => {
    signIn(['inbox:read']);
    renderInApp(<AppLayout />);
    expect(navLabels()).toEqual(['Dashboard', 'Inbox']);
  });

  it('**never shows a link whose API route the user would be refused**', () => {
    /*
     * The pairing is the point: each nav entry names the same permission its route enforces. A
     * few checked individually rather than as one list, so a failure says which one drifted.
     */
    const pairs: Array<[Permission, string]> = [
      ['customers:read', 'Customers'],
      ['workflows:read', 'Workflows'],
      ['connectors:read', 'Connectors'],
      ['analytics:read', 'Analytics'],
      ['team:read', 'Team'],
      ['templates:write', 'Templates'],
    ];

    for (const [permission, label] of pairs) {
      signIn([]);
      const withoutIt = renderInApp(<AppLayout />);
      expect(navLabels(), `${label} must be hidden without ${permission}`).not.toContain(label);
      withoutIt.unmount();

      signIn([permission]);
      const withIt = renderInApp(<AppLayout />);
      expect(navLabels(), `${label} must appear with ${permission}`).toContain(label);
      withIt.unmount();
    }
  });

  it('gives one permission every entry that names it', () => {
    // `settings:read` covers three screens. Someone who may read settings may reach all three.
    signIn(['settings:read']);
    renderInApp(<AppLayout />);
    expect(navLabels()).toEqual(expect.arrayContaining(['WhatsApp', 'Billing', 'Settings']));
  });
});

describe('what a module buys', () => {
  it('**hides a module’s screen even from someone holding its permission**', () => {
    // Two independent gates, and this is the one that is easy to get wrong: the permission is
    // granted by the workspace, the module by the operator. Without the module the routes 404,
    // so holding `leads:read` alone must still show nothing.
    signIn(['leads:read', 'campaigns:read', 'tickets:read'], []);
    renderInApp(<AppLayout />);

    const labels = navLabels();
    expect(labels).not.toContain('Leads');
    expect(labels).not.toContain('Campaigns');
    expect(labels).not.toContain('Support');
  });

  it('reveals it once the module is granted as well', () => {
    signIn(['leads:read'], ['LEADS']);
    renderInApp(<AppLayout />);
    expect(navLabels()).toContain('Leads');
  });

  it('**hides a module’s screen from someone holding the module but not the permission**', () => {
    // The other direction. A workspace can have Leads while a particular seat may not read them.
    signIn([], ['LEADS']);
    renderInApp(<AppLayout />);
    expect(navLabels()).not.toContain('Leads');
  });

  it('takes Orders and the catalogue away when selling is switched off', () => {
    // The operator's ECOMMERCE toggle. Both entries go, not just one — they were added together
    // and a half-applied gate leaves a 404 in the menu.
    signIn(['orders:read', 'catalogue:read'], []);
    const off = renderInApp(<AppLayout />);
    expect(navLabels()).not.toContain('Orders');
    expect(navLabels()).not.toContain('Catalogue');
    off.unmount();

    signIn(['orders:read', 'catalogue:read'], ['ECOMMERCE']);
    renderInApp(<AppLayout />);
    expect(navLabels()).toEqual(expect.arrayContaining(['Orders', 'Catalogue']));
  });
});

describe('what the catalogue is called', () => {
  it('uses the word this business chose', () => {
    // A restaurant's "Menu" and a shop's "Products" are the same screen. The nav and the page
    // both read `useCatalogueNouns`, which is what stopped the sidebar saying "Menu" to a
    // grocery while the page itself had adapted.
    signIn(['catalogue:read'], ['ECOMMERCE'], { catalogueNoun: 'Menu' });
    renderInApp(<AppLayout />);
    expect(navLabels()).toContain('Menu');
    expect(navLabels()).not.toContain('Catalogue');
  });

  it('falls back to "Catalogue" when the workspace has not chosen one', () => {
    signIn(['catalogue:read'], ['ECOMMERCE']);
    renderInApp(<AppLayout />);
    expect(navLabels()).toContain('Catalogue');
  });

  it('**still points at /catalogue whatever it is called**', () => {
    // The label is cosmetic; renaming it must not change where it goes.
    signIn(['catalogue:read'], ['ECOMMERCE'], { catalogueNoun: 'Products' });
    renderInApp(<AppLayout />);
    expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Products' }))
      .toHaveAttribute('href', '/catalogue');
  });
});

describe('the whole menu, for the two seats that matter', () => {
  it('an owner with everything sees every entry', () => {
    const all: Permission[] = [
      'inbox:read', 'orders:read', 'catalogue:read', 'customers:read', 'leads:read',
      'campaigns:read', 'tickets:read', 'workflows:read', 'connectors:read',
      'templates:write', 'analytics:read', 'settings:read', 'team:read',
    ];
    signIn(all, ['ECOMMERCE', 'LEADS', 'MARKETING', 'SUPPORT']);
    renderInApp(<AppLayout />);

    expect(navLabels()).toEqual([
      'Dashboard', 'Inbox', 'Orders', 'Catalogue', 'Customers', 'Leads', 'Campaigns',
      'Support', 'Assistants', 'Workflows', 'Connectors', 'Templates', 'Analytics',
      'WhatsApp', 'Team', 'Billing', 'Settings',
    ]);
  });

  it('an inbox-only agent sees a two-item menu', () => {
    // The realistic restricted seat: answer WhatsApp, see the customer, nothing else.
    signIn(['inbox:read', 'customers:read'], ['ECOMMERCE']);
    renderInApp(<AppLayout />);
    expect(navLabels()).toEqual(['Dashboard', 'Inbox', 'Customers']);
  });
});
