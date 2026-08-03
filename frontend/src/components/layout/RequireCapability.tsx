import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore, type ModuleKey, type Permission } from '@/stores/auth.store';

// A route the workspace must have been given, and the person must be allowed to
// open.
//
// Wraps the routes of an optional module so a URL typed by hand, or a stale
// bookmark from before an operator switched the module off, does not render a
// page whose every request 404s. Sends them to the dashboard rather than showing
// an error: from the workspace's point of view the feature simply is not part of
// their product.
//
// **This is not the control.** `requireModule` and `requirePermission` refuse the
// request on the server whatever this component decides; changing what is in
// localStorage gets you an empty page, not data.

export default function RequireCapability({ module, permission }: {
  module?: ModuleKey;
  permission?: Permission;
}) {
  const modules = useAuthStore((s) => s.modules);
  const permissions = useAuthStore((s) => s.permissions);

  const hasModule = module === undefined || modules.includes(module);
  const hasPermission = permission === undefined || permissions.includes(permission);

  if (!hasModule || !hasPermission) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
