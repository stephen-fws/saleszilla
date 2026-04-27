-- =============================================================================
-- Migration: add IsSuperAdmin column to CX_UserTokens.
--
-- Superadmin users see all data (cross-org) and can impersonate any user via
-- the X-Impersonate-User-Id header. While impersonating, all mutations
-- (POST/PATCH/PUT/DELETE) are rejected by middleware.
--
-- Idempotent — safe to re-run.
-- =============================================================================

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns
    WHERE object_id = OBJECT_ID(N'dbo.CX_UserTokens')
      AND name = N'IsSuperAdmin'
)
BEGIN
    ALTER TABLE dbo.CX_UserTokens
        ADD IsSuperAdmin BIT NOT NULL DEFAULT 0;
    PRINT 'Added column CX_UserTokens.IsSuperAdmin';
END
ELSE
BEGIN
    PRINT 'Column CX_UserTokens.IsSuperAdmin already exists — no change.';
END
GO

-- To grant superadmin to a user (once they've connected MS):
--   UPDATE dbo.CX_UserTokens SET IsSuperAdmin = 1 WHERE UserId = '<user_id>';
