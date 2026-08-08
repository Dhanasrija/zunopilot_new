import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuthStore, type AuthWorkspace } from '@/stores/auth.store';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import WorkspaceSwitcher from './WorkspaceSwitcher';

/*
 * The switcher in the account menu.
 *
 * The property that matters most is the boring one: **with one workspace it renders nothing**, which
 * is the state of almost every account and the reason this is safe to ship. The rest is that the
 * current workspace is announced as current, and that a suspended one cannot be walked into.
 */

vi.mock('@/lib/workspace', () => ({ switchWorkspace: vi.fn().mockResolvedValue(undefined) }));

const { switchWorkspace } = await import('@/lib/workspace');

const workspace = (id: string, name: string, extra: Partial<AuthWorkspace> = {}): AuthWorkspace => ({
  id,
  businessName: name,
  logoUrl: null,
  roleName: 'Owner',
  isOwner: true,
  joinedAt: '2026-01-01T00:00:00.000Z',
  isSuspended: false,
  isCurrent: false,
  ...extra,
});

const seed = (workspaces: AuthWorkspace[]) => {
  useAuthStore.setState({
    tenant: {
      id: 't-alpha', businessName: 'Alpha Trading', category: null, categoryId: null, categoryLabel: null,
    },
    workspaces,
  });
};

/**
 * Inside a menu, because `DropdownMenuRadioGroup` needs one — outside it Radix throws.
 *
 * Returns the opener rather than opening once: selecting a workspace closes the menu, so a test that
 * clicks twice has to reopen it rather than render a second copy of the trigger.
 */
const renderMenu = async () => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Account</DropdownMenuTrigger>
      <DropdownMenuContent><WorkspaceSwitcher /></DropdownMenuContent>
    </DropdownMenu>,
  );
  const open = () => userEvent.click(screen.getByText('Account'));
  await open();
  return open;
};

beforeEach(() => { vi.clearAllMocks(); });

describe('the workspace switcher', () => {
  it('**renders nothing for a single workspace**', async () => {
    /*
     * Which is every account today, and every session persisted before this shipped — `persist` has
     * no `partialize` or `version`, so the stored blob lacks the key and the initial `[]` survives.
     * The menu is then exactly what it was.
     */
    seed([workspace('t-alpha', 'Alpha Trading', { isCurrent: true })]);
    await renderMenu();

    expect(screen.queryByText('Workspaces')).not.toBeInTheDocument();
  });

  it('**marks the workspace you are in as the checked one**', async () => {
    seed([
      workspace('t-alpha', 'Alpha Trading', { isCurrent: true }),
      workspace('t-bravo', 'Bravo Trading', { roleName: 'Shift lead', isOwner: false }),
    ]);
    await renderMenu();

    // `menuitemradio` and `aria-checked` come from the primitive, so a screen reader is told which
    // workspace is current without the label having to say it.
    const rows = screen.getAllByRole('menuitemradio');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('aria-checked', 'true');
    expect(rows[1]).toHaveAttribute('aria-checked', 'false');
    // The workspace's own word for the role, not the legacy enum.
    expect(screen.getByText('Shift lead')).toBeInTheDocument();
  });

  it('**switches on the other workspace and does nothing on the current one**', async () => {
    seed([
      workspace('t-alpha', 'Alpha Trading', { isCurrent: true }),
      workspace('t-bravo', 'Bravo Trading'),
    ]);
    const open = await renderMenu();

    await userEvent.click(screen.getByText('Alpha Trading'));
    // Radix does not fire for an unchanged value, so clicking where you already are is a no-op by
    // construction — not by a guard that could be deleted.
    expect(switchWorkspace).not.toHaveBeenCalled();

    await open();
    await userEvent.click(screen.getByText('Bravo Trading'));
    expect(switchWorkspace).toHaveBeenCalledWith('t-bravo');
  });

  it('lists a suspended workspace but will not enter it', async () => {
    // Hiding it would make a business vanish with no explanation; enabling it would offer a click
    // the server answers with 403.
    seed([
      workspace('t-alpha', 'Alpha Trading', { isCurrent: true }),
      workspace('t-bravo', 'Bravo Trading', { isSuspended: true }),
    ]);
    await renderMenu();

    expect(screen.getByText('Suspended')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Bravo Trading'));
    expect(switchWorkspace).not.toHaveBeenCalled();
  });
});
