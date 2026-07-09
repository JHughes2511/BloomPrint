"""SQLAlchemy ORM models."""

from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Text, DateTime,
    ForeignKey, Boolean, JSON,
)
from sqlalchemy.orm import relationship
from .database import Base


class Coach(Base):
    __tablename__ = "coaches"

    id                = Column(Integer, primary_key=True, index=True)
    name              = Column(String, nullable=False)
    email             = Column(String, unique=True, index=True, nullable=False)
    password_hash     = Column(String, nullable=False)
    weight            = Column(Integer, default=45)       # BIM authority weight
    level             = Column(String, default="hs_elite_aau")
    role              = Column(String, default="coach")   # coach / scout / trainer
    program_name      = Column(String, default="SEED Academy")
    conference        = Column(String, nullable=True)     # college conference
    competition_level = Column(String, nullable=True)     # signup competition level
    country           = Column(String, nullable=True)     # account location
    city              = Column(String, nullable=True)
    google_sub        = Column(String, nullable=True)      # Google account id (Sign-In)
    # Program system & philosophy — free-text per category. Injected into every
    # report so evaluations are framed as fit-for-this-program.
    system_profile    = Column(JSON, nullable=True)
    # Imported philosophy documents, distilled to text and kept as a standing
    # reference that is fed to the model on every generation.
    philosophy_reference = Column(String, nullable=True)
    onboarded         = Column(Boolean, default=False)  # completed the philosophy onboarding
    last_season_reminder = Column(String, nullable=True)  # season year last nudged/acknowledged
    last_active       = Column(DateTime, nullable=True)   # last app-open / login / activity
    created_at        = Column(DateTime, default=datetime.utcnow)

    evaluations         = relationship("Evaluation", back_populates="coach")
    corrections         = relationship("Correction", back_populates="coach")
    teams               = relationship("Team", back_populates="coach")
    notifications       = relationship("PlayerNotification", back_populates="coach", cascade="all, delete-orphan")
    coach_notifications = relationship("CoachNotification", foreign_keys="CoachNotification.coach_id", cascade="all, delete-orphan")


class Team(Base):
    __tablename__ = "teams"

    id               = Column(Integer, primary_key=True, index=True)
    name             = Column(String, nullable=False)
    coach_id         = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    competition_level = Column(String, default="HS Varsity")
    parent_team_id   = Column(Integer, ForeignKey("teams.id"), nullable=True)  # nested sub-team
    created_at       = Column(DateTime, default=datetime.utcnow)

    coach   = relationship("Coach", back_populates="teams")
    players = relationship("Player", back_populates="team")


class Player(Base):
    __tablename__ = "players"

    id               = Column(Integer, primary_key=True, index=True)
    name             = Column(String, nullable=False)
    position         = Column(String)
    jersey_number    = Column(String)
    age              = Column(Integer)
    height           = Column(String)
    wingspan         = Column(String)
    weight           = Column(String)
    standing_reach   = Column(String)
    country          = Column(String)
    state            = Column(String)
    city             = Column(String)
    school_name      = Column(String)
    program_name     = Column(String, default="SEED Academy")
    competition_level = Column(String, default="HS Varsity")
    notes            = Column(Text)
    # Parent/guardian consent for minors (under 18). None = not specified.
    parent_permission = Column(Boolean, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)
    team_id          = Column(Integer, ForeignKey("teams.id"), nullable=True)
    coach_id         = Column(Integer, ForeignKey("coaches.id"), nullable=True)  # roster owner

    evaluations      = relationship("Evaluation", back_populates="player",
                                    order_by="Evaluation.created_at")
    team             = relationship("Team", back_populates="players")
    player_user      = relationship("PlayerUser", back_populates="player", uselist=False)


class Evaluation(Base):
    __tablename__ = "evaluations"

    id               = Column(Integer, primary_key=True, index=True)
    player_id        = Column(Integer, ForeignKey("players.id"), nullable=False)
    coach_id         = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    output_type      = Column(String, nullable=False)
    competition_level = Column(String)
    coach_weight     = Column(Integer)
    coach_notes      = Column(Text)
    video_path       = Column(String)
    report_text      = Column(Text)
    overall_grade    = Column(Float)
    pillar_grades    = Column(JSON)   # {"offensive_skills": 7.2, ...}
    key_questions    = Column(JSON)   # list of strings
    green_flags      = Column(JSON)
    watch_flags      = Column(JSON)
    created_at       = Column(DateTime, default=datetime.utcnow)

    player           = relationship("Player", back_populates="evaluations")
    coach            = relationship("Coach", back_populates="evaluations")
    corrections      = relationship("Correction", back_populates="evaluation")


class Correction(Base):
    __tablename__ = "corrections"

    id            = Column(Integer, primary_key=True, index=True)
    evaluation_id = Column(Integer, ForeignKey("evaluations.id"), nullable=False)
    coach_id      = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    pillar        = Column(String)         # which pillar is being corrected
    original_text = Column(Text)
    correction    = Column(Text, nullable=False)
    coach_weight  = Column(Integer)
    applied       = Column(Boolean, default=False)
    created_at    = Column(DateTime, default=datetime.utcnow)

    evaluation    = relationship("Evaluation", back_populates="corrections")
    coach         = relationship("Coach", back_populates="corrections")


class GenerationJob(Base):
    """Background job for long-running video-based generation (so 60+ minute
    films don't block/time out the request). The client polls for completion."""
    __tablename__ = "generation_jobs"

    id          = Column(Integer, primary_key=True, index=True)
    coach_id    = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    kind        = Column(String, nullable=False)          # 'eval' | 'team_report'
    status      = Column(String, default="processing")    # processing | done | error
    result_id   = Column(Integer, nullable=True)          # created eval/team_report id
    error       = Column(Text, nullable=True)
    progress    = Column(String, nullable=True)           # human-readable progress
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TeamReport(Base):
    __tablename__ = "team_reports"

    id           = Column(Integer, primary_key=True, index=True)
    coach_id     = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    output_type  = Column(String, nullable=False)
    focus_prompt = Column(Text, nullable=True)
    report_text  = Column(Text, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow)

    coach        = relationship("Coach")
    corrections  = relationship("TeamReportCorrection", back_populates="team_report", cascade="all, delete-orphan")


class TeamReportCorrection(Base):
    __tablename__ = "team_report_corrections"

    id             = Column(Integer, primary_key=True, index=True)
    team_report_id = Column(Integer, ForeignKey("team_reports.id"), nullable=False)
    coach_id       = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    correction     = Column(Text, nullable=False)
    applied        = Column(Boolean, default=False)
    created_at     = Column(DateTime, default=datetime.utcnow)

    team_report    = relationship("TeamReport", back_populates="corrections")
    coach          = relationship("Coach")


class TrainingSession(Base):
    __tablename__ = "training_sessions"

    id            = Column(Integer, primary_key=True, index=True)
    player_id     = Column(Integer, ForeignKey("players.id"), nullable=False)
    coach_id      = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    evaluation_id = Column(Integer, ForeignKey("evaluations.id"), nullable=True)
    program_text  = Column(Text)
    priorities    = Column(JSON)   # ordered list of focus areas
    created_at    = Column(DateTime, default=datetime.utcnow)

    # Player-facing version: once sent, the AI reformats program_text into the
    # same checklist/weekly-structure format the player's own training screens
    # parse. program_text above stays the untouched coach original.
    sent_to_player       = Column(Boolean, default=False)
    reformatting         = Column(Boolean, default=False)
    player_program_text  = Column(Text, nullable=True)
    completed_drills     = Column(JSON, default=list)

    player        = relationship("Player")
    coach         = relationship("Coach")


# ── Player-facing system ──────────────────────────────────────────────────────

class PlayerUser(Base):
    __tablename__ = "player_users"

    id            = Column(Integer, primary_key=True, index=True)
    name          = Column(String, nullable=False)
    email         = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    player_id     = Column(Integer, ForeignKey("players.id"), nullable=True)
    avatar        = Column(Text, nullable=True)   # base64 data URI
    country       = Column(String, nullable=True) # account location
    city          = Column(String, nullable=True)
    google_sub    = Column(String, nullable=True)  # Google account id (Sign-In)
    created_at    = Column(DateTime, default=datetime.utcnow)

    player        = relationship("Player", back_populates="player_user")
    notifications = relationship("PlayerNotification", back_populates="player_user", cascade="all, delete-orphan")
    comments      = relationship("PlayerComment", back_populates="player_user", cascade="all, delete-orphan")
    links         = relationship("PlayerUserLink", back_populates="player_user", cascade="all, delete-orphan")


class PlayerUserLink(Base):
    """A player account can be linked to multiple player profiles (one per
    coach / program / team). PlayerUser.player_id is the primary/active one."""
    __tablename__ = "player_user_links"

    id             = Column(Integer, primary_key=True, index=True)
    player_user_id = Column(Integer, ForeignKey("player_users.id"), nullable=False)
    player_id      = Column(Integer, ForeignKey("players.id"), nullable=False)
    coach_id       = Column(Integer, ForeignKey("coaches.id"), nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)

    player_user    = relationship("PlayerUser", back_populates="links")
    player         = relationship("Player")
    coach          = relationship("Coach")


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id         = Column(Integer, primary_key=True, index=True)
    code       = Column(String, unique=True, index=True, nullable=False)
    coach_id   = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    player_id  = Column(Integer, ForeignKey("players.id"), nullable=False)
    used       = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    coach  = relationship("Coach")
    player = relationship("Player")


class LinkRequest(Base):
    __tablename__ = "link_requests"

    id             = Column(Integer, primary_key=True, index=True)
    player_user_id = Column(Integer, ForeignKey("player_users.id"), nullable=False)
    player_id      = Column(Integer, ForeignKey("players.id"), nullable=False)
    coach_id       = Column(Integer, ForeignKey("coaches.id"), nullable=True)  # set when player requested a coach directly
    status         = Column(String, default="pending")  # pending / approved / rejected
    created_at     = Column(DateTime, default=datetime.utcnow)

    player_user = relationship("PlayerUser")
    player      = relationship("Player")


class SharedReport(Base):
    __tablename__ = "shared_reports"

    id                = Column(Integer, primary_key=True, index=True)
    evaluation_id     = Column(Integer, ForeignKey("evaluations.id"), nullable=False)
    player_user_id    = Column(Integer, ForeignKey("player_users.id"), nullable=False)
    shared_by_id      = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    share_report_text = Column(Boolean, default=True)
    share_grades      = Column(Boolean, default=False)
    share_flags       = Column(Boolean, default=False)
    share_questions   = Column(Boolean, default=False)
    message           = Column(Text, nullable=True)
    created_at        = Column(DateTime, default=datetime.utcnow)

    evaluation  = relationship("Evaluation")
    player_user = relationship("PlayerUser")
    shared_by   = relationship("Coach")
    comments    = relationship("PlayerComment", back_populates="shared_report", cascade="all, delete-orphan")


class TeamSharedReport(Base):
    __tablename__ = "team_shared_reports"

    id             = Column(Integer, primary_key=True, index=True)
    player_user_id = Column(Integer, ForeignKey("player_users.id"), nullable=False)
    shared_by_id   = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    output_type    = Column(String, nullable=False)
    report_text    = Column(Text, nullable=True)
    message        = Column(Text, nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)

    player_user = relationship("PlayerUser")
    shared_by   = relationship("Coach")


class PlayerTraining(Base):
    __tablename__ = "player_training"

    id               = Column(Integer, primary_key=True, index=True)
    player_user_id   = Column(Integer, ForeignKey("player_users.id"), nullable=False)
    shared_report_id = Column(Integer, ForeignKey("shared_reports.id"), nullable=False)
    program_text     = Column(Text, nullable=True)
    coach_notes      = Column(Text, nullable=True)
    completed_drills = Column(JSON, default=list)   # list of completed drill keys
    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    player_user   = relationship("PlayerUser")
    shared_report = relationship("SharedReport")
    comments      = relationship("PlayerComment", back_populates="player_training", cascade="all, delete-orphan")


class TrainingCorrection(Base):
    """Save-for-later corrections on a training program — either a player's own
    (player_training_id) or a coach-sent one (training_session_id)."""
    __tablename__ = "training_corrections"

    id                  = Column(Integer, primary_key=True, index=True)
    player_training_id  = Column(Integer, ForeignKey("player_training.id"), nullable=True)
    training_session_id = Column(Integer, ForeignKey("training_sessions.id"), nullable=True)
    correction          = Column(Text, nullable=False)
    applied             = Column(Boolean, default=False)
    # On a coach-sent TrainingSession, distinguishes coach corrections (edit the
    # coach's program_text) from player corrections (edit player_program_text).
    coach_side          = Column(Boolean, default=False)
    created_at          = Column(DateTime, default=datetime.utcnow)


class PlayerComment(Base):
    __tablename__ = "player_comments"

    id                  = Column(Integer, primary_key=True, index=True)
    player_user_id      = Column(Integer, ForeignKey("player_users.id"), nullable=True)
    coach_id            = Column(Integer, ForeignKey("coaches.id"), nullable=True)
    shared_report_id    = Column(Integer, ForeignKey("shared_reports.id"), nullable=True)
    player_training_id  = Column(Integer, ForeignKey("player_training.id"), nullable=True)
    training_session_id = Column(Integer, ForeignKey("training_sessions.id"), nullable=True)
    parent_id           = Column(Integer, ForeignKey("player_comments.id"), nullable=True)  # threaded reply
    text                = Column(Text, nullable=False)
    created_at          = Column(DateTime, default=datetime.utcnow)

    player_user      = relationship("PlayerUser", back_populates="comments")
    coach            = relationship("Coach")
    shared_report    = relationship("SharedReport", back_populates="comments")
    player_training  = relationship("PlayerTraining", back_populates="comments")
    training_session = relationship("TrainingSession")


class PlayerNotification(Base):
    __tablename__ = "player_notifications"

    id             = Column(Integer, primary_key=True, index=True)
    player_user_id = Column(Integer, ForeignKey("player_users.id"), nullable=True)
    coach_id       = Column(Integer, ForeignKey("coaches.id"), nullable=True)
    type           = Column(String, nullable=False)
    title          = Column(String, nullable=False)
    body           = Column(Text, nullable=False)
    read           = Column(Boolean, default=False)
    ref_id         = Column(Integer, nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)

    player_user = relationship("PlayerUser", back_populates="notifications")
    coach       = relationship("Coach", back_populates="notifications")


class ShareApproval(Base):
    """Consent record: a coach wants to send a player's report to a DIFFERENT
    player. The subject player (who the report is about) must approve before it
    is sent to the recipient."""
    __tablename__ = "share_approvals"

    id                       = Column(Integer, primary_key=True, index=True)
    coach_id                 = Column(Integer, ForeignKey("coaches.id"), nullable=False)   # sender
    subject_player_id        = Column(Integer, ForeignKey("players.id"), nullable=False)    # report is about
    subject_player_user_id   = Column(Integer, ForeignKey("player_users.id"), nullable=True) # approver
    recipient_player_user_id = Column(Integer, ForeignKey("player_users.id"), nullable=False) # intended recipient
    kind                     = Column(String, default="team")     # "eval" | "team"
    output_type              = Column(String, nullable=False)
    report_text              = Column(Text, nullable=True)        # team-share payload
    message                  = Column(Text, nullable=True)
    # eval-share payload (kind == "eval")
    evaluation_id            = Column(Integer, ForeignKey("evaluations.id"), nullable=True)
    share_report_text        = Column(Boolean, default=True)
    share_grades             = Column(Boolean, default=True)
    share_flags              = Column(Boolean, default=True)
    share_questions          = Column(Boolean, default=True)
    status                   = Column(String, default="pending")  # pending / approved / rejected
    created_at               = Column(DateTime, default=datetime.utcnow)


class CoachNotification(Base):
    __tablename__ = "coach_notifications"

    id         = Column(Integer, primary_key=True, index=True)
    coach_id   = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    title      = Column(String, nullable=False)
    body       = Column(Text, nullable=False)
    read       = Column(Boolean, default=False)
    ref_id     = Column(Integer, nullable=True)
    type       = Column(String, nullable=False, default="info")
    created_at = Column(DateTime, default=datetime.utcnow)

    coach = relationship("Coach", foreign_keys=[coach_id])


class StaffSharedReport(Base):
    __tablename__ = "staff_shared_reports"

    id               = Column(Integer, primary_key=True, index=True)
    report_type      = Column(String, nullable=False)   # eval / game / team_training / team_report / training
    report_id        = Column(Integer, nullable=False)
    sender_id        = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    recipient_id     = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    allow_regenerate = Column(Boolean, default=False)
    regenerated_text = Column(Text, nullable=True)
    # When set, this is a frozen, section-filtered snapshot of the report at
    # share time. Used when the sender does NOT allow regeneration so the
    # recipient sees exactly the controlled copy instead of the live report.
    frozen_text      = Column(Text, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)

    sender    = relationship("Coach", foreign_keys=[sender_id])
    recipient = relationship("Coach", foreign_keys=[recipient_id])
    comments  = relationship("StaffReportComment", back_populates="shared_report", cascade="all, delete-orphan")


class StaffReportComment(Base):
    __tablename__ = "staff_report_comments"

    id               = Column(Integer, primary_key=True, index=True)
    shared_report_id = Column(Integer, ForeignKey("staff_shared_reports.id"), nullable=False)
    author_id        = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    text             = Column(Text, nullable=False)
    created_at       = Column(DateTime, default=datetime.utcnow)

    shared_report = relationship("StaffSharedReport", back_populates="comments")
    author        = relationship("Coach")


class GameReport(Base):
    __tablename__ = "game_reports"

    id                = Column(Integer, primary_key=True, index=True)
    coach_id          = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    title             = Column(String, nullable=True)
    mode              = Column(String, default="vs_opponent")  # vs_opponent / my_program / opponent_only
    my_team_id        = Column(Integer, ForeignKey("teams.id"), nullable=True)
    opponent_team_id  = Column(Integer, ForeignKey("teams.id"), nullable=True)
    opponent_name     = Column(String, nullable=True)
    output_type       = Column(String, default="coaching_report")
    focus_prompt      = Column(Text, nullable=True)
    box_score         = Column(Text, nullable=True)
    scouting_notes    = Column(Text, nullable=True)
    report_text       = Column(Text, nullable=True)
    created_at        = Column(DateTime, default=datetime.utcnow)
    updated_at        = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    coach         = relationship("Coach")
    my_team       = relationship("Team", foreign_keys=[my_team_id])
    opponent_team = relationship("Team", foreign_keys=[opponent_team_id])
    clips         = relationship("GameReportClip", back_populates="game_report", cascade="all, delete-orphan")
    corrections   = relationship("GameReportCorrection", back_populates="game_report", cascade="all, delete-orphan")


class GameReportCorrection(Base):
    __tablename__ = "game_report_corrections"

    id             = Column(Integer, primary_key=True, index=True)
    game_report_id = Column(Integer, ForeignKey("game_reports.id"), nullable=False)
    coach_id       = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    correction     = Column(Text, nullable=False)
    applied        = Column(Boolean, default=False)
    created_at     = Column(DateTime, default=datetime.utcnow)

    game_report    = relationship("GameReport", back_populates="corrections")
    coach          = relationship("Coach")


class GameReportClip(Base):
    __tablename__ = "game_report_clips"

    id             = Column(Integer, primary_key=True, index=True)
    game_report_id = Column(Integer, ForeignKey("game_reports.id"), nullable=False)
    video_path     = Column(String, nullable=False)
    label          = Column(String, nullable=False)  # 'my_team' or 'opponent'
    analysis_text  = Column(Text, nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)

    game_report = relationship("GameReport", back_populates="clips")


class GameSession(Base):
    __tablename__ = "game_sessions"
    id = Column(Integer, primary_key=True, index=True)
    coach_id = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    opponent_name = Column(String, nullable=False)
    date = Column(DateTime, default=datetime.utcnow)
    location = Column(String, nullable=True)
    our_score = Column(Integer, nullable=True)
    opponent_score = Column(Integer, nullable=True)
    season_phase = Column(String, default="regular")
    season_year = Column(String, nullable=True)
    tracking_mode = Column(String, default="live")  # live / post
    # Game clock / period structure, set from competition level at creation.
    competition_level = Column(String, nullable=True)
    period_format = Column(String, default="quarters")   # quarters / halves
    num_periods = Column(Integer, default=4)             # 4 quarters, or 2 halves
    period_seconds = Column(Integer, default=480)        # length of each period
    status = Column(String, default="in_progress")
    ai_scouting_report = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    coach = relationship("Coach")
    player_stats = relationship("GamePlayerStat", back_populates="game", cascade="all, delete-orphan")
    lineup_events = relationship("LineupEvent", back_populates="game", cascade="all, delete-orphan")


class GamePlayerStat(Base):
    __tablename__ = "game_player_stats"
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=False)
    player_id = Column(Integer, ForeignKey("players.id"), nullable=True)
    player_name = Column(String, nullable=False)
    is_opponent = Column(Boolean, default=False)
    quarter = Column(Integer, nullable=False)
    stat_name = Column(String, nullable=False)
    stat_category = Column(String, nullable=False)
    raw_points = Column(Float, nullable=False)
    quarter_multiplier = Column(Float, default=1.0)
    weighted_points = Column(Float, nullable=False)
    count = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)

    game = relationship("GameSession", back_populates="player_stats")
    player = relationship("Player")


class LineupEvent(Base):
    __tablename__ = "lineup_events"
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=False)
    player_id = Column(Integer, ForeignKey("players.id"), nullable=True)
    player_name = Column(String, nullable=False)
    is_opponent = Column(Boolean, default=False)
    event_type = Column(String, nullable=False)
    quarter = Column(Integer, nullable=False)
    timestamp_seconds = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    game = relationship("GameSession", back_populates="lineup_events")


class GameMinutesPlayed(Base):
    __tablename__ = "game_minutes_played"
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=False)
    player_id = Column(Integer, ForeignKey("players.id"), nullable=True)
    player_name = Column(String, nullable=False)
    is_opponent = Column(Boolean, default=False)
    minutes_played = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)


class OpponentNote(Base):
    __tablename__ = "opponent_notes"

    id            = Column(Integer, primary_key=True, index=True)
    coach_id      = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    opponent_name = Column(String, nullable=False)
    note_text     = Column(Text, nullable=False)
    created_at    = Column(DateTime, default=datetime.utcnow)

    coach = relationship("Coach")


class OpponentPlayer(Base):
    __tablename__ = "opponent_players"
    id = Column(Integer, primary_key=True, index=True)
    coach_id = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    opponent_name = Column(String, nullable=False)
    player_name = Column(String, nullable=False)
    jersey_number = Column(String, nullable=True)
    position = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class GameWhiteboard(Base):
    __tablename__ = "game_whiteboards"
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=False)
    coach_id = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    name = Column(String, default="Untitled Board")
    court_type = Column(String, default="full")  # full, half, three_quarter
    data = Column(Text, default="[]")  # JSON array of strokes/shapes
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    coach = relationship("Coach")


class TeamStaff(Base):
    __tablename__ = "team_staff"

    id        = Column(Integer, primary_key=True, index=True)
    coach_id  = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    team_id   = Column(Integer, ForeignKey("teams.id"), nullable=False)
    joined_at = Column(DateTime, default=datetime.utcnow)

    coach = relationship("Coach")
    team  = relationship("Team")


# ── Staff messaging ──────────────────────────────────────────────────────────

class Conversation(Base):
    __tablename__ = "conversations"

    id         = Column(Integer, primary_key=True, index=True)
    is_group   = Column(Boolean, default=False)
    title      = Column(String, nullable=True)      # group name
    created_by = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_at    = Column(DateTime, default=datetime.utcnow)  # sort key


class ConversationMember(Base):
    __tablename__ = "conversation_members"

    id                   = Column(Integer, primary_key=True, index=True)
    conversation_id      = Column(Integer, ForeignKey("conversations.id"), nullable=False)
    coach_id             = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    last_read_message_id = Column(Integer, nullable=True)


class StaffMessage(Base):
    __tablename__ = "staff_messages"

    id              = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id"), nullable=False)
    sender_id       = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    text            = Column(Text, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)

    attachments = relationship("StaffMessageAttachment", cascade="all, delete-orphan")


class StaffMessageAttachment(Base):
    __tablename__ = "staff_message_attachments"

    id           = Column(Integer, primary_key=True, index=True)
    message_id   = Column(Integer, ForeignKey("staff_messages.id"), nullable=False)
    kind         = Column(String, nullable=False)   # report | image | audio
    report_type  = Column(String, nullable=True)
    report_id    = Column(Integer, nullable=True)
    report_title = Column(String, nullable=True)
    report_text  = Column(Text, nullable=True)       # snapshot for reports
    data         = Column(Text, nullable=True)        # base64 data URI for image/audio
    name         = Column(String, nullable=True)


class TeamInvite(Base):
    """Invite a coach (existing account or by email) into a team / sub-team.
    Existing accounts approve/reject; unknown emails get a signup invite."""
    __tablename__ = "team_invites"

    id               = Column(Integer, primary_key=True, index=True)
    team_id          = Column(Integer, ForeignKey("teams.id"), nullable=False)
    invited_by       = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    invited_coach_id = Column(Integer, ForeignKey("coaches.id"), nullable=True)
    invited_email    = Column(String, nullable=True)
    code             = Column(String, nullable=True)   # signup/join code for email invites
    status           = Column(String, default="pending")  # pending / approved / rejected
    created_at       = Column(DateTime, default=datetime.utcnow)
