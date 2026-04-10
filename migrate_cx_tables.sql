-- ============================================================================
-- Salezilla CX_ Tables — Complete Idempotent Migration Script
-- ============================================================================
-- Safe to run on both fresh databases and existing ones.
-- Uses IF NOT EXISTS / IF COL_LENGTH checks so it won't fail on re-run.
--
-- Run this on: CRMSalesPotentialls database
-- Date: 2026-04-10
-- ============================================================================

USE CRMSalesPotentialls;
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 1. CX_OTPCodes — OTP login codes
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_OTPCodes')
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
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 2. CX_UserTokens — MS OAuth tokens per user
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_UserTokens')
BEGIN
    CREATE TABLE CX_UserTokens (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        UserId          VARCHAR(32)     NOT NULL,
        Provider        VARCHAR(32)     NOT NULL DEFAULT 'microsoft',
        AccessToken     NVARCHAR(MAX)   NULL,
        RefreshToken    NVARCHAR(MAX)   NULL,
        MSEmail         NVARCHAR(256)   NULL,
        TokenExpiry     DATETIME        NULL,
        CalendarSyncCursor VARCHAR(256) NULL,
        EmailSignature  NVARCHAR(MAX)   NULL,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1,
        CONSTRAINT UQ_UserTokens_User_Provider UNIQUE (UserId, Provider)
    );
    PRINT 'Created CX_UserTokens';
END
GO

-- Add MSEmail if missing (was added after initial creation)
IF COL_LENGTH('CX_UserTokens', 'MSEmail') IS NULL
BEGIN
    ALTER TABLE CX_UserTokens ADD MSEmail NVARCHAR(256) NULL;
    PRINT 'Added CX_UserTokens.MSEmail';
END
GO

-- Add EmailSignature if missing
IF COL_LENGTH('CX_UserTokens', 'EmailSignature') IS NULL
BEGIN
    ALTER TABLE CX_UserTokens ADD EmailSignature NVARCHAR(MAX) NULL;
    PRINT 'Added CX_UserTokens.EmailSignature';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 3. CX_QueueItems — action queue linked to potentials
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_QueueItems')
BEGIN
    CREATE TABLE CX_QueueItems (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        PotentialId     VARCHAR(32)     NOT NULL,
        ContactId       VARCHAR(32)     NULL,
        AccountId       VARCHAR(32)     NULL,
        FolderType      VARCHAR(32)     NOT NULL,
        Title           NVARCHAR(256)   NOT NULL,
        Subtitle        NVARCHAR(256)   NULL,
        Preview         NVARCHAR(MAX)   NULL,
        TimeLabel       VARCHAR(32)     NULL,
        Priority        VARCHAR(16)     NULL,
        Status          VARCHAR(16)     NOT NULL DEFAULT 'pending',
        AssignedToUserId VARCHAR(32)    NULL,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1
    );
    PRINT 'Created CX_QueueItems';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 4. CX_AgentTypeConfig — agent registry
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_AgentTypeConfig')
BEGIN
    CREATE TABLE CX_AgentTypeConfig (
        AgentId         VARCHAR(64)     PRIMARY KEY,
        AgentName       NVARCHAR(128)   NOT NULL,
        TabType         VARCHAR(32)     NOT NULL,
        ContentType     VARCHAR(16)     NOT NULL DEFAULT 'markdown',
        TriggerCategory VARCHAR(32)     NULL,
        SortOrder       INT             NOT NULL DEFAULT 0,
        IsActive        BIT             NOT NULL DEFAULT 1,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE()
    );
    PRINT 'Created CX_AgentTypeConfig';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 5. CX_AgentInsights — agent results per potential
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_AgentInsights')
BEGIN
    CREATE TABLE CX_AgentInsights (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        PotentialId     VARCHAR(32)     NOT NULL,
        AgentType       VARCHAR(64)     NOT NULL,
        MSEventId       VARCHAR(256)    NULL,
        AgentId         VARCHAR(64)     NULL,
        AgentName       NVARCHAR(128)   NULL,
        Content         NVARCHAR(MAX)   NULL,
        ContentType     VARCHAR(16)     NULL,
        Status          VARCHAR(16)     NOT NULL DEFAULT 'pending',
        ExecutionId     VARCHAR(64)     NULL,
        RunId           VARCHAR(64)     NULL,
        TriggeredBy     VARCHAR(32)     NULL,
        TriggeredAt     DATETIME        NULL,
        ErrorMessage    NVARCHAR(MAX)   NULL,
        RequestedTime   DATETIME        NULL,
        CompletedTime   DATETIME        NULL,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1,
        CONSTRAINT UQ_AgentInsights_Potential_Agent_Event UNIQUE (PotentialId, AgentType, MSEventId)
    );
    PRINT 'Created CX_AgentInsights';
END
GO

-- Add columns that were added incrementally
IF COL_LENGTH('CX_AgentInsights', 'AgentId') IS NULL
    ALTER TABLE CX_AgentInsights ADD AgentId VARCHAR(64) NULL;
GO
IF COL_LENGTH('CX_AgentInsights', 'AgentName') IS NULL
    ALTER TABLE CX_AgentInsights ADD AgentName NVARCHAR(128) NULL;
GO
IF COL_LENGTH('CX_AgentInsights', 'ContentType') IS NULL
    ALTER TABLE CX_AgentInsights ADD ContentType VARCHAR(16) NULL;
GO
IF COL_LENGTH('CX_AgentInsights', 'ExecutionId') IS NULL
    ALTER TABLE CX_AgentInsights ADD ExecutionId VARCHAR(64) NULL;
GO
IF COL_LENGTH('CX_AgentInsights', 'RunId') IS NULL
    ALTER TABLE CX_AgentInsights ADD RunId VARCHAR(64) NULL;
GO
IF COL_LENGTH('CX_AgentInsights', 'TriggeredBy') IS NULL
    ALTER TABLE CX_AgentInsights ADD TriggeredBy VARCHAR(32) NULL;
GO
IF COL_LENGTH('CX_AgentInsights', 'TriggeredAt') IS NULL
    ALTER TABLE CX_AgentInsights ADD TriggeredAt DATETIME NULL;
GO
IF COL_LENGTH('CX_AgentInsights', 'ErrorMessage') IS NULL
    ALTER TABLE CX_AgentInsights ADD ErrorMessage NVARCHAR(MAX) NULL;
GO
IF COL_LENGTH('CX_AgentInsights', 'MSEventId') IS NULL
BEGIN
    ALTER TABLE CX_AgentInsights ADD MSEventId VARCHAR(256) NULL;
    -- Drop old constraint and add new one with MSEventId
    IF EXISTS (SELECT * FROM sys.key_constraints WHERE name = 'UQ_AgentInsights_Potential_Agent')
        ALTER TABLE CX_AgentInsights DROP CONSTRAINT UQ_AgentInsights_Potential_Agent;
    IF NOT EXISTS (SELECT * FROM sys.key_constraints WHERE name = 'UQ_AgentInsights_Potential_Agent_Event')
        ALTER TABLE CX_AgentInsights ADD CONSTRAINT UQ_AgentInsights_Potential_Agent_Event UNIQUE (PotentialId, AgentType, MSEventId);
    PRINT 'Added CX_AgentInsights.MSEventId + updated constraint';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 6. CX_EmailDrafts — AI-generated email drafts
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_EmailDrafts')
BEGIN
    CREATE TABLE CX_EmailDrafts (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        PotentialId     VARCHAR(32)     NOT NULL,
        QueueItemId     INT             NULL,
        ToEmail         VARCHAR(256)    NULL,
        Subject         NVARCHAR(512)   NULL,
        Body            NVARCHAR(MAX)   NULL,
        Status          VARCHAR(16)     NOT NULL DEFAULT 'draft',
        CreatedByUserId VARCHAR(32)     NULL,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1
    );
    PRINT 'Created CX_EmailDrafts';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 7. CX_UserEmailDrafts — user-composed email drafts
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_UserEmailDrafts')
BEGIN
    CREATE TABLE CX_UserEmailDrafts (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        PotentialId     VARCHAR(32)     NOT NULL,
        ToEmail         NVARCHAR(512)   NULL,
        ToName          NVARCHAR(256)   NULL,
        CcEmails        NVARCHAR(MAX)   NULL,
        BccEmails       NVARCHAR(MAX)   NULL,
        Subject         NVARCHAR(512)   NULL,
        Body            NVARCHAR(MAX)   NULL,
        ReplyToThreadId NVARCHAR(512)   NULL,
        ReplyToMessageId NVARCHAR(512)  NULL,
        Status          VARCHAR(16)     NOT NULL DEFAULT 'draft',
        CreatedByUserId VARCHAR(32)     NULL,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1
    );
    PRINT 'Created CX_UserEmailDrafts';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 8. CX_SentEmails — emails sent via MS Graph
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_SentEmails')
BEGIN
    CREATE TABLE CX_SentEmails (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        PotentialId     VARCHAR(32)     NOT NULL,
        ContactId       VARCHAR(32)     NULL,
        AccountId       VARCHAR(32)     NULL,
        DraftId         INT             NULL,
        FromEmail       VARCHAR(256)    NOT NULL,
        FromName        NVARCHAR(128)   NULL,
        ToEmail         VARCHAR(256)    NOT NULL,
        ToName          NVARCHAR(128)   NULL,
        Subject         NVARCHAR(512)   NOT NULL,
        Body            NVARCHAR(MAX)   NOT NULL,
        ThreadId        VARCHAR(512)    NULL,
        SentByUserId    VARCHAR(32)     NULL,
        SentTime        DATETIME        NOT NULL DEFAULT GETDATE(),
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1
    );
    PRINT 'Created CX_SentEmails';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 9. CX_Notes — free-text notes on potentials
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_Notes')
BEGIN
    CREATE TABLE CX_Notes (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        PotentialId     VARCHAR(32)     NOT NULL,
        Content         NVARCHAR(MAX)   NOT NULL,
        CreatedByUserId VARCHAR(32)     NULL,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1
    );
    PRINT 'Created CX_Notes';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 10. CX_Todos — action items per potential
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_Todos')
BEGIN
    CREATE TABLE CX_Todos (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        PotentialId     VARCHAR(32)     NOT NULL,
        Text            NVARCHAR(512)   NOT NULL,
        Status          VARCHAR(20)     NOT NULL DEFAULT 'pending',
        IsCompleted     BIT             NOT NULL DEFAULT 0,
        CreatedByUserId VARCHAR(32)     NULL,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1
    );
    PRINT 'Created CX_Todos';
END
GO

-- Add Status column if missing (was added after initial creation)
IF COL_LENGTH('CX_Todos', 'Status') IS NULL
BEGIN
    ALTER TABLE CX_Todos ADD Status VARCHAR(20) NOT NULL DEFAULT 'pending';
    PRINT 'Added CX_Todos.Status';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 11. CX_Files — file attachments on potentials (stored in GCS)
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_Files')
BEGIN
    CREATE TABLE CX_Files (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        PotentialId     VARCHAR(32)     NOT NULL,
        FileName        NVARCHAR(256)   NOT NULL,
        MimeType        VARCHAR(128)    NULL,
        FileSize        INT             NULL,
        StoragePath     NVARCHAR(512)   NOT NULL,
        UploadedByUserId VARCHAR(32)    NULL,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1
    );
    PRINT 'Created CX_Files';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 12. CX_CallLogs — phone call records (Twilio integration)
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_CallLogs')
BEGIN
    CREATE TABLE CX_CallLogs (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        PotentialId     VARCHAR(32)     NOT NULL,
        ContactId       VARCHAR(32)     NULL,
        AccountId       VARCHAR(32)     NULL,
        PhoneNumber     VARCHAR(32)     NULL,
        ContactName     NVARCHAR(128)   NULL,
        Duration        INT             NOT NULL DEFAULT 0,
        Status          VARCHAR(16)     NOT NULL DEFAULT 'completed',
        Notes           NVARCHAR(MAX)   NULL,
        CalledByUserId  VARCHAR(32)     NULL,
        TwilioCallSid   VARCHAR(64)     NULL,
        RecordingUrl    NVARCHAR(512)   NULL,
        RecordingFileId INT             NULL,
        Transcript      NVARCHAR(MAX)   NULL,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1
    );
    PRINT 'Created CX_CallLogs';
END
GO

-- Add Twilio columns if missing
IF COL_LENGTH('CX_CallLogs', 'TwilioCallSid') IS NULL
    ALTER TABLE CX_CallLogs ADD TwilioCallSid VARCHAR(64) NULL;
GO
IF COL_LENGTH('CX_CallLogs', 'RecordingUrl') IS NULL
    ALTER TABLE CX_CallLogs ADD RecordingUrl NVARCHAR(512) NULL;
GO
IF COL_LENGTH('CX_CallLogs', 'RecordingFileId') IS NULL
    ALTER TABLE CX_CallLogs ADD RecordingFileId INT NULL;
GO
IF COL_LENGTH('CX_CallLogs', 'Transcript') IS NULL
    ALTER TABLE CX_CallLogs ADD Transcript NVARCHAR(MAX) NULL;
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 13. CX_Activities — timeline / audit log
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_Activities')
BEGIN
    CREATE TABLE CX_Activities (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        PotentialId     VARCHAR(32)     NOT NULL,
        ContactId       VARCHAR(32)     NULL,
        AccountId       VARCHAR(32)     NULL,
        ActivityType    VARCHAR(32)     NOT NULL,
        Description     NVARCHAR(MAX)   NULL,
        PerformedByUserId VARCHAR(32)   NULL,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1
    );
    PRINT 'Created CX_Activities';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 14. CX_ChatMessages — per-potential AI chat history
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_ChatMessages')
BEGIN
    CREATE TABLE CX_ChatMessages (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        UserId          VARCHAR(32)     NOT NULL,
        PotentialId     VARCHAR(16)     NULL,
        Role            VARCHAR(16)     NOT NULL,
        Content         NVARCHAR(MAX)   NOT NULL,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1
    );
    PRINT 'Created CX_ChatMessages';
END
GO

-- Add PotentialId if missing
IF COL_LENGTH('CX_ChatMessages', 'PotentialId') IS NULL
BEGIN
    ALTER TABLE CX_ChatMessages ADD PotentialId VARCHAR(16) NULL;
    PRINT 'Added CX_ChatMessages.PotentialId';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 15. CX_GlobalChatConversations — global chat threads per user
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_GlobalChatConversations')
BEGIN
    CREATE TABLE CX_GlobalChatConversations (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        UserId          VARCHAR(32)     NOT NULL,
        Title           NVARCHAR(256)   NULL,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1
    );
    PRINT 'Created CX_GlobalChatConversations';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 16. CX_GlobalChatMessages — global chat messages
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_GlobalChatMessages')
BEGIN
    CREATE TABLE CX_GlobalChatMessages (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        UserId          VARCHAR(32)     NOT NULL,
        ConversationId  INT             NULL,
        Role            VARCHAR(16)     NOT NULL,
        Content         NVARCHAR(MAX)   NOT NULL,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1
    );
    PRINT 'Created CX_GlobalChatMessages';
END
GO

-- Add ConversationId if missing
IF COL_LENGTH('CX_GlobalChatMessages', 'ConversationId') IS NULL
BEGIN
    ALTER TABLE CX_GlobalChatMessages ADD ConversationId INT NULL;
    PRINT 'Added CX_GlobalChatMessages.ConversationId';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 17. CX_MeetingBriefDismissals — per-user meeting brief done/skipped
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_MeetingBriefDismissals')
BEGIN
    CREATE TABLE CX_MeetingBriefDismissals (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        UserId          VARCHAR(32)     NOT NULL,
        MSEventId       VARCHAR(256)    NOT NULL,
        Status          VARCHAR(16)     NOT NULL,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1,
        CONSTRAINT UQ_MeetingBriefDismissal UNIQUE (UserId, MSEventId)
    );
    PRINT 'Created CX_MeetingBriefDismissals';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- 18. CX_Meetings — meetings synced from MS Calendar
-- ════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CX_Meetings')
BEGIN
    CREATE TABLE CX_Meetings (
        Id              INT IDENTITY(1,1) PRIMARY KEY,
        MSEventId       VARCHAR(256)    NOT NULL,
        PotentialId     VARCHAR(32)     NULL,
        ContactId       VARCHAR(32)     NULL,
        AccountId       VARCHAR(32)     NULL,
        Title           NVARCHAR(256)   NOT NULL,
        StartTime       DATETIME        NOT NULL,
        EndTime         DATETIME        NULL,
        Location        NVARCHAR(256)   NULL,
        Description     NVARCHAR(MAX)   NULL,
        MeetingType     VARCHAR(32)     NULL,
        Attendees       NVARCHAR(MAX)   NULL,
        UserId          VARCHAR(32)     NOT NULL,
        CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
        IsActive        BIT             NOT NULL DEFAULT 1,
        CONSTRAINT UQ_Meetings_MSEventId UNIQUE (MSEventId)
    );
    PRINT 'Created CX_Meetings';
END
GO

-- ════════════════════════════════════════════════════════════════════════════
-- Summary
-- ════════════════════════════════════════════════════════════════════════════
PRINT '';
PRINT '============================================';
PRINT 'Migration complete. Tables:';
PRINT '  1.  CX_OTPCodes';
PRINT '  2.  CX_UserTokens (+MSEmail, +EmailSignature)';
PRINT '  3.  CX_QueueItems';
PRINT '  4.  CX_AgentTypeConfig';
PRINT '  5.  CX_AgentInsights (+AgentId, +AgentName, +ContentType, +ExecutionId, +RunId, +TriggeredBy, +TriggeredAt, +ErrorMessage, +MSEventId)';
PRINT '  6.  CX_EmailDrafts';
PRINT '  7.  CX_UserEmailDrafts';
PRINT '  8.  CX_SentEmails';
PRINT '  9.  CX_Notes';
PRINT '  10. CX_Todos (+Status)';
PRINT '  11. CX_Files';
PRINT '  12. CX_CallLogs (+TwilioCallSid, +RecordingUrl, +RecordingFileId, +Transcript)';
PRINT '  13. CX_Activities';
PRINT '  14. CX_ChatMessages (+PotentialId)';
PRINT '  15. CX_GlobalChatConversations';
PRINT '  16. CX_GlobalChatMessages (+ConversationId)';
PRINT '  17. CX_MeetingBriefDismissals';
PRINT '  18. CX_Meetings';
PRINT '============================================';
GO
