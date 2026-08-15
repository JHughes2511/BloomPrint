"""When a shared game stops being live, the recipient keeps what they had.

A game shared as Game Insights is a live link: it sits on the recipient's
schedule, counts in their season record, and follows the sender's corrections.
Nothing is copied while that holds.

The link can end — the sender deletes the game, takes the share back, or
leaves. Letting the game simply vanish would take a night the recipient had
already read, graded and commented on out of their season with no notice, and
change a record they had written down. So at that moment, and only then, the
game is copied into the recipient's account exactly as it last stood, marked
frozen. It stops following anything, and stays read-only: it is still not
their game, it is a record of one.
"""
from datetime import datetime

from sqlalchemy.orm import Session

from . import models


def _norm(x) -> str:
    return "".join(ch for ch in str(x or "").lower() if ch.isalnum())


def _recipients(db: Session, game_id: int) -> list[int]:
    return [r.recipient_id for r in db.query(models.StaffSharedReport)
            .filter(models.StaffSharedReport.report_id == game_id,
                    models.StaffSharedReport.report_type.in_(("game_session", "game")))
            .all()]


def freeze_for(db: Session, game: models.GameSession, recipient_id: int) -> int | None:
    """Copy a game into one recipient's account as a frozen record.

    Returns the new game's id, or None if there is nothing to do — already
    frozen for them, or the game is theirs to begin with.
    """
    if game is None or game.coach_id == recipient_id:
        return None
    already = (db.query(models.GameSession)
               .filter_by(coach_id=recipient_id, frozen_from_game_id=game.id).first())
    if already:
        return already.id

    sender = db.get(models.Coach, game.coach_id)
    ours = db.get(models.Team, game.team_id) if game.team_id else None
    # Filed under the recipient's own record of that team, which the share
    # created when it landed. Falls back to no team rather than pointing at a
    # team row belonging to someone else.
    team_id = None
    if ours and ours.name:
        match = next((t for t in db.query(models.Team).filter_by(coach_id=recipient_id).all()
                      if t.deleted_at is None and _norm(t.name) == _norm(ours.name)), None)
        team_id = match.id if match else None

    copy = models.GameSession(
        coach_id=recipient_id,
        team_id=team_id,
        opponent_name=game.opponent_name,
        date=game.date,
        location=game.location,
        our_score=game.our_score,
        opponent_score=game.opponent_score,
        season_phase=game.season_phase,
        season_year=game.season_year,
        tracking_mode=game.tracking_mode,
        competition_level=game.competition_level,
        period_format=game.period_format,
        num_periods=game.num_periods,
        period_seconds=game.period_seconds,
        status=game.status,
        frozen_from_game_id=game.id,
        frozen_from=(sender.name if sender else None),
        frozen_at=datetime.utcnow(),
    )
    db.add(copy)
    db.flush()

    for st in db.query(models.GamePlayerStat).filter_by(game_id=game.id).all():
        db.add(models.GamePlayerStat(
            game_id=copy.id, player_id=st.player_id, player_name=st.player_name,
            jersey_number=st.jersey_number, is_opponent=st.is_opponent,
            quarter=st.quarter, stat_name=st.stat_name, stat_category=st.stat_category,
            raw_points=st.raw_points, quarter_multiplier=st.quarter_multiplier,
            weighted_points=st.weighted_points, count=st.count, source=st.source))
    for m in db.query(models.GameMinutesPlayed).filter_by(game_id=game.id).all():
        db.add(models.GameMinutesPlayed(
            game_id=copy.id, player_name=m.player_name, is_opponent=m.is_opponent,
            minutes_played=m.minutes_played,
            plus_minus=getattr(m, "plus_minus", None),
            efficiency=getattr(m, "efficiency", None)))
    return copy.id


def freeze_all(db: Session, game: models.GameSession) -> int:
    """Freeze a game for everyone it was shared with. Returns how many."""
    if game is None:
        return 0
    return len([1 for rid in set(_recipients(db, game.id))
                if freeze_for(db, game, rid) is not None])
