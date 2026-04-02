-- ============================================
-- CX_ Tables for Salezilla (CRM eXtension)
-- ============================================

-- 1. CX_QueueItems
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

-- 2. CX_AgentInsights
CREATE TABLE CX_AgentInsights (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId     VARCHAR(32)     NOT NULL,
    AgentType       VARCHAR(64)     NOT NULL,
    Content         NVARCHAR(MAX)   NULL,
    Status          VARCHAR(16)     NOT NULL DEFAULT 'pending',
    RequestedTime   DATETIME        NULL,
    CompletedTime   DATETIME        NULL,
    CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive        BIT             NOT NULL DEFAULT 1,
    CONSTRAINT UQ_AgentInsights_Potential_Agent UNIQUE (PotentialId, AgentType)
);

-- 3. CX_EmailDrafts
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

-- 4. CX_SentEmails
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
    ThreadId        VARCHAR(64)     NULL,
    SentByUserId    VARCHAR(32)     NULL,
    SentTime        DATETIME        NOT NULL DEFAULT GETDATE(),
    CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive        BIT             NOT NULL DEFAULT 1
);

-- 5. CX_Notes
CREATE TABLE CX_Notes (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId     VARCHAR(32)     NOT NULL,
    Content         NVARCHAR(MAX)   NOT NULL,
    CreatedByUserId VARCHAR(32)     NULL,
    CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive        BIT             NOT NULL DEFAULT 1
);

-- 6. CX_Todos
CREATE TABLE CX_Todos (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    PotentialId     VARCHAR(32)     NOT NULL,
    Text            NVARCHAR(512)   NOT NULL,
    IsCompleted     BIT             NOT NULL DEFAULT 0,
    CreatedByUserId VARCHAR(32)     NULL,
    CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive        BIT             NOT NULL DEFAULT 1
);

-- 7. CX_Files
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

-- 8. CX_CallLogs
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
    CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive        BIT             NOT NULL DEFAULT 1
);

-- 9. CX_Activities
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

-- 10. CX_ChatMessages
CREATE TABLE CX_ChatMessages (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    UserId          VARCHAR(32)     NOT NULL,
    Role            VARCHAR(16)     NOT NULL,
    Content         NVARCHAR(MAX)   NOT NULL,
    CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive        BIT             NOT NULL DEFAULT 1
);

-- 11. CX_Meetings
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

-- 12. CX_UserTokens
CREATE TABLE CX_UserTokens (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    UserId          VARCHAR(32)     NOT NULL,
    Provider        VARCHAR(32)     NOT NULL DEFAULT 'microsoft',
    AccessToken     NVARCHAR(MAX)   NULL,
    RefreshToken    NVARCHAR(MAX)   NULL,
    TokenExpiry     DATETIME        NULL,
    CalendarSyncCursor VARCHAR(256) NULL,
    CreatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    UpdatedTime     DATETIME        NOT NULL DEFAULT GETDATE(),
    IsActive        BIT             NOT NULL DEFAULT 1,
    CONSTRAINT UQ_UserTokens_User_Provider UNIQUE (UserId, Provider)
);
