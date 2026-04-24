-- ============================================================================
-- migrate_notes_files_to_potential_number.sql
--
-- Brings CX_Notes, CX_Files, CX_Todos in line with the rest of the CX_ tables
-- by keying their PotentialId on the 7-digit potential_number (business key).
-- Also renames CX_Files.UploadedByUserId → CreatedByUserId for consistency
-- with CX_Notes + CX_Todos.
--
-- Idempotent: rows already keyed on potential_number + already renamed columns
-- are left alone.
-- ============================================================================

USE [CRMSalesPotentialls];
GO
SET NOCOUNT ON;

PRINT '============================================';
PRINT 'Migrating CX_Notes / CX_Files / CX_Todos PotentialId to potential_number';
PRINT '============================================';

-- ── CX_Notes ────────────────────────────────────────────────────────────────
UPDATE n
SET n.PotentialId = p.[Potential Number]
FROM CX_Notes n
JOIN Potentials p ON p.[Potential Id] = n.PotentialId
WHERE p.[Potential Number] IS NOT NULL
  AND n.PotentialId <> p.[Potential Number];
PRINT CAST(@@ROWCOUNT AS VARCHAR(10)) + ' CX_Notes rows normalised';

-- ── CX_Todos ────────────────────────────────────────────────────────────────
UPDATE t
SET t.PotentialId = p.[Potential Number]
FROM CX_Todos t
JOIN Potentials p ON p.[Potential Id] = t.PotentialId
WHERE p.[Potential Number] IS NOT NULL
  AND t.PotentialId <> p.[Potential Number];
PRINT CAST(@@ROWCOUNT AS VARCHAR(10)) + ' CX_Todos rows normalised';

-- ── CX_Files ────────────────────────────────────────────────────────────────
UPDATE f
SET f.PotentialId = p.[Potential Number]
FROM CX_Files f
JOIN Potentials p ON p.[Potential Id] = f.PotentialId
WHERE p.[Potential Number] IS NOT NULL
  AND f.PotentialId <> p.[Potential Number];
PRINT CAST(@@ROWCOUNT AS VARCHAR(10)) + ' CX_Files rows normalised';

-- ── Rename CX_Files.UploadedByUserId → CreatedByUserId (idempotent) ────────
IF COL_LENGTH('CX_Files', 'UploadedByUserId') IS NOT NULL
   AND COL_LENGTH('CX_Files', 'CreatedByUserId') IS NULL
BEGIN
    EXEC sp_rename 'CX_Files.UploadedByUserId', 'CreatedByUserId', 'COLUMN';
    PRINT 'Renamed CX_Files.UploadedByUserId → CreatedByUserId';
END
ELSE IF COL_LENGTH('CX_Files', 'CreatedByUserId') IS NOT NULL
    PRINT 'CX_Files.CreatedByUserId already exists — skipped rename';
ELSE
    PRINT 'CX_Files: neither column present — check the table schema';
GO

PRINT '';
PRINT '============================================';
PRINT 'Done.';
PRINT '============================================';
GO
