-- Follow-up schedule — one row per (potential, day_offset) in a cadence series.
-- Idempotent: CREATE TABLE IF NOT EXISTS pattern for SQL Server.

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID('dbo.CX_FollowUpSchedule') AND type = 'U')
BEGIN
    CREATE TABLE dbo.CX_FollowUpSchedule (
        Id                   INT IDENTITY PRIMARY KEY,
        PotentialId          NVARCHAR(32)  NOT NULL,       -- UUID (FK semantics, not enforced)
        PotentialNumber      NVARCHAR(20)  NOT NULL,       -- 7-digit business key; used in AgentInsights and email view
        TriggerMessageId     NVARCHAR(512) NULL,           -- InternetMessageId of the outbound that started this series
        TriggerSentTime      DATETIME2     NOT NULL,       -- UTC
        DayOffset            INT           NOT NULL,       -- 3, 5, 8, 12
        ScheduledTime        DATETIME2     NOT NULL,       -- UTC; when this tick is eligible to fire
        Status               NVARCHAR(20)  NOT NULL DEFAULT 'pending',  -- pending | fired | cancelled
        FiredTime            DATETIME2     NULL,
        InsightId            INT           NULL,           -- FK to CX_AgentInsights when fired
        CancelReason         NVARCHAR(50)  NULL,           -- 'client_replied' | 'new_series_started' | 'manual'
        CreatedTime          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        UpdatedTime          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );

    CREATE INDEX IX_FU_Status_Scheduled ON dbo.CX_FollowUpSchedule (Status, ScheduledTime);
    CREATE INDEX IX_FU_Potential        ON dbo.CX_FollowUpSchedule (PotentialId, Status);
    CREATE INDEX IX_FU_PotentialNumber  ON dbo.CX_FollowUpSchedule (PotentialNumber, Status);
END

-- Ensure the follow_up agent is registered so its insights render in the Next Action tab.
-- The read path (get_insights_for_tab) joins CX_AgentInsights to CX_AgentTypeConfig on agent_id.
IF NOT EXISTS (SELECT 1 FROM dbo.CX_AgentTypeConfig WHERE agent_id = 'follow_up')
BEGIN
    INSERT INTO dbo.CX_AgentTypeConfig (agent_id, agent_name, tab_type, content_type, sort_order, is_active)
    VALUES ('follow_up', 'Follow Up', 'next_action', 'markdown', 20, 1);
END
