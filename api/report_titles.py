"""What to call a report, composed from what is already known about it.

A notification that says "Jaire shared a Scouting Report with you" names the
kind of document and not the document. A coach who has three scouting reports
from the same person cannot tell which one arrived, and neither can the digest
line about a comment on it.

The rule is the same one the rest of the app runs on: nothing is guessed. A
title here is composed from rows that already exist — the player it is about,
the two teams in the game, the opponent — the way `_packet_title` has always
built a packet's name. Nothing reads the report body looking for something that
resembles a heading, because that is a guess that quietly produces the wrong
title, or none, and a wrong title is worse than no title.

Where a report kind genuinely has nothing to be named after, this returns None
and the caller says only the type. Absent, not invented.

`qualify` is the other half. The app already renders "scouting_report|Andre" as
"Scouting Report · Andre", translating the half before the bar and leaving the
name alone, so a title travels through the same param in twenty-five languages
without any copy knowing about it.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from . import models

QUALIFIER = "|"


def qualify(output_type: str | None, title: str | None) -> str | None:
    """The value to pass as a `type` param: the kind, then the document.

    Returns the bare type when there is no title, so the sentence still reads
    and only loses the detail that was never there.
    """
    kind = (output_type or "").strip()
    name = (title or "").strip()
    if not kind:
        return name or None
    if not name:
        return kind
    return f"{kind}{QUALIFIER}{name}"


def evaluation_title(db: Session, ev: "models.Evaluation | None") -> str | None:
    """A stored title wins; otherwise the player it is about.

    Matchups already set a title at creation ("A vs B"). Everything else is a
    report about one player, and the player's name is the fact that
    distinguishes it from the next one.
    """
    if ev is None:
        return None
    if ev.title:
        return ev.title
    player = db.get(models.Player, ev.player_id) if ev.player_id else None
    return player.name if player else None


def training_title(db: Session, ts: "models.TrainingSession | None") -> str | None:
    """A program's own subject, or the player it was written for."""
    if ts is None:
        return None
    if ts.title:
        return ts.title
    player = db.get(models.Player, ts.player_id) if ts.player_id else None
    return player.name if player else None


def game_title(db: Session, gs: "models.GameSession | None") -> str | None:
    """Both teams, not one.

    "vs Mali" named one side of a game between two, so a coach who was sent it
    could not tell whose game they had been given.
    """
    if gs is None:
        return None
    team = db.get(models.Team, gs.team_id) if gs.team_id else None
    owner = db.get(models.Coach, gs.coach_id) if gs.coach_id else None
    ours = (team.name if team else None) or (owner.program_name if owner else None)
    theirs = gs.opponent_name or "Opponent"
    return f"{ours} vs {theirs}" if ours else f"vs {theirs}"


def packet_title(db: Session, gr: "models.GameReport | None") -> str | None:
    """The packet's own name, or the matchup it covers."""
    if gr is None:
        return None
    if gr.title:
        return gr.title
    my = gr.my_team.name if gr.my_team else None
    opp = gr.opponent_team.name if gr.opponent_team else gr.opponent_name
    if gr.mode == "opp_vs_opp":
        a = gr.my_team.name if gr.my_team else (gr.opponent_a_name or "Opponent A")
        return f"{a} vs {opp or 'Opponent B'}"
    if gr.mode == "vs_opponent" and opp:
        return f"{my or 'My Team'} vs {opp}"
    if gr.mode == "my_program":
        return my
    return opp


def report_meta(report_type: str, report_id: int, db: Session
                ) -> tuple[str | None, str | None, float | None]:
    """(title, output_type, overall_grade) for anything that can be shared.

    One place, because the recipient's list, the notification and the digest
    line all have to call the same document by the same name. They used to
    disagree: the list said "Varsity vs Northgate" and the email said "a report".
    """
    if report_type == "eval":
        ev = db.get(models.Evaluation, report_id)
        if not ev:
            return None, None, None
        return evaluation_title(db, ev), ev.output_type, ev.overall_grade
    if report_type == "game":
        gr = db.get(models.GameReport, report_id)
        if not gr:
            return None, None, None
        return packet_title(db, gr), gr.output_type, None
    if report_type in ("team_training", "team_report"):
        tr = db.get(models.TeamReport, report_id)
        if not tr:
            return None, None, None
        # A team report is not tied to a team row — it has only a coach — so the
        # programme is the one fact available to name it by. It used to be
        # called the literal string "Team Report", which told a recipient with
        # two of them nothing at all.
        coach = db.get(models.Coach, tr.coach_id) if tr.coach_id else None
        return (coach.program_name if coach else None), tr.output_type, None
    if report_type == "training":
        ts = db.get(models.TrainingSession, report_id)
        return training_title(db, ts), "training_program", None
    if report_type == "game_session":
        gs = db.get(models.GameSession, report_id)
        if not gs:
            return None, None, None
        return game_title(db, gs), "game_report", None
    if report_type == "film":
        clip = db.get(models.GameReportClip, report_id)
        if not clip:
            return None, None, None
        gr = db.get(models.GameReport, clip.game_report_id)
        return (clip.team_name or packet_title(db, gr)), "film_breakdown", None
    if report_type == "game_report":
        gs = db.get(models.GameSession, report_id)
        return game_title(db, gs), "game_report", None
    return None, None, None


# What a finished background job produced. Read off the branch in
# evaluations.py that loads a job's result, so the mail names the same document
# the screen opens rather than a second guess at it.
JOB_KIND_REPORTS = {
    "eval": "eval",
    "eval_text": "eval",
    "team_report": "team_report",
    "packet": "game",
    "training": "training",
    "scouting": "game_session",
    "game_report_full": "game_report",
    "clip": "film",
}


def qualified_for_job(db: Session, kind: str, result_id: int | None) -> str | None:
    """Which document a finished job produced, named.

    "Your team report is ready" is true of every team report a coach has ever
    run. It does not say which one, and a coach who queued three does not know
    which of the three to open.
    """
    report_type = JOB_KIND_REPORTS.get(kind or "")
    if not report_type or not result_id:
        return None
    return qualified_type(report_type, result_id, db)


def qualified_type(report_type: str, report_id: int, db: Session) -> str | None:
    """The one value a notification needs: the kind and the document, together.

    The report's own output_type is preferred over the sharing kind, because
    "Scouting Report" says more than "Player Eval" about the same document. The
    sharing kind is the fallback, and both are keys the type vocabulary knows,
    so either way the reader gets it in their own language.
    """
    title, output_type, _ = report_meta(report_type, report_id, db)
    return qualify(output_type or report_type, title)
