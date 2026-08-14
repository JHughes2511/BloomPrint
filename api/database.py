"""Database setup: SQLite by default, any SQLAlchemy URL when configured.

SQLite is right for one coach on one Mac and wrong the moment there are two
servers — it is a file, so "the database" is whatever disk that process
happens to have. DATABASE_URL is what lets this run somewhere else without
touching the code.

Env:
  DATABASE_URL    full SQLAlchemy URL, e.g. postgresql+psycopg://user:pw@host/db
  BLOOMPRINT_DB   SQLite file path, used only when DATABASE_URL is unset
"""
import logging
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

log = logging.getLogger(__name__)

DB_PATH = os.environ.get("BLOOMPRINT_DB", "bloomprint.db")
DATABASE_URL = os.environ.get("DATABASE_URL") or f"sqlite:///{DB_PATH}"


def _through_a_transaction_pooler(url: str) -> bool:
    """Is this URL pointed at PgBouncer (or similar) in transaction mode?

    Neon spells it with a -pooler suffix on the host; Supabase and a bare
    PgBouncer are matched too. A false negative here costs nothing — it is the
    behaviour this project had all along — so the test errs toward matching.
    """
    return "-pooler." in url or "pgbouncer" in url


def _engine_kwargs(url: str) -> dict:
    if url.startswith("sqlite"):
        # SQLite ties a connection to the thread that opened it; FastAPI runs
        # handlers on a threadpool, so that check has to be off.
        return {"connect_args": {"check_same_thread": False}}
    # Networked databases drop idle connections, and a pooled-but-dead one
    # surfaces as a random query failure. pre_ping trades a cheap round trip
    # for not serving errors after a restart or an idle period.
    kwargs: dict = {"pool_pre_ping": True, "pool_recycle": 1800}

    if _through_a_transaction_pooler(url):
        # psycopg promotes a statement to a server-side PREPARE once it has run
        # a few times. A server-side prepare belongs to a backend connection —
        # but a transaction pooler hands the next transaction whichever backend
        # is free, so the prepared name is either missing or belongs to someone
        # else. The result is "prepared statement _pg3_0 already exists", and
        # the shape of the bug is what makes it worth pre-empting: nothing is
        # wrong at startup or in testing, because the threshold hasn't been
        # crossed yet. It appears once a query gets popular, intermittently,
        # under load, reading as a database outage rather than a config choice.
        #
        # None disables the promotion. The cost is re-planning a query the
        # server could have cached; the benefit is that both endpoints work.
        kwargs["connect_args"] = {"prepare_threshold": None}

    return kwargs


# Heroku and some others still hand out the legacy postgres:// scheme, which
# SQLAlchemy 2 no longer recognises. Rewriting it here beats a deploy that
# fails on a URL the platform generated itself.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg://", 1)
# The modern scheme needs rewriting too, for a less obvious reason: a bare
# postgresql:// URL is valid, so SQLAlchemy accepts it and reaches for its
# DEFAULT driver, psycopg2 — which this project does not install and does not
# use. The failure is "No module named psycopg2" on a URL nobody typed, handed
# out by the platform, against a database that is up. Naming psycopg (v3)
# explicitly is what makes the connection use the driver we actually ship.
elif DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_engine(DATABASE_URL, **_engine_kwargs(DATABASE_URL))
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
    if engine.dialect.name == "sqlite":
        _run_migrations()
    else:
        # _run_migrations() is written in SQLite's dialect — PRAGMA table_info,
        # AUTOINCREMENT — and exists to evolve an existing bloomprint.db in
        # place. A database created fresh from create_all() already has every
        # column those migrations add, and every table they create is also a
        # declared model, so skipping them loses nothing on a new backend.
        #
        # It does mean there is no schema-change path on a server yet. Half-
        # porting 26 PRAGMA calls would produce something that looks portable
        # and silently isn't; the real answer when this ships is Alembic.
        log.info(
            "Skipping in-place migrations on %s — schema comes from create_all(). "
            "Add Alembic before making schema changes against this database.",
            engine.dialect.name,
        )
        _add_missing_columns()
        _relax_not_null()

    # Backend-independent: operates on rows, not schema.
    _fail_orphaned_jobs()
    _reparse_eval_sections()
    _backfill_training_titles()
    _claim_linked_players()
    _backfill_rosters_from_games()
    _restore_deleted_clip_analyses()


def _restore_deleted_clip_analyses():
    """Put back film breakdowns that deleting a video threw away.

    Deleting a film out of the catalog used to delete the clip row, and the
    clip row is where the breakdown lives — so freeing a few gigabytes also
    destroyed the writing the film was watched to produce. The route no longer
    does that, which does nothing for the reports already gone.

    What survives is the job that produced them: each segment of the film was
    written down on the job row as it finished, so a twenty-minute analysis
    interrupted by a deploy could carry on. Those notes are the substance of
    the report — everything the model saw, in order — and they are enough to
    give the coach their breakdown back. What cannot be recovered is the final
    pass that read the notes and wrote them up, so the restored text says so
    rather than passing itself off as the report that was lost.

    Idempotent: a restored job is pointed at its new clip, so it is not a
    candidate the next time this runs.
    """
    import json
    import re

    try:
        from sqlalchemy.orm import Session as _Session
        from . import models

        with _Session(engine) as sess:
            jobs = (
                sess.query(models.GenerationJob)
                .filter(models.GenerationJob.kind == "clip",
                        models.GenerationJob.result_id.isnot(None))
                .all()
            )
            restored = 0
            for job in jobs:
                if sess.get(models.GameReportClip, job.result_id) is not None:
                    continue
                try:
                    call = json.loads(job.payload or "{}")
                    partial = json.loads(job.partial or "{}")
                except Exception:
                    continue
                segments = partial.get("segments") or {}
                if not segments:
                    # Nothing was written down: there is nothing to give back,
                    # and inventing a placeholder report would be worse.
                    continue
                # The upload is named gr_<report>_clip_<uuid>, which is the only
                # surviving link from the job to the packet it belonged to.
                m = re.search(r"gr_(\d+)_clip_", call.get("video_path") or "")
                if not m:
                    continue
                report = sess.get(models.GameReport, int(m.group(1)))
                if report is None:
                    continue
                label_text = (call.get("label_text") or "").strip()
                generic = label_text in ("", "my team", "the opponent")
                body = "\n\n".join(
                    text for _, text in sorted(segments.items(), key=lambda kv: int(kv[0]))
                    if (text or "").strip()
                )
                if not body.strip():
                    continue
                clip = models.GameReportClip(
                    game_report_id=report.id,
                    video_path="",          # the film itself is gone
                    label="my_team" if label_text == "my team" else "opponent",
                    team_name=None if generic else label_text,
                    analysis_text=(
                        "Recovered breakdown — the film was deleted along with the "
                        "written report. This is what was observed, section by section, "
                        "as the film was watched; the summary that was written from it "
                        "could not be recovered.\n\n" + body
                    ),
                )
                sess.add(clip)
                sess.flush()
                job.result_id = clip.id
                restored += 1
            if restored:
                sess.commit()
                log.info("Restored %s film breakdown(s) whose clip had been deleted", restored)
    except Exception:
        # A repair that cannot run must not stop the app from starting.
        pass


def _claim_linked_players():
    """Put already-linked players onto the roster of the coach who approved them.

    Approving a link used to record the PlayerUserLink and leave
    Player.coach_id unset, and the roster is filtered on that column — so every
    link approved before that was fixed left a player the coach could not see.
    The link row already names the approving coach, so the information to repair
    it was there all along.

    Fills empties only. A player already owned by a coach keeps that owner; this
    can move nobody between rosters.
    """
    try:
        from sqlalchemy.orm import Session as _Session
        from . import models

        with _Session(engine) as sess:
            links = (
                sess.query(models.PlayerUserLink)
                .filter(models.PlayerUserLink.coach_id.isnot(None))
                .all()
            )
            claimed = 0
            for link in links:
                player = sess.get(models.Player, link.player_id)
                if player and not player.coach_id:
                    player.coach_id = link.coach_id
                    claimed += 1
            if claimed:
                sess.commit()
                log.info("Claimed %s linked player(s) onto their coach's roster", claimed)
    except Exception:
        # A repair that cannot run must not stop the app from starting.
        pass


def _backfill_rosters_from_games():
    """Put players already recorded in games onto their teams' rosters.

    Roster push-back arrived after games had been imported, so a coach could
    have a full box score for a team and an empty roster page for it — the
    names were in the database the whole time, as stat rows, just never turned
    into players. This walks the games once and does what an import does now.

    Runs ONCE per game, recorded on the game itself, not on every boot.

    "Idempotent because it only adds names the team does not have" was true of
    the database and false of the coach. A stat row carries no team name, so
    this can only file players by side, onto whatever team the game was created
    under — and for a game holding a box score for two teams that are both
    someone else's, that is the wrong team. Deleting those players then did
    nothing: the next restart put every one of them back, with no way to tell
    that a repair rather than an import was doing it. Running once means a
    deletion stays deleted.

    Jersey numbers are NOT invented — the old reader never captured them, and a
    squad number is not something to guess. Re-importing the file fills those
    in, and an import knows which team each name belongs to.
    """
    try:
        from sqlalchemy.orm import Session as _Session
        from . import models
        from .routes.imports import _sync_roster

        with _Session(engine) as sess:
            games = sess.query(models.GameSession).all()
            added = marked = 0
            for game in games:
                if getattr(game, "roster_backfilled", False):
                    continue
                stats = sess.query(models.GamePlayerStat).filter_by(game_id=game.id).all()
                if not stats:
                    continue
                coach = sess.get(models.Coach, game.coach_id)
                if coach is None:
                    continue
                seen: dict[tuple[str, bool], dict] = {}
                for st in stats:
                    key = (st.player_name, bool(st.is_opponent))
                    if key not in seen:
                        seen[key] = {"player_name": st.player_name,
                                     "is_opponent": bool(st.is_opponent),
                                     "jersey_number": getattr(st, "jersey_number", None)}
                    elif not seen[key]["jersey_number"]:
                        seen[key]["jersey_number"] = getattr(st, "jersey_number", None)
                result = _sync_roster(sess, game, coach, list(seen.values()))
                added += result.get("added", 0)
                game.roster_backfilled = True
                marked += 1
            if marked:
                # _sync_roster commits its own additions; the marks still need
                # saving, including for a game that added nobody — that game is
                # done too, and leaving it unmarked means walking it again on
                # every boot forever.
                sess.commit()
                log.info("Backfilled %s player(s) onto rosters from %s recorded game(s)",
                         added, marked)
    except Exception:
        # A repair that cannot run must not stop the app from starting.
        pass


def _backfill_training_titles():
    """Give existing training programs the subject line new ones get.

    Derived from the same function the create path uses, so an old program and
    a new one are labelled identically rather than by whichever code wrote them.
    """
    try:
        from sqlalchemy.orm import Session as _Session
        from .routes.training import _derive_title
        from . import models

        with _Session(engine) as sess:
            rows = (
                sess.query(models.TrainingSession)
                .filter(models.TrainingSession.title.is_(None))
                .all()
            )
            touched = 0
            for tr in rows:
                title = _derive_title(tr.program_text or "", tr.priorities or [])
                if title:
                    tr.title = title
                    touched += 1
            if touched:
                sess.commit()
    except Exception:
        pass


def _reparse_eval_sections():
    """Recompute green/watch/questions from report_text for existing rows.

    Deliberately its own Session on the engine rather than part of
    _run_migrations: that runs inside `engine.connect()`, and a nested
    Session's commit does not survive the enclosing block, so the rows were
    read, corrected in memory, and silently discarded.

    Re-parses rather than filling only the empties. The earlier parser ended a
    section only at a header carrying a colon, so on the other two header
    shapes GREEN FLAGS absorbed the watch flags, the key questions and the
    stat lines. Those rows are populated and wrong, so a fill-if-empty pass
    leaves every existing report showing a player's weaknesses as strengths.

    report_text is the source of truth — these columns are derived from it on
    write and recomputed after any correction — so this cannot lose coach input.
    """
    try:
        from sqlalchemy.orm import Session as _Session
        from .routes.evaluations import _parse_list_section
        from . import models

        with _Session(engine) as sess:
            rows = (
                sess.query(models.Evaluation)
                .filter(models.Evaluation.report_text.isnot(None))
                .all()
            )
            touched = 0
            for ev in rows:
                for field, header in (
                    ("green_flags", "GREEN FLAGS"),
                    ("watch_flags", "WATCH FLAGS"),
                    ("key_questions", "KEY QUESTIONS"),
                ):
                    parsed = _parse_list_section(ev.report_text, header)
                    if parsed and parsed != (getattr(ev, field) or []):
                        setattr(ev, field, parsed)
                        touched += 1
            if touched:
                sess.commit()
    except Exception:
        # A failed backfill must not stop the server booting.
        pass


ADDITIVE_COLUMNS: list[tuple[str, str, str]] = [
    # (table, column, SQL type + default)
    ("player_users", "preferred_language", "VARCHAR DEFAULT 'en'"),
    ("staff_shared_reports", "request_status", "VARCHAR"),
    ("feedback", "images", "TEXT"),
    ("coaches", "job_title", "VARCHAR"),
    ("generation_jobs", "payload", "TEXT"),
    ("generation_jobs", "partial", "TEXT"),
    ("generation_jobs", "attempts", "INTEGER DEFAULT 0"),
    ("game_report_clips", "team_name", "VARCHAR"),
    ("shared_reports", "hidden_sections", "TEXT"),
    ("share_approvals", "hidden_sections", "TEXT"),
    # The team-totals panel gained the basic totals after its table had already
    # shipped. create_all() adds missing TABLES and not missing COLUMNS, so
    # without these an import committed fine everywhere it was tested — on a
    # database created from scratch — and failed on the one that mattered, with
    # the coach told only "Could not import stats".
    ("game_team_advanced", "pts", "INTEGER"),
    ("game_team_advanced", "reb", "INTEGER"),
    ("game_team_advanced", "oreb", "INTEGER"),
    ("game_team_advanced", "dreb", "INTEGER"),
    ("game_team_advanced", "ast", "INTEGER"),
    ("game_team_advanced", "stl", "INTEGER"),
    ("game_team_advanced", "blk", "INTEGER"),
    ("game_team_advanced", "tov", "INTEGER"),
    ("game_team_advanced", "pf", "INTEGER"),
    # A box score prints a number beside every name; it was being read and
    # thrown away. Same lesson as the nine above — the table shipped first.
    ("game_player_stats", "jersey_number", "VARCHAR"),
    # Teams predate the distinction between a coach's own sides and the teams
    # they only keep records on. Everything already in the table was built by
    # hand, so it defaults to theirs; only the ones created automatically from
    # an opponent's box score start out as not.
    ("teams", "is_mine", "BOOLEAN DEFAULT TRUE"),
    # Marks the one-off roster repair as done for a game. Without it the
    # repair ran on every boot and put back players a coach had deleted.
    ("game_sessions", "roster_backfilled", "BOOLEAN DEFAULT FALSE"),
    # Whether a finished job has already been announced to its coach.
    ("generation_jobs", "announced", "BOOLEAN DEFAULT FALSE"),
    # A film and the box score of the same game, tied together.
    ("game_report_clips", "game_id", "INTEGER"),
    ("game_report_clips", "link_declined", "BOOLEAN DEFAULT FALSE"),
    ("game_reports", "game_date", "TIMESTAMP"),
    # Written material behind a scouting sentence, for spotting a stale one.
    ("scout_insights", "material", "INTEGER DEFAULT 0"),
    # Which coach's copy of a player is the more recent one, for merging two
    # rosters of the same team.
    ("players", "updated_at", "TIMESTAMP"),
    # What a film was analysed as, as opposed to what its packet is set to now.
    ("game_report_clips", "output_type", "VARCHAR"),
    # A box score prints these beside the counted stats; neither is countable.
    ("game_minutes_played", "plus_minus", "FLOAT"),
    ("game_minutes_played", "efficiency", "FLOAT"),
    # Added after the questionnaire had already collected responses.
    ("questionnaire_responses", "email", "VARCHAR"),
    # Replying to a particular message or comment, editing one, and taking one
    # back. All three tables predate the columns, and create_all() adds tables
    # rather than columns — without these, a staff conversation on the live
    # database fails on the first read.
    ("staff_messages", "parent_id", "INTEGER"),
    ("staff_messages", "edited_at", "TIMESTAMP"),
    ("staff_messages", "deleted_at", "TIMESTAMP"),
    ("staff_report_comments", "parent_id", "INTEGER"),
    ("staff_report_comments", "edited_at", "TIMESTAMP"),
    ("staff_report_comments", "deleted_at", "TIMESTAMP"),
    ("player_comments", "edited_at", "TIMESTAMP"),
    ("player_comments", "deleted_at", "TIMESTAMP"),
]


# Columns whose NOT NULL has to be lifted on an existing table.
#
# Kept separate from ADDITIVE_COLUMNS and deliberately short: this is the one
# schema change that is not additive and still cannot wait for Alembic, because
# without it the playbook whiteboard cannot save at all on Postgres.
RELAXED_COLUMNS: list[tuple[str, str]] = [
    # A playbook board belongs to no game. The column is a foreign key to
    # game_sessions, and the old code wrote a sentinel 0 that matches no row —
    # rejected by Postgres on every write.
    ("game_whiteboards", "game_id"),
]


def _relax_not_null():
    """Drop NOT NULL where the model now allows NULL. Idempotent."""
    from sqlalchemy import text

    with engine.connect() as conn:
        for table, column in RELAXED_COLUMNS:
            try:
                conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL"))
                conn.commit()
            except Exception as exc:
                # Already nullable, or a backend without this syntax. Neither is
                # worth refusing to start over.
                conn.rollback()
                log.warning("Could not relax %s.%s: %s", table, column, exc)


def _add_missing_columns():
    """Add columns create_all() cannot, on backends that support IF NOT EXISTS.

    Deliberately not a port of _run_migrations(). That function is twenty-six
    PRAGMA calls in SQLite's dialect, and half-porting it would produce
    something that looks portable and silently isn't. This is a short, explicit,
    additive list: every statement is idempotent, so a redeploy is a no-op and
    a fresh database created by create_all() already satisfies all of them.

    Additive only. A column that needs backfilling, renaming or dropping is the
    point at which this stops being enough and Alembic starts being the answer.
    """
    from sqlalchemy import text

    if not ADDITIVE_COLUMNS:
        return
    with engine.connect() as conn:
        for table, column, spec in ADDITIVE_COLUMNS:
            try:
                conn.execute(text(
                    f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {spec}"
                ))
                conn.commit()
            except Exception as exc:
                # A backend without IF NOT EXISTS, or a table that does not
                # exist yet. Neither is worth refusing to start over.
                conn.rollback()
                log.warning("Could not add %s.%s: %s", table, column, exc)


def _run_migrations():
    """Apply any schema changes that create_all() can't handle (column additions).

    SQLite only — see init_db().
    """
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
        if "onboarded" not in coach_cols:
            # Existing coaches default to onboarded=1 so they're never forced through it.
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE coaches ADD COLUMN onboarded INTEGER DEFAULT 1"
            ))
            conn.commit()
        if "last_season_reminder" not in coach_cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE coaches ADD COLUMN last_season_reminder TEXT"
            ))
            conn.commit()
        if "last_active" not in coach_cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE coaches ADD COLUMN last_active DATETIME"
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
        if "preferred_language" not in coach_cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE coaches ADD COLUMN preferred_language TEXT DEFAULT 'en'"
            ))
            conn.commit()
        if "play_style_profile" not in coach_cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE coaches ADD COLUMN play_style_profile TEXT"
            ))
            conn.commit()
        if "play_style_synced_at" not in coach_cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE coaches ADD COLUMN play_style_synced_at DATETIME"
            ))
            conn.commit()

        # Add roster-owner coach_id to players + backfill.
        if "coach_id" not in cols:
            conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE players ADD COLUMN coach_id INTEGER"
            ))
            conn.commit()
            # Owner = the coach who owns the player's team, else the first coach
            # who evaluated them (best-effort for legacy team-less players).
            conn.execute(__import__("sqlalchemy").text(
                "UPDATE players SET coach_id = (SELECT teams.coach_id FROM teams WHERE teams.id = players.team_id) "
                "WHERE team_id IS NOT NULL AND coach_id IS NULL"
            ))
            conn.execute(__import__("sqlalchemy").text(
                "UPDATE players SET coach_id = (SELECT e.coach_id FROM evaluations e WHERE e.player_id = players.id ORDER BY e.id LIMIT 1) "
                "WHERE coach_id IS NULL"
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
            if gr_cols and "opponent_a_name" not in gr_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE game_reports ADD COLUMN opponent_a_name TEXT"
                ))
                conn.commit()
            if gr_cols and "extra_teams" not in gr_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE game_reports ADD COLUMN extra_teams TEXT"
                ))
                conn.commit()
        except Exception:
            pass

        # Cached on-view report translations (created by create_all on fresh DBs;
        # this guard covers databases that predate the table).
        try:
            conn.execute(__import__("sqlalchemy").text(
                """CREATE TABLE IF NOT EXISTS report_translations (
                       id INTEGER PRIMARY KEY AUTOINCREMENT,
                       report_type TEXT NOT NULL,
                       report_id INTEGER NOT NULL,
                       lang TEXT NOT NULL,
                       source_hash TEXT NOT NULL,
                       text TEXT NOT NULL,
                       created_at DATETIME
                   )"""))
            conn.execute(__import__("sqlalchemy").text(
                "CREATE INDEX IF NOT EXISTS ix_report_tr_lookup "
                "ON report_translations (report_type, report_id, lang)"))
            conn.commit()
        except Exception:
            pass

        # Notifications carry an optional i18n key + params so the client can
        # render them in the coach's language instead of stored English prose.
        try:
            pn_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(player_notifications)")
            )]
            if pn_cols and "i18n_key" not in pn_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE player_notifications ADD COLUMN i18n_key TEXT"))
                conn.commit()
            if pn_cols and "i18n_params" not in pn_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE player_notifications ADD COLUMN i18n_params TEXT"))
                conn.commit()
        except Exception:
            pass

        # Add title to evaluations if missing (match-up display title, e.g. "A vs B")
        try:
            ev_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(evaluations)")
            )]
            if ev_cols and "title" not in ev_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE evaluations ADD COLUMN title TEXT"
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
            if ssr_cols and "updated_report_id" not in ssr_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE staff_shared_reports ADD COLUMN updated_report_id INTEGER"
                ))
                conn.commit()
            src_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(staff_report_comments)")
            )]
            if src_cols and "target" not in src_cols:
                conn.execute(__import__("sqlalchemy").text(
                    "ALTER TABLE staff_report_comments ADD COLUMN target VARCHAR DEFAULT 'original'"
                ))
                conn.commit()
        except Exception:
            pass

        # Add completed_drills to player_training if missing
        try:
            ptr_cols = [row[1] for row in conn.execute(
                __import__("sqlalchemy").text("PRAGMA table_info(training_sessions)")
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

        # Box-score imports used to store stat_category as "positive"/"negative"
        # (the sign of the points) instead of "offense"/"defense". Rows written
        # that way are dropped from the off/def totals and raise a KeyError in
        # the per-quarter split, so re-derive the category from the stat name.
        try:
            from .routes.game_eval import DEFENSE_STATS
            text = __import__("sqlalchemy").text
            bad = conn.execute(text(
                "SELECT COUNT(*) FROM game_player_stats "
                "WHERE stat_category NOT IN ('offense', 'defense')"
            )).scalar()
            if bad:
                for name in DEFENSE_STATS:
                    conn.execute(text(
                        "UPDATE game_player_stats SET stat_category = 'defense' "
                        "WHERE stat_category NOT IN ('offense', 'defense') "
                        "AND stat_name = :n"
                    ), {"n": name})
                # Everything left is offense — including the negative offensive
                # stats (missed shots, turnovers) the old code mislabelled.
                conn.execute(text(
                    "UPDATE game_player_stats SET stat_category = 'offense' "
                    "WHERE stat_category NOT IN ('offense', 'defense')"))
                conn.commit()
        except Exception:
            pass

        # Training programs gained a subject line.
        try:
            text = __import__("sqlalchemy").text
            cols = [row[1] for row in conn.execute(text("PRAGMA table_info(training_sessions)"))]
            if cols and "title" not in cols:
                conn.execute(text("ALTER TABLE training_sessions ADD COLUMN title TEXT"))
                conn.commit()
        except Exception:
            pass

        # Distinguish live-tracked stats from imported box scores so a re-import
        # can replace the previous import instead of doubling every count.
        try:
            text = __import__("sqlalchemy").text
            cols = [row[1] for row in conn.execute(text("PRAGMA table_info(game_player_stats)"))]
            if cols and "source" not in cols:
                conn.execute(text(
                    "ALTER TABLE game_player_stats ADD COLUMN source TEXT DEFAULT 'live'"))
                conn.execute(text(
                    "UPDATE game_player_stats SET source = 'live' WHERE source IS NULL"))
                conn.commit()
        except Exception:
            pass

        # Coach notifications gained the same i18n pointer the player ones have,
        # so a notification is stored once and rendered in the reader's language.
        try:
            text = __import__("sqlalchemy").text
            cn_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(coach_notifications)"))]
            if cn_cols and "i18n_key" not in cn_cols:
                conn.execute(text("ALTER TABLE coach_notifications ADD COLUMN i18n_key TEXT"))
                conn.commit()
            if cn_cols and "i18n_params" not in cn_cols:
                conn.execute(text("ALTER TABLE coach_notifications ADD COLUMN i18n_params TEXT"))
                conn.commit()
        except Exception:
            pass

        # Team joins became approval-gated: the same table now also carries
        # coach-asked-to-join rows, distinguished by kind.
        try:
            text = __import__("sqlalchemy").text
            ti_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(team_invites)"))]
            if ti_cols and "kind" not in ti_cols:
                conn.execute(text("ALTER TABLE team_invites ADD COLUMN kind TEXT DEFAULT 'invite'"))
                # Everything that existed before was an owner-issued invite.
                conn.execute(text("UPDATE team_invites SET kind = 'invite' WHERE kind IS NULL"))
                conn.commit()
        except Exception:
            pass

        # Deleting hides a record now instead of destroying it. Every table
        # behind a SoftDeleteMixin model needs the column before the global
        # filter (which runs on every SELECT) can reference it.
        try:
            text = __import__("sqlalchemy").text
            for table in ("evaluations", "team_reports", "game_reports",
                          "game_sessions", "training_sessions", "players", "teams"):
                cols = [row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))]
                if cols and "deleted_at" not in cols:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN deleted_at DATETIME"))
                    conn.commit()
        except Exception:
            pass

        # Everything in ADDITIVE_COLUMNS, applied the SQLite way.
        #
        # That list is what the server path uses; sharing it means a new column
        # is declared once and lands on both backends, instead of a developer's
        # existing bloomprint.db quietly missing a column the models select.
        # SQLite has no ADD COLUMN IF NOT EXISTS, so existence is checked first.
        try:
            text = __import__("sqlalchemy").text
            for table, column, spec in ADDITIVE_COLUMNS:
                cols = [row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))]
                if cols and column not in cols:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {spec}"))
                    conn.commit()
        except Exception as exc:
            log.warning("Could not apply additive columns on SQLite: %s", exc)


# A job that dies three times is failing for its own reasons, not because of
# bad luck with deploys. Counted only for attempts that achieved nothing.
ATTEMPT_CAP = 3

# The longest a running job may legitimately go without saying anything. Every
# phase reports itself far more often than this — the pre-scan in percentages,
# segments one by one, the report every hundred words — so silence for this
# long means the thread doing the work is gone.
STALLED_AFTER_MINUTES = 15


def revive_if_stalled(sess, job) -> bool:
    """Notice a job nobody is working on any more, from wherever we happen to be.

    The startup sweep below only runs when the server starts. A worker that dies
    while the process keeps running — or a container replaced without the
    replacement ever seeing the row — leaves a job saying "processing" with a
    progress label frozen at whatever it last reported. Nothing then looks at it
    again, so the coach watches a bar that will never move for as long as they
    are willing to wait.

    This runs on the polling path instead: every time the app asks how a job is
    doing, a job that has said nothing for a quarter of an hour is picked back
    up, or closed with a reason. Cheap enough to do on every poll — it is one
    timestamp comparison — and it needs no scheduler to be running.

    Returns True if something was done to the job.
    """
    from datetime import datetime, timedelta

    if job is None or job.status != "processing" or not job.updated_at:
        return False
    if datetime.utcnow() - job.updated_at < timedelta(minutes=STALLED_AFTER_MINUTES):
        return False

    progressed = _made_progress(job)
    attempts = 0 if progressed else (job.attempts or 0) + 1
    done_now, _ = _segments_done(job)
    if job.payload and attempts <= ATTEMPT_CAP:
        job.attempts = attempts
        job.partial = _remember_segment_count(job, done_now)
        # Stamped so the next poll, seconds later, sees a fresh row and does not
        # start a second copy of the same work.
        job.updated_at = datetime.utcnow()
        sess.commit()
        _resume_job(job.id, job.kind, job.payload)
        log.info("Stalled job %s picked back up (attempt %s)", job.id, attempts)
        return True

    job.status = "error"
    job.error = (
        "This stopped part-way and could not be picked back up — nothing was "
        "saved. Run it again."
        if not job.payload else
        f"Stopped after {ATTEMPT_CAP} attempts that made no progress. "
        "Try running it again."
    )
    _mark_subject_failed(sess, job)
    sess.commit()
    log.info("Stalled job %s closed as errored", job.id)
    return True


def _fail_orphaned_jobs():
    """Pick up, or close out, jobs whose process is gone.

    Film analysis runs in a background thread and can take twenty minutes. If
    the container stops in the middle — a deploy, a restart, the platform
    reclaiming it — the thread dies with it and the row is left saying
    "processing" forever. The app polls that row, so the coach watches a
    progress bar that will never move again.

    Any job still marked processing when the server starts belongs to a process
    that no longer exists: this one has only just begun. Where the row carries
    the arguments it was called with, run it again — the segments it already
    finished are on the row too, so it resumes rather than restarting the film.
    Where it does not, or where it has already been tried too many times, mark
    it errored with a reason a coach can act on.

    ATTEMPT_CAP counts attempts that achieved NOTHING, not restarts. A film
    analysis is many segments over many minutes, and a busy day of deploys can
    restart the server more times than that — counting restarts meant the
    coach's three-hour film was abandoned because of OUR releases, not because
    anything was wrong with it. A job that recorded new segments since its last
    attempt is making progress and starts its count again; only a job that
    comes back with nothing to show for an attempt burns one.
    """
    try:
        from sqlalchemy.orm import Session as _Session
        from . import models

        resumable = []
        with _Session(engine) as sess:
            stale = sess.query(models.GenerationJob).filter_by(status="processing").all()
            for job in stale:
                done_now, _ = _segments_done(job)
                progressed = _made_progress(job)
                attempts = 0 if progressed else (job.attempts or 0) + 1
                if job.payload and attempts <= ATTEMPT_CAP:
                    job.attempts = attempts
                    job.partial = _remember_segment_count(job, done_now)
                    resumable.append((job.id, job.kind, job.payload))
                    continue
                job.status = "error"
                job.error = (
                    "The server restarted while this was running, so the analysis "
                    "stopped part-way. Nothing was saved — run it again."
                    if not job.payload else
                    f"Stopped after {ATTEMPT_CAP} attempts that made no progress. "
                    "Try running it again."
                )
                _mark_subject_failed(sess, job)
            if stale:
                sess.commit()

        for job_id, kind, payload in resumable:
            _resume_job(job_id, kind, payload)
        if stale:
            log.info("Restart: resumed %d job(s), closed %d",
                     len(resumable), len(stale) - len(resumable))
    except Exception as exc:
        log.warning("Could not settle orphaned jobs: %s", exc)


def _segments_done(job) -> tuple[int, int]:
    """(segments recorded now, segments recorded at the previous attempt)."""
    import json

    try:
        data = json.loads(job.partial or "{}")
    except Exception:
        return 0, 0
    return len(data.get("segments") or {}), int(data.get("seen_at_resume") or 0)


def _made_progress(job) -> bool:
    """Did this attempt achieve anything, by any measure?

    Segments are not the only work a job does. The last phase — writing the
    report — records no segments at all, because they were all finished before
    it started. Judging progress by segment count alone meant a job killed
    while writing looked identical to one that crashed on startup, so a run of
    deploys during that phase would abandon a nearly-finished report and blame
    it for making no progress.

    The progress label moves throughout, whatever the phase, so a label that has
    changed since the last attempt is proof the job was alive and working.
    """
    import json

    done_now, done_before = _segments_done(job)
    if done_now > done_before:
        return True
    try:
        data = json.loads(job.partial or "{}")
    except Exception:
        return False
    seen = data.get("seen_progress")
    return bool(job.progress) and job.progress != seen


def _remember_segment_count(job, done: int) -> str:
    """Stamp what had been achieved, so the next restart can tell real progress
    from a job that is simply crashing on start."""
    import json

    try:
        data = json.loads(job.partial or "{}")
    except Exception:
        data = {}
    data["seen_at_resume"] = done
    data["seen_progress"] = job.progress
    return json.dumps(data)


def _mark_subject_failed(sess, job):
    """Put the reason where the coach will actually see it.

    A job that dies with its container runs no exception handler, so the thing
    it was filling in — a packet's film breakdown — was left blank with no
    explanation. The packet then shows a clip that is forever "analyzing", and
    the coach is left waiting for a report that is never coming.
    """
    import json

    try:
        from . import models

        call = json.loads(job.payload or "{}")
        clip_id = call.get("clip_id")
        if job.kind == "clip" and clip_id:
            clip = sess.get(models.GameReportClip, clip_id)
            if clip and not clip.analysis_text:
                clip.analysis_text = (
                    "Analysis stopped before it finished — the server restarted while this "
                    "film was being watched. The film is still attached; delete this clip "
                    "and add it again to retry."
                )
    except Exception:
        pass


def _resume_job(job_id: int, kind: str, payload: str):
    """Run an interrupted job again, on its own thread.

    A thread rather than the request's BackgroundTasks because there is no
    request here — this is startup. Failures are logged and left on the job
    row; nothing about a resumed job may stop the server from coming up.
    """
    import json
    import threading

    try:
        call = json.loads(payload)
    except Exception:
        return

    def run():
        try:
            if kind == "clip":
                from .routes.game_reports import _run_clip_analysis

                _run_clip_analysis(
                    call["clip_id"], job_id, call["video_path"], call["output_type"],
                    call["program_name"], call["opp_name"], call["label_text"],
                    call["coach_weight"], call["focus_prompt"], call.get("level", "HS Varsity"),
                    # Absent on a job queued before the packet's report context
                    # was carried through — those resume with the old behaviour
                    # rather than failing.
                    call.get("report_subject", ""), call.get("report_context", ""),
                    call.get("report_segment_note", ""),
                )
            elif kind == "packet":
                from .routes.game_reports import _run_packet_generation

                _run_packet_generation(call["report_id"], job_id, call["coach_id"])
            elif kind == "scouting":
                from .routes.game_eval import _run_scouting_job

                _run_scouting_job(call["game_id"], call["coach_id"], job_id,
                                  call.get("edits"))
            elif kind == "game_report_full":
                from .routes.game_eval import _run_game_report_job

                _run_game_report_job(call["game_id"], call["coach_id"], job_id,
                                     call.get("edits"))
            elif kind == "training":
                from .routes.training import _run_training_job

                _run_training_job(job_id, call["coach_id"], call["player_id"],
                                  call.get("evaluation_id"), call["content"])
            elif kind == "eval_text":
                from .routes.evaluations import _run_eval_text_job

                _run_eval_text_job(
                    job_id, call["player_id"], call["coach_id"], call["output_type"],
                    call["competition_level"], call["coach_notes"],
                    call["combined_focus"], call.get("title"),
                )
            else:
                log.warning("No resume handler for job kind %r", kind)
        except Exception as exc:
            log.warning("Resumed job %s failed: %s", job_id, exc)

    threading.Thread(target=run, name=f"resume-job-{job_id}", daemon=True).start()
