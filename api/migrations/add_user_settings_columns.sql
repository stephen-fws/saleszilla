-- Add working hours + timezone columns to CX_UserTokens.
-- Idempotent: uses sys.columns check so re-runs are safe.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CX_UserTokens') AND name = 'WorkingHoursStart')
    ALTER TABLE dbo.CX_UserTokens ADD WorkingHoursStart NVARCHAR(5) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CX_UserTokens') AND name = 'WorkingHoursEnd')
    ALTER TABLE dbo.CX_UserTokens ADD WorkingHoursEnd NVARCHAR(5) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.CX_UserTokens') AND name = 'Timezone')
    ALTER TABLE dbo.CX_UserTokens ADD Timezone NVARCHAR(64) NULL;
