-- ============================================================================
-- migrate_cx_todos_to_potential_number.sql
--
-- Normalises CX_Todos.PotentialId to the 7-digit potential_number, matching
-- the convention used by CX_QueueItems / CX_ChatMessages / CX_AgentInsights.
--
-- Previously, user-created todos were stored under the Potentials.potential_id
-- UUID (because the route passed the UUID straight through). Agent-reconciled
-- todos were already using the potential_number. This UPDATE normalises the
-- UUID-keyed rows to the 7-digit form so the UI can find both kinds.
--
-- Idempotent: rows that already store a potential_number are skipped.
-- ============================================================================

USE [CRMSalesPotentialls];
GO
SET NOCOUNT ON;

PRINT 'Before:';
SELECT
    CASE WHEN t.PotentialId LIKE '%-%' OR LEN(t.PotentialId) > 10 THEN 'UUID' ELSE 'potential_number' END AS KeyShape,
    COUNT(*) AS Rows
FROM CX_Todos t
GROUP BY CASE WHEN t.PotentialId LIKE '%-%' OR LEN(t.PotentialId) > 10 THEN 'UUID' ELSE 'potential_number' END;

UPDATE t
SET t.PotentialId = p.[Potential Number]
FROM CX_Todos t
JOIN Potentials p ON p.[Potential Id] = t.PotentialId
WHERE p.[Potential Number] IS NOT NULL
  AND t.PotentialId != p.[Potential Number];

PRINT CAST(@@ROWCOUNT AS VARCHAR(10)) + ' CX_Todos rows migrated UUID → potential_number';

PRINT 'After:';
SELECT
    CASE WHEN t.PotentialId LIKE '%-%' OR LEN(t.PotentialId) > 10 THEN 'UUID' ELSE 'potential_number' END AS KeyShape,
    COUNT(*) AS Rows
FROM CX_Todos t
GROUP BY CASE WHEN t.PotentialId LIKE '%-%' OR LEN(t.PotentialId) > 10 THEN 'UUID' ELSE 'potential_number' END;
GO
