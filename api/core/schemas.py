"""Pydantic request/response models."""

from datetime import datetime
from typing import Generic, Optional, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ResponseModel(BaseModel, Generic[T]):
    """Standard API response envelope."""

    status: str = "OK"
    message_code: Optional[str] = None
    message: Optional[str] = None
    data: Optional[T] = None


class LoginTokens(BaseModel):
    access_token: str
    refresh_token: str


class AccessTokenResponse(BaseModel):
    access_token: str


class UserInfo(BaseModel):
    id: str
    email: str
    name: str
    role: Optional[str] = None
    is_active: bool = True
    is_ms_connected: bool = False
    ms_email: Optional[str] = None


class MicrosoftConnectResponse(BaseModel):
    ms_email: str
    message: str = "Microsoft account connected successfully."


# ═════════════════════════════════════════════════════════════════════════════
# Potentials
# ═════════════════════════════════════════════════════════════════════════════


class CompanySummary(BaseModel):
    id: str
    name: Optional[str] = None
    industry: Optional[str] = None


class ContactSummary(BaseModel):
    id: str
    name: Optional[str] = None
    title: Optional[str] = None
    email: Optional[str] = None


class PotentialItem(BaseModel):
    id: str
    potential_number: Optional[str] = None
    category: Optional[str] = None  # "Diamond" | "Platinum" | "Other"
    title: Optional[str] = None
    value: Optional[float] = None
    stage: Optional[str] = None
    probability: Optional[float] = None
    service: Optional[str] = None
    sub_service: Optional[str] = None
    owner_name: Optional[str] = None
    closing_date: Optional[datetime] = None
    lead_source: Optional[str] = None
    deal_size: Optional[str] = None
    deal_type: Optional[str] = None
    created_time: Optional[datetime] = None
    company: Optional[CompanySummary] = None
    contact: Optional[ContactSummary] = None


class UpdatePotentialRequest(BaseModel):
    title: Optional[str] = None
    stage: Optional[str] = None
    amount: Optional[float] = None
    probability: Optional[float] = None
    closing_date: Optional[str] = None   # ISO date string YYYY-MM-DD
    next_step: Optional[str] = None
    description: Optional[str] = None
    service: Optional[str] = None
    sub_service: Optional[str] = None
    lead_source: Optional[str] = None
    deal_type: Optional[str] = None
    deal_size: Optional[str] = None


class CreatePotentialCompany(BaseModel):
    name: str
    industry: Optional[str] = None
    website: Optional[str] = None
    country: Optional[str] = None


class CreatePotentialContact(BaseModel):
    name: str
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class ContactSearchItem(BaseModel):
    id: str
    name: str
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    account_id: Optional[str] = None
    account_name: Optional[str] = None


class CreatePotentialRequest(BaseModel):
    # Account — provide either existing account_id OR new company object
    account_id: Optional[str] = None
    company: Optional[CreatePotentialCompany] = None

    # Contact — provide either existing contact_id OR new contact object
    contact_id: Optional[str] = None
    contact: Optional[CreatePotentialContact] = None

    potential_name: str
    amount: float
    stage: str = "Pre Qualified"
    probability: Optional[float] = None
    service: Optional[str] = None
    sub_service: Optional[str] = None
    lead_source: Optional[str] = None
    closing_date: Optional[str] = None   # YYYY-MM-DD
    next_step: Optional[str] = None
    description: Optional[str] = None
    deal_type: Optional[str] = None
    deal_size: Optional[str] = None


class PotentialFilterOptions(BaseModel):
    owners: list[str] = []
    services: list[str] = []
    stages: list[str] = []


class PotentialListResponse(BaseModel):
    potentials: list[PotentialItem] = []
    total: int = 0
    filter_options: PotentialFilterOptions = PotentialFilterOptions()


class PotentialDetailResponse(BaseModel):
    potential: PotentialItem
    company: Optional[CompanySummary] = None
    contact: Optional[ContactSummary] = None
    contact_phone: Optional[str] = None
    contact_mobile: Optional[str] = None
    company_website: Optional[str] = None
    company_location: Optional[str] = None
    company_employees: Optional[int] = None
    company_revenue: Optional[float] = None
    company_description: Optional[str] = None
    next_step: Optional[str] = None
    description: Optional[str] = None


# ═════════════════════════════════════════════════════════════════════════════
# Accounts
# ═════════════════════════════════════════════════════════════════════════════


class AccountItem(BaseModel):
    id: str
    name: Optional[str] = None
    industry: Optional[str] = None
    location: Optional[str] = None
    website: Optional[str] = None
    country: Optional[str] = None
    deal_count: int = 0
    contact_count: int = 0
    total_value: float = 0.0
    top_stage: Optional[str] = None


class AccountFilterOptions(BaseModel):
    industries: list[str] = []


class AccountListResponse(BaseModel):
    accounts: list[AccountItem] = []
    total: int = 0
    filter_options: AccountFilterOptions = AccountFilterOptions()


class AccountDetailContact(BaseModel):
    id: str
    name: Optional[str] = None
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    mobile: Optional[str] = None
    department: Optional[str] = None


class AccountDetailPotential(BaseModel):
    id: str
    title: Optional[str] = None
    value: Optional[float] = None
    stage: Optional[str] = None
    probability: Optional[float] = None
    service: Optional[str] = None
    owner_name: Optional[str] = None
    contact: Optional[ContactSummary] = None


class AccountDetailResponse(BaseModel):
    id: str
    name: Optional[str] = None
    industry: Optional[str] = None
    website: Optional[str] = None
    location: Optional[str] = None
    billing_city: Optional[str] = None
    billing_state: Optional[str] = None
    billing_country: Optional[str] = None
    employees: Optional[int] = None
    revenue: Optional[float] = None
    description: Optional[str] = None
    contacts: list[AccountDetailContact] = []
    potentials: list[AccountDetailPotential] = []
    activities: list["ActivityItem"] = []


class UpdateAccountRequest(BaseModel):
    industry: Optional[str] = None
    website: Optional[str] = None
    employees: Optional[int] = None
    revenue: Optional[float] = None
    description: Optional[str] = None
    billing_city: Optional[str] = None
    billing_state: Optional[str] = None
    billing_country: Optional[str] = None


class UpdateContactRequest(BaseModel):
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    mobile: Optional[str] = None
    department: Optional[str] = None


# ═════════════════════════════════════════════════════════════════════════════
# Queue / Folders
# ═════════════════════════════════════════════════════════════════════════════


class FolderItem(BaseModel):
    id: str
    label: str
    icon: str
    count: int = 0


class QueueItemResponse(BaseModel):
    id: int
    potential_id: str
    contact_id: Optional[str] = None
    account_id: Optional[str] = None
    folder_type: str
    title: str
    subtitle: Optional[str] = None
    preview: Optional[str] = None
    time_label: Optional[str] = None
    priority: Optional[str] = None
    status: str = "pending"
    created_time: Optional[datetime] = None


# ═════════════════════════════════════════════════════════════════════════════
# Notes, Todos, Files
# ═════════════════════════════════════════════════════════════════════════════


class NoteItem(BaseModel):
    id: int
    potential_id: str
    content: str
    created_by_user_id: Optional[str] = None
    created_time: Optional[datetime] = None


class CreateNoteRequest(BaseModel):
    content: str


class UpdateNoteRequest(BaseModel):
    content: str


TODO_STATUSES = ("pending", "in_progress", "on_hold", "done")


class TodoItem(BaseModel):
    id: int
    potential_id: str
    text: str
    status: str = "pending"
    is_completed: bool = False
    created_by_user_id: Optional[str] = None
    created_time: Optional[datetime] = None


class CreateTodoRequest(BaseModel):
    text: str


class UpdateTodoRequest(BaseModel):
    status: str


class FileItem(BaseModel):
    id: int
    potential_id: str
    file_name: str
    mime_type: Optional[str] = None
    file_size: Optional[int] = None
    created_time: Optional[datetime] = None
    download_url: Optional[str] = None  # GCS signed URL, short-lived


# ═════════════════════════════════════════════════════════════════════════════
# Calls, Activities
# ═════════════════════════════════════════════════════════════════════════════


class CallLogItem(BaseModel):
    id: int
    potential_id: str
    contact_name: Optional[str] = None
    phone_number: Optional[str] = None
    duration: int = 0
    status: str = "completed"
    notes: Optional[str] = None
    created_time: Optional[datetime] = None


class CreateCallLogRequest(BaseModel):
    phone_number: Optional[str] = None
    contact_name: Optional[str] = None
    duration: int = 0
    status: str = "completed"
    notes: Optional[str] = None
    contact_id: Optional[str] = None
    account_id: Optional[str] = None


class ActivityItem(BaseModel):
    id: int
    potential_id: str
    activity_type: str
    description: Optional[str] = None
    performed_by_user_id: Optional[str] = None
    performed_by_name: Optional[str] = None
    created_time: Optional[datetime] = None


# ═════════════════════════════════════════════════════════════════════════════
# Agent Insights
# ═════════════════════════════════════════════════════════════════════════════


class AgentResultItem(BaseModel):
    id: int
    potential_id: str
    agent_id: str
    agent_name: str
    tab_type: str
    content_type: str
    content: Optional[str] = None
    status: str = "pending"
    sort_order: int = 0
    triggered_by: Optional[str] = None
    triggered_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None


# Keep old name as alias for any existing references
AgentInsightItem = AgentResultItem


class AgentWebhookPayload(BaseModel):
    event: str
    agent_id: str
    agent_name: str
    execution_id: str
    entity_id: str
    external_id: str  # Salezilla potential_id
    run_id: str
    execution_time_ms: Optional[int] = None
    status: str  # "completed" | "failed"
    content: Optional[str] = None  # agent result content, delivered inline
    content_type: Optional[str] = None  # "markdown" | "html" — overrides config default if provided


# Keep old name as alias
AgentWebhookRequest = AgentWebhookPayload


# ═════════════════════════════════════════════════════════════════════════════
# Emails
# ═════════════════════════════════════════════════════════════════════════════


class EmailDraftResponse(BaseModel):
    id: Optional[int] = None
    potential_id: str
    to_email: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    status: str = "draft"


class AttachmentItem(BaseModel):
    name: str
    content_type: str
    content_bytes: str  # base64-encoded


class SendEmailRequest(BaseModel):
    to_email: str
    to_name: Optional[str] = None
    subject: str
    body: str
    cc: Optional[list[str]] = None
    bcc: Optional[list[str]] = None
    thread_id: Optional[str] = None
    reply_to_message_id: Optional[str] = None
    draft_id: Optional[int] = None
    attachments: Optional[list[AttachmentItem]] = None


class SentEmailResponse(BaseModel):
    id: int
    to_email: str
    subject: str
    sent_time: Optional[datetime] = None
    thread_id: Optional[str] = None


class UserEmailDraftItem(BaseModel):
    id: int
    potential_id: str
    to_email: Optional[str] = None
    to_name: Optional[str] = None
    cc_emails: Optional[list[str]] = None
    bcc_emails: Optional[list[str]] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    reply_to_thread_id: Optional[str] = None
    reply_to_message_id: Optional[str] = None
    status: str = "draft"
    created_time: Optional[datetime] = None
    updated_time: Optional[datetime] = None


class CreateDraftRequest(BaseModel):
    to_email: Optional[str] = None
    to_name: Optional[str] = None
    cc_emails: Optional[list[str]] = None
    bcc_emails: Optional[list[str]] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    reply_to_thread_id: Optional[str] = None
    reply_to_message_id: Optional[str] = None


class UpdateDraftRequest(BaseModel):
    to_email: Optional[str] = None
    to_name: Optional[str] = None
    cc_emails: Optional[list[str]] = None
    bcc_emails: Optional[list[str]] = None
    subject: Optional[str] = None
    body: Optional[str] = None


class SignatureRequest(BaseModel):
    signature: Optional[str] = None


# ═════════════════════════════════════════════════════════════════════════════
# Sales Targets
# ═════════════════════════════════════════════════════════════════════════════


class SalesTopDeal(BaseModel):
    potential_number: Optional[str] = None
    potential_name: Optional[str] = None
    amount: float
    invoice_date: Optional[str] = None


class SalesTargetSummary(BaseModel):
    quarter_label: str           # e.g. "Q1 2025"
    actuals: float
    target: float
    pct_of_target: float         # actuals / target * 100
    prev_quarter_label: str
    prev_actuals: float
    prev_target: float
    prev_pct_of_target: float
    pct_change: float            # (actuals - prev_actuals) / prev_actuals * 100, None if no prev data
    top_closed: list[SalesTopDeal] = []


# ═════════════════════════════════════════════════════════════════════════════
# Chat
# ═════════════════════════════════════════════════════════════════════════════


class ChatMessageItem(BaseModel):
    id: int
    role: str
    content: str
    created_time: Optional[datetime] = None


class SendChatRequest(BaseModel):
    message: str


# ═════════════════════════════════════════════════════════════════════════════
# Calendar
# ═════════════════════════════════════════════════════════════════════════════


class CalendarAttendeeResponse(BaseModel):
    email: str
    name: Optional[str] = None
    type: str = "required"  # "required" | "optional"


class CalendarEventResponse(BaseModel):
    id: str
    subject: str
    body_preview: Optional[str] = None
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    is_all_day: bool = False
    is_cancelled: bool = False
    show_as: str = "busy"
    organizer_email: Optional[str] = None
    organizer_name: Optional[str] = None
    location: Optional[str] = None
    is_online_meeting: bool = False
    online_meeting_url: Optional[str] = None
    is_recurring: bool = False
    attendees: list[CalendarAttendeeResponse] = []


class CreateCalendarEventRequest(BaseModel):
    subject: str
    start: datetime
    end: datetime
    timezone: str = "UTC"
    location: Optional[str] = None
    body: Optional[str] = None
    is_online_meeting: bool = False
    required_attendees: list[str] = []
    optional_attendees: list[str] = []


class UpdateCalendarEventRequest(BaseModel):
    subject: Optional[str] = None
    start: Optional[datetime] = None
    end: Optional[datetime] = None
    timezone: str = "UTC"
    location: Optional[str] = None
    body: Optional[str] = None
    is_online_meeting: Optional[bool] = None
    required_attendees: Optional[list[str]] = None
    optional_attendees: Optional[list[str]] = None


class PersonResult(BaseModel):
    name: str
    email: str
    job_title: Optional[str] = None
