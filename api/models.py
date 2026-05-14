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

    evaluations      = relationship("Evaluation", back_populates="player",
                                    order_by="Evaluation.created_at")


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
