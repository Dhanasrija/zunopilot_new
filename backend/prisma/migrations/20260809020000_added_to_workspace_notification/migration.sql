-- A notification kind for "somebody added you to this workspace".
--
-- Additive: appending an enum value does not rewrite the column.
--
-- Recorded in the workspace the person was added *to*, which is a stated limitation rather than an
-- oversight: notifications are tenant-scoped by `visibleTo`, so it does not reach them while they
-- are working elsewhere. The new entry in their workspace switcher is the signal that crosses
-- workspaces; this is what tells them *who* added them, once they arrive.
--
-- Both hand-written partial unique indexes (WorkflowInstance_one_active_per_conversation and
-- Price_one_active_per_plan_interval) are untouched.

ALTER TYPE "NotificationKind" ADD VALUE 'ADDED_TO_WORKSPACE';
