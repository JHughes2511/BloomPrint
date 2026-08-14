"""SQLAlchemy ORM models."""

from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Text, DateTime,
    ForeignKey, Boolean, JSON, UniqueConstraint,
)
from sqlalchemy.orm import relationship
from .database import Base
from .softdelete import SoftDeleteMixin


class Coach(Base):
    __tablename__ = "coaches"

    id                = Column(Integer, primary_key=True, index=True)
    name              = Column(String, nullable=False)
    email             = Column(String, unique=True, index=True, nullable=False)
    password_hash     = Column(String, nullable=False)
    weight            = Column(Integer, default=45)       # BIM authority weight
    level             = Column(String, default="hs_elite_aau")
    role              = Column(String, default="coach")   # coach / scout / trainer
    # The specific title inside a program — "Director of Player Development",
    # "Assistant Coach — Guards". Free text: role says what kind of account this
    # is, and no fixed list survives contact with how programs actually title
    # their staff.
    job_title         = Column(String, nullable=True)
    program_name      = Column(String, default="SEED Academy")
    conference        = Column(String, nullable=True)     # college conference
    competition_level = Column(String, nullable=True)     # signup competition level
    country           = Column(String, nullable=True)     # account location
    city              = Column(String, nullable=True)
    google_sub        = Column(String, nullable=True)      # Google account id (Sign-In)
    # UI + AI output language (BCP-47 primary tag, e.g. "es", "ru"). Reports,
    # Ask BloomPrint, and the app interface all follow this choice.
    preferred_language = Column(String, default="en")
    # Program system & philosophy — free-text per category. Injected into every
    # report so evaluations are framed as fit-for-this-program.
    system_profile    = Column(JSON, nullable=True)
    # Imported philosophy documents, distilled to text and kept as a standing
    # reference that is fed to the model on every generation.
    philosophy_reference = Column(String, nullable=True)
    onboarded         = Column(Boolean, default=False)  # completed the philosophy onboarding
    # Coaching-style profile the AI accumulates from the coach's drawn plays
    # (hand-drawn + AI boards) and reads on every play draw-up so a short brief is
    # positioned the way this coach draws. Learned incrementally over time.
    play_style_profile   = Column(String, nullable=True)
    play_style_synced_at = Column(DateTime, nullable=True)  # latest board updated_at folded into the profile
    last_season_reminder = Column(String, nullable=True)  # season year last nudged/acknowledged
    last_active       = Column(DateTime, nullable=True)   # last app-open / login / activity
    created_at        = Column(DateTime, default=datetime.utcnow)

    evaluations         = relationship("Evaluation", back_populates="coach")
    corrections         = relationship("Correction", back_populates="coach")
    teams               = relationship("Team", back_populates="coach")
    notifications       = relationship("PlayerNotification", back_populates="coach", cascade="all, delete-orphan")
    # back_populates, not two independent relationships over the same foreign
    # key: without it SQLAlchemy treats these as separate mappings that both
    # write coach_notifications.coach_id, so setting one side leaves the other
    # stale in the same session until a refresh.
    coach_notifications = relationship(
        "CoachNotification", foreign_keys="CoachNotification.coach_id",
        cascade="all, delete-orphan", back_populates="coach",
    )


class Team(SoftDeleteMixin, Base):
    __tablename__ = "teams"

    id               = Column(Integer, primary_key=True, index=True)
    name             = Column(String, nullable=False)
    coach_id         = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    # Whether this is one of the coach's OWN sides, or a team they only keep
    # records on. Both live here and are used the same way — a game is between
    # two named teams, not between "us" and "them" — but a season record has to
    # be about somebody, so the ones that are theirs are marked.
    is_mine          = Column(Boolean, default=True)
    competition_level = Column(String, default="HS Varsity")
    parent_team_id   = Column(Integer, ForeignKey("teams.id"), nullable=True)  # nested sub-team
    created_at       = Column(DateTime, default=datetime.utcnow)

    coach   = relationship("Coach", back_populates="teams")
    players = relationship("Player", back_populates="team")


class Player(SoftDeleteMixin, Base):
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
    # Which side of a merge wins a disagreement. Two coaches keeping the same
    # player both being right is the normal case — one of them measured more
    # recently, and that is the answer the roster should carry.
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    team_id          = Column(Integer, ForeignKey("teams.id"), nullable=True)
    coach_id         = Column(Integer, ForeignKey("coaches.id"), nullable=True)  # roster owner

    evaluations      = relationship("Evaluation", back_populates="player",
                                    order_by="Evaluation.created_at")
    team             = relationship("Team", back_populates="players")
    player_user      = relationship("PlayerUser", back_populates="player", uselist=False)


class Evaluation(SoftDeleteMixin, Base):
    __tablename__ = "evaluations"

    id               = Column(Integer, primary_key=True, index=True)
    player_id        = Column(Integer, ForeignKey("players.id"), nullable=False)
    coach_id         = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    output_type      = Column(String, nullable=False)
    title            = Column(String)   # optional display title (e.g. "A vs B" for match-ups)
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


class PlayerVideo(Base):
    """A film uploaded for a player, kept for the player-profile video catalog.
    Links back to the report/eval/training it helped create so a coach can
    watch it and see what it produced."""
    __tablename__ = "player_videos"
    id          = Column(Integer, primary_key=True, index=True)
    player_id   = Column(Integer, ForeignKey("players.id"), nullable=False)
    coach_id    = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    video_path  = Column(String, nullable=False)
    source_kind = Column(String, default="eval")   # eval / training / game_report
    source_id   = Column(Integer, nullable=True)    # id of the eval/training/report
    label       = Column(String, nullable=True)     # optional display label
    created_at  = Column(DateTime, default=datetime.utcnow)


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
    # Everything needed to run this job again from scratch. A film analysis
    # takes twenty minutes and the container it runs in can be replaced by a
    # deploy at any point; without the inputs recorded, a restart has no way to
    # pick the work back up and the coach simply loses it.
    payload     = Column(Text, nullable=True)             # JSON: the call's arguments
    # Work already finished, so a resumed run pays for the segments it has not
    # done rather than starting the film over. JSON: {"segments": {"3": "..."}}.
    partial     = Column(Text, nullable=True)
    # Guards the loop: a job that dies three times is failing for its own
    # reasons, not because of bad luck with deploys.
    attempts    = Column(Integer, default=0)
    # Whether this job's ending has been turned into a notification. Six
    # different places mark a job done; asking each of them to also announce it
    # is five chances to forget. The endpoint that reports on jobs does it
    # instead, once, whoever finished the work.
    announced   = Column(Boolean, default=False)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class TeamReport(SoftDeleteMixin, Base):
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


class TrainingSession(SoftDeleteMixin, Base):
    __tablename__ = "training_sessions"

    id            = Column(Integer, primary_key=True, index=True)
    player_id     = Column(Integer, ForeignKey("players.id"), nullable=False)
    coach_id      = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    evaluation_id = Column(Integer, ForeignKey("evaluations.id"), nullable=True)
    program_text  = Column(Text)
    priorities    = Column(JSON)   # ordered list of focus areas
    # A short subject so a coach can tell two programs apart in a list. Without
    # it every row rendered as "Training Program" plus a date, and the preview
    # line was whatever the text opened with — usually the word "BRIEF:".
    title         = Column(String)
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
    # Same contract as Coach.preferred_language: the app and any mail we send
    # follow it. The picker existed on the player's login and link screens long
    # before this column, so the choice was device-local and forgotten on the
    # next sign-in.
    preferred_language = Column(String, default="en")
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
    # Section headings the coach switched off when sharing. An eval is shared by
    # reference — its text is read from the evaluation at view time — so the
    # choice has to live here or it is lost the moment the share is saved.
    hidden_sections   = Column(Text, nullable=True)   # JSON list of headings
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
    # Optional i18n pointer. When set, clients render the translated string with
    # these params; `title`/`body` remain as the English fallback so existing
    # rows and not-yet-migrated senders keep working.
    i18n_key       = Column(String, nullable=True)
    i18n_params    = Column(JSON, nullable=True)
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
    hidden_sections          = Column(Text, nullable=True)        # JSON list of withheld headings
    status                   = Column(String, default="pending")  # pending / approved / rejected
    created_at               = Column(DateTime, default=datetime.utcnow)


class ReportTranslation(Base):
    """Cached translation of a report's text into one language.

    Reports are written in whatever language the coach used at generation time and
    kept as the source of truth. When someone reads one in a different language we
    translate on view and cache it here, keyed by the SOURCE text's hash so an
    edited/regenerated report invalidates itself instead of serving a stale copy.
    """
    __tablename__ = "report_translations"

    id          = Column(Integer, primary_key=True, index=True)
    report_type = Column(String, nullable=False)   # eval / team_report / game / game_session / game_report / training
    report_id   = Column(Integer, nullable=False)
    lang        = Column(String, nullable=False)   # BCP-47 primary tag
    source_hash = Column(String, nullable=False)   # sha256 of the source text
    text        = Column(Text, nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)


class Feedback(Base):
    """In-app feedback from a coach.

    Stored before it is emailed, and kept afterwards: the email is a nudge, the
    row is the record. The digest reads these rows, so losing them to a failed
    send would lose the input the priorities email is built from.
    """
    __tablename__ = "feedback"

    id          = Column(Integer, primary_key=True, index=True)
    coach_id    = Column(Integer, ForeignKey("coaches.id"), nullable=True)
    text        = Column(Text, nullable=False)
    # Context that makes a report actionable without having to ask.
    screen      = Column(String, nullable=True)   # where they were when they wrote it
    app_version = Column(String, nullable=True)
    platform    = Column(String, nullable=True)   # ios / android / web
    language    = Column(String, nullable=True)   # so a non-English report is readable in context
    # Screenshots, as a JSON array of base64 data URIs — the same shape as an
    # avatar. A photo of the problem says in one glance what a paragraph
    # struggles to, and these are small enough to live beside the text rather
    # than depending on object storage that is not yet proven.
    images      = Column(Text, nullable=True)
    # Filled by the digest pass, not at submit time — categorising on submit
    # would put an AI call in the way of the coach's tap.
    category    = Column(String, nullable=True)   # bug / confusing / feature / praise / other
    priority    = Column(String, nullable=True)   # must_have / nice_to_have
    summary     = Column(Text, nullable=True)     # one-line normalisation for the digest
    emailed     = Column(Boolean, default=False)  # the immediate notification went out
    digested_at = Column(DateTime, nullable=True) # included in a priorities email
    created_at  = Column(DateTime, default=datetime.utcnow)

    coach = relationship("Coach")


class CoachNotification(Base):
    __tablename__ = "coach_notifications"

    id         = Column(Integer, primary_key=True, index=True)
    coach_id   = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    title      = Column(String, nullable=False)
    body       = Column(Text, nullable=False)
    # Same contract as PlayerNotification: i18n_key points at a "notifs.<name>"
    # base with .title/.body underneath, rendered by the reader's client in the
    # reader's language. title/body stay as the English fallback for rows
    # written before a sender was migrated.
    i18n_key   = Column(String, nullable=True)
    i18n_params = Column(JSON, nullable=True)
    read       = Column(Boolean, default=False)
    ref_id     = Column(Integer, nullable=True)
    type       = Column(String, nullable=False, default="info")
    created_at = Column(DateTime, default=datetime.utcnow)

    coach = relationship("Coach", foreign_keys=[coach_id], back_populates="coach_notifications")


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

    # id of the recipient's OWN "Updated ___" copy once they regenerate/correct
    # it (points to the appropriate table for report_type). Lets the viewer and
    # Recents surface the updated version distinctly from the original.
    updated_report_id = Column(Integer, nullable=True)
    # Where a request-to-share-back stands: pending / approved / declined, or
    # NULL when no request was ever made. Recorded because the outcome was
    # previously only held in the responding coach's session — reload the app
    # and a resolved request offered its Approve and Deny buttons again.
    request_status   = Column(String, nullable=True)

    sender    = relationship("Coach", foreign_keys=[sender_id])
    recipient = relationship("Coach", foreign_keys=[recipient_id])
    comments  = relationship("StaffReportComment", back_populates="shared_report", cascade="all, delete-orphan")


class SharedReportCorrection(Base):
    """A recipient's running list of corrections for a report shared with them.
    'Apply Corrections' saves one; 'Apply & Regenerate' runs the AI over all
    un-applied corrections to produce the recipient's own Updated copy."""
    __tablename__ = "shared_report_corrections"
    id         = Column(Integer, primary_key=True, index=True)
    shared_id  = Column(Integer, ForeignKey("staff_shared_reports.id"), nullable=False)
    coach_id   = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    correction = Column(Text, nullable=False)
    applied    = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class StaffReportComment(Base):
    __tablename__ = "staff_report_comments"

    id               = Column(Integer, primary_key=True, index=True)
    shared_report_id = Column(Integer, ForeignKey("staff_shared_reports.id"), nullable=False)
    author_id        = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    text             = Column(Text, nullable=False)
    target           = Column(String, default="original")  # "original" | "updated"
    created_at       = Column(DateTime, default=datetime.utcnow)

    shared_report = relationship("StaffSharedReport", back_populates="comments")
    author        = relationship("Coach")


class CoachPreference(Base):
    """Something a coach has taught BloomPrint by correcting a report.

    A correction is a coach saying what this report should have paid attention
    to. Verifying it against the film fixes one report; remembering it is what
    stops them writing the same note again next week.

    Scope is the team it was made about, or the whole program when there is no
    team in view. Both apply together and are not in competition: a coach has a
    general idea of how they play and a specific plan for a given opponent.

    Kept per COACH. What this one cares about is theirs, not a fact about
    basketball, and nobody else's reports change because of it.
    """
    __tablename__ = "coach_preferences"

    id         = Column(Integer, primary_key=True, index=True)
    coach_id   = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    # NULL means it applies to everything this coach generates.
    team_id    = Column(Integer, ForeignKey("teams.id"), nullable=True)
    text       = Column(Text, nullable=False)
    # Where it came from, so the list can say. "correction" today.
    source     = Column(String, default="correction")
    # Teams evolve across a season; a coach can switch one off without losing
    # the record of having made it.
    active     = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    coach = relationship("Coach", foreign_keys=[coach_id])
    team  = relationship("Team", foreign_keys=[team_id])


class GameReport(SoftDeleteMixin, Base):
    __tablename__ = "game_reports"

    id                = Column(Integer, primary_key=True, index=True)
    coach_id          = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    title             = Column(String, nullable=True)
    mode              = Column(String, default="vs_opponent")  # vs_opponent / my_program / opponent_only
    my_team_id        = Column(Integer, ForeignKey("teams.id"), nullable=True)
    opponent_team_id  = Column(Integer, ForeignKey("teams.id"), nullable=True)
    opponent_name     = Column(String, nullable=True)
    # Free-text name for "Opponent A" in opponent-vs-opponent mode (when A isn't
    # one of the coach's saved teams). Opponent B uses opponent_name.
    opponent_a_name   = Column(String, nullable=True)
    # When the game on this packet's film was played. Optional, and asked
    # rather than derived: it is the one thing that can tell two fixtures
    # against the same team apart, and without it no film is offered a link to
    # a tracked game at all.
    game_date         = Column(DateTime, nullable=True)
    # Additional teams for a multi-team (3+) MATCH-UP, comma-separated tokens:
    # "t<id>" for a saved team, or a free-text opponent name.
    extra_teams       = Column(Text, nullable=True)
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
    versions      = relationship("GameReportVersion", back_populates="game_report",
                                 cascade="all, delete-orphan", order_by="GameReportVersion.updated_at.desc()")


class GameReportVersion(Base):
    """A generated report saved inside a packet, keyed by the selection of report
    types (output_type signature). Generating the same selection overwrites its
    version; a new selection is saved as a separate version. So a packet keeps a
    history — one entry per distinct report-type combination."""
    __tablename__ = "game_report_versions"

    id             = Column(Integer, primary_key=True, index=True)
    game_report_id = Column(Integer, ForeignKey("game_reports.id"), nullable=False)
    coach_id       = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    output_type    = Column(String, nullable=False)   # the selection signature
    report_text    = Column(Text, nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    game_report    = relationship("GameReport", back_populates="versions")


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
    # The team this film is actually of. `label` only says which side, which is
    # not enough for an opponent-vs-opponent packet where both films are the
    # opponent — and "Opponent Film" is not what a coach called the team.
    team_name      = Column(String, nullable=True)
    # The report type the film was actually watched AS, recorded when the
    # analysis was asked for. The packet's own output_type is a live setting a
    # coach changes between generations, so reading it later says what the
    # packet is FOR now, not what this film was read as — a Game Analysis
    # sitting in a packet since retyped to Coaching + Scouting was labelled as
    # both of those and was neither.
    output_type    = Column(String, nullable=True)
    analysis_text  = Column(Text, nullable=True)
    # The tracked game this film is OF, once the coach has confirmed it.
    #
    # A film and a box score of the same night are two readings of one game,
    # and neither is much use to the other while nothing says they belong
    # together: the analysis cannot cite the numbers, and a scouting report
    # built from the numbers cannot say what the film showed. Never guessed —
    # a link is suggested from the teams and the date and then confirmed, and
    # the coach can answer "not one of these".
    game_id        = Column(Integer, ForeignKey("game_sessions.id"), nullable=True)
    # The coach was asked about this packet's films and said none of them
    # belong to a tracked game. Remembered so the question is asked once a
    # session rather than every time the packet is opened.
    link_declined  = Column(Boolean, default=False)
    created_at     = Column(DateTime, default=datetime.utcnow)

    game_report = relationship("GameReport", back_populates="clips")
    game        = relationship("GameSession", foreign_keys=[game_id])


class GameSession(SoftDeleteMixin, Base):
    __tablename__ = "game_sessions"
    id = Column(Integer, primary_key=True, index=True)
    coach_id = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    # The one-off repair that turned this game's stat rows into roster players
    # has run. Recorded so it cannot run twice: it files players by side onto
    # this game's team, which is wrong when the box score is for two teams that
    # are both somebody else's, and re-running it undid the coach's deletions.
    roster_backfilled = Column(Boolean, default=False)
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


class GameScoutingReport(Base):
    """A coach's OWN scouting report for a game. Each coach who can access a
    game (owner or team staff) gets their own private report; they can then
    share it with staff/teams/players if they choose. One per (game, coach)."""
    __tablename__ = "game_scouting_reports"
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=False)
    coach_id = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    report_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class GameScoutingCorrection(Base):
    """Coach-added context/adjustments layered on top of the stat-derived
    scouting report. Apply & Regenerate rebuilds the report from the box score
    PLUS these corrections — the qualitative detail the stats can't capture."""
    __tablename__ = "game_scouting_corrections"
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=False)
    coach_id = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    correction = Column(Text, nullable=False)
    applied = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class GameSessionReportVersion(Base):
    """A previous wording of a coach's scouting or game report for a game.

    Regenerating used to overwrite. That was survivable while every
    regeneration was rebuilt from the box score — the report could always be
    made again from its sources. It is not survivable now that a regeneration
    EDITS the report: an edit that goes wrong takes the report with it, and
    there is nothing to rebuild from because the wording was the work.

    One row per generation, newest kept; the packet has had this for its own
    reports all along.
    """
    __tablename__ = "game_session_report_versions"
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=False)
    coach_id = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    # "scouting" or "game_report" — the two reports a game carries.
    kind = Column(String, nullable=False)
    report_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class GameFullReport(Base):
    """A coach's OWN full GAME REPORT for a game (our team + opponent combined),
    distinct from the opponent-only scouting report. Per (game, coach); the coach
    can layer context on it, regenerate, share, and it feeds game packets."""
    __tablename__ = "game_full_reports"
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=False)
    coach_id = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    report_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class GameSessionReportCorrection(Base):
    """Coach-added context/adjustments layered on top of the stat-derived full
    game report for a GameSession (distinct from GameReportCorrection, which
    belongs to the packet GameReport). Apply & Regenerate rebuilds the report
    from the box score PLUS these corrections."""
    __tablename__ = "game_session_report_corrections"
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=False)
    coach_id = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    correction = Column(Text, nullable=False)
    applied = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class GamePlayerStat(Base):
    __tablename__ = "game_player_stats"
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=False)
    player_id = Column(Integer, ForeignKey("players.id"), nullable=True)
    player_name = Column(String, nullable=False)
    # As the sheet printed it. Kept on the stat row rather than looked up from
    # the roster, because a box score is often the only place an opponent's
    # number is ever written down.
    jersey_number = Column(String, nullable=True)
    is_opponent = Column(Boolean, default=False)
    quarter = Column(Integer, nullable=False)
    stat_name = Column(String, nullable=False)
    stat_category = Column(String, nullable=False)
    raw_points = Column(Float, nullable=False)
    quarter_multiplier = Column(Float, default=1.0)
    weighted_points = Column(Float, nullable=False)
    count = Column(Integer, default=1)
    # "live" for stats tapped in during a game, "import" for a box score read
    # from a file. Re-importing replaces the previous import for that game
    # without touching anything the coach tracked live.
    source = Column(String, default="live")
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


class GamePlayEvent(Base):
    """One line of a play-by-play: what happened, when, and the score after it.

    A box score is a total; this is the game in order. It is the only thing that
    can answer when a lead was biggest, how long a team led, how many times the
    lead changed, or how many points came off turnovers — questions a coach asks
    constantly and which no amount of totals can reach.
    """
    __tablename__ = "game_play_events"
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=False, index=True)
    # Order within the game. Kept explicitly: a file may give a clock, a
    # sequence number, or only the order of its rows.
    sequence = Column(Integer, nullable=False, default=0)
    period = Column(Integer, nullable=True)
    # Seconds REMAINING in the period, as a game clock reads.
    clock_seconds = Column(Float, nullable=True)
    is_opponent = Column(Boolean, nullable=True)
    player_name = Column(String, nullable=True)
    # The event as the file described it, kept verbatim so nothing is lost in
    # translation to our vocabulary.
    description = Column(Text, nullable=True)
    points = Column(Integer, nullable=False, default=0)
    # The running score AFTER this event, when the file states it.
    our_score = Column(Integer, nullable=True)
    opponent_score = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class GameShot(Base):
    """Where a shot was taken from.

    x and y are percentages of the full court, 0-100, origin at the top-left of
    the half the shot was taken in — a fraction rather than feet, because files
    disagree about court dimensions and every renderer wants a fraction anyway.
    """
    __tablename__ = "game_shots"
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=False, index=True)
    is_opponent = Column(Boolean, nullable=False, default=False)
    player_name = Column(String, nullable=True)
    period = Column(Integer, nullable=True)
    x = Column(Float, nullable=False)
    y = Column(Float, nullable=False)
    made = Column(Boolean, nullable=False, default=False)
    points = Column(Integer, nullable=True)      # 2 or 3, when the file says
    created_at = Column(DateTime, default=datetime.utcnow)


class GameTeamAdvanced(Base):
    """The team-totals panel a box score often prints beside the player rows.

    Points off turnovers, fast-break points and the rest cannot be worked out
    from a box score — they need possession context — but sheets frequently
    state them outright. Stored when stated, absent when not; never inferred.
    """
    __tablename__ = "game_team_advanced"
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=False, index=True)
    is_opponent = Column(Boolean, nullable=False, default=False)
    # The basic totals as the sheet prints them. These are NOT the sum of the
    # player rows and are not meant to be: a box score credits team rebounds and
    # team turnovers to the team, so the official total is legitimately higher
    # than anything the named players add up to. Summing the players left the
    # team comparison a few rebounds and turnovers short of the sheet every
    # time, which reads as the import having got it wrong.
    pts = Column(Integer, nullable=True)
    reb = Column(Integer, nullable=True)
    oreb = Column(Integer, nullable=True)
    dreb = Column(Integer, nullable=True)
    ast = Column(Integer, nullable=True)
    stl = Column(Integer, nullable=True)
    blk = Column(Integer, nullable=True)
    tov = Column(Integer, nullable=True)
    pf = Column(Integer, nullable=True)

    points_off_turnovers = Column(Integer, nullable=True)
    fast_break_points = Column(Integer, nullable=True)
    second_chance_points = Column(Integer, nullable=True)
    points_in_paint = Column(Integer, nullable=True)
    bench_points = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class GameMinutesPlayed(Base):
    """The parts of a player's box-score line that are not countable stats.

    Minutes, plus-minus and efficiency are printed on every real box score and
    none of them is a tally of events, so they have no place in GamePlayerStat
    — a plus-minus is not worth grade points and cannot be summed across
    quarters. They live here, one row per player per game, read straight off
    the sheet.

    Minutes matter beyond the sheet: grading weights a player's work by how
    long they were on the floor, and with none recorded every player was
    treated as having played exactly twenty.
    """
    __tablename__ = "game_minutes_played"
    id = Column(Integer, primary_key=True, index=True)
    game_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=False)
    player_id = Column(Integer, ForeignKey("players.id"), nullable=True)
    player_name = Column(String, nullable=False)
    is_opponent = Column(Boolean, default=False)
    minutes_played = Column(Float, default=0.0)
    # Both nullable and both meaning "the sheet did not say", which is not the
    # same as zero — a plus-minus of 0 is a real result.
    plus_minus = Column(Float, nullable=True)
    efficiency = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class OpponentNote(Base):
    __tablename__ = "opponent_notes"

    id            = Column(Integer, primary_key=True, index=True)
    coach_id      = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    opponent_name = Column(String, nullable=False)
    note_text     = Column(Text, nullable=False)
    created_at    = Column(DateTime, default=datetime.utcnow)

    coach = relationship("Coach")


class ScoutInsight(Base):
    """One sentence about what a team's numbers actually mean.

    Written on demand — when a coach opens a scouting page, or taps a player on
    it — and kept. The averages say what somebody did; this says what to do
    about it. `subject` is a player's name, or one of "offense" / "defense" /
    "weak" for the three team sections.

    `games` records how many were behind the sentence, so a stored one written
    from two games can be replaced once there are four rather than quietly
    describing a smaller sample than the page beside it shows.

    `material` does the same job for everything WRITTEN about the team — the
    packet reports and film breakdowns. Games alone missed it: a coach could
    produce a full packet about a team and the sentence beside it would still
    be the one written before any of it existed, with nothing to say so.
    """
    __tablename__ = "scout_insights"

    id          = Column(Integer, primary_key=True, index=True)
    coach_id    = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    team_name   = Column(String, nullable=False, index=True)
    # How many written pieces about the team the sentence was based on.
    material    = Column(Integer, default=0)
    subject     = Column(String, nullable=False, index=True)
    insight     = Column(Text, nullable=False)
    games       = Column(Integer, default=0)
    created_at  = Column(DateTime, default=datetime.utcnow)

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
    # NULL means the coach's playbook rather than one game's board.
    #
    # The playbook used a sentinel game_id of 0, and no game session has id 0.
    # SQLite does not enforce foreign keys by default so it saved locally; the
    # deployed Postgres does, so every playbook save violated the constraint and
    # answered 500. A foreign key permits NULL, which is what "belongs to no
    # game" actually means.
    game_id = Column(Integer, ForeignKey("game_sessions.id"), nullable=True)
    coach_id = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    name = Column(String, default="Untitled Board")
    court_type = Column(String, default="full")  # full, half, three_quarter
    data = Column(Text, default="[]")  # JSON array of strokes/shapes
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    coach = relationship("Coach")


class TeamStaff(Base):
    __tablename__ = "team_staff"

    id        = Column(Integer, primary_key=True, index=True)
    coach_id  = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    team_id   = Column(Integer, ForeignKey("teams.id"), nullable=False)
    joined_at = Column(DateTime, default=datetime.utcnow)

    coach = relationship("Coach")
    team  = relationship("Team")


class QuestionnaireTranslation(Base):
    """The questionnaire in one language, translated once and kept.

    The whole form is about two hundred short strings, and it never changes
    between respondents — so translating it per visitor would be paying for the
    same work every time somebody opened the link. Translated on the first
    request for a language and read from here forever after, keyed by the
    question version so a reworded question is retranslated rather than served
    from a cache of the old one.
    """
    __tablename__ = "questionnaire_translations"

    id         = Column(Integer, primary_key=True, index=True)
    version    = Column(Integer, nullable=False)
    lang       = Column(String, nullable=False, index=True)
    payload    = Column(JSON, nullable=False)   # same shape as GET /questionnaire/form
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("version", "lang", name="uq_questionnaire_lang"),)


class QuestionnaireResponse(Base):
    """One filled-in discovery questionnaire, from someone with no account.

    Answers are stored as INDEXES against a version rather than as the option
    text: the wording is the instrument, and copying it onto every row would
    mean a later edit leaving the stored text and the live question saying
    different things with nothing to say which was answered. The version says
    which list the indexes refer to.
    """
    __tablename__ = "questionnaire_responses"

    id         = Column(Integer, primary_key=True, index=True)
    version    = Column(Integer, nullable=False, default=1)
    role       = Column(String, nullable=False, index=True)
    name       = Column(String, nullable=False)
    # Optional, and asked for one reason: an invite when the app is ready, and
    # a follow-up call. Optional because a required email on a cold public form
    # costs responses, and a response with no address is still evidence.
    email      = Column(String, nullable=True, index=True)
    age_range  = Column(String, nullable=True)
    # {"0": [1, 3], "1": 2, ...} — question index to option index, or a list of
    # them where the question takes more than one.
    answers    = Column(JSON, nullable=False, default=dict)
    # Free text, and usually the most useful thing on the row.
    comment    = Column(Text, nullable=True)
    # For spotting one person filling it in twenty times, and nothing else. A
    # hash, because an IP is personal data and the question it answers here is
    # only "is this the same submitter as that one".
    submitter  = Column(String, nullable=True, index=True)
    source     = Column(String, nullable=True)   # ?from= on the link, for tracking a channel
    created_at = Column(DateTime, default=datetime.utcnow)


class RosterProposal(Base):
    """"I have a player you don't" — waiting on the team to say yes or no.

    When two coaches who each kept the same team join up, most of the roster is
    the same two people written down twice and merges silently. What is left is
    the interesting part: a player one of them has and the other has never seen.
    That is not automatically a new player — it can be a tryout who never made
    it, or last season's roster — so it is offered, not added.
    """
    __tablename__ = "roster_proposals"

    id          = Column(Integer, primary_key=True, index=True)
    team_id     = Column(Integer, ForeignKey("teams.id"), nullable=False, index=True)
    # The proposer's own row. Approving moves THIS row onto the team, so the
    # player's history comes with them rather than being retyped.
    player_id   = Column(Integer, ForeignKey("players.id"), nullable=False)
    proposed_by = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    status      = Column(String, nullable=False, default="pending")  # pending/approved/rejected
    decided_by  = Column(Integer, ForeignKey("coaches.id"), nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow)

    team     = relationship("Team")
    player   = relationship("Player")
    proposer = relationship("Coach", foreign_keys=[proposed_by])


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
    # "invite": the team asked a coach in — that coach approves.
    # "request": a coach asked to join — the team OWNER approves.
    # The row shape is identical; only who may approve it differs, so the two
    # must never be listed in the same inbox.
    kind             = Column(String, default="invite")
    status           = Column(String, default="pending")  # pending / approved / rejected
    created_at       = Column(DateTime, default=datetime.utcnow)


class EmailPreference(Base):
    """Whether one account wants activity email, and the token that turns it off.

    A separate table rather than columns on coaches/player_users on purpose.
    init_db() creates missing tables on every backend but only adds columns on
    SQLite, so a column added here would work locally and silently not exist on
    the deployed database. A new table needs no migration path to arrive.

    A missing row means opted in — the default has to hold for every account
    that existed before this table did, without backfilling anything.
    """
    __tablename__ = "email_preferences"

    id          = Column(Integer, primary_key=True, index=True)
    # "coach" or "player". The two id spaces are independent, so audience is
    # part of the identity of a row, not a detail of it.
    audience    = Column(String, nullable=False, index=True)
    user_id     = Column(Integer, nullable=False, index=True)
    opted_out   = Column(Boolean, default=False, nullable=False)
    # Unguessable and stable: it goes in the footer of every message, and a
    # link that stops working is a link that traps someone in a mailing list.
    token       = Column(String, unique=True, index=True, nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("audience", "user_id", name="uq_email_pref_audience_user"),
    )

class TeamJoinLink(Base):
    """A standing signup link for a team.

    One per coach per team, not one per team: a link belongs to whoever made
    it, so revoking yours cannot silently kill an assistant's. Anyone who
    already joined stays — revoking closes the door, it does not undo who is
    already inside.
    """
    __tablename__ = "team_join_links"

    id         = Column(Integer, primary_key=True, index=True)
    team_id    = Column(Integer, ForeignKey("teams.id"), nullable=False, index=True)
    created_by = Column(Integer, ForeignKey("coaches.id"), nullable=False)
    code       = Column(String, nullable=False, unique=True, index=True)
    revoked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    team    = relationship("Team")
    creator = relationship("Coach")
    joins   = relationship("TeamJoinEvent", back_populates="link", cascade="all, delete-orphan")

    @property
    def is_live(self) -> bool:
        return self.revoked_at is None


class TeamJoinEvent(Base):
    """Who came in through a link — so the coach who shared it can see."""
    __tablename__ = "team_join_events"

    id             = Column(Integer, primary_key=True, index=True)
    link_id        = Column(Integer, ForeignKey("team_join_links.id"), nullable=False, index=True)
    coach_id       = Column(Integer, ForeignKey("coaches.id"), nullable=True)       # staff
    player_user_id = Column(Integer, ForeignKey("player_users.id"), nullable=True)  # player
    player_id      = Column(Integer, ForeignKey("players.id"), nullable=True)       # roster entry
    display_name   = Column(String, nullable=True)
    kind           = Column(String, nullable=False)   # "staff" | "player"
    created_at     = Column(DateTime, default=datetime.utcnow)

    link = relationship("TeamJoinLink", back_populates="joins")


class PlayerAccess(Base):
    """A coach who can see a player they do not own.

    Sharing a report about someone hands the person over with it — otherwise
    the recipient reads an evaluation of a player they cannot look up. It is
    the SAME player record, not a copy: one history, and each coach keeps their
    own BIM grade because that is scoped per coach elsewhere.
    """
    __tablename__ = "player_access"

    id         = Column(Integer, primary_key=True, index=True)
    player_id  = Column(Integer, ForeignKey("players.id"), nullable=False, index=True)
    coach_id   = Column(Integer, ForeignKey("coaches.id"), nullable=False, index=True)
    granted_by = Column(Integer, ForeignKey("coaches.id"), nullable=True)
    source     = Column(String, nullable=True)   # "shared_report" | "join_link"
    created_at = Column(DateTime, default=datetime.utcnow)

    player = relationship("Player")

