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
    conference: str | None = None
    competition_level: str | None = None
    country: str | None = None
    city: str | None = None


class CoachLogin(BaseModel):
    email: str
    password: str


class CoachGoogleAuth(BaseModel):
    id_token: str
    mode: str = "login"   # "login" (existing only) or "register" (create with fields)
    # Required-profile fields collected during Google signup (ignored on login):
    role: str = "coach"
    program_name: str | None = None
    competition_level: str | None = None
    conference: str | None = None
    country: str | None = None
    city: str | None = None


class CoachUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    role: str | None = None
    program_name: str | None = None
    competition_level: str | None = None
    conference: str | None = None
    system_profile: dict | None = None
    country: str | None = None
    city: str | None = None
    onboarded: bool | None = None


class CoachOut(BaseModel):
    id: int
    name: str
    email: str
    weight: int
    level: str
    role: str
    program_name: str
    conference: str | None = None
    competition_level: str | None = None
    country: str | None = None
    city: str | None = None
    system_profile: dict | None = None
    philosophy_reference: str | None = None
    onboarded: bool | None = None
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
    jersey_number: str | None = None
    age: int | None = None
    height: str | None = None
    wingspan: str | None = None
    weight: str | None = None
    standing_reach: str | None = None
    country: str | None = None
    state: str | None = None
    city: str | None = None
    school_name: str | None = None
    program_name: str | None = None
    competition_level: str | None = None
    notes: str | None = None
    parent_permission: bool | None = None
    team_id: int | None = None


class PlayerOut(BaseModel):
    id: int
    name: str
    position: str | None
    jersey_number: str | None = None
    age: int | None
    height: str | None
    wingspan: str | None = None
    weight: str | None = None
    standing_reach: str | None = None
    country: str | None = None
    state: str | None = None
    city: str | None = None
    school_name: str | None = None
    program_name: str
    competition_level: str
    notes: str | None
    parent_permission: bool | None = None
    created_at: datetime
    latest_grade: float | None = None
    bim_grade: float | None = None            # recency-weighted composite overall
    bim_pillars: dict | None = None           # recency-weighted composite per pillar
    bim_report_count: int = 0                 # how many evals feed the composite
    team_id: int | None = None
    team_name: str | None = None

    model_config = {"from_attributes": True}


class TeamCreate(BaseModel):
    name: str
    competition_level: str = "HS Varsity"


class TeamUpdate(BaseModel):
    name: str | None = None
    competition_level: str | None = None


class TeamOut(BaseModel):
    id: int
    name: str
    coach_id: int
    competition_level: str
    parent_team_id: int | None = None
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
    title: str | None = None
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
    player_name: str | None = None
    sent_to_player: bool = False
    reformatting: bool = False
    player_program_text: str | None = None

    model_config = {"from_attributes": True}


class EvalWithPlayerOut(EvalOut):
    player_name: str = ""


class SummaryRequest(BaseModel):
    output_type: str = "player_eval"
    focus_prompt: str | None = None
    game_ids: list[int] | None = None   # tracked games to pull box-score stats from


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
    country: str | None = None
    city: str | None = None


class PlayerUserOut(BaseModel):
    id: int
    name: str
    email: str
    player_id: int | None
    avatar: str | None = None
    country: str | None = None
    city: str | None = None
    linked_player_name: str | None = None
    linked_team_name: str | None = None
    linked_program_name: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


class PlayerUserUpdate(BaseModel):
    name: str | None = None
    avatar: str | None = None
    country: str | None = None
    city: str | None = None


class PlayerGoogleAuth(BaseModel):
    id_token: str
    mode: str = "login"   # "login" (existing only) or "register" (create)
    country: str | None = None
    city: str | None = None


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
    consent_override: bool = False


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
    completed_drills: list[str] | None = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class PlayerTrainingProgress(BaseModel):
    completed_drills: list[str]


class CoachTrainingRefresh(BaseModel):
    feedback: str


class PlayerLinkOut(BaseModel):
    player_id: int
    player_name: str
    program_name: str | None = None
    team_name: str | None = None
    coach_name: str | None = None
    is_primary: bool = False


class PlayerTrainingUpdate(BaseModel):
    coach_notes: str


# ── Comments ──────────────────────────────────────────────────────────────────

class PlayerCommentCreate(BaseModel):
    text: str
    parent_id: int | None = None


class PlayerCommentOut(BaseModel):
    id: int
    player_user_id: int | None
    coach_id: int | None
    parent_id: int | None = None
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
    # Consent flow: for an individual player's report, if the recipient is NOT
    # the subject, the subject must approve first.
    subject_player_id: int | None = None
    require_consent: bool = False
    consent_override: bool = False   # coach confirms sending when subject has no account


class ShareApprovalOut(BaseModel):
    id: int
    coach_name: str
    subject_player_name: str
    recipient_name: str
    output_type: str
    status: str
    created_at: datetime
    model_config = {"from_attributes": True}

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


# ── Game Reports ──────────────────────────────────────────────────────────────

class GameReportCreate(BaseModel):
    title: str | None = None
    mode: str = "vs_opponent"
    my_team_id: int | None = None
    opponent_team_id: int | None = None
    opponent_name: str | None = None
    output_type: str = "coaching_report"
    focus_prompt: str | None = None


class GameReportUpdate(BaseModel):
    title: str | None = None
    mode: str | None = None
    my_team_id: int | None = None
    opponent_team_id: int | None = None
    opponent_name: str | None = None
    opponent_a_name: str | None = None
    extra_teams: str | None = None
    output_type: str | None = None
    focus_prompt: str | None = None
    box_score: str | None = None
    scouting_notes: str | None = None


class GameReportClipOut(BaseModel):
    id: int
    game_report_id: int
    label: str
    analysis_text: str | None
    created_at: datetime
    model_config = {"from_attributes": True}


class GameReportOut(BaseModel):
    id: int
    coach_id: int
    title: str | None
    mode: str
    my_team_id: int | None
    opponent_team_id: int | None
    opponent_name: str | None
    opponent_a_name: str | None = None
    extra_teams: str | None = None
    output_type: str
    focus_prompt: str | None
    box_score: str | None
    scouting_notes: str | None
    report_text: str | None
    created_at: datetime
    updated_at: datetime
    clips: list[GameReportClipOut] = []
    my_team_name: str | None = None
    opponent_team_name: str | None = None
    model_config = {"from_attributes": True}


# ── Staff sharing ─────────────────────────────────────────────────────────────

class StaffShareRequest(BaseModel):
    report_type: str          # eval / game / team_training
    report_id: int
    recipient_id: int
    allow_regenerate: bool = False
    # Optional frozen, section-filtered snapshot. When provided (and
    # allow_regenerate is False) the recipient sees this exact text instead of
    # the live report.
    frozen_text: str | None = None


class StaffSharedReportOut(BaseModel):
    id: int
    report_type: str
    report_id: int
    sender_id: int
    recipient_id: int
    allow_regenerate: bool
    created_at: datetime
    sender_name: str = ""
    recipient_name: str = ""
    report_text: str | None = None  # resolved from actual report
    regenerated_text: str | None = None
    subject_name: str | None = None  # player name / matchup / "Team Report"
    output_type: str | None = None
    overall_grade: float | None = None
    updated_report_id: int | None = None  # recipient's own Updated copy, once made
    has_update: bool = False  # the recipient made an updated version (content hidden from the sharer until approved)
    comment_count: int = 0
    note_count: int = 0
    correction_count: int = 0

    model_config = {"from_attributes": True}


class StaffShareTargetOut(BaseModel):
    # kind: "coach" | "team" | "program"
    kind: str
    label: str                       # display name
    sublabel: str = ""               # role / member count / etc.
    coach_id: int | None = None      # when kind == "coach"
    team_id: int | None = None       # when kind == "team"
    program_name: str | None = None  # when kind == "program"
    member_count: int = 1            # how many coaches will receive it


class StaffGroupShareRequest(BaseModel):
    report_type: str
    report_id: int
    kind: str                        # "coach" | "team" | "program"
    coach_id: int | None = None
    team_id: int | None = None
    program_name: str | None = None
    allow_regenerate: bool = False
    frozen_text: str | None = None


class CoachNotificationOut(BaseModel):
    id: int
    coach_id: int
    title: str
    body: str
    read: bool
    ref_id: int | None
    type: str
    created_at: datetime

    model_config = {"from_attributes": True}


class StaffReportCommentCreate(BaseModel):
    text: str
    target: str = "original"  # "original" | "updated" — which version it's under


class StaffReportCommentOut(BaseModel):
    id: int
    shared_report_id: int
    author_id: int
    text: str
    created_at: datetime
    author_name: str = ""
    target: str = "original"

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


class TeamReportCorrectionOut(BaseModel):
    id: int
    team_report_id: int
    coach_id: int
    correction: str
    applied: bool
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Game Evaluation ───────────────────────────────────────────────────────────

class GameSessionCreate(BaseModel):
    opponent_name: str
    team_id: int | None = None
    date: str | None = None
    location: str | None = None
    season_phase: str = "regular"
    season_year: str | None = None
    tracking_mode: str = "live"
    competition_level: str | None = None
    period_format: str = "quarters"
    num_periods: int = 4
    period_seconds: int = 480


class GameSessionUpdate(BaseModel):
    opponent_name: str | None = None
    location: str | None = None
    our_score: int | None = None
    opponent_score: int | None = None
    season_phase: str | None = None
    season_year: str | None = None
    status: str | None = None


class GameSessionOut(BaseModel):
    id: int
    coach_id: int
    team_id: int | None
    opponent_name: str
    date: datetime
    location: str | None
    our_score: int | None
    opponent_score: int | None
    season_phase: str
    season_year: str | None
    tracking_mode: str | None = None
    competition_level: str | None = None
    period_format: str | None = None
    num_periods: int | None = None
    period_seconds: int | None = None
    status: str
    ai_scouting_report: str | None
    created_at: datetime
    scouting_updated_at: datetime | None = None  # when THIS coach's scout was last generated
    ai_game_report: str | None = None            # THIS coach's full game report (our team + opp)
    game_report_updated_at: datetime | None = None
    model_config = {"from_attributes": True}


class GameStatEntry(BaseModel):
    player_id: int | None = None
    player_name: str
    is_opponent: bool = False
    quarter: int
    stat_name: str
    stat_category: str
    raw_points: float
    count: int = 1


class LineupEventCreate(BaseModel):
    player_id: int | None = None
    player_name: str
    is_opponent: bool = False
    event_type: str
    quarter: int
    timestamp_seconds: int | None = None


class GameMinutesEntry(BaseModel):
    player_id: int | None = None
    player_name: str
    is_opponent: bool = False
    minutes_played: float


class GameSummaryOut(BaseModel):
    game: GameSessionOut
    player_grades: list[dict]
    team_grade: float
    opponent_grades: list[dict]
    model_config = {"from_attributes": True}
