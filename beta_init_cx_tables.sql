-- ============================================================================
-- Salezilla — Beta Deploy Fresh Install of CX_ Tables
-- ============================================================================
-- Date: 2026-04-21
--
-- ⚠ DESTRUCTIVE. Drops every CX_* table, then recreates them empty with the
-- current schema (no ALTERs — one clean CREATE per table). Intended as a
-- one-shot clean slate for beta deployment.
--
-- What this touches:    all CX_* tables only.
-- What this leaves alone:
--   - Accounts, Contacts, Potentials, Users (Zoho-sourced / legacy)
--   - CXActivities  — wait, this IS a CX_ table (misleading name);
--                     it IS dropped and recreated here.
--   - Master lookups (service, Subservices, potentialstageid, CompanyEnrichmentData)
--   - Views (VW_actuals_vs_targets_salescopilot, VW_CRM_Sales_Sync_Emails)
--   - Sync tables (CRM_Sales_Sync_Emails)
--
-- After running:
--   1. CX_AgentTypeConfig is empty — re-seed your agent registry rows before
--      triggering any agents (otherwise init_agents_for_potential() creates no
--      insight rows and the UI shows no agent spinners).
--   2. CX_UserTokens is empty — users will need to re-connect Microsoft OAuth.
--   3. Queue/notes/files/todos/chat history/call logs all start empty.
--
-- Pre-flight checklist:
--   [ ] DB backup taken (SSMS → Tasks → Back Up)
--   [ ] Confirmed target DB is the beta (NOT production)
--   [ ] Have agent registry seed INSERTs ready to run after this
-- ============================================================================

USE CRMSalesPotentialls;
GO

PRINT '';
PRINT '============================================';
PRINT '  DROP phase — removing existing CX_ tables';
PRINT '============================================';

IF OBJECT_ID(N'CX_DraftAttachments', N'U') IS NOT NULL
BEGIN DROP TABLE CX_DraftAttachments; PRINT 'Dropped CX_DraftAttachments'; END;

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
PRINT '============================================';
PRINT '  CREATE phase — rebuilding CX_ tables';
PRINT '============================================';

-- ────────────────────────────────────────────────────────────────────────────
-- 1. CX_OTPCodes
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_OTPCodes (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    UserId          VARCHAR(32)     NOT NULL,
    Code            VARCHAR(8)      NOT NULL,
    ExpiresAt       DATETIME        NOT NULL,
    IsUsed          BIT             NOT NULL DEFAULT 0,
    CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive        BIT             NOT NULL DEFAULT 1
);
PRINT 'Created CX_OTPCodes';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 2. CX_UserTokens
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_UserTokens (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    UserId              VARCHAR(32)     NOT NULL,
    Provider            VARCHAR(32)     NOT NULL DEFAULT 'microsoft',
    AccessToken         NVARCHAR(MAX)   NULL,
    RefreshToken        NVARCHAR(MAX)   NULL,
    MSEmail             NVARCHAR(256)   NULL,
    TokenExpiry         DATETIME        NULL,
    CalendarSyncCursor  VARCHAR(256)    NULL,
    EmailSignature      NVARCHAR(MAX)   NULL,
    WorkingHoursStart   VARCHAR(5)      NULL,
    WorkingHoursEnd     VARCHAR(5)      NULL,
    Timezone            VARCHAR(64)     NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive            BIT             NOT NULL DEFAULT 1,
    CONSTRAINT UQ_UserTokens_User_Provider UNIQUE (UserId, Provider)
);
PRINT 'Created CX_UserTokens';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 3. CX_QueueItems
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_QueueItems (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId         VARCHAR(32)     NOT NULL,  -- 7-digit potential_number
    ContactId           VARCHAR(32)     NULL,
    AccountId           VARCHAR(32)     NULL,
    FolderType          VARCHAR(32)     NOT NULL,
    Title               NVARCHAR(256)   NOT NULL,
    Subtitle            NVARCHAR(256)   NULL,
    Preview             NVARCHAR(MAX)   NULL,
    TimeLabel           VARCHAR(32)     NULL,
    Priority            VARCHAR(16)     NULL,
    Status              VARCHAR(16)     NOT NULL DEFAULT 'pending',
    AssignedToUserId    VARCHAR(32)     NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive            BIT             NOT NULL DEFAULT 1
);
CREATE INDEX IX_QueueItems_Folder_Status ON CX_QueueItems (FolderType, Status, IsActive);
CREATE INDEX IX_QueueItems_Potential ON CX_QueueItems (PotentialId);
PRINT 'Created CX_QueueItems';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 4. CX_AgentTypeConfig  (registry — needs seeding after install)
-- ────────────────────────────────────────────────────────────────────────────
-- Composite PK: (AgentId, TriggerCategory). Same agent can serve multiple
-- categories (e.g. attachment agent for both followUp and followUpInactive).
CREATE TABLE CX_AgentTypeConfig (
    AgentId             VARCHAR(64)     NOT NULL,
    TriggerCategory     VARCHAR(32)     NOT NULL,
    AgentName           NVARCHAR(128)   NOT NULL,
    TabType             VARCHAR(32)     NOT NULL,
    ContentType         VARCHAR(16)     NOT NULL DEFAULT 'markdown',
    SortOrder           INT             NOT NULL DEFAULT 0,
    IsActive            BIT             NOT NULL DEFAULT 1,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    CONSTRAINT PK_CX_AgentTypeConfig PRIMARY KEY (AgentId, TriggerCategory)
);
PRINT 'Created CX_AgentTypeConfig (REMINDER: seed rows before triggering agents)';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 5. CX_AgentInsights
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_AgentInsights (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId         VARCHAR(32)     NOT NULL,  -- 7-digit potential_number
    AgentType           VARCHAR(64)     NOT NULL,
    MSEventId           VARCHAR(256)    NULL,       -- set only for meeting_brief
    AgentId             VARCHAR(64)     NULL,
    AgentName           NVARCHAR(128)   NULL,
    Content             NVARCHAR(MAX)   NULL,
    ContentType         VARCHAR(16)     NULL,
    Status              VARCHAR(16)     NOT NULL DEFAULT 'pending',
    ExecutionId         VARCHAR(64)     NULL,
    RunId               VARCHAR(64)     NULL,
    TriggeredBy         VARCHAR(32)     NULL,
    TriggeredAt         DATETIME        NULL,
    ErrorMessage        NVARCHAR(MAX)   NULL,
    RequestedTime       DATETIME        NULL,
    CompletedTime       DATETIME        NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive            BIT             NOT NULL DEFAULT 1,
    CONSTRAINT UQ_AgentInsights_Potential_Agent_Event UNIQUE (PotentialId, AgentId, MSEventId)
);
CREATE INDEX IX_AgentInsights_Potential ON CX_AgentInsights (PotentialId, Status);
PRINT 'Created CX_AgentInsights';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 6. CX_EmailDrafts
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_EmailDrafts (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId         VARCHAR(32)     NOT NULL,
    QueueItemId         INT             NULL,
    ToEmail             VARCHAR(256)    NULL,
    Subject             NVARCHAR(512)   NULL,
    Body                NVARCHAR(MAX)   NULL,
    Status              VARCHAR(16)     NOT NULL DEFAULT 'draft',
    CreatedByUserId     VARCHAR(32)     NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive            BIT             NOT NULL DEFAULT 1
);
PRINT 'Created CX_EmailDrafts';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 7. CX_UserEmailDrafts
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_UserEmailDrafts (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId         VARCHAR(32)     NOT NULL,
    ToEmail             NVARCHAR(512)   NULL,
    ToName              NVARCHAR(256)   NULL,
    CcEmails            NVARCHAR(MAX)   NULL,
    BccEmails           NVARCHAR(MAX)   NULL,
    Subject             NVARCHAR(512)   NULL,
    Body                NVARCHAR(MAX)   NULL,
    ReplyToThreadId     NVARCHAR(512)   NULL,
    ReplyToMessageId    NVARCHAR(512)   NULL,
    IsNextAction        BIT             NOT NULL DEFAULT 0,
    Status              VARCHAR(16)     NOT NULL DEFAULT 'draft',
    -- JSON list of {name, content_type, content_bytes (base64), size_bytes}.
    -- Capped by the 25 MB attachment policy enforced at send time.
    Attachments         NVARCHAR(MAX)   NULL,
    CreatedByUserId     VARCHAR(32)     NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive            BIT             NOT NULL DEFAULT 1
);
PRINT 'Created CX_UserEmailDrafts';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 8. CX_SentEmails
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_SentEmails (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId         VARCHAR(32)     NOT NULL,
    ContactId           VARCHAR(32)     NULL,
    AccountId           VARCHAR(32)     NULL,
    DraftId             INT             NULL,
    FromEmail           VARCHAR(256)    NOT NULL,
    FromName            NVARCHAR(128)   NULL,
    ToEmail             VARCHAR(256)    NOT NULL,
    ToName              NVARCHAR(128)   NULL,
    CcEmails            NVARCHAR(MAX)   NULL,
    BccEmails           NVARCHAR(MAX)   NULL,
    Subject             NVARCHAR(512)   NOT NULL,
    Body                NVARCHAR(MAX)   NOT NULL,
    ThreadId            VARCHAR(512)    NULL,
    InternetMessageId   NVARCHAR(512)   NULL,
    SentByUserId        VARCHAR(32)     NULL,
    SentTime            DATETIME        NOT NULL DEFAULT GETDATE(),
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive            BIT             NOT NULL DEFAULT 1
);
CREATE INDEX IX_SentEmails_Potential ON CX_SentEmails (PotentialId, SentTime DESC);
PRINT 'Created CX_SentEmails';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 9. CX_Notes
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_Notes (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId         VARCHAR(32)     NOT NULL,
    Content             NVARCHAR(MAX)   NOT NULL,
    CreatedByUserId     VARCHAR(32)     NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive            BIT             NOT NULL DEFAULT 1
);
PRINT 'Created CX_Notes';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 10. CX_Todos
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_Todos (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId         VARCHAR(32)     NOT NULL,
    Text                NVARCHAR(512)   NOT NULL,
    Status              VARCHAR(20)     NOT NULL DEFAULT 'pending',
    IsCompleted         BIT             NOT NULL DEFAULT 0,
    -- "user" | "agent". Agent-created rows are reconciled by the todo_reconcile
    -- agent. If a user edits an agent row, Source flips to "user" and the agent
    -- no longer sees or touches it.
    Source              VARCHAR(16)     NOT NULL DEFAULT 'user',
    CreatedByUserId     VARCHAR(32)     NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive            BIT             NOT NULL DEFAULT 1
);
PRINT 'Created CX_Todos';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 11. CX_Files
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_Files (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId         VARCHAR(32)     NOT NULL,
    FileName            NVARCHAR(256)   NOT NULL,
    MimeType            VARCHAR(128)    NULL,
    FileSize            INT             NULL,
    StoragePath         NVARCHAR(512)   NOT NULL,
    CreatedByUserId     VARCHAR(32)     NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive            BIT             NOT NULL DEFAULT 1
);
PRINT 'Created CX_Files';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 12. CX_CallLogs
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_CallLogs (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId         VARCHAR(32)     NOT NULL,
    ContactId           VARCHAR(32)     NULL,
    AccountId           VARCHAR(32)     NULL,
    PhoneNumber         VARCHAR(32)     NULL,
    ContactName         NVARCHAR(128)   NULL,
    Duration            INT             NOT NULL DEFAULT 0,
    Status              VARCHAR(16)     NOT NULL DEFAULT 'completed',
    Notes               NVARCHAR(MAX)   NULL,
    CalledByUserId      VARCHAR(32)     NULL,
    TwilioCallSid       VARCHAR(64)     NULL,
    RecordingUrl        NVARCHAR(512)   NULL,
    RecordingFileId     INT             NULL,
    Transcript          NVARCHAR(MAX)   NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive            BIT             NOT NULL DEFAULT 1
);
CREATE INDEX IX_CallLogs_TwilioSid ON CX_CallLogs (TwilioCallSid);
PRINT 'Created CX_CallLogs';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 13. CX_Activities
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_Activities (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId         VARCHAR(32)     NOT NULL,
    ContactId           VARCHAR(32)     NULL,
    AccountId           VARCHAR(32)     NULL,
    ActivityType        VARCHAR(32)     NOT NULL,
    Description         NVARCHAR(MAX)   NULL,
    PerformedByUserId   VARCHAR(32)     NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive            BIT             NOT NULL DEFAULT 1
);
CREATE INDEX IX_Activities_Potential_Created ON CX_Activities (PotentialId, CreatedTime DESC);
PRINT 'Created CX_Activities';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 14. CX_ChatMessages  (per-potential AI chat history; PotentialId = 7-digit number)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_ChatMessages (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    UserId              VARCHAR(32)     NOT NULL,
    PotentialId         VARCHAR(16)     NULL,
    Role                VARCHAR(16)     NOT NULL,
    Content             NVARCHAR(MAX)   NOT NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive            BIT             NOT NULL DEFAULT 1
);
CREATE INDEX IX_ChatMessages_Potential ON CX_ChatMessages (PotentialId, CreatedTime);
PRINT 'Created CX_ChatMessages';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 15. CX_GlobalChatConversations
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_GlobalChatConversations (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    UserId              VARCHAR(32)     NOT NULL,
    Title               NVARCHAR(256)   NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive            BIT             NOT NULL DEFAULT 1
);
CREATE INDEX IX_GlobalChatConversations_User ON CX_GlobalChatConversations (UserId, UpdatedTime DESC);
PRINT 'Created CX_GlobalChatConversations';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 16. CX_GlobalChatMessages
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_GlobalChatMessages (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    UserId              VARCHAR(32)     NOT NULL,
    ConversationId      INT             NULL,
    Role                VARCHAR(16)     NOT NULL,
    Content             NVARCHAR(MAX)   NOT NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive            BIT             NOT NULL DEFAULT 1
);
CREATE INDEX IX_GlobalChatMessages_Conv ON CX_GlobalChatMessages (ConversationId, CreatedTime);
PRINT 'Created CX_GlobalChatMessages';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 17. CX_Meetings
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_Meetings (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    MSEventId           VARCHAR(256)    NOT NULL,
    PotentialId         VARCHAR(32)     NULL,
    ContactId           VARCHAR(32)     NULL,
    AccountId           VARCHAR(32)     NULL,
    Title               NVARCHAR(256)   NOT NULL,
    StartTime           DATETIME        NOT NULL,
    EndTime             DATETIME        NULL,
    Location            NVARCHAR(256)   NULL,
    MeetingLink         NVARCHAR(1024)  NULL,
    Description         NVARCHAR(MAX)   NULL,
    MeetingType         VARCHAR(32)     NULL,
    Attendees           NVARCHAR(MAX)   NULL,
    UserId              VARCHAR(32)     NOT NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive            BIT             NOT NULL DEFAULT 1,
    CONSTRAINT UQ_Meetings_MSEventId UNIQUE (MSEventId)
);
PRINT 'Created CX_Meetings';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 18. CX_FollowUpSchedule  (D3/D5/D8/D12 cadence)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_FollowUpSchedule (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId         VARCHAR(32)     NOT NULL,
    PotentialNumber     VARCHAR(20)     NOT NULL,
    TriggerMessageId    NVARCHAR(512)   NULL,
    TriggerSentTime     DATETIME        NOT NULL,
    DayOffset           INT             NOT NULL,
    ScheduledTime       DATETIME        NOT NULL,
    Status              VARCHAR(20)     NOT NULL DEFAULT 'pending',
    FiredTime           DATETIME        NULL,
    InsightId           INT             NULL,
    CancelReason        VARCHAR(50)     NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE()
);
CREATE INDEX IX_FollowUpSchedule_Potential ON CX_FollowUpSchedule (PotentialId, DayOffset);
CREATE INDEX IX_FollowUpSchedule_Status_Scheduled ON CX_FollowUpSchedule (Status, ScheduledTime);
PRINT 'Created CX_FollowUpSchedule';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 19. CX_AgentDraftHistory  (append-only audit log of agent drafts)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_AgentDraftHistory (
    Id                  INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId         VARCHAR(20)     NOT NULL,
    AgentId             VARCHAR(64)     NOT NULL,
    AgentName           NVARCHAR(128)   NULL,
    TriggerCategory     VARCHAR(32)     NULL,
    Content             NVARCHAR(MAX)   NULL,
    Status              VARCHAR(16)     NOT NULL,
    Resolution          VARCHAR(16)     NULL,
    TriggeredAt         DATETIME        NULL,
    CompletedAt         DATETIME        NULL,
    ResolvedAt          DATETIME        NOT NULL,
    CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE()
);
CREATE INDEX IX_AgentDraftHistory_Potential ON CX_AgentDraftHistory (PotentialId, CreatedTime);
PRINT 'Created CX_AgentDraftHistory';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 20. CX_DraftAttachments  (agent-generated HTML attachments for email drafts)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE CX_DraftAttachments (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId     VARCHAR(32)     NOT NULL,   -- 7-digit potential_number
    AgentId         VARCHAR(64)     NULL,        -- attachment agent that produced it
    GcsPath         NVARCHAR(512)   NOT NULL,
    Filename        NVARCHAR(256)   NOT NULL,
    ContentType     VARCHAR(64)     NOT NULL DEFAULT 'text/html',
    FileSize        INT             NULL,
    IsRemoved       BIT             NOT NULL DEFAULT 0,  -- user removed in composer
    IsSent          BIT             NOT NULL DEFAULT 0,  -- attached to a sent email
    CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE()
);
CREATE INDEX IX_DraftAttachments_Potential ON CX_DraftAttachments (PotentialId, IsSent, IsRemoved);
PRINT 'Created CX_DraftAttachments';
GO

-- ============================================================================
-- Done
-- ============================================================================
PRINT '';
PRINT '============================================';
PRINT 'Beta init complete — 20 CX_ tables recreated.';
PRINT '  1.  CX_OTPCodes';
PRINT '  2.  CX_UserTokens';
PRINT '  3.  CX_QueueItems';
PRINT '  4.  CX_AgentTypeConfig            (⚠ empty — seed agent rows next)';
PRINT '  5.  CX_AgentInsights';
PRINT '  6.  CX_EmailDrafts';
PRINT '  7.  CX_UserEmailDrafts';
PRINT '  8.  CX_SentEmails';
PRINT '  9.  CX_Notes';
PRINT '  10. CX_Todos';
PRINT '  11. CX_Files';
PRINT '  12. CX_CallLogs';
PRINT '  13. CX_Activities';
PRINT '  14. CX_ChatMessages';
PRINT '  15. CX_GlobalChatConversations';
PRINT '  16. CX_GlobalChatMessages';
PRINT '  17. CX_Meetings';
PRINT '  18. CX_FollowUpSchedule';
PRINT '  19. CX_AgentDraftHistory';
PRINT '  20. CX_DraftAttachments';
PRINT '';
PRINT 'Next: INSERT your agent registry rows into CX_AgentTypeConfig.';
PRINT '============================================';
GO
