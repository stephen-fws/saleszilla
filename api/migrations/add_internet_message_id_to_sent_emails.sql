-- Capture the RFC InternetMessageId for every sent email — this is the link
-- between Salezilla and the email sync service, and is what MS Graph uses to
-- find the full conversation thread later.
-- Idempotent.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CX_SentEmails') AND name = 'InternetMessageId')
    ALTER TABLE dbo.CX_SentEmails ADD InternetMessageId NVARCHAR(512) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CX_SentEmails_InternetMessageId')
    CREATE INDEX IX_CX_SentEmails_InternetMessageId ON dbo.CX_SentEmails (InternetMessageId);
