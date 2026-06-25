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
