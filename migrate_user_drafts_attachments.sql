-- =============================================================================
-- Migration: add Attachments column to CX_UserEmailDrafts
--
-- Purpose: persist attachments alongside saved drafts so they survive close +
--   reopen of the composer. Stored as JSON list of
--   {name, content_type, content_bytes (base64), size_bytes}.
--
-- Idempotent — safe to re-run.
-- =============================================================================

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.CX_UserEmailDrafts')
      AND name = N'Attachments'
)
BEGIN
    ALTER TABLE dbo.CX_UserEmailDrafts
        ADD Attachments NVARCHAR(MAX) NULL;
    PRINT 'Added column CX_UserEmailDrafts.Attachments';
END
ELSE
BEGIN
    PRINT 'Column CX_UserEmailDrafts.Attachments already exists — no change.';
END
GO
