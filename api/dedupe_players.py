"""One person, one card.

Two ways the same player ended up on a roster twice. A box score imported
again under a slightly different heading, and a shared game, which creates a
record on the SENDER's side for every name in it — a coach who already kept
that player then had their own row and the shared twin side by side.

The listing rule stops both from here on. This is for the rows already
written. Same name and same number, under the same coach and the same
program, is the same person: everything that pointed at the extra rows is
re-pointed at the one that stays, and the extras are hidden the way any
deleted record is hidden — the data is still there if this got something
wrong.

The row that stays is the one carrying the most: evaluations first, because
that is a coach's own work, then the most filled-in profile, then the oldest
record. A row belonging to another coach is never touched.
"""
from sqlalchemy import text

from . import models
from .softdelete import soft_delete

# Every table that names a player, and the column that does it.
_REFERENCES = [
    ("evaluations", "player_id"),
    ("training_sessions", "player_id"),
    ("player_users", "player_id"),
    ("player_access", "player_id"),
    ("game_player_stats", "player_id"),
    ("shared_reports", "subject_player_id"),
]

_PROFILE_FIELDS = ("position", "jersey_number", "age", "height", "wingspan",
                   "weight", "standing_reach", "country", "state", "city",
                   "school_name", "notes")


def _name(p) -> str:
    return " ".join((p.name or "").split()).lower()


def _number(p) -> str:
    return str(p.jersey_number or "").strip().lstrip("#").lower()


def _program(p) -> str:
    return " ".join((p.program_name or "").split()).lower()


def _richness(db, p) -> tuple:
    evals = db.query(models.Evaluation).filter_by(player_id=p.id).count()
    filled = sum(1 for f in _PROFILE_FIELDS if getattr(p, f, None))
    # Negative id so the oldest wins a tie: sorted descending, -3 beats -7.
    return (evals, filled, -p.id)


def find_duplicate_groups(db) -> list[tuple[int, list[int]]]:
    """(keeper id, ids to fold into it) for every duplicated player.

    Only rows with a number on them: a name with no number is not enough to
    call two records the same person.
    """
    groups: dict[tuple, list] = {}
    for p in db.query(models.Player).all():
        if p.deleted_at is not None or not p.coach_id:
            continue
        num = _number(p)
        if not num or not _name(p):
            continue
        groups.setdefault((p.coach_id, _name(p), num, _program(p)), []).append(p)
    out = []
    for rows in groups.values():
        if len(rows) < 2:
            continue
        rows.sort(key=lambda p: _richness(db, p), reverse=True)
        out.append((rows[0].id, [p.id for p in rows[1:]]))
    return out


def merge_duplicates(db) -> int:
    """Fold duplicates into one record each. Returns how many rows were folded."""
    folded = 0
    for keeper_id, extra_ids in find_duplicate_groups(db):
        keeper = db.get(models.Player, keeper_id)
        # Whichever row wins, nothing on the others is thrown away: a blank
        # field on the keeper is filled from them. One card was imported with
        # a position and a height and the other carried the evaluation, and
        # keeping either alone lost half of what the coach had.
        for pid in extra_ids:
            extra = db.get(models.Player, pid)
            if extra is None or keeper is None:
                continue
            for field in _PROFILE_FIELDS:
                if not getattr(keeper, field, None) and getattr(extra, field, None):
                    setattr(keeper, field, getattr(extra, field))
            if keeper.team_id is None and extra.team_id is not None:
                keeper.team_id = extra.team_id
        for table, column in _REFERENCES:
            # The id list is written into the statement as its own placeholders.
            # A bound tuple is not an IN list — the driver rejects it, and every
            # one of these failed silently, so nothing was ever re-pointed and
            # the evaluations on a folded row would have been orphaned.
            holes = ", ".join(f":p{i}" for i in range(len(extra_ids)))
            params = {"keep": keeper_id}
            params.update({f"p{i}": pid for i, pid in enumerate(extra_ids)})
            # A savepoint, so a table this deployment does not have yet costs
            # that table and not the whole merge.
            sp = db.begin_nested()
            try:
                db.execute(
                    text(f"UPDATE {table} SET {column} = :keep "
                         f"WHERE {column} IN ({holes})"), params)
                sp.commit()
            except Exception:
                sp.rollback()
        # One grant per (player, coach) — the re-point above can make two.
        seen = set()
        for a in (db.query(models.PlayerAccess)
                  .filter(models.PlayerAccess.player_id == keeper_id).all()):
            if a.coach_id in seen:
                db.delete(a)
            else:
                seen.add(a.coach_id)
        for pid in extra_ids:
            soft_delete(db, db.get(models.Player, pid))
            folded += 1
    if folded:
        db.commit()
    return folded
