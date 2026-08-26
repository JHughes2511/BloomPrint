"""Two coaches, one team, one roster.

A head coach and their assistant both keep the same team. Until they are on it
together in the app, each of them has their own copy: the same fourteen kids
typed in twice, one list with wingspans and no schools, the other with schools
and a misspelt name.

Joining the team is the moment to reconcile that. After it there is ONE row per
player on the team, which is what makes everything afterwards work — a coach
correcting a spelling or adding a wingspan is editing the row the other coach
reads, so it simply shows up. There is no background job and nothing to keep in
step, because there is no second copy left to drift.

WHAT MERGES AND WHAT DOES NOT

Who the player is merges: name, number, position, the measurements, where they
are from, what school they are at. That is shared knowledge, and a blank field
means "I don't know", not "no" — so a blank on one side is filled from the
other. When both sides have a value and they disagree, the more recently edited
row wins: someone measured that player again.

What a coach THINKS of the player does not merge. Evaluations, BIM grades and
notes stay with the coach who wrote them; the merge moves a coach's own
evaluations onto the surviving row so their history follows the player, and
they remain theirs alone (see `_bim_evals` in routes/players.py).

LEAVING

Leaving the team stops the sharing but does not take the players away. The
coach keeps a private copy of the players they had worked with, carrying their
own evaluations, and edits on the team's roster stop reaching it — which is
what "we no longer coach together" means.
"""
from datetime import datetime
from difflib import SequenceMatcher

from sqlalchemy.orm import Session

from . import emails, models, notify
from .softdelete import soft_delete

# Who the player is. Shared knowledge, and the only thing that merges.
SYNC_FIELDS = (
    "position", "jersey_number", "age", "height", "wingspan", "weight",
    "standing_reach", "country", "state", "city", "school_name",
    "competition_level", "parent_permission",
)

# Rows that belong to whoever wrote them and follow that coach's copy of the
# player, rather than staying with the surviving roster row.
_COACH_OWNED = ("Evaluation", "TrainingSession", "PlayerVideo")

# Rows that describe the player rather than any one coach's read of them.
_PLAYER_OWNED = (
    "InviteCode", "LinkRequest", "GamePlayerStat", "LineupEvent",
    "GameMinutesPlayed", "PlayerAccess",
)

# A claimed player account is 1:1 with a roster row, so it can only be moved
# onto a row that does not already have one — otherwise merging two claimed
# rows would leave a player unable to sign in.
_ACCOUNT_TABLES = ("PlayerUser", "PlayerUserLink")

MAX_PROPOSALS = 40


def _norm(value: str | None) -> str:
    return (value or "").strip().lower()


def _key(player: models.Player) -> tuple[str, str]:
    """What makes two rows the same player: the name and the number.

    Either alone is not enough — a squad has two Williamses, and last year's
    number 4 is this year's number 11.
    """
    return (_norm(player.name), _norm(player.jersey_number))


def _same_person(a: models.Player, b: models.Player) -> bool:
    """Same number, and near enough the same name to be a typo rather than
    another player.

    Matching on the name exactly would have defeated the case this is most
    needed for: one coach has "Marcus Jonson" and the other has fixed it to
    "Marcus Johnson". On an exact match those are two players, and the roster
    ends up with both — the precise thing a coach joining a team is trying to
    avoid. A squad does not have two number 4s, so the number carries most of
    the weight and the name only has to agree.
    """
    if _norm(a.jersey_number) != _norm(b.jersey_number):
        return False
    if not _norm(a.jersey_number):
        return False   # no number on either side: too weak to merge on a name
    x, y = _norm(a.name), _norm(b.name)
    if not x or not y:
        return False
    return SequenceMatcher(None, x, y).ratio() >= 0.8


def _blank(value) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    return False


def _edited_at(player: models.Player) -> datetime:
    return player.updated_at or player.created_at or datetime.min


def reconcile(keep: models.Player, other: models.Player) -> int:
    """Fold `other`'s knowledge of the player into `keep`. Returns fields changed.

    Nothing is ever blanked: a coach who left height empty is saying they do not
    know it, and their silence must not erase the other coach's answer.
    """
    changed = 0
    other_newer = _edited_at(other) > _edited_at(keep)
    for field in SYNC_FIELDS:
        mine, theirs = getattr(keep, field), getattr(other, field)
        if _blank(theirs):
            continue
        if _blank(mine) or (mine != theirs and other_newer):
            setattr(keep, field, theirs)
            changed += 1
    # A spelling correction is the same kind of edit as a measurement, but the
    # name is half of what identifies the row, so only a newer row may rewrite it.
    if not _blank(other.name) and other.name != keep.name and other_newer:
        keep.name = other.name
        changed += 1
    return changed


def _move_rows(db: Session, model_name: str, player_id: int, to_player_id: int,
               coach_id: int | None = None) -> int:
    """Repoint a player's rows at another player row, without loading them."""
    cls = getattr(models, model_name, None)
    if cls is None:
        return 0
    q = db.query(cls).filter(cls.player_id == player_id)
    if coach_id is not None and hasattr(cls, "coach_id"):
        q = q.filter(cls.coach_id == coach_id)
    return q.update({"player_id": to_player_id}, synchronize_session=False)


def _absorb(db: Session, keep: models.Player, other: models.Player) -> None:
    """Everything hanging off `other` moves to `keep`, then `other` is hidden."""
    for name in _COACH_OWNED + _PLAYER_OWNED:
        _move_rows(db, name, other.id, keep.id)
    # Only when the surviving row has no account of its own — see _ACCOUNT_TABLES.
    if not db.query(models.PlayerUser).filter_by(player_id=keep.id).first():
        for name in _ACCOUNT_TABLES:
            _move_rows(db, name, other.id, keep.id)
    soft_delete(db, other)


def _team_roster(db: Session, team_id: int) -> list[models.Player]:
    return db.query(models.Player).filter(models.Player.team_id == team_id).all()


def _duplicate_rosters(db: Session, team: models.Team,
                       coach: models.Coach) -> list[models.Player]:
    """The joining coach's own copy of this team, if they kept one.

    Their own teams of the same name — not every player they have. A coach who
    joins a team called Varsity should not have their club roster swept in.
    """
    mine = (
        db.query(models.Team)
        .filter(models.Team.coach_id == coach.id, models.Team.id != team.id)
        .all()
    )
    ids = [t.id for t in mine if _norm(t.name) == _norm(team.name)]
    if not ids:
        return []
    return (
        db.query(models.Player)
        .filter(models.Player.team_id.in_(ids))
        .all()
    )


def on_staff_joined(db: Session, team: models.Team, coach: models.Coach) -> dict:
    """Merge a newly joined coach's copy of this team into the team's roster.

    Does not commit — the caller owns the transaction, so a join and its merge
    land together or not at all.
    """
    if team is None or coach is None:
        return {"merged": 0, "filled": 0, "proposed": 0}

    canon = _team_roster(db, team.id)
    by_key: dict[tuple[str, str], models.Player] = {}
    for p in canon:
        by_key.setdefault(_key(p), p)

    merged = filled = proposed = 0
    owner_id = team.coach_id
    taken: set[int] = set()

    for dup in _duplicate_rosters(db, team, coach):
        match = by_key.get(_key(dup))
        if match is None:
            match = next((p for p in canon
                          if p.id not in taken and _same_person(p, dup)), None)
        if match is not None and match.id != dup.id:
            taken.add(match.id)
            filled += reconcile(match, dup)
            # Their read of the player follows them onto the surviving row and
            # stays theirs; anything about the player themself is already on it.
            _absorb(db, match, dup)
            merged += 1
        elif match is None and proposed < MAX_PROPOSALS:
            if _propose(db, team, coach, dup, owner_id):
                proposed += 1

    return {"merged": merged, "filled": filled, "proposed": proposed}


def _propose(db: Session, team: models.Team, coach: models.Coach,
             player: models.Player, owner_id: int) -> bool:
    existing = (
        db.query(models.RosterProposal)
        .filter_by(team_id=team.id, player_id=player.id, status="pending")
        .first()
    )
    if existing:
        return False
    row = models.RosterProposal(team_id=team.id, player_id=player.id,
                                proposed_by=coach.id, status="pending")
    db.add(row)
    db.flush()
    if owner_id and owner_id != coach.id:
        params = {"coach": coach.name, "player": player.name, "team": team.name}
        db.add(models.CoachNotification(
            coach_id=owner_id,
            title="A player to add to your roster",
            body=f"{coach.name} has {player.name} on their copy of {team.name}. "
                 f"Add them to the roster?",
            i18n_key="notifs.rosterPlayerProposed",
            i18n_params=params,
            type="roster_player_proposed",
            ref_id=row.id,
        ))
        # This one is a question, not an announcement: the roster stays as it
        # is until the owner answers it.
        notify.coach_notification(db.get(models.Coach, owner_id),
                                  "notifs.rosterPlayerProposed", params,
                                  link=emails.link_to("/home/staff"))
    return True


def accept_proposal(db: Session, proposal: models.RosterProposal,
                    decided_by: models.Coach) -> models.Player | None:
    """Say yes: the proposed row joins the team's roster, history and all.

    If the player has since been added by hand, the two are merged instead of
    both landing — the thing this whole module exists to prevent.
    """
    player = db.get(models.Player, proposal.player_id)
    proposal.status = "approved"
    proposal.decided_by = decided_by.id
    if player is None:
        return None
    twin = next((p for p in _team_roster(db, proposal.team_id)
                 if p.id != player.id
                 and (_key(p) == _key(player) or _same_person(p, player))), None)
    if twin is not None:
        reconcile(twin, player)
        _absorb(db, twin, player)
        return twin
    player.team_id = proposal.team_id
    return player


def reject_proposal(db: Session, proposal: models.RosterProposal,
                    decided_by: models.Coach) -> None:
    """Say no: the player stays exactly where they were, on the proposer's own
    roster. Declining is not deleting somebody else's player."""
    proposal.status = "rejected"
    proposal.decided_by = decided_by.id


def on_staff_left(db: Session, team: models.Team, coach: models.Coach) -> int:
    """Leaving keeps what you worked on, and stops it updating.

    A private copy of every player this coach evaluated or originally entered,
    carrying their own evaluations. The team's roster is untouched: the rest of
    the staff lose nothing by someone leaving.
    """
    if team is None or coach is None:
        return 0
    roster = _team_roster(db, team.id)
    if not roster:
        return 0
    ids = [p.id for p in roster]
    worked_on = {
        e.player_id for e in db.query(models.Evaluation)
        .filter(models.Evaluation.player_id.in_(ids),
                models.Evaluation.coach_id == coach.id).all()
    }
    kept = 0
    for player in roster:
        if player.id not in worked_on and player.coach_id != coach.id:
            continue
        copy = models.Player(name=player.name, team_id=None, coach_id=coach.id,
                             notes=None, program_name=player.program_name)
        for field in SYNC_FIELDS:
            setattr(copy, field, getattr(player, field))
        db.add(copy)
        db.flush()
        for name in _COACH_OWNED:
            _move_rows(db, name, player.id, copy.id, coach_id=coach.id)
        # A row they originally entered stays with the team, but stops being
        # theirs — otherwise they would keep reading the team's live roster
        # through it, and leaving would not have stopped anything.
        if player.coach_id == coach.id and team.coach_id:
            player.coach_id = team.coach_id
        kept += 1
    return kept
