-- ============================================================================
-- migrate_pk_autogeneration.sql
--
-- Adds server-side DEFAULT expressions for the primary keys on the Zoho-legacy
-- tables (Accounts, Contacts, Potentials) plus the business-key [Potential Number]
-- on Potentials. After running this, Salezilla code no longer supplies these
-- values on INSERT — the DB auto-populates them.
--
--   Accounts.[Account Id]         → 32-char hex (NEWID, dash-stripped)
--   Contacts.[Contact Id]         → 32-char hex (NEWID, dash-stripped)
--   Potentials.[Potential Id]     → 32-char hex (NEWID, dash-stripped)
--   Potentials.[Potential Number] → 7-digit zero-padded sequence, starting at
--                                   MAX(existing) + 1 so it won't collide with
--                                   existing Zoho data.
--
-- Idempotent: safe to re-run. Existing constraints / sequences are skipped.
-- ============================================================================

USE [CRMSalesPotentialls];
GO

SET NOCOUNT ON;
PRINT '============================================';
PRINT 'PK autogeneration migration';
PRINT '============================================';

-- ── Accounts.[Account Id] ───────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.default_constraints
    WHERE name = 'DF_Accounts_AccountId'
)
BEGIN
    ALTER TABLE [Accounts]
    ADD CONSTRAINT DF_Accounts_AccountId
    DEFAULT (LOWER(REPLACE(CONVERT(VARCHAR(36), NEWID()), '-', '')))
    FOR [Account Id];
    PRINT 'Added DEFAULT on Accounts.[Account Id]';
END
ELSE PRINT 'DF_Accounts_AccountId already exists — skipped';
GO

-- ── Contacts.[Contact Id] ───────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.default_constraints
    WHERE name = 'DF_Contacts_ContactId'
)
BEGIN
    ALTER TABLE [Contacts]
    ADD CONSTRAINT DF_Contacts_ContactId
    DEFAULT (LOWER(REPLACE(CONVERT(VARCHAR(36), NEWID()), '-', '')))
    FOR [Contact Id];
    PRINT 'Added DEFAULT on Contacts.[Contact Id]';
END
ELSE PRINT 'DF_Contacts_ContactId already exists — skipped';
GO

-- ── Potentials.[Potential Id] ───────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.default_constraints
    WHERE name = 'DF_Potentials_PotentialId'
)
BEGIN
    ALTER TABLE [Potentials]
    ADD CONSTRAINT DF_Potentials_PotentialId
    DEFAULT (LOWER(REPLACE(CONVERT(VARCHAR(36), NEWID()), '-', '')))
    FOR [Potential Id];
    PRINT 'Added DEFAULT on Potentials.[Potential Id]';
END
ELSE PRINT 'DF_Potentials_PotentialId already exists — skipped';
GO

-- ── Potentials.[Potential Number] — SEQUENCE + DEFAULT ──────────────────────
-- Create the sequence starting at max(existing) + 1 so it won't collide with
-- existing Zoho rows. CREATE SEQUENCE requires a literal, so we build it via
-- dynamic SQL.

IF NOT EXISTS (SELECT 1 FROM sys.sequences WHERE name = 'PotentialNumberSeq')
BEGIN
    DECLARE @StartAt INT = (
        SELECT ISNULL(MAX(TRY_CAST([Potential Number] AS INT)), 1000000) + 1
        FROM [Potentials]
    );
    DECLARE @sql NVARCHAR(MAX) =
        'CREATE SEQUENCE PotentialNumberSeq AS INT START WITH '
        + CAST(@StartAt AS VARCHAR(10)) + ' INCREMENT BY 1 NO CYCLE;';
    EXEC sp_executesql @sql;
    PRINT 'Created SEQUENCE PotentialNumberSeq starting at ' + CAST(@StartAt AS VARCHAR(10));
END
ELSE PRINT 'SEQUENCE PotentialNumberSeq already exists — skipped';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.default_constraints
    WHERE name = 'DF_Potentials_PotentialNumber'
)
BEGIN
    ALTER TABLE [Potentials]
    ADD CONSTRAINT DF_Potentials_PotentialNumber
    DEFAULT (RIGHT('0000000' + CAST(NEXT VALUE FOR PotentialNumberSeq AS VARCHAR(10)), 7))
    FOR [Potential Number];
    PRINT 'Added DEFAULT on Potentials.[Potential Number]';
END
ELSE PRINT 'DF_Potentials_PotentialNumber already exists — skipped';
GO

PRINT '';
PRINT '============================================';
PRINT 'Done. New rows from Salezilla (or any tool)';
PRINT 'that omit these columns will receive';
PRINT 'server-generated values.';
PRINT '============================================';
GO
