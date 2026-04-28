-- =============================================================================
-- Salezilla — production CX_ tables: create-if-not-exists
--
-- SAFE for prod. Each CREATE TABLE is wrapped in IF OBJECT_ID(...) IS NULL so
-- existing tables are NEVER dropped or altered. Re-running this script on a
-- DB that already has some/all of these tables is a no-op (you'll just see
-- "Skipped <Table> — already exists" PRINT messages).
--
-- For applying schema changes to existing tables (adding new columns, etc.),
-- use the dedicated migrate_*.sql scripts in this directory.
--
-- Tables created (20 total — all CX_ tables):
--   1.  CX_OTPCodes                    11. CX_Files
--   2.  CX_UserTokens                  12. CX_CallLogs
--   3.  CX_QueueItems                  13. CX_Activities
--   4.  CX_AgentTypeConfig             14. CX_ChatMessages
--   5.  CX_AgentInsights               15. CX_GlobalChatConversations
--   6.  CX_EmailDrafts                 16. CX_GlobalChatMessages
--   7.  CX_UserEmailDrafts             17. CX_Meetings
--   8.  CX_SentEmails                  18. CX_FollowUpSchedule
--   9.  CX_Notes                       19. CX_AgentDraftHistory
--   10. CX_Todos                       20. CX_DraftAttachments
--
-- After running, seed CX_AgentTypeConfig with your agent registry rows.
-- =============================================================================

PRINT '';
PRINT '============================================';
PRINT 'Salezilla prod — create-if-not-exists CX_ tables';
PRINT '============================================';

-- ────────────────────────────────────────────────────────────────────────────
-- 1. CX_OTPCodes
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_OTPCodes', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_OTPCodes — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 2. CX_UserTokens
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_UserTokens', N'U') IS NULL
BEGIN
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
        -- Superadmin: can impersonate any user (X-Impersonate-User-Id header).
        -- Mutations are blocked by middleware while impersonating.
        IsSuperAdmin        BIT             NOT NULL DEFAULT 0,
        CreatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime         DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive            BIT             NOT NULL DEFAULT 1,
        CONSTRAINT UQ_UserTokens_User_Provider UNIQUE (UserId, Provider)
    );
    PRINT 'Created CX_UserTokens';
END
ELSE PRINT 'Skipped CX_UserTokens — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 3. CX_QueueItems
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_QueueItems', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_QueueItems — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 4. CX_AgentTypeConfig  (registry — needs seeding after install)
--    Composite PK: (AgentId, TriggerCategory). Same agent can serve multiple
--    categories (e.g. attachment agent for both followUp and followUpInactive).
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_AgentTypeConfig', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_AgentTypeConfig — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 5. CX_AgentInsights
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_AgentInsights', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_AgentInsights — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 6. CX_EmailDrafts
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_EmailDrafts', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_EmailDrafts — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 7. CX_UserEmailDrafts
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_UserEmailDrafts', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_UserEmailDrafts — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 8. CX_SentEmails
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_SentEmails', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_SentEmails — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 9. CX_Notes
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_Notes', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_Notes — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 10. CX_Todos
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_Todos', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_Todos — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 11. CX_Files
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_Files', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_Files — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 12. CX_CallLogs
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_CallLogs', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_CallLogs — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 13. CX_Activities
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_Activities', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_Activities — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 14. CX_ChatMessages  (per-potential AI chat history; PotentialId = 7-digit number)
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_ChatMessages', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_ChatMessages — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 15. CX_GlobalChatConversations
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_GlobalChatConversations', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_GlobalChatConversations — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 16. CX_GlobalChatMessages
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_GlobalChatMessages', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_GlobalChatMessages — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 17. CX_Meetings
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_Meetings', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_Meetings — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 18. CX_FollowUpSchedule  (D3/D5/D8/D12 cadence)
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_FollowUpSchedule', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_FollowUpSchedule — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 19. CX_AgentDraftHistory  (append-only audit log of agent drafts)
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_AgentDraftHistory', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_AgentDraftHistory — already exists';
GO

-- ────────────────────────────────────────────────────────────────────────────
-- 20. CX_DraftAttachments  (agent-generated attachments for email drafts)
-- ────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID(N'CX_DraftAttachments', N'U') IS NULL
BEGIN
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
END
ELSE PRINT 'Skipped CX_DraftAttachments — already exists';
GO

-- =============================================================================
-- Done
-- =============================================================================
PRINT '';
PRINT '============================================';
PRINT 'prod create-if-not-exists pass complete.';
PRINT '20 CX_ tables verified / created.';
PRINT '';
PRINT 'Next: INSERT your agent registry rows into CX_AgentTypeConfig.';
PRINT '============================================';
GO
