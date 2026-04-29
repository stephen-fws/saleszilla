-- Cleanup: hard-delete per-agent timeline rows.
--
-- Background:
--   We used to log one CXActivities row per AGENT webhook (research, solution,
--   next_action, attachment, news_check, stage_update, todos, ...). That made
--   the timeline noisy. Going forward we only log the GRAPH trigger
--   (`activity_type = 'agent_triggered'`) and skip per-agent completions.
--
--   This script removes the existing per-agent rows so historical timelines
--   match the new behaviour. `agent_triggered` rows (graph-level, the ones we
--   keep) are not touched.

BEGIN TRAN;

-- Preview: how many rows will be deleted
SELECT COUNT(*) AS rows_to_delete
FROM   CXActivities
WHERE  activity_type = 'agent_completed';

DELETE FROM CXActivities
WHERE  activity_type = 'agent_completed';

SELECT @@ROWCOUNT AS rows_deleted;

-- Verify nothing left
SELECT COUNT(*) AS remaining
FROM   CXActivities
WHERE  activity_type = 'agent_completed';

-- COMMIT;   -- ← uncomment to apply
-- ROLLBACK; -- ← or roll back if the count looks wrong
