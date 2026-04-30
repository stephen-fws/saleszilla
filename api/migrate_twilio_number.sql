-- Migration: per-user personal Twilio number for outbound caller ID.
--
-- Stores each sales rep's own Twilio number (E.164) on CX_UserTokens.
-- NULL = use the org default (TWILIO_CALLING_NUMBER env var).

IF NOT EXISTS (
    SELECT 1
    FROM   sys.columns
    WHERE  object_id = OBJECT_ID(N'dbo.CX_UserTokens')
      AND  name = 'TwilioNumber'
)
BEGIN
    ALTER TABLE dbo.CX_UserTokens
        ADD TwilioNumber NVARCHAR(32) NULL;
END;
