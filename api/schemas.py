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
