"""Pydantic request/response schemas."""

from datetime import datetime
from typing import Any
from pydantic import BaseModel


# ── Auth ──────────────────────────────────────────────────────────────────────

class CoachCreate(BaseModel):
    name: str
    email: str
    password: str
    weight: int = 45
    level: str = "hs_elite_aau"
    role: str = "coach"
    program_name: str = "SEED Academy"


class CoachLogin(BaseModel):
    email: str
    password: str


class CoachOut(BaseModel):
    id: int
    name: str
    email: str
    weight: int
    level: str
    role: str
    program_name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    coach: CoachOut


# ── Players ───────────────────────────────────────────────────────────────────

class PlayerCreate(BaseModel):
    name: str
    position: str | None = None
    age: int | None = None
    height: str | None = None
    program_name: str | None = None
    competition_level: str = "HS Varsity"
    notes: str | None = None
    team_id: int | None = None


class PlayerOut(BaseModel):
    id: int
    name: str
    position: str | None
    age: int | None
    height: str | None
    program_name: str
    competition_level: str
    notes: str | None
    created_at: datetime
    latest_grade: float | None = None
    team_id: int | None = None
    team_name: str | None = None

    model_config = {"from_attributes": True}


class TeamCreate(BaseModel):
    name: str
    competition_level: str = "HS Varsity"


class TeamOut(BaseModel):
    id: int
    name: str
    coach_id: int
    competition_level: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Evaluations ───────────────────────────────────────────────────────────────

class EvalSubmit(BaseModel):
    player_id: int
    output_type: str
    competition_level: str = "HS Varsity"
    coach_notes: str | None = None
    focus_prompt: str | None = None
    interval_seconds: float = 5.0
    max_frames: int = 10
    include_audio: bool = False
    whisper_model: str = "base"


class EvalOut(BaseModel):
    id: int
    player_id: int
    coach_id: int
    output_type: str
    competition_level: str | None
    coach_weight: int | None
    coach_notes: str | None
    report_text: str | None
    overall_grade: float | None
    pillar_grades: dict[str, Any] | None
    key_questions: list[str] | None
    green_flags: list[str] | None
    watch_flags: list[str] | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Corrections ───────────────────────────────────────────────────────────────

class CorrectionCreate(BaseModel):
    pillar: str | None = None
    original_text: str | None = None
    correction: str


class CorrectionOut(BaseModel):
    id: int
    evaluation_id: int
    coach_id: int
    pillar: str | None
    original_text: str | None
    correction: str
    coach_weight: int | None
    applied: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Training ──────────────────────────────────────────────────────────────────

class TrainingRequest(BaseModel):
    player_id: int
    evaluation_id: int | None = None
    focus_prompt: str | None = None


class TrainingOut(BaseModel):
    id: int
    player_id: int
    coach_id: int
    evaluation_id: int | None
    program_text: str | None
    priorities: list[str] | None
    created_at: datetime

    model_config = {"from_attributes": True}


class EvalWithPlayerOut(EvalOut):
    player_name: str = ""


class SummaryRequest(BaseModel):
    output_type: str = "player_eval"
    focus_prompt: str | None = None


class SummaryOut(BaseModel):
    report_text: str


class TeamReportRequest(BaseModel):
    output_type: str = "coaching_report"
    focus_prompt: str | None = None


# ── Player auth ───────────────────────────────────────────────────────────────

class PlayerUserCreate(BaseModel):
    name: str
    email: str
    password: str


class PlayerUserOut(BaseModel):
    id: int
    name: str
    email: str
    player_id: int | None
    linked_player_name: str | None = None
    linked_team_name: str | None = None
    linked_program_name: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


class PlayerToken(BaseModel):
    access_token: str
    token_type: str = "bearer"
    player_user: PlayerUserOut


# ── Invite ────────────────────────────────────────────────────────────────────

class InviteCodeOut(BaseModel):
    code: str
    player_name: str


# ── Link request ──────────────────────────────────────────────────────────────

class LinkRequestOut(BaseModel):
    id: int
    player_user_id: int
    player_id: int
    status: str
    player_user_name: str = ""
    player_name: str = ""
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Shared report ─────────────────────────────────────────────────────────────

class ShareReportRequest(BaseModel):
    player_user_id: int
    share_report_text: bool = True
    share_grades: bool = False
    share_flags: bool = False
    share_questions: bool = False
    message: str | None = None


class SharedReportOut(BaseModel):
    id: int
    evaluation_id: int
    player_user_id: int
    shared_by_id: int
    share_report_text: bool
    share_grades: bool
    share_flags: bool
    share_questions: bool
    message: str | None
    created_at: datetime
    output_type: str = ""
    report_text: str | None = None
    overall_grade: float | None = None
    pillar_grades: dict | None = None
    green_flags: list[str] | None = None
    watch_flags: list[str] | None = None
    key_questions: list[str] | None = None
    shared_by_name: str = ""
    model_config = {"from_attributes": True}


# ── Player training ───────────────────────────────────────────────────────────

class PlayerTrainingOut(BaseModel):
    id: int
    player_user_id: int
    shared_report_id: int
    program_text: str | None
    coach_notes: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class PlayerTrainingUpdate(BaseModel):
    coach_notes: str


# ── Comments ──────────────────────────────────────────────────────────────────

class PlayerCommentCreate(BaseModel):
    text: str


class PlayerCommentOut(BaseModel):
    id: int
    player_user_id: int | None
    coach_id: int | None
    text: str
    created_at: datetime
    author_name: str = ""
    model_config = {"from_attributes": True}


# ── Notifications ─────────────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id: int
    type: str
    title: str
    body: str
    read: bool
    ref_id: int | None
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Team shared report ────────────────────────────────────────────────────────

class TeamShareRequest(BaseModel):
    output_type: str
    report_text: str
    target_type: str  # "player", "team", "all_staff"
    player_user_id: int | None = None
    team_id: int | None = None
    message: str | None = None
    staff_coach_id: int | None = None  # for targeting a specific staff member

class TeamSharedReportOut(BaseModel):
    id: int
    player_user_id: int
    shared_by_id: int
    output_type: str
    report_text: str | None
    message: str | None
    created_at: datetime
    shared_by_name: str = ""
    model_config = {"from_attributes": True}


# ── Team report ────────────────────────────────────────────────────────────────

class TeamReportOut(BaseModel):
    id: int
    coach_id: int
    output_type: str
    focus_prompt: str | None
    report_text: str | None
    created_at: datetime
    model_config = {"from_attributes": True}
