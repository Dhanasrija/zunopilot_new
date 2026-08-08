import { useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { switchWorkspace } from '@/lib/workspace';
import {
  DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

/**
 * The workspaces this login can reach, inside the account menu.
 *
 * ── Why a radio group and not a list of buttons ──────────────────────────────
 *
 * One of these is the workspace you are in, and the rest are places you could go. A radio group says
 * that in the markup as well as on screen: `role="menuitemradio"` and `aria-checked` come free, so a
 * screen reader announces which one is current without any of it being spelled out in a label. And
 * Radix does not fire `onValueChange` for a value that has not changed, which makes clicking the
 * current workspace a no-op by construction rather than by a guard somebody could delete.
 *
 * The heading is **Workspaces**, not "Switch workspace". The current one is checked, so this is a
 * list of where you can be, not a verb.
 *
 * ── One workspace renders nothing ────────────────────────────────────────────
 *
 * Which is almost everybody. A session persisted before this shipped has an empty list — `persist`
 * has no `partialize` or `version`, so the stored blob simply lacks the key and the initial `[]`
 * survives — and the menu is then byte-identical to what it was before.
 */
export default function WorkspaceSwitcher() {
  const workspaces = useAuthStore((s) => s.workspaces);
  const activeId = useAuthStore((s) => s.tenant?.id) ?? '';
  const [switching, setSwitching] = useState(false);

  if (workspaces.length < 2) return null;

  const pick = (id: string) => {
    // Radix already suppresses an unchanged value; this keeps that true if the group is ever
    // rebuilt as something else.
    if (id === activeId || switching) return;
    setSwitching(true);
    // Resolves only on failure — a successful switch reloads the page. The toast comes from the
    // response interceptor, so there is nothing to say here beyond letting the menu re-enable.
    switchWorkspace(id).catch(() => setSwitching(false));
  };

  return (
    <>
      <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={activeId} onValueChange={pick}>
        {workspaces.map((workspace) => (
          <DropdownMenuRadioItem
            key={workspace.id}
            value={workspace.id}
            /*
             * A suspended workspace cannot be entered — `POST /workspaces/switch` refuses it with a
             * 403. Disabling the row says so before the click instead of after, and it is still
             * listed, because a business quietly missing from this list explains nothing.
             */
            disabled={switching || workspace.isSuspended}
          >
            <span className="min-w-0 flex-1 truncate">{workspace.businessName}</span>
            {workspace.isSuspended
              ? <span className="ml-2 shrink-0 text-caption text-danger">Suspended</span>
              : workspace.roleName && (
                <span className="ml-2 shrink-0 text-caption text-ink-500">{workspace.roleName}</span>
              )}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
    </>
  );
}
