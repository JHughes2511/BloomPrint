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

    id           = Column(Integer, primary_key=True, index=True)
    name         = Column(String, nullable=False)
    email        = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    weight       = Column(Integer, default=45)       # BIM authority weight
    level        = Column(String, default="hs_elite_aau")
    program_name = Column(String, default="SEED Academy")
    created_at   = Column(DateTime, default=datetime.utcnow)

    evaluations  = relationship("Evaluation", back_populates="coach")
    corrections  = relationship("Correction", back_populates="coach")
    teams        = relationship("Team", back_populates="coach")
    notifications = relationship("PlayerNotification", back_populates="coach", cascade="all, delete-orphan")


class Team(Base):
    __tablename__ = "teams"

    id               = Column(Integer, primary_key=True, index=True)
    name             = Column(String, nullable=False)
    coach_id         = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    competition_level = Column(String, default="HS Varsity")
    created_at       = Column(DateTime, default=datetime.utcnow)

    coach   = relationship("Coach", back_populates="teams")
    players = relationship("Player", back_populates="team")


class Player(Base):
    __tablename__ = "players"

    id               = Column(Integer, primary_key=True, index=True)
    name             = Column(String, nullable=False)
    position         = Column(String)
    age              = Column(Integer)
    height           = Column(String)
    program_name     = Column(String, default="SEED Academy")
    competition_level = Column(String, default="HS Varsity")
    notes            = Column(Text)
    created_at       = Column(DateTime, default=datetime.utcnow)
    team_id          = Column(Integer, ForeignKey("teams.id"), nullable=True)

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


class TrainingSession(Base):
    __tablename__ = "training_sessions"

    id            = Column(Integer, primary_key=True, index=True)
    player_id     = Column(Integer, ForeignKey("players.id"), nullable=False)
    coach_id      = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    evaluation_id = Column(Integer, ForeignKey("evaluations.id"), nullable=True)
    program_text  = Column(Text)
    priorities    = Column(JSON)   # ordered list of focus areas
    created_at    = Column(DateTime, default=datetime.utcnow)

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
    created_at    = Column(DateTime, default=datetime.utcnow)

    player        = relationship("Player", back_populates="player_user")
    notifications = relationship("PlayerNotification", back_populates="player_user", cascade="all, delete-orphan")
    comments      = relationship("PlayerComment", back_populates="player_user", cascade="all, delete-orphan")


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


class PlayerTraining(Base):
    __tablename__ = "player_training"

    id               = Column(Integer, primary_key=True, index=True)
    player_user_id   = Column(Integer, ForeignKey("player_users.id"), nullable=False)
    shared_report_id = Column(Integer, ForeignKey("shared_reports.id"), nullable=False)
    program_text     = Column(Text, nullable=True)
    coach_notes      = Column(Text, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    player_user   = relationship("PlayerUser")
    shared_report = relationship("SharedReport")
    comments      = relationship("PlayerComment", back_populates="player_training", cascade="all, delete-orphan")


class PlayerComment(Base):
    __tablename__ = "player_comments"

    id                 = Column(Integer, primary_key=True, index=True)
    player_user_id     = Column(Integer, ForeignKey("player_users.id"), nullable=True)
    coach_id           = Column(Integer, ForeignKey("coaches.id"), nullable=True)
    shared_report_id   = Column(Integer, ForeignKey("shared_reports.id"), nullable=True)
    player_training_id = Column(Integer, ForeignKey("player_training.id"), nullable=True)
    text               = Column(Text, nullable=False)
    created_at         = Column(DateTime, default=datetime.utcnow)

    player_user     = relationship("PlayerUser", back_populates="comments")
    coach           = relationship("Coach")
    shared_report   = relationship("SharedReport", back_populates="comments")
    player_training = relationship("PlayerTraining", back_populates="comments")


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
