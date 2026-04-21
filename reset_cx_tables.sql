-- =============================================================================
-- Salezilla — RESET all CX_ tables (beta deploy clean slate)
-- =============================================================================
--
-- ⚠ DESTRUCTIVE. Drops every CX_* table in the current database. All app-owned
-- data (queue items, notes, todos, files, call logs, chat history, emails,
-- agent insights, meeting bindings, follow-up schedule, user tokens, etc.) will
-- be lost. External / legacy tables (Accounts, Contacts, Potentials, Users,
-- master-data lookups, sync views) are NOT touched.
--
-- After running this, run `migrate_cx_tables.sql` to recreate the schema.
-- Then re-seed CX_AgentTypeConfig with your agent registry rows (see below).
--
-- Intended flow for beta:
--   1. Back up the DB (SSMS → Tasks → Back Up).
--   2. Run THIS script  (drops all CX_* tables).
--   3. Run migrate_cx_tables.sql  (recreates them empty).
--   4. INSERT rows into CX_AgentTypeConfig for each active agent.
-- =============================================================================

USE CRMSalesPotentialls;
GO

PRINT '=== Dropping CX_ tables ===';

-- Drop order does not matter: there are no declared FK constraints between
-- CX_* tables. Using IF OBJECT_ID so re-runs are idempotent.

IF OBJECT_ID(N'CX_AgentDraftHistory', N'U') IS NOT NULL
BEGIN DROP TABLE CX_AgentDraftHistory; PRINT 'Dropped CX_AgentDraftHistory'; END;

IF OBJECT_ID(N'CX_FollowUpSchedule', N'U') IS NOT NULL
BEGIN DROP TABLE CX_FollowUpSchedule; PRINT 'Dropped CX_FollowUpSchedule'; END;

IF OBJECT_ID(N'CX_Meetings', N'U') IS NOT NULL
BEGIN DROP TABLE CX_Meetings; PRINT 'Dropped CX_Meetings'; END;

IF OBJECT_ID(N'CX_MeetingBriefDismissals', N'U') IS NOT NULL
BEGIN DROP TABLE CX_MeetingBriefDismissals; PRINT 'Dropped CX_MeetingBriefDismissals (deprecated)'; END;

IF OBJECT_ID(N'CX_GlobalChatMessages', N'U') IS NOT NULL
BEGIN DROP TABLE CX_GlobalChatMessages; PRINT 'Dropped CX_GlobalChatMessages'; END;

IF OBJECT_ID(N'CX_GlobalChatConversations', N'U') IS NOT NULL
BEGIN DROP TABLE CX_GlobalChatConversations; PRINT 'Dropped CX_GlobalChatConversations'; END;

IF OBJECT_ID(N'CX_ChatMessages', N'U') IS NOT NULL
BEGIN DROP TABLE CX_ChatMessages; PRINT 'Dropped CX_ChatMessages'; END;

IF OBJECT_ID(N'CX_Activities', N'U') IS NOT NULL
BEGIN DROP TABLE CX_Activities; PRINT 'Dropped CX_Activities'; END;

IF OBJECT_ID(N'CX_CallLogs', N'U') IS NOT NULL
BEGIN DROP TABLE CX_CallLogs; PRINT 'Dropped CX_CallLogs'; END;

IF OBJECT_ID(N'CX_Files', N'U') IS NOT NULL
BEGIN DROP TABLE CX_Files; PRINT 'Dropped CX_Files'; END;

IF OBJECT_ID(N'CX_Todos', N'U') IS NOT NULL
BEGIN DROP TABLE CX_Todos; PRINT 'Dropped CX_Todos'; END;

IF OBJECT_ID(N'CX_Notes', N'U') IS NOT NULL
BEGIN DROP TABLE CX_Notes; PRINT 'Dropped CX_Notes'; END;

IF OBJECT_ID(N'CX_SentEmails', N'U') IS NOT NULL
BEGIN DROP TABLE CX_SentEmails; PRINT 'Dropped CX_SentEmails'; END;

IF OBJECT_ID(N'CX_UserEmailDrafts', N'U') IS NOT NULL
BEGIN DROP TABLE CX_UserEmailDrafts; PRINT 'Dropped CX_UserEmailDrafts'; END;

IF OBJECT_ID(N'CX_EmailDrafts', N'U') IS NOT NULL
BEGIN DROP TABLE CX_EmailDrafts; PRINT 'Dropped CX_EmailDrafts'; END;

IF OBJECT_ID(N'CX_AgentInsights', N'U') IS NOT NULL
BEGIN DROP TABLE CX_AgentInsights; PRINT 'Dropped CX_AgentInsights'; END;

IF OBJECT_ID(N'CX_AgentTypeConfig', N'U') IS NOT NULL
BEGIN DROP TABLE CX_AgentTypeConfig; PRINT 'Dropped CX_AgentTypeConfig'; END;

IF OBJECT_ID(N'CX_QueueItems', N'U') IS NOT NULL
BEGIN DROP TABLE CX_QueueItems; PRINT 'Dropped CX_QueueItems'; END;

IF OBJECT_ID(N'CX_UserTokens', N'U') IS NOT NULL
BEGIN DROP TABLE CX_UserTokens; PRINT 'Dropped CX_UserTokens'; END;

IF OBJECT_ID(N'CX_OTPCodes', N'U') IS NOT NULL
BEGIN DROP TABLE CX_OTPCodes; PRINT 'Dropped CX_OTPCodes'; END;

GO

PRINT '';
PRINT '=== All CX_ tables dropped. Now run migrate_cx_tables.sql to recreate. ===';
PRINT 'Reminder: CX_AgentTypeConfig starts empty — insert your agent registry rows before triggering agents.';
