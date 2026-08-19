"""One search box over everything a coach can see.

Grouped by kind rather than blended into a single ranked list: a coach typing
"Marcus" wants the player, and a coach typing "Kennedy" wants the game against
them. Keeping the groups separate lets the client show "Players / Training /
Packets" headings, which answers "why did this match?" without a relevance
score nobody can interrogate.

WHAT IT LOOKS AT

Everything the app makes: players, teams, evaluations, training programs, team
reports, game packets and scouting reports. This used to be four of those, so
a training program was unfindable by name and a player who arrived through a
shared report could not be found at all — both of them plainly visible one
screen away, which reads as the search box being broken rather than narrow.

Names AND text. Typing a player's name finds their reports; typing "1-3-1" or
"transition defense" finds every report that argues about it, with the matching
line quoted underneath so a hit is never a mystery.

WHAT A COACH CAN SEE

The same rule the rest of the app uses, not a looser one written here: their
own rows, rows belonging to teams they are staff of, and rows another coach has
explicitly shared with them. Search is exactly the kind of endpoint where a
missing ownership filter leaks quietly — it returns other people's rows as
"results" rather than as an error, so nothing looks wrong. Soft-deleted rows are
excluded automatically by the global filter in api/softdelete.py.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, false
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_coach
from .. import models

router = APIRouter(prefix="/search", tags=["search"])

# Enough to show a few per group without the dropdown becoming its own screen.
# The full-results screen asks for more.
PER_GROUP = 6
MAX_GROUP = 50


def _like(term: str) -> str:
    # Escape the wildcards so a coach searching for "50%" doesn't match
    # everything. The escape character is declared on each .like() below.
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _snippet(text: str | None, term: str, width: int = 80) -> str | None:
    """The line the match was found on, so a body hit explains itself.

    Without this, searching "1-3-1" returns a row titled "Bloom Bloom" and the
    coach has no idea why it is there.
    """
    if not text:
        return None
    at = text.lower().find(term.lower())
    if at < 0:
        return None
    start = max(0, at - width // 2)
    end = min(len(text), at + len(term) + width // 2)
    out = " ".join(text[start:end].split())
    return ("…" if start > 0 else "") + out + ("…" if end < len(text) else "")


def _accessible_team_ids(db: Session, coach: models.Coach) -> set[int]:
    ids = {t.id for t in db.query(models.Team).filter_by(coach_id=coach.id).all()}
    ids |= {l.team_id for l in db.query(models.TeamStaff).filter_by(coach_id=coach.id).all()}
    return ids


def _shared_ids(db: Session, coach: models.Coach, *kinds: str) -> set[int]:
    """Report ids another coach has shared with this one, by kind."""
    rows = (
        db.query(models.StaffSharedReport)
        .filter(models.StaffSharedReport.recipient_id == coach.id,
                models.StaffSharedReport.report_type.in_(kinds))
        .all()
    )
    return {r.report_id for r in rows}


def _game_scope(coach: models.Coach, team_ids: set[int]):
    """The condition for a tracked game this coach can open.

    Written as a condition rather than a set of ids so it can be joined onto
    the things that hang off a game — the written report, the whiteboard — and
    let the database do the narrowing. Collecting ids first works until a coach
    has a season of games and every search sends a thousand of them back down
    as an IN list.
    """
    return or_(models.GameSession.coach_id == coach.id,
               models.GameSession.team_id.in_(team_ids) if team_ids
               else models.GameSession.id.is_(None))


def _packet_scope(coach: models.Coach, shared_packets: set[int]):
    """The same, for a report packet: their own, or one shared with them."""
    return or_(models.GameReport.coach_id == coach.id,
               models.GameReport.id.in_(shared_packets) if shared_packets
               else models.GameReport.id.is_(None))


def _page(query, limit: int):
    """A group's rows plus how many there are in total, for "see all N".

    Asking for one row more than will be shown answers "is there more?" for
    free. Only when the answer is yes does the total need counting — and now
    that every keystroke is a request, a COUNT per group per letter is a cost
    paid on almost every search to learn a number that is usually just the
    length of the list already in hand.
    """
    rows = query.limit(limit + 1).all()
    if len(rows) <= limit:
        return rows, len(rows)
    return rows[:limit], query.count()


@router.get("")
def search(
    q: str = Query("", min_length=0),
    limit: int = Query(PER_GROUP, ge=1, le=MAX_GROUP),
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    term = (q or "").strip()
    if not term:
        return {"query": term, "players": [], "teams": [], "reports": [],
                "training": [], "team_reports": [], "games": [], "scouting": [],
                "film": [], "game_reports": [], "opponents": [], "insights": [],
                "messages": [], "staff_comments": [], "comments": [],
                "totals": {}}

    # One letter answers from names only. It is the first keystroke of a name
    # far more often than a search for a letter, and matching it against the
    # body of every report would scan the coach's whole library to answer
    # something they are still in the middle of typing.
    pattern = _like(term)
    deep = len(term) >= 2
    team_ids = _accessible_team_ids(db, coach)
    granted = {a.player_id for a in db.query(models.PlayerAccess).filter_by(coach_id=coach.id).all()}

    # ── Who this coach can see ────────────────────────────────────────────────
    player_scope = [models.Player.coach_id == coach.id]
    if team_ids:
        player_scope.append(models.Player.team_id.in_(team_ids))
    if granted:
        # Shared with me: the report about them came with the person.
        player_scope.append(models.Player.id.in_(granted))

    players_q = (
        db.query(models.Player)
        .filter(or_(*player_scope))
        .filter(or_(
            models.Player.name.ilike(pattern, escape="\\"),
            models.Player.position.ilike(pattern, escape="\\"),
            models.Player.school_name.ilike(pattern, escape="\\"),
            models.Player.program_name.ilike(pattern, escape="\\"),
        ))
        .order_by(models.Player.name)
    )
    players, players_n = _page(players_q, limit)

    teams_q = (
        db.query(models.Team)
        .filter(or_(models.Team.coach_id == coach.id,
                    models.Team.id.in_(team_ids) if team_ids else models.Team.id.is_(None)))
        .filter(or_(models.Team.name.ilike(pattern, escape="\\"),
                    models.Team.competition_level.ilike(pattern, escape="\\")))
        .order_by(models.Team.name)
    )
    teams, teams_n = _page(teams_q, limit)

    # ── Reports ───────────────────────────────────────────────────────────────
    # Evaluations are titled inconsistently — some carry a title, some only the
    # player's name — so match the player too, which is how coaches refer to
    # them, and the body, which is what they actually remember about one.
    shared_evals = _shared_ids(db, coach, "eval")
    evals_q = (
        db.query(models.Evaluation)
        .outerjoin(models.Player, models.Evaluation.player_id == models.Player.id)
        .filter(or_(models.Evaluation.coach_id == coach.id,
                    models.Evaluation.id.in_(shared_evals) if shared_evals
                    else models.Evaluation.id.is_(None)))
        .filter(or_(
            models.Evaluation.title.ilike(pattern, escape="\\"),
            models.Evaluation.output_type.ilike(pattern, escape="\\"),
            models.Evaluation.report_text.ilike(pattern, escape="\\") if deep else false(),
            models.Player.name.ilike(pattern, escape="\\"),
        ))
        .order_by(models.Evaluation.id.desc())
    )
    evals, evals_n = _page(evals_q, limit)

    shared_training = _shared_ids(db, coach, "training")
    training_q = (
        db.query(models.TrainingSession)
        .outerjoin(models.Player, models.TrainingSession.player_id == models.Player.id)
        .filter(or_(models.TrainingSession.coach_id == coach.id,
                    models.TrainingSession.id.in_(shared_training) if shared_training
                    else models.TrainingSession.id.is_(None)))
        .filter(or_(
            models.TrainingSession.title.ilike(pattern, escape="\\"),
            models.TrainingSession.program_text.ilike(pattern, escape="\\") if deep else false(),
            models.Player.name.ilike(pattern, escape="\\"),
        ))
        .order_by(models.TrainingSession.id.desc())
    )
    training, training_n = _page(training_q, limit)

    shared_team_reports = _shared_ids(db, coach, "team_report", "team_training")
    team_reports_q = (
        db.query(models.TeamReport)
        .filter(or_(models.TeamReport.coach_id == coach.id,
                    models.TeamReport.id.in_(shared_team_reports) if shared_team_reports
                    else models.TeamReport.id.is_(None)))
        .filter(or_(
            models.TeamReport.output_type.ilike(pattern, escape="\\"),
            models.TeamReport.focus_prompt.ilike(pattern, escape="\\") if deep else false(),
            models.TeamReport.report_text.ilike(pattern, escape="\\") if deep else false(),
        ))
        .order_by(models.TeamReport.id.desc())
    )
    team_reports, team_reports_n = _page(team_reports_q, limit)

    shared_packets = _shared_ids(db, coach, "game")
    games_q = (
        db.query(models.GameReport)
        .filter(or_(models.GameReport.coach_id == coach.id,
                    models.GameReport.id.in_(shared_packets) if shared_packets
                    else models.GameReport.id.is_(None)))
        .filter(or_(
            models.GameReport.title.ilike(pattern, escape="\\"),
            models.GameReport.opponent_name.ilike(pattern, escape="\\"),
            models.GameReport.opponent_a_name.ilike(pattern, escape="\\"),
            models.GameReport.focus_prompt.ilike(pattern, escape="\\") if deep else false(),
            models.GameReport.scouting_notes.ilike(pattern, escape="\\") if deep else false(),
            models.GameReport.box_score.ilike(pattern, escape="\\") if deep else false(),
            models.GameReport.report_text.ilike(pattern, escape="\\") if deep else false(),
        ))
        .order_by(models.GameReport.id.desc())
    )
    games, games_n = _page(games_q, limit)

    # Tracked games and the scouting reports written off them. The report is
    # per-coach, so a match on someone else's report must not surface here —
    # only this coach's own, alongside the game's own legacy report.
    mine_scouted = set() if not deep else {
        r.game_id for r in db.query(models.GameScoutingReport)
        .filter(models.GameScoutingReport.coach_id == coach.id,
                models.GameScoutingReport.report_text.ilike(pattern, escape="\\"))
        .all()
    }
    scouting_q = (
        db.query(models.GameSession)
        .filter(or_(models.GameSession.coach_id == coach.id,
                    models.GameSession.team_id.in_(team_ids) if team_ids
                    else models.GameSession.id.is_(None)))
        .filter(or_(
            models.GameSession.opponent_name.ilike(pattern, escape="\\"),
            models.GameSession.location.ilike(pattern, escape="\\"),
            models.GameSession.ai_scouting_report.ilike(pattern, escape="\\") if deep else false(),
            models.GameSession.id.in_(mine_scouted) if mine_scouted
            else models.GameSession.id.is_(None),
        ))
        .order_by(models.GameSession.id.desc())
    )
    scouting, scouting_n = _page(scouting_q, limit)

    # ── The long documents ────────────────────────────────────────────────────
    # A film breakdown and a game's written report are the two biggest pieces
    # of writing the app produces, and neither was searchable: a coach who
    # remembered a phrase from one had no way back to it but to open packets
    # until they found the right one.
    film_q = (
        db.query(models.GameReportClip)
        .join(models.GameReport,
              models.GameReportClip.game_report_id == models.GameReport.id)
        .filter(models.GameReportClip.analysis_text.isnot(None))
        .filter(_packet_scope(coach, shared_packets))
        .filter(or_(
            models.GameReportClip.team_name.ilike(pattern, escape="\\"),
            models.GameReportClip.output_type.ilike(pattern, escape="\\"),
            models.GameReportClip.analysis_text.ilike(pattern, escape="\\") if deep else false(),
        ))
        .order_by(models.GameReportClip.id.desc())
    )
    film, film_n = _page(film_q, limit)

    # The report written off a tracked game. Matched on the opponent's name as
    # well as the body, because "the Egypt report" is what a coach calls it —
    # the row itself carries no title at all.
    full_q = (
        db.query(models.GameFullReport, models.GameSession)
        .join(models.GameSession,
              models.GameFullReport.game_id == models.GameSession.id)
        .filter(_game_scope(coach, team_ids))
        .filter(or_(
            models.GameSession.opponent_name.ilike(pattern, escape="\\"),
            models.GameFullReport.report_text.ilike(pattern, escape="\\") if deep else false(),
        ))
        .order_by(models.GameFullReport.id.desc())
    )
    full_reports, full_n = _page(full_q, limit)

    # ── Scouting, the parts of it that are not the game ───────────────────────
    opponents_q = (
        db.query(models.OpponentPlayer)
        .filter(models.OpponentPlayer.coach_id == coach.id)
        .filter(or_(
            models.OpponentPlayer.player_name.ilike(pattern, escape="\\"),
            models.OpponentPlayer.opponent_name.ilike(pattern, escape="\\"),
            models.OpponentPlayer.position.ilike(pattern, escape="\\"),
            models.OpponentPlayer.jersey_number.ilike(pattern, escape="\\"),
            models.OpponentPlayer.notes.ilike(pattern, escape="\\") if deep else false(),
        ))
        .order_by(models.OpponentPlayer.player_name)
    )
    opponents, opponents_n = _page(opponents_q, limit)

    insights_q = (
        db.query(models.ScoutInsight)
        .filter(models.ScoutInsight.coach_id == coach.id)
        .filter(or_(
            models.ScoutInsight.team_name.ilike(pattern, escape="\\"),
            models.ScoutInsight.subject.ilike(pattern, escape="\\"),
            models.ScoutInsight.insight.ilike(pattern, escape="\\") if deep else false(),
        ))
        .order_by(models.ScoutInsight.id.desc())
    )
    insights, insights_n = _page(insights_q, limit)

    # ── Staff Hub ─────────────────────────────────────────────────────────────
    # Only conversations this coach is actually in. A message is the one kind
    # of row here that belongs to somebody else as much as to them, so the
    # membership table is the filter rather than authorship: they can see what
    # was said to them, not only what they said.
    my_convs = {m.conversation_id for m in db.query(models.ConversationMember)
                .filter_by(coach_id=coach.id).all()}
    conv_scope = (models.StaffMessage.conversation_id.in_(my_convs) if my_convs
                  else models.StaffMessage.id.is_(None))
    messages_q = (
        db.query(models.StaffMessage)
        .filter(conv_scope)
        .filter(models.StaffMessage.deleted_at.is_(None))
        .filter(models.StaffMessage.text.ilike(pattern, escape="\\") if deep else false())
        .order_by(models.StaffMessage.id.desc())
    )
    messages, messages_n = _page(messages_q, limit)

    # Comments left on a report that was shared between coaches — visible to
    # the two ends of that share, which is what the Staff Hub shows.
    my_shares = {r.id for r in db.query(models.StaffSharedReport)
                 .filter(or_(models.StaffSharedReport.sender_id == coach.id,
                             models.StaffSharedReport.recipient_id == coach.id)).all()}
    staff_comments_q = (
        db.query(models.StaffReportComment)
        .filter(models.StaffReportComment.shared_report_id.in_(my_shares) if my_shares
                else models.StaffReportComment.id.is_(None))
        .filter(models.StaffReportComment.deleted_at.is_(None))
        .filter(models.StaffReportComment.text.ilike(pattern, escape="\\") if deep else false())
        .order_by(models.StaffReportComment.id.desc())
    )
    staff_comments, staff_comments_n = _page(staff_comments_q, limit)

    # ── What a player wrote back ──────────────────────────────────────────────
    # A comment reaches this coach two ways: they wrote it, or a player wrote
    # it on something this coach shared with them. The second is the one that
    # matters — it is the half of the conversation they did not author and
    # cannot otherwise find.
    my_shared_reports = {r.id for r in db.query(models.SharedReport)
                         .filter_by(shared_by_id=coach.id).all()}
    my_training = {r.id for r in db.query(models.TrainingSession)
                   .filter_by(coach_id=coach.id).all()}
    comment_scope = [models.PlayerComment.coach_id == coach.id]
    if my_shared_reports:
        comment_scope.append(models.PlayerComment.shared_report_id.in_(my_shared_reports))
    if my_training:
        comment_scope.append(models.PlayerComment.training_session_id.in_(my_training))
    comments_q = (
        db.query(models.PlayerComment)
        .filter(or_(*comment_scope))
        .filter(models.PlayerComment.deleted_at.is_(None))
        .filter(models.PlayerComment.text.ilike(pattern, escape="\\") if deep else false())
        .order_by(models.PlayerComment.id.desc())
    )
    comments, comments_n = _page(comments_q, limit)

    def player_name(pid) -> str | None:
        if not pid:
            return None
        p = db.get(models.Player, pid)
        return p.name if p else None

    def sender_name(cid) -> str | None:
        c = db.get(models.Coach, cid) if cid else None
        return c.name if c else None

    def conversation_title(conv_id) -> str | None:
        """What the Staff Hub calls this thread.

        A group has a name of its own. A one-to-one does not — it is named
        after the other person, so find them rather than showing "Conversation".
        """
        conv = db.get(models.Conversation, conv_id) if conv_id else None
        if not conv:
            return None
        if conv.title:
            return conv.title
        other = (db.query(models.ConversationMember)
                 .filter(models.ConversationMember.conversation_id == conv_id,
                         models.ConversationMember.coach_id != coach.id).first())
        return sender_name(other.coach_id) if other else None

    def comment_eval_id(pc) -> int | None:
        """The evaluation a player's comment is attached to, if any.

        Comments hang off the share, not the report, so opening one means
        walking back through the share to the evaluation it carried.
        """
        if pc.shared_report_id:
            sr = db.get(models.SharedReport, pc.shared_report_id)
            if sr:
                return sr.evaluation_id
        if pc.player_training_id:
            pt = db.get(models.PlayerTraining, pc.player_training_id)
            sr = db.get(models.SharedReport, pt.shared_report_id) if pt else None
            if sr:
                return sr.evaluation_id
        return None

    def my_scout_text(game_id: int) -> str | None:
        row = (db.query(models.GameScoutingReport)
               .filter_by(game_id=game_id, coach_id=coach.id).first())
        return row.report_text if row else None

    return {
        "query": term,
        "players": [
            {"id": p.id, "name": p.name, "position": p.position,
             "team_name": p.team.name if p.team else None,
             "mine": p.coach_id == coach.id}
            for p in players
        ],
        "teams": [
            {"id": t.id, "name": t.name, "competition_level": t.competition_level}
            for t in teams
        ],
        "reports": [
            {"id": e.id, "title": e.title or player_name(e.player_id) or e.output_type,
             "output_type": e.output_type, "player_id": e.player_id,
             "player_name": player_name(e.player_id),
             "snippet": _snippet(e.report_text, term), "created_at": e.created_at}
            for e in evals
        ],
        "training": [
            {"id": ts.id, "title": ts.title or player_name(ts.player_id) or "Training Program",
             "player_id": ts.player_id, "player_name": player_name(ts.player_id),
             "snippet": _snippet(ts.program_text, term), "created_at": ts.created_at}
            for ts in training
        ],
        "team_reports": [
            {"id": tr.id, "title": tr.output_type, "output_type": tr.output_type,
             "snippet": _snippet(tr.report_text, term) or _snippet(tr.focus_prompt, term),
             "created_at": tr.created_at}
            for tr in team_reports
        ],
        "games": [
            {"id": g.id, "title": g.title, "opponent_name": g.opponent_name,
             "output_type": g.output_type,
             "snippet": (_snippet(g.report_text, term) or _snippet(g.scouting_notes, term)
                         or _snippet(g.box_score, term)),
             "created_at": g.created_at}
            for g in games
        ],
        "scouting": [
            {"id": s.id, "opponent_name": s.opponent_name, "location": s.location,
             "date": s.date,
             "snippet": (_snippet(my_scout_text(s.id), term)
                         or _snippet(s.ai_scouting_report, term)),
             "created_at": s.created_at}
            for s in scouting
        ],
        "film": [
            {"id": c.id, "report_id": c.game_report_id,
             "title": c.team_name or c.label, "output_type": c.output_type,
             "snippet": _snippet(c.analysis_text, term), "created_at": c.created_at}
            for c in film
        ],
        "game_reports": [
            {"id": r.id, "game_id": g.id, "opponent_name": g.opponent_name,
             "date": g.date, "snippet": _snippet(r.report_text, term),
             "created_at": r.created_at}
            for r, g in full_reports
        ],
        "opponents": [
            {"id": o.id, "player_name": o.player_name, "opponent_name": o.opponent_name,
             "jersey_number": o.jersey_number, "position": o.position,
             "snippet": _snippet(o.notes, term)}
            for o in opponents
        ],
        "insights": [
            {"id": i.id, "team_name": i.team_name, "subject": i.subject,
             "snippet": _snippet(i.insight, term) or (i.insight or "")[:120],
             "created_at": i.created_at}
            for i in insights
        ],
        "messages": [
            {"id": m.id, "conversation_id": m.conversation_id,
             "sender_name": sender_name(m.sender_id),
             "title": conversation_title(m.conversation_id),
             "snippet": _snippet(m.text, term), "created_at": m.created_at}
            for m in messages
        ],
        "staff_comments": [
            {"id": sc.id, "shared_report_id": sc.shared_report_id,
             "sender_name": sender_name(sc.author_id),
             "snippet": _snippet(sc.text, term), "created_at": sc.created_at}
            for sc in staff_comments
        ],
        "comments": [
            {"id": pc.id, "eval_id": comment_eval_id(pc),
             "training_id": pc.training_session_id,
             "snippet": _snippet(pc.text, term), "created_at": pc.created_at}
            for pc in comments
        ],
        # What the client needs to offer "see all 23" rather than silently
        # showing six of them and looking like that is all there is.
        "totals": {
            "players": players_n, "teams": teams_n, "reports": evals_n,
            "training": training_n, "team_reports": team_reports_n,
            "games": games_n, "scouting": scouting_n,
            "film": film_n, "game_reports": full_n, "opponents": opponents_n,
            "insights": insights_n, "messages": messages_n,
            "staff_comments": staff_comments_n, "comments": comments_n,
        },
    }


# Everything the coach could search, by name, small enough to hold in memory.
# Larger than any real coach's library; a cap only so a pathological account
# cannot ask the browser to hold a hundred megabytes.
INDEX_CAP = 2000


@router.get("/index")
def search_index(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Names and titles only, for matching without a round trip.

    Typing is faster than a network. Waiting for a server to answer "does
    anything start with 'ma'" is a quarter of a second the coach spends looking
    at a stale list, and no amount of tuning the delay before the request fixes
    a delay that IS the request.

    So the app keeps this in memory and answers name searches itself, instantly,
    while the full search runs behind it and fills in what only the server can
    know — matches inside the text of a report. Deliberately no report bodies
    here: those are what make the payload big, and they are exactly the part
    that can wait.
    """
    team_ids = _accessible_team_ids(db, coach)
    granted = {a.player_id for a in db.query(models.PlayerAccess).filter_by(coach_id=coach.id).all()}

    player_scope = [models.Player.coach_id == coach.id]
    if team_ids:
        player_scope.append(models.Player.team_id.in_(team_ids))
    if granted:
        player_scope.append(models.Player.id.in_(granted))
    players = (db.query(models.Player).filter(or_(*player_scope))
               .order_by(models.Player.name).limit(INDEX_CAP).all())

    teams = (db.query(models.Team)
             .filter(or_(models.Team.coach_id == coach.id,
                         models.Team.id.in_(team_ids) if team_ids else models.Team.id.is_(None)))
             .order_by(models.Team.name).limit(INDEX_CAP).all())

    # One lookup for every player named anywhere below, instead of one query per
    # row: this endpoint is a list of names, and fetching each one individually
    # is what turns "small payload" into "slow payload".
    def _named(rows, attr="player_id"):
        ids = {getattr(r, attr) for r in rows if getattr(r, attr)}
        if not ids:
            return {}
        return {p.id: p.name for p in db.query(models.Player)
                .filter(models.Player.id.in_(ids)).all()}

    shared_evals = _shared_ids(db, coach, "eval")
    evals = (db.query(models.Evaluation)
             .filter(or_(models.Evaluation.coach_id == coach.id,
                         models.Evaluation.id.in_(shared_evals) if shared_evals
                         else models.Evaluation.id.is_(None)))
             .order_by(models.Evaluation.id.desc()).limit(INDEX_CAP).all())
    eval_names = _named(evals)

    shared_training = _shared_ids(db, coach, "training")
    training = (db.query(models.TrainingSession)
                .filter(or_(models.TrainingSession.coach_id == coach.id,
                            models.TrainingSession.id.in_(shared_training) if shared_training
                            else models.TrainingSession.id.is_(None)))
                .order_by(models.TrainingSession.id.desc()).limit(INDEX_CAP).all())
    training_names = _named(training)

    shared_team_reports = _shared_ids(db, coach, "team_report", "team_training")
    team_reports = (db.query(models.TeamReport)
                    .filter(or_(models.TeamReport.coach_id == coach.id,
                                models.TeamReport.id.in_(shared_team_reports) if shared_team_reports
                                else models.TeamReport.id.is_(None)))
                    .order_by(models.TeamReport.id.desc()).limit(INDEX_CAP).all())

    shared_packets = _shared_ids(db, coach, "game")
    games = (db.query(models.GameReport)
             .filter(or_(models.GameReport.coach_id == coach.id,
                         models.GameReport.id.in_(shared_packets) if shared_packets
                         else models.GameReport.id.is_(None)))
             .order_by(models.GameReport.id.desc()).limit(INDEX_CAP).all())

    scouting = (db.query(models.GameSession)
                .filter(_game_scope(coach, team_ids))
                .order_by(models.GameSession.id.desc()).limit(INDEX_CAP).all())

    # The named things among the long documents and the scouting notes. Their
    # bodies stay on the server — that is the whole point of this endpoint —
    # but a coach typing an opponent's name should not wait for a round trip to
    # be shown the film they shot against them.
    film = (db.query(models.GameReportClip)
            .join(models.GameReport,
                  models.GameReportClip.game_report_id == models.GameReport.id)
            .filter(models.GameReportClip.analysis_text.isnot(None))
            .filter(_packet_scope(coach, shared_packets))
            .order_by(models.GameReportClip.id.desc()).limit(INDEX_CAP).all())

    full_reports = (db.query(models.GameFullReport, models.GameSession)
                    .join(models.GameSession,
                          models.GameFullReport.game_id == models.GameSession.id)
                    .filter(_game_scope(coach, team_ids))
                    .order_by(models.GameFullReport.id.desc()).limit(INDEX_CAP).all())

    opponents = (db.query(models.OpponentPlayer)
                 .filter(models.OpponentPlayer.coach_id == coach.id)
                 .order_by(models.OpponentPlayer.player_name).limit(INDEX_CAP).all())

    insights = (db.query(models.ScoutInsight)
                .filter(models.ScoutInsight.coach_id == coach.id)
                .order_by(models.ScoutInsight.id.desc()).limit(INDEX_CAP).all())

    return {
        "players": [
            {"id": p.id, "name": p.name, "position": p.position,
             "team_name": p.team.name if p.team else None,
             "school_name": p.school_name, "program_name": p.program_name}
            for p in players
        ],
        "teams": [
            {"id": t.id, "name": t.name, "competition_level": t.competition_level}
            for t in teams
        ],
        "reports": [
            {"id": e.id, "title": e.title or eval_names.get(e.player_id) or e.output_type,
             "output_type": e.output_type, "player_id": e.player_id,
             "player_name": eval_names.get(e.player_id), "created_at": e.created_at}
            for e in evals
        ],
        "training": [
            {"id": ts.id, "title": ts.title or training_names.get(ts.player_id) or "Training Program",
             "player_id": ts.player_id, "player_name": training_names.get(ts.player_id),
             "created_at": ts.created_at}
            for ts in training
        ],
        "team_reports": [
            {"id": tr.id, "title": tr.output_type, "output_type": tr.output_type,
             "created_at": tr.created_at}
            for tr in team_reports
        ],
        "games": [
            {"id": g.id, "title": g.title, "opponent_name": g.opponent_name,
             "opponent_a_name": g.opponent_a_name, "output_type": g.output_type,
             "created_at": g.created_at}
            for g in games
        ],
        "scouting": [
            {"id": s.id, "opponent_name": s.opponent_name, "location": s.location,
             "created_at": s.created_at}
            for s in scouting
        ],
        "film": [
            {"id": c.id, "report_id": c.game_report_id,
             "title": c.team_name or c.label, "output_type": c.output_type,
             "created_at": c.created_at}
            for c in film
        ],
        "game_reports": [
            {"id": r.id, "game_id": g.id, "opponent_name": g.opponent_name,
             "date": g.date, "created_at": r.created_at}
            for r, g in full_reports
        ],
        "opponents": [
            {"id": o.id, "player_name": o.player_name, "opponent_name": o.opponent_name,
             "jersey_number": o.jersey_number, "position": o.position}
            for o in opponents
        ],
        "insights": [
            {"id": i.id, "team_name": i.team_name, "subject": i.subject,
             "created_at": i.created_at}
            for i in insights
        ],
    }
