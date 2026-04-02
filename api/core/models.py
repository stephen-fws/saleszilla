"""SQLAlchemy ORM models.

Read-only models map to existing CRM tables (never INSERT/UPDATE).
Read-write CX_ models map to the Salezilla extension tables.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text, Unicode, UnicodeText
from sqlalchemy.orm import Mapped, mapped_column

from core.database import Base


# ═════════════════════════════════════════════════════════════════════════════
# READ-ONLY — Existing CRM tables
# ═════════════════════════════════════════════════════════════════════════════


class User(Base):
    """Maps to the existing `users` table. Read-only."""

    __tablename__ = "users"

    user_id: Mapped[str] = mapped_column("User Id", String(32), primary_key=True)
    zuid: Mapped[str | None] = mapped_column("ZUID", Unicode(16), nullable=True)
    email: Mapped[str] = mapped_column("Email", Unicode(128), nullable=False)
    name: Mapped[str] = mapped_column("Name", Unicode(128), nullable=False)
    first_name: Mapped[str | None] = mapped_column("FirstName", Unicode(128), nullable=True)
    last_name: Mapped[str | None] = mapped_column("LastName", Unicode(128), nullable=True)
    role: Mapped[str | None] = mapped_column("Role", Unicode(128), nullable=True)
    profile: Mapped[str | None] = mapped_column("Profile", Unicode(32), nullable=True)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False)
    user_status: Mapped[str] = mapped_column("User Status", String(8), nullable=False)
    reporting_to: Mapped[str | None] = mapped_column("reporting_to", Unicode(200), nullable=True)


class Account(Base):
    """Maps to the existing `Accounts` table. Read-only."""

    __tablename__ = "Accounts"

    account_id: Mapped[str] = mapped_column("Account Id", String(32), primary_key=True)
    account_owner_id: Mapped[str | None] = mapped_column("Account Owner Id", String(32), nullable=True)
    account_name: Mapped[str | None] = mapped_column("Account Name", String(256), nullable=True)
    industry: Mapped[str | None] = mapped_column("Industry", String(64), nullable=True)
    website: Mapped[str | None] = mapped_column("Website", String(256), nullable=True)
    employees: Mapped[int | None] = mapped_column("Employees", Integer, nullable=True)
    annual_revenue: Mapped[float | None] = mapped_column("Annual Revenue", nullable=True)
    phone: Mapped[str | None] = mapped_column("Phone", String(32), nullable=True)
    billing_city: Mapped[str | None] = mapped_column("Billing City", String(256), nullable=True)
    billing_state: Mapped[str | None] = mapped_column("Billing State", String(256), nullable=True)
    billing_country: Mapped[str | None] = mapped_column("Billing Country", String(256), nullable=True)
    country_fws: Mapped[str | None] = mapped_column("Country FWS", String(256), nullable=True)
    description: Mapped[str | None] = mapped_column("Description", Text, nullable=True)
    rating: Mapped[str | None] = mapped_column("Rating", String(8), nullable=True)
    account_type: Mapped[str | None] = mapped_column("Account Type", String(8), nullable=True)
    created_time: Mapped[datetime | None] = mapped_column("Created Time", DateTime, nullable=True)
    modified_time: Mapped[datetime | None] = mapped_column("Modified Time", DateTime, nullable=True)


class Contact(Base):
    """Maps to the existing `Contacts` table. Read-only."""

    __tablename__ = "Contacts"

    contact_id: Mapped[str] = mapped_column("Contact Id", String(32), primary_key=True)
    contact_owner_id: Mapped[str | None] = mapped_column("Contact Owner Id", String(32), nullable=True)
    first_name: Mapped[str | None] = mapped_column("First Name", String(128), nullable=True)
    last_name: Mapped[str | None] = mapped_column("Last Name", String(128), nullable=True)
    full_name: Mapped[str | None] = mapped_column("Full Name", String(128), nullable=True)
    title: Mapped[str | None] = mapped_column("Title", String(128), nullable=True)
    email: Mapped[str | None] = mapped_column("Email", String(256), nullable=True)
    phone: Mapped[str | None] = mapped_column("Phone", String(32), nullable=True)
    mobile: Mapped[str | None] = mapped_column("Mobile", String(32), nullable=True)
    account_id: Mapped[str | None] = mapped_column("Account Id", String(32), nullable=True)
    lead_source: Mapped[str | None] = mapped_column("Lead Source", String(32), nullable=True)
    department: Mapped[str | None] = mapped_column("Department", String(256), nullable=True)
    created_time: Mapped[datetime | None] = mapped_column("Created Time", DateTime, nullable=True)
    modified_time: Mapped[datetime | None] = mapped_column("Modified Time", DateTime, nullable=True)


class Potential(Base):
    """Maps to the existing `Potentials` table. Read-only."""

    __tablename__ = "Potentials"

    potential_id: Mapped[str] = mapped_column("Potential Id", String(32), primary_key=True)
    potential_owner_id: Mapped[str | None] = mapped_column("Potential Owner Id", String(32), nullable=True)
    potential_owner_name: Mapped[str | None] = mapped_column("Potential Owner Name", Unicode(128), nullable=True)
    potential_name: Mapped[str | None] = mapped_column("Potential Name", String(256), nullable=True)
    amount: Mapped[float | None] = mapped_column("Amount", nullable=True)
    stage: Mapped[str | None] = mapped_column("Stage", String(64), nullable=True)
    probability: Mapped[float | None] = mapped_column("Probability (%)", nullable=True)
    closing_date: Mapped[datetime | None] = mapped_column("Closing Date", DateTime, nullable=True)
    account_id: Mapped[str | None] = mapped_column("Account Id", String(32), nullable=True)
    contact_id: Mapped[str | None] = mapped_column("Contact Id", String(32), nullable=True)
    service: Mapped[str | None] = mapped_column("Service", String(64), nullable=True)
    sub_service: Mapped[str | None] = mapped_column("Sub Service", String(64), nullable=True)
    lead_source: Mapped[str | None] = mapped_column("Lead Source", String(32), nullable=True)
    next_step: Mapped[str | None] = mapped_column("Next Step", String(64), nullable=True)
    deal_size: Mapped[str | None] = mapped_column("Deal Size", String(32), nullable=True)
    description: Mapped[str | None] = mapped_column("Description", Text, nullable=True)
    type: Mapped[str | None] = mapped_column("Type", String(32), nullable=True)
    created_time: Mapped[datetime | None] = mapped_column("Created Time", DateTime, nullable=True)
    modified_time: Mapped[datetime | None] = mapped_column("Modified Time", DateTime, nullable=True)


# ═════════════════════════════════════════════════════════════════════════════
# READ-WRITE — CX_ extension tables
# ═════════════════════════════════════════════════════════════════════════════


class CXUserToken(Base):
    """Microsoft OAuth tokens per user."""

    __tablename__ = "CX_UserTokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column("UserId", String(32), nullable=False)
    provider: Mapped[str] = mapped_column("Provider", String(32), nullable=False, default="microsoft")
    access_token: Mapped[str | None] = mapped_column("AccessToken", UnicodeText, nullable=True)
    refresh_token: Mapped[str | None] = mapped_column("RefreshToken", UnicodeText, nullable=True)
    ms_email: Mapped[str | None] = mapped_column("MSEmail", Unicode(256), nullable=True)
    token_expiry: Mapped[datetime | None] = mapped_column("TokenExpiry", DateTime, nullable=True)
    calendar_sync_cursor: Mapped[str | None] = mapped_column("CalendarSyncCursor", String(256), nullable=True)
    created_time: Mapped[datetime] = mapped_column("CreatedTime", DateTime, nullable=False)
    updated_time: Mapped[datetime] = mapped_column("UpdatedTime", DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False, default=True)


class CXOTPCode(Base):
    """OTP codes for email-based login."""

    __tablename__ = "CX_OTPCodes"

    id: Mapped[int] = mapped_column("Id", Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column("UserId", String(32), nullable=False)
    code: Mapped[str] = mapped_column("Code", String(8), nullable=False)
    expires_at: Mapped[datetime] = mapped_column("ExpiresAt", DateTime, nullable=False)
    is_used: Mapped[bool] = mapped_column("IsUsed", Boolean, nullable=False, default=False)
    created_time: Mapped[datetime] = mapped_column("CreatedTime", DateTime, nullable=False)
    updated_time: Mapped[datetime] = mapped_column("UpdatedTime", DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False, default=True)


class CXQueueItem(Base):
    """Daily action queue items linked to Potentials."""

    __tablename__ = "CX_QueueItems"

    id: Mapped[int] = mapped_column("Id", Integer, primary_key=True, autoincrement=True)
    potential_id: Mapped[str] = mapped_column("PotentialId", String(32), nullable=False)
    contact_id: Mapped[str | None] = mapped_column("ContactId", String(32), nullable=True)
    account_id: Mapped[str | None] = mapped_column("AccountId", String(32), nullable=True)
    folder_type: Mapped[str] = mapped_column("FolderType", String(32), nullable=False)
    title: Mapped[str] = mapped_column("Title", Unicode(256), nullable=False)
    subtitle: Mapped[str | None] = mapped_column("Subtitle", Unicode(256), nullable=True)
    preview: Mapped[str | None] = mapped_column("Preview", UnicodeText, nullable=True)
    time_label: Mapped[str | None] = mapped_column("TimeLabel", String(32), nullable=True)
    priority: Mapped[str | None] = mapped_column("Priority", String(16), nullable=True)
    status: Mapped[str] = mapped_column("Status", String(16), nullable=False, default="pending")
    assigned_to_user_id: Mapped[str | None] = mapped_column("AssignedToUserId", String(32), nullable=True)
    created_time: Mapped[datetime] = mapped_column("CreatedTime", DateTime, nullable=False)
    updated_time: Mapped[datetime] = mapped_column("UpdatedTime", DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False, default=True)


class CXAgentInsight(Base):
    """Cached AI agent results per Potential."""

    __tablename__ = "CX_AgentInsights"

    id: Mapped[int] = mapped_column("Id", Integer, primary_key=True, autoincrement=True)
    potential_id: Mapped[str] = mapped_column("PotentialId", String(32), nullable=False)
    agent_type: Mapped[str] = mapped_column("AgentType", String(64), nullable=False)
    content: Mapped[str | None] = mapped_column("Content", UnicodeText, nullable=True)
    status: Mapped[str] = mapped_column("Status", String(16), nullable=False, default="pending")
    requested_time: Mapped[datetime | None] = mapped_column("RequestedTime", DateTime, nullable=True)
    completed_time: Mapped[datetime | None] = mapped_column("CompletedTime", DateTime, nullable=True)
    created_time: Mapped[datetime] = mapped_column("CreatedTime", DateTime, nullable=False)
    updated_time: Mapped[datetime] = mapped_column("UpdatedTime", DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False, default=True)


class CXEmailDraft(Base):
    """AI-generated email drafts."""

    __tablename__ = "CX_EmailDrafts"

    id: Mapped[int] = mapped_column("Id", Integer, primary_key=True, autoincrement=True)
    potential_id: Mapped[str] = mapped_column("PotentialId", String(32), nullable=False)
    queue_item_id: Mapped[int | None] = mapped_column("QueueItemId", Integer, nullable=True)
    to_email: Mapped[str | None] = mapped_column("ToEmail", String(256), nullable=True)
    subject: Mapped[str | None] = mapped_column("Subject", Unicode(512), nullable=True)
    body: Mapped[str | None] = mapped_column("Body", UnicodeText, nullable=True)
    status: Mapped[str] = mapped_column("Status", String(16), nullable=False, default="draft")
    created_by_user_id: Mapped[str | None] = mapped_column("CreatedByUserId", String(32), nullable=True)
    created_time: Mapped[datetime] = mapped_column("CreatedTime", DateTime, nullable=False)
    updated_time: Mapped[datetime] = mapped_column("UpdatedTime", DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False, default=True)


class CXSentEmail(Base):
    """Emails sent from Salezilla via MS Graph."""

    __tablename__ = "CX_SentEmails"

    id: Mapped[int] = mapped_column("Id", Integer, primary_key=True, autoincrement=True)
    potential_id: Mapped[str] = mapped_column("PotentialId", String(32), nullable=False)
    contact_id: Mapped[str | None] = mapped_column("ContactId", String(32), nullable=True)
    account_id: Mapped[str | None] = mapped_column("AccountId", String(32), nullable=True)
    draft_id: Mapped[int | None] = mapped_column("DraftId", Integer, nullable=True)
    from_email: Mapped[str] = mapped_column("FromEmail", String(256), nullable=False)
    from_name: Mapped[str | None] = mapped_column("FromName", Unicode(128), nullable=True)
    to_email: Mapped[str] = mapped_column("ToEmail", String(256), nullable=False)
    to_name: Mapped[str | None] = mapped_column("ToName", Unicode(128), nullable=True)
    subject: Mapped[str] = mapped_column("Subject", Unicode(512), nullable=False)
    body: Mapped[str] = mapped_column("Body", UnicodeText, nullable=False)
    thread_id: Mapped[str | None] = mapped_column("ThreadId", String(64), nullable=True)
    sent_by_user_id: Mapped[str | None] = mapped_column("SentByUserId", String(32), nullable=True)
    sent_time: Mapped[datetime] = mapped_column("SentTime", DateTime, nullable=False)
    created_time: Mapped[datetime] = mapped_column("CreatedTime", DateTime, nullable=False)
    updated_time: Mapped[datetime] = mapped_column("UpdatedTime", DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False, default=True)


class CXNote(Base):
    """Free-text notes on Potentials."""

    __tablename__ = "CX_Notes"

    id: Mapped[int] = mapped_column("Id", Integer, primary_key=True, autoincrement=True)
    potential_id: Mapped[str] = mapped_column("PotentialId", String(32), nullable=False)
    content: Mapped[str] = mapped_column("Content", UnicodeText, nullable=False)
    created_by_user_id: Mapped[str | None] = mapped_column("CreatedByUserId", String(32), nullable=True)
    created_time: Mapped[datetime] = mapped_column("CreatedTime", DateTime, nullable=False)
    updated_time: Mapped[datetime] = mapped_column("UpdatedTime", DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False, default=True)


class CXTodo(Base):
    """Action items per Potential."""

    __tablename__ = "CX_Todos"

    id: Mapped[int] = mapped_column("Id", Integer, primary_key=True, autoincrement=True)
    potential_id: Mapped[str] = mapped_column("PotentialId", String(32), nullable=False)
    text: Mapped[str] = mapped_column("Text", Unicode(512), nullable=False)
    status: Mapped[str] = mapped_column("Status", String(20), nullable=False, default="pending")
    is_completed: Mapped[bool] = mapped_column("IsCompleted", Boolean, nullable=False, default=False)
    created_by_user_id: Mapped[str | None] = mapped_column("CreatedByUserId", String(32), nullable=True)
    created_time: Mapped[datetime] = mapped_column("CreatedTime", DateTime, nullable=False)
    updated_time: Mapped[datetime] = mapped_column("UpdatedTime", DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False, default=True)


class CXFile(Base):
    """File attachments on Potentials."""

    __tablename__ = "CX_Files"

    id: Mapped[int] = mapped_column("Id", Integer, primary_key=True, autoincrement=True)
    potential_id: Mapped[str] = mapped_column("PotentialId", String(32), nullable=False)
    file_name: Mapped[str] = mapped_column("FileName", Unicode(256), nullable=False)
    mime_type: Mapped[str | None] = mapped_column("MimeType", String(128), nullable=True)
    file_size: Mapped[int | None] = mapped_column("FileSize", Integer, nullable=True)
    storage_path: Mapped[str] = mapped_column("StoragePath", Unicode(512), nullable=False)
    uploaded_by_user_id: Mapped[str | None] = mapped_column("UploadedByUserId", String(32), nullable=True)
    created_time: Mapped[datetime] = mapped_column("CreatedTime", DateTime, nullable=False)
    updated_time: Mapped[datetime] = mapped_column("UpdatedTime", DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False, default=True)


class CXCallLog(Base):
    """Phone call records."""

    __tablename__ = "CX_CallLogs"

    id: Mapped[int] = mapped_column("Id", Integer, primary_key=True, autoincrement=True)
    potential_id: Mapped[str] = mapped_column("PotentialId", String(32), nullable=False)
    contact_id: Mapped[str | None] = mapped_column("ContactId", String(32), nullable=True)
    account_id: Mapped[str | None] = mapped_column("AccountId", String(32), nullable=True)
    phone_number: Mapped[str | None] = mapped_column("PhoneNumber", String(32), nullable=True)
    contact_name: Mapped[str | None] = mapped_column("ContactName", Unicode(128), nullable=True)
    duration: Mapped[int] = mapped_column("Duration", Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column("Status", String(16), nullable=False, default="completed")
    notes: Mapped[str | None] = mapped_column("Notes", UnicodeText, nullable=True)
    called_by_user_id: Mapped[str | None] = mapped_column("CalledByUserId", String(32), nullable=True)
    created_time: Mapped[datetime] = mapped_column("CreatedTime", DateTime, nullable=False)
    updated_time: Mapped[datetime] = mapped_column("UpdatedTime", DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False, default=True)


class CXActivity(Base):
    """Timeline / audit log."""

    __tablename__ = "CX_Activities"

    id: Mapped[int] = mapped_column("Id", Integer, primary_key=True, autoincrement=True)
    potential_id: Mapped[str] = mapped_column("PotentialId", String(32), nullable=False)
    contact_id: Mapped[str | None] = mapped_column("ContactId", String(32), nullable=True)
    account_id: Mapped[str | None] = mapped_column("AccountId", String(32), nullable=True)
    activity_type: Mapped[str] = mapped_column("ActivityType", String(32), nullable=False)
    description: Mapped[str | None] = mapped_column("Description", UnicodeText, nullable=True)
    performed_by_user_id: Mapped[str | None] = mapped_column("PerformedByUserId", String(32), nullable=True)
    created_time: Mapped[datetime] = mapped_column("CreatedTime", DateTime, nullable=False)
    updated_time: Mapped[datetime] = mapped_column("UpdatedTime", DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False, default=True)


class CXChatMessage(Base):
    """AI chat conversation history."""

    __tablename__ = "CX_ChatMessages"

    id: Mapped[int] = mapped_column("Id", Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column("UserId", String(32), nullable=False)
    role: Mapped[str] = mapped_column("Role", String(16), nullable=False)
    content: Mapped[str] = mapped_column("Content", UnicodeText, nullable=False)
    created_time: Mapped[datetime] = mapped_column("CreatedTime", DateTime, nullable=False)
    updated_time: Mapped[datetime] = mapped_column("UpdatedTime", DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False, default=True)


class CXMeeting(Base):
    """Meetings synced from MS Calendar."""

    __tablename__ = "CX_Meetings"

    id: Mapped[int] = mapped_column("Id", Integer, primary_key=True, autoincrement=True)
    ms_event_id: Mapped[str] = mapped_column("MSEventId", String(256), nullable=False)
    potential_id: Mapped[str | None] = mapped_column("PotentialId", String(32), nullable=True)
    contact_id: Mapped[str | None] = mapped_column("ContactId", String(32), nullable=True)
    account_id: Mapped[str | None] = mapped_column("AccountId", String(32), nullable=True)
    title: Mapped[str] = mapped_column("Title", Unicode(256), nullable=False)
    start_time: Mapped[datetime] = mapped_column("StartTime", DateTime, nullable=False)
    end_time: Mapped[datetime | None] = mapped_column("EndTime", DateTime, nullable=True)
    location: Mapped[str | None] = mapped_column("Location", Unicode(256), nullable=True)
    description: Mapped[str | None] = mapped_column("Description", UnicodeText, nullable=True)
    meeting_type: Mapped[str | None] = mapped_column("MeetingType", String(32), nullable=True)
    attendees: Mapped[str | None] = mapped_column("Attendees", UnicodeText, nullable=True)
    user_id: Mapped[str] = mapped_column("UserId", String(32), nullable=False)
    created_time: Mapped[datetime] = mapped_column("CreatedTime", DateTime, nullable=False)
    updated_time: Mapped[datetime] = mapped_column("UpdatedTime", DateTime, nullable=False)
    is_active: Mapped[bool] = mapped_column("IsActive", Boolean, nullable=False, default=True)
