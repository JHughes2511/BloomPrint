"""SQLite database setup via SQLAlchemy."""

import os
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DB_PATH = os.environ.get("BLOOMPRINT_DB", "bloomprint.db")
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from . import models  # noqa: F401 — registers all models
    Base.metadata.create_all(bind=engine)
    _run_migrations()


def _run_migrations():
    """Apply any schema changes that create_all() can't handle (column additions)."""
    with engine.connect() as conn:
        # Add team_id to players if missing
        cols = [row[1] for row in conn.execute(
            __import__("sqlalchemy").text("PRAGMA table_info(players)")
        )]
        if "team_id" not in cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE players ADD COLUMN team_id INTEGER REFERENCES teams(id)"
            ))
            conn.commit()

        # Add role to coaches if missing
        coach_cols = [row[1] for row in conn.execute(
            __import__("sqlalchemy").text("PRAGMA table_info(coaches)")
        )]
        if "role" not in coach_cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE coaches ADD COLUMN role TEXT NOT NULL DEFAULT 'coach'"
            ))
            conn.commit()
        if "system_profile" not in coach_cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE coaches ADD COLUMN system_profile TEXT"
            ))
            conn.commit()
        if "philosophy_reference" not in coach_cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE coaches ADD COLUMN philosophy_reference TEXT"
            ))
            conn.commit()

        # Add conference and competition_level to coaches if missing
        if "conference" not in coach_cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE coaches ADD COLUMN conference TEXT"
            ))
            conn.commit()
        if "competition_level" not in coach_cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE coaches ADD COLUMN competition_level TEXT"
            ))
            conn.commit()
        if "country" not in coach_cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE coaches ADD COLUMN country TEXT"
            ))
            conn.commit()
        if "city" not in coach_cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE coaches ADD COLUMN city TEXT"
            ))
            conn.commit()
        if "google_sub" not in coach_cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE coaches ADD COLUMN google_sub TEXT"
            ))
            conn.commit()

        # Add wingspan to players if missing
        if "wingspan" not in cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE players ADD COLUMN wingspan TEXT"
            ))
            conn.commit()

        # Add weight and standing_reach to players if missing
        if "weight" not in cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE players ADD COLUMN weight TEXT"
            ))
            conn.commit()
        if "standing_reach" not in cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE players ADD COLUMN standing_reach TEXT"
            ))
            conn.commit()

        # Add location + school fields to players if missing
        for col in ("country", "state", "city", "school_name"):
            if col not in cols:
                conn.execute(__import__("sqlalchemy").text(
                    f"ALTER TABLE players ADD COLUMN {col} TEXT"
                ))
                conn.commit()

        # Add jersey_number to players if missing
        if "jersey_number" not in cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE players ADD COLUMN jersey_number TEXT"
            ))
            conn.commit()

        # Add parent_permission to players if missing
        if "parent_permission" not in cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE players ADD COLUMN parent_permission BOOLEAN"
            ))
            conn.commit()

        # Add jersey_number to opponent_players if missing
        try:
            op_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(opponent_players)")
            )]
            if op_cols and "jersey_number" not in op_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE opponent_players ADD COLUMN jersey_number TEXT"
                ))
                conn.commit()
        except Exception:
            pass

        # Add game_reports table columns (handled by create_all, but ensure updated_at exists)
        try:
            gr_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(game_reports)")
            )]
            if gr_cols and "updated_at" not in gr_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE game_reports ADD COLUMN updated_at DATETIME"
                ))
                conn.commit()
        except Exception:
            pass

        # Staff sharing tables are handled by create_all() on first startup.
        # Add regenerated_text to staff_shared_reports if missing
        try:
            ssr_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(staff_shared_reports)")
            )]
            if ssr_cols and "regenerated_text" not in ssr_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE staff_shared_reports ADD COLUMN regenerated_text TEXT"
                ))
                conn.commit()
            if ssr_cols and "frozen_text" not in ssr_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE staff_shared_reports ADD COLUMN frozen_text TEXT"
                ))
                conn.commit()
        except Exception:
            pass

        # Add completed_drills to player_training if missing
        try:
            ptr_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(player_training)")
            )]
            if ptr_cols and "completed_drills" not in ptr_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE player_training ADD COLUMN completed_drills JSON"
                ))
                conn.commit()
        except Exception:
            pass

        # Add avatar to player_users if missing
        try:
            puu_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(player_users)")
            )]
            if puu_cols and "avatar" not in puu_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE player_users ADD COLUMN avatar TEXT"
                ))
                conn.commit()
            if puu_cols and "country" not in puu_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE player_users ADD COLUMN country TEXT"
                ))
                conn.commit()
            if puu_cols and "city" not in puu_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE player_users ADD COLUMN city TEXT"
                ))
                conn.commit()
            if puu_cols and "google_sub" not in puu_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE player_users ADD COLUMN google_sub TEXT"
                ))
                conn.commit()
        except Exception:
            pass

        # Add coach_id to link_requests if missing
        try:
            lr_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(link_requests)")
            )]
            if lr_cols and "coach_id" not in lr_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE link_requests ADD COLUMN coach_id INTEGER"
                ))
                conn.commit()
        except Exception:
            pass

        # Add tracking_mode to game_sessions if missing
        try:
            gs_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(game_sessions)")
            )]
            if gs_cols and "tracking_mode" not in gs_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE game_sessions ADD COLUMN tracking_mode TEXT DEFAULT 'live'"
                ))
                conn.commit()
        except Exception:
            pass

        # Create coach_notifications table if missing
        try:
            conn.execute(__import__("sqlalchemy").text(
                "CREATE TABLE IF NOT EXISTS coach_notifications ("
                "id INTEGER PRIMARY KEY, "
                "coach_id INTEGER NOT NULL REFERENCES coaches(id), "
                "title TEXT NOT NULL, "
                "body TEXT NOT NULL, "
                "read INTEGER NOT NULL DEFAULT 0, "
                "ref_id INTEGER, "
                "type TEXT NOT NULL DEFAULT 'info', "
                "created_at DATETIME"
                ")"
            ))
            conn.commit()
        except Exception:
            pass

        # Create team_report_corrections table if missing
        try:
            conn.execute(__import__("sqlalchemy").text(
                "CREATE TABLE IF NOT EXISTS team_report_corrections ("
                "id INTEGER PRIMARY KEY, "
                "team_report_id INTEGER NOT NULL REFERENCES team_reports(id), "
                "coach_id INTEGER NOT NULL REFERENCES coaches(id), "
                "correction TEXT NOT NULL, "
                "applied INTEGER NOT NULL DEFAULT 0, "
                "created_at DATETIME"
                ")"
            ))
            conn.commit()
        except Exception:
            pass

        # Add allow_regenerate to staff_shared_reports if missing
        try:
            ssr_cols2 = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(staff_shared_reports)")
            )]
            if ssr_cols2 and "allow_regenerate" not in ssr_cols2:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE staff_shared_reports ADD COLUMN allow_regenerate INTEGER NOT NULL DEFAULT 0"
                ))
                conn.commit()
        except Exception:
            pass

        # Create game_sessions table if missing
        try:
            conn.execute(__import__("sqlalchemy").text(
                "CREATE TABLE IF NOT EXISTS game_sessions ("
                "id INTEGER PRIMARY KEY, "
                "coach_id INTEGER NOT NULL REFERENCES coaches(id), "
                "team_id INTEGER REFERENCES teams(id), "
                "opponent_name TEXT NOT NULL, "
                "date DATETIME, "
                "location TEXT, "
                "our_score INTEGER, "
                "opponent_score INTEGER, "
                "season_phase TEXT NOT NULL DEFAULT 'regular', "
                "season_year TEXT, "
                "status TEXT NOT NULL DEFAULT 'in_progress', "
                "ai_scouting_report TEXT, "
                "created_at DATETIME"
                ")"
            ))
            conn.commit()
        except Exception:
            pass

        # Create game_player_stats table if missing
        try:
            conn.execute(__import__("sqlalchemy").text(
                "CREATE TABLE IF NOT EXISTS game_player_stats ("
                "id INTEGER PRIMARY KEY, "
                "game_id INTEGER NOT NULL REFERENCES game_sessions(id), "
                "player_id INTEGER REFERENCES players(id), "
                "player_name TEXT NOT NULL, "
                "is_opponent INTEGER NOT NULL DEFAULT 0, "
                "quarter INTEGER NOT NULL, "
                "stat_name TEXT NOT NULL, "
                "stat_category TEXT NOT NULL, "
                "raw_points REAL NOT NULL, "
                "quarter_multiplier REAL NOT NULL DEFAULT 1.0, "
                "weighted_points REAL NOT NULL, "
                "count INTEGER NOT NULL DEFAULT 1, "
                "created_at DATETIME"
                ")"
            ))
            conn.commit()
        except Exception:
            pass

        # Create lineup_events table if missing
        try:
            conn.execute(__import__("sqlalchemy").text(
                "CREATE TABLE IF NOT EXISTS lineup_events ("
                "id INTEGER PRIMARY KEY, "
                "game_id INTEGER NOT NULL REFERENCES game_sessions(id), "
                "player_id INTEGER REFERENCES players(id), "
                "player_name TEXT NOT NULL, "
                "is_opponent INTEGER NOT NULL DEFAULT 0, "
                "event_type TEXT NOT NULL, "
                "quarter INTEGER NOT NULL, "
                "timestamp_seconds INTEGER, "
                "created_at DATETIME"
                ")"
            ))
            conn.commit()
        except Exception:
            pass

        # Create game_minutes_played table if missing
        try:
            conn.execute(__import__("sqlalchemy").text(
                "CREATE TABLE IF NOT EXISTS game_minutes_played ("
                "id INTEGER PRIMARY KEY, "
                "game_id INTEGER NOT NULL REFERENCES game_sessions(id), "
                "player_id INTEGER REFERENCES players(id), "
                "player_name TEXT NOT NULL, "
                "is_opponent INTEGER NOT NULL DEFAULT 0, "
                "minutes_played REAL NOT NULL DEFAULT 0.0, "
                "created_at DATETIME"
                ")"
            ))
            conn.commit()
        except Exception:
            pass

        # Create opponent_players table if missing
        try:
            conn.execute(__import__("sqlalchemy").text(
                "CREATE TABLE IF NOT EXISTS opponent_players ("
                "id INTEGER PRIMARY KEY, "
                "coach_id INTEGER NOT NULL REFERENCES coaches(id), "
                "opponent_name TEXT NOT NULL, "
                "player_name TEXT NOT NULL, "
                "position TEXT, "
                "notes TEXT, "
                "created_at DATETIME"
                ")"
            ))
            conn.commit()
        except Exception:
            pass

        # Create opponent_notes table if missing
        try:
            conn.execute(__import__("sqlalchemy").text(
                "CREATE TABLE IF NOT EXISTS opponent_notes ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "coach_id INTEGER NOT NULL REFERENCES coaches(id), "
                "opponent_name TEXT NOT NULL, "
                "note_text TEXT NOT NULL, "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP"
                ")"
            ))
            conn.commit()
        except Exception:
            pass

        # Create team_staff table if missing
        try:
            conn.execute(__import__("sqlalchemy").text(
                "CREATE TABLE IF NOT EXISTS team_staff ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "coach_id INTEGER NOT NULL REFERENCES coaches(id), "
                "team_id INTEGER NOT NULL REFERENCES teams(id), "
                "joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                "UNIQUE(coach_id, team_id)"
                ")"
            ))
            conn.commit()
        except Exception:
            pass

        # Create corrections table if missing (player-eval "save correction for
        # later" feature), and backfill any columns missing on an older table.
        try:
            conn.execute(__import__("sqlalchemy").text(
                "CREATE TABLE IF NOT EXISTS corrections ("
                "id INTEGER PRIMARY KEY, "
                "evaluation_id INTEGER NOT NULL REFERENCES evaluations(id), "
                "coach_id INTEGER NOT NULL REFERENCES coaches(id), "
                "pillar TEXT, "
                "original_text TEXT, "
                "correction TEXT NOT NULL, "
                "coach_weight INTEGER, "
                "applied INTEGER NOT NULL DEFAULT 0, "
                "created_at DATETIME"
                ")"
            ))
            conn.commit()
            corr_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(corrections)")
            )]
            if "pillar" not in corr_cols:
                conn.execute(__import__("sqlalchemy").text("ALTER TABLE corrections ADD COLUMN pillar TEXT"))
                conn.commit()
            if "original_text" not in corr_cols:
                conn.execute(__import__("sqlalchemy").text("ALTER TABLE corrections ADD COLUMN original_text TEXT"))
                conn.commit()
            if "coach_weight" not in corr_cols:
                conn.execute(__import__("sqlalchemy").text("ALTER TABLE corrections ADD COLUMN coach_weight INTEGER"))
                conn.commit()
            if "applied" not in corr_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE corrections ADD COLUMN applied INTEGER NOT NULL DEFAULT 0"
                ))
                conn.commit()
        except Exception:
            pass

        # Training sessions: coach-sent-to-player fields (AI-reformatted
        # checklist version, kept separate from the coach's original text).
        try:
            ts_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(training_sessions)")
            )]
            if ts_cols and "sent_to_player" not in ts_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE training_sessions ADD COLUMN sent_to_player INTEGER NOT NULL DEFAULT 0"
                ))
                conn.commit()
            if ts_cols and "reformatting" not in ts_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE training_sessions ADD COLUMN reformatting INTEGER NOT NULL DEFAULT 0"
                ))
                conn.commit()
            if ts_cols and "player_program_text" not in ts_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE training_sessions ADD COLUMN player_program_text TEXT"
                ))
                conn.commit()
            if ts_cols and "completed_drills" not in ts_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE training_sessions ADD COLUMN completed_drills TEXT"
                ))
                conn.commit()
        except Exception:
            pass

        # Player comments: allow attaching to a coach-sent training_session too.
        try:
            pc_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(player_comments)")
            )]
            if pc_cols and "training_session_id" not in pc_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE player_comments ADD COLUMN training_session_id INTEGER REFERENCES training_sessions(id)"
                ))
                conn.commit()
        except Exception:
            pass

        # Extend share_approvals for eval-kind consent (table may pre-exist).
        try:
            sa_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(share_approvals)")
            )]
            if sa_cols:
                for col, ddl in [
                    ("kind", "ALTER TABLE share_approvals ADD COLUMN kind TEXT DEFAULT 'team'"),
                    ("evaluation_id", "ALTER TABLE share_approvals ADD COLUMN evaluation_id INTEGER"),
                    ("share_report_text", "ALTER TABLE share_approvals ADD COLUMN share_report_text INTEGER DEFAULT 1"),
                    ("share_grades", "ALTER TABLE share_approvals ADD COLUMN share_grades INTEGER DEFAULT 1"),
                    ("share_flags", "ALTER TABLE share_approvals ADD COLUMN share_flags INTEGER DEFAULT 1"),
                    ("share_questions", "ALTER TABLE share_approvals ADD COLUMN share_questions INTEGER DEFAULT 1"),
                ]:
                    if col not in sa_cols:
                        conn.execute(__import__("sqlalchemy").text(ddl))
                        conn.commit()
        except Exception:
            pass

        # Add parent_team_id to teams for nested sub-teams.
        try:
            tcols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(teams)")
            )]
            if tcols and "parent_team_id" not in tcols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE teams ADD COLUMN parent_team_id INTEGER"
                ))
                conn.commit()
        except Exception:
            pass

        # Add parent_id to player_comments for threaded replies.
        try:
            pc_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(player_comments)")
            )]
            if pc_cols and "parent_id" not in pc_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE player_comments ADD COLUMN parent_id INTEGER"
                ))
                conn.commit()
        except Exception:
            pass

        # Create game_report_corrections table if missing (save-for-later
        # corrections on game reports, mirroring team_report_corrections).
        try:
            conn.execute(__import__("sqlalchemy").text(
                "CREATE TABLE IF NOT EXISTS game_report_corrections ("
                "id INTEGER PRIMARY KEY, "
                "game_report_id INTEGER NOT NULL REFERENCES game_reports(id), "
                "coach_id INTEGER NOT NULL REFERENCES coaches(id), "
                "correction TEXT NOT NULL, "
                "applied INTEGER NOT NULL DEFAULT 0, "
                "created_at DATETIME"
                ")"
            ))
            conn.commit()
        except Exception:
            pass

        # Create training_corrections table if missing (save-for-later
        # corrections on training programs — player-owned or coach-sent).
        try:
            conn.execute(__import__("sqlalchemy").text(
                "CREATE TABLE IF NOT EXISTS training_corrections ("
                "id INTEGER PRIMARY KEY, "
                "player_training_id INTEGER REFERENCES player_training(id), "
                "training_session_id INTEGER REFERENCES training_sessions(id), "
                "correction TEXT NOT NULL, "
                "applied INTEGER NOT NULL DEFAULT 0, "
                "created_at DATETIME"
                ")"
            ))
            conn.commit()
            tc_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(training_corrections)")
            )]
            if tc_cols and "coach_side" not in tc_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE training_corrections ADD COLUMN coach_side INTEGER NOT NULL DEFAULT 0"
                ))
                conn.commit()
        except Exception:
            pass

        # Game session clock/period-structure columns.
        try:
            gs_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(game_sessions)")
            )]
            if gs_cols:
                if "competition_level" not in gs_cols:
                    conn.execute(__import__("sqlalchemy").text(
                        "ALTER TABLE game_sessions ADD COLUMN competition_level TEXT"))
                    conn.commit()
                if "period_format" not in gs_cols:
                    conn.execute(__import__("sqlalchemy").text(
                        "ALTER TABLE game_sessions ADD COLUMN period_format TEXT NOT NULL DEFAULT 'quarters'"))
                    conn.commit()
                if "num_periods" not in gs_cols:
                    conn.execute(__import__("sqlalchemy").text(
                        "ALTER TABLE game_sessions ADD COLUMN num_periods INTEGER NOT NULL DEFAULT 4"))
                    conn.commit()
                if "period_seconds" not in gs_cols:
                    conn.execute(__import__("sqlalchemy").text(
                        "ALTER TABLE game_sessions ADD COLUMN period_seconds INTEGER NOT NULL DEFAULT 480"))
                    conn.commit()
        except Exception:
            pass

        # Create generation_jobs table if missing (background video generation).
        try:
            conn.execute(__import__("sqlalchemy").text(
                "CREATE TABLE IF NOT EXISTS generation_jobs ("
                "id INTEGER PRIMARY KEY, "
                "coach_id INTEGER NOT NULL REFERENCES coaches(id), "
                "kind TEXT NOT NULL, "
                "status TEXT NOT NULL DEFAULT 'processing', "
                "result_id INTEGER, "
                "error TEXT, "
                "created_at DATETIME, "
                "updated_at DATETIME"
                ")"
            ))
            conn.commit()
            gj_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(generation_jobs)")
            )]
            if gj_cols and "progress" not in gj_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE generation_jobs ADD COLUMN progress TEXT"))
                conn.commit()
        except Exception:
            pass
