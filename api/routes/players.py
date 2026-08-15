import os
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_coach
from ..report_format import REPORT_FORMAT, REPORT_FORMAT_WITH_TABLES
from .. import models, schemas
from ..softdelete import soft_delete
from ..ownership import get_owned
from ..ai_models import OPUS


class PlayerUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[str] = None
    jersey_number: Optional[str] = None
    competition_level: Optional[str] = None
    team_id: Optional[int] = None
    height: Optional[str] = None
    wingspan: Optional[str] = None
    weight: Optional[str] = None
    standing_reach: Optional[str] = None
    country: Optional[str] = None
    state: Optional[str] = None
    city: Optional[str] = None
    school_name: Optional[str] = None

router = APIRouter(prefix="/players", tags=["players"])


@router.post("", response_model=schemas.PlayerOut)
def create_player(
    body: schemas.PlayerCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    data = body.model_dump()
    # Roster owner: a team player belongs to the team's owner; a team-less
    # personal player belongs to the coach who created it.
    team = db.get(models.Team, data["team_id"]) if data.get("team_id") else None
    if team:
        data["program_name"] = team.name
        data["coach_id"] = team.coach_id
    if not data.get("coach_id"):
        data["coach_id"] = coach.id
    if "program_name" not in data or not data.get("program_name"):
        data["program_name"] = coach.program_name
    # Default the competition level to the team's, else the coach's signup level.
    if not data.get("competition_level"):
        from ..coach_context import resolve_level
        data["competition_level"] = resolve_level(coach, team=team)
    player = models.Player(**data)
    db.add(player)
    db.commit()
    db.refresh(player)
    return _with_grade(player, [e for e in player.evaluations if e.coach_id == coach.id])


def _accessible_team_ids(db: Session, coach: models.Coach) -> set[int]:
    ids = {tm.id for tm in db.query(models.Team).filter_by(coach_id=coach.id).all()}
    ids |= {l.team_id for l in db.query(models.TeamStaff).filter_by(coach_id=coach.id).all()}
    return ids


def _granted_player_ids(db: Session, coach: models.Coach) -> set[int]:
    """Players handed to this coach with a shared report — see PlayerAccess."""
    return {a.player_id for a in db.query(models.PlayerAccess).filter_by(coach_id=coach.id).all()}


def _can_see_player(db: Session, coach: models.Coach, player: models.Player) -> bool:
    if player.coach_id == coach.id:
        return True
    if player.team_id is not None and player.team_id in _accessible_team_ids(db, coach):
        return True
    return db.query(models.PlayerAccess).filter_by(
        player_id=player.id, coach_id=coach.id).first() is not None


def _bim_evals(db: Session, coach: models.Coach, player: models.Player) -> list:
    """The evals that back a coach's BIM view of a player.

    A BIM score belongs to the coach who produced it. It is their read of the
    player, and it stays theirs until they choose to share that evaluation —
    which is the whole point of the score being per-coach rather than global.

    So: the coach's OWN evaluations, plus any evaluation of this player that
    another coach has explicitly SHARED with them. Nothing else.

    This used to fall back to the aggregate of EVERY eval when the viewer had
    none of their own, so that a player reached through a shared team did not
    look blank. The cost was the thing the design exists to prevent: joining a
    team handed you a number built out of another coach's work, with no share
    and no say. Blank is the correct answer there — it says "you have not
    evaluated this player", which is true.
    """
    own = [e for e in player.evaluations if e.coach_id == coach.id]
    others = [e for e in player.evaluations if e.coach_id != coach.id]
    if not others:
        return own
    shared_ids = {
        r.report_id for r in db.query(models.StaffSharedReport)
        .filter_by(recipient_id=coach.id, report_type="eval")
        .all()
    }
    return own + [e for e in others if e.id in shared_ids]


@router.get("", response_model=list[schemas.PlayerOut])
def list_players(
    team_id: int | None = None,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    from sqlalchemy import or_
    team_ids = _accessible_team_ids(db, coach)
    granted = _granted_player_ids(db, coach)
    conds = [models.Player.coach_id == coach.id]
    if team_ids:
        conds.append(models.Player.team_id.in_(team_ids))
    if granted:
        # Shared with me: the report about them came with the person.
        conds.append(models.Player.id.in_(granted))
    q = db.query(models.Player).filter(or_(*conds))
    # team_id is applied after the display team below, not in SQL: a player who
    # came with a shared game is filed on the sender's team row, and asking the
    # database for mine would answer with nobody.
    # Newest first. A coach adding a player was sent to the bottom of a long
    # list to find them, and the one they just typed in is the one they are
    # about to open. id, not created_at: the column is nullable on rows that
    # predate it, and a null sorts unpredictably.
    q = q.order_by(models.Player.id.desc())
    # A player who arrived with a shared game is on a team, but on the SENDER's
    # side of it: the team row belongs to them and the player row is theirs to
    # file. The recipient keeps their own record of both teams in that game, so
    # the player is shown under the one whose name matches — read only, no
    # write, so nothing on the sender's roster moves.
    by_name = {" ".join((t.name or "").split()).lower(): t
               for t in db.query(models.Team).filter_by(coach_id=coach.id).all()
               if t.deleted_at is None}
    out = []
    for p in q.all():
        row = _with_grade(p, _bim_evals(db, coach, p))
        # Mine if I own the row; otherwise they are here through a share, and
        # the only thing I can do is take them off my own list.
        row.shared = p.coach_id != coach.id and p.id in granted
        if row.shared and (row.team_id is None or row.team_id not in team_ids):
            mine = by_name.get(" ".join((p.program_name or "").split()).lower())
            if mine is not None:
                row.team_id, row.team_name = mine.id, mine.name
        if team_id is not None and row.team_id != team_id:
            continue
        out.append(row)
    return out


@router.post("/{player_id}/leave-team")
def remove_from_team(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Take a player off the team they are on, and nothing else.

    A player moves clubs, or an import filed them under the wrong side. Neither
    is a reason to delete them: the evaluations, the grades and the games they
    played are the record of a person, not of a squad list. So this clears the
    team and leaves everything else exactly where it is — the player stays in
    the account, under All, with no team beside their name, and can be put on
    another team whenever the coach says so.

    Their lines in a game already played are untouched. A box score is what
    happened that night; it does not change because somebody left.
    """
    player = db.get(models.Player, player_id)
    if not player or player.coach_id != coach.id:
        # Somebody else's player, reached through a share. Their team is not
        # this coach's to change — dropping the share is the action that fits.
        raise HTTPException(status_code=404, detail="Player not found")
    if player.team_id is None:
        return {"ok": True, "team_id": None}
    player.team_id = None
    db.commit()
    return {"ok": True, "team_id": None}


@router.delete("/{player_id}/access")
def drop_shared_player(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Take a player off MY roster that a shared report put there.

    Only ever removes my own access. The player, their history and the owner's
    roster are untouched — this is "I do not need this one", not a delete.
    """
    row = db.query(models.PlayerAccess).filter_by(player_id=player_id, coach_id=coach.id).first()
    if not row:
        raise HTTPException(
            status_code=404,
            detail="This player is not on your roster through a share.",
        )
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/{player_id}", response_model=schemas.PlayerOut)
def get_player(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = db.get(models.Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    if not _can_see_player(db, coach, player):
        raise HTTPException(status_code=403, detail="You don't have access to this player")
    return _with_grade(player, _bim_evals(db, coach, player))


@router.patch("/{player_id}", response_model=schemas.PlayerOut)
def update_player(
    player_id: int,
    body: PlayerUpdate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = get_owned(db, models.Player, player_id, coach.id, "Player")

    def cleared(v):
        """An emptied box is a value, not an omission.

        A field left out of the request means "don't touch this" and must keep
        what is there. A field sent as "" means the coach emptied it, and is
        stored as NULL so nothing downstream has to tell an empty string from a
        missing one.
        """
        return None if isinstance(v, str) and not v.strip() else v

    if body.name is not None and body.name.strip():
        player.name = body.name.strip()
    if body.position is not None:
        player.position = cleared(body.position)
    if body.jersey_number is not None:
        player.jersey_number = cleared(body.jersey_number)
    if body.competition_level is not None:
        player.competition_level = cleared(body.competition_level)
    # 0 means "no team", and it has to be tested FIRST. The old order asked
    # `is not None` before `== 0`, and 0 is not None — so the clear-the-team
    # branch could never run, and every edit of a player without a team looked
    # up team id 0, found nothing, and failed with "Team not found" no matter
    # which field the coach had actually changed.
    if body.team_id == 0:
        player.team_id = None
    elif body.team_id is not None:
        # Only a team this coach owns — otherwise a player could be labelled
        # with another coach's team name.
        team = get_owned(db, models.Team, body.team_id, coach.id, "Team")
        player.team_id = body.team_id
        if team:
            player.program_name = team.name
    if body.height is not None:
        player.height = cleared(body.height)
    if body.wingspan is not None:
        player.wingspan = cleared(body.wingspan)
    for field in ("weight", "standing_reach", "country", "state", "city", "school_name"):
        val = getattr(body, field)
        if val is not None:
            setattr(player, field, cleared(val))
    db.commit()
    db.refresh(player)
    return _with_grade(player, [e for e in player.evaluations if e.coach_id == coach.id])


@router.delete("/{player_id}")
def delete_player(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = get_owned(db, models.Player, player_id, coach.id, "Player")
    # Deleting a player hides them along with their evaluation history; the
    # global filter takes care of the rest.
    soft_delete(db, player)
    db.commit()
    return {"ok": True}


@router.get("/{player_id}/evaluations", response_model=list[schemas.EvalOut])
def player_evaluations(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = db.get(models.Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    if not _can_see_player(db, coach, player):
        raise HTTPException(status_code=403, detail="You don't have access to this player")
    # A coach sees only their OWN evaluations of the player (their personal BIM).
    from .evaluations import _backfill_parsed
    own = [e for e in player.evaluations if e.coach_id == coach.id]
    for e in own:
        _backfill_parsed(db, e)
    return own


@router.get("/{player_id}/videos")
def player_videos(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Video catalog: every film uploaded for this player (by this coach), with
    what report it created so it can be opened, plus a stream url to watch it."""
    player = db.get(models.Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    if not _can_see_player(db, coach, player):
        raise HTTPException(status_code=403, detail="You don't have access to this player")
    rows = (
        db.query(models.PlayerVideo)
        .filter_by(player_id=player_id, coach_id=coach.id)
        .order_by(models.PlayerVideo.id.desc())
        .all()
    )
    out = []
    for v in rows:
        report_label = None
        if v.source_kind == "eval" and v.source_id:
            ev = db.get(models.Evaluation, v.source_id)
            if ev:
                report_label = (ev.output_type or "eval").replace("_", " ").title()
        from ..storage import playback_url
        out.append({
            "id": v.id,
            "source_kind": v.source_kind,
            "source_id": v.source_id,
            "report_label": report_label,
            "label": v.label,
            "created_at": v.created_at,
            # Presigned URL when on S3, else the backend stream path.
            "stream_url": playback_url(v.video_path, f"/players/videos/{v.id}/stream"),
        })
    return out


@router.get("/videos/{video_id}/stream")
def stream_player_video(
    video_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    from fastapi.responses import FileResponse
    from ..storage import exists, ensure_local
    v = db.get(models.PlayerVideo, video_id)
    if not v:
        raise HTTPException(status_code=404, detail="Video not found")
    player = db.get(models.Player, v.player_id)
    if not player or not _can_see_player(db, coach, player):
        raise HTTPException(status_code=403, detail="No access to this video")
    if not exists(v.video_path):
        raise HTTPException(status_code=404, detail="Video file is no longer available")
    return FileResponse(ensure_local(v.video_path), media_type="video/mp4")


@router.delete("/videos/{video_id}")
def delete_player_video(
    video_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Remove a film from the player's catalog and free the file from storage.
    Only the coach who uploaded it can delete it. The evaluation it created is
    left intact — just the stored video is removed."""
    v = db.get(models.PlayerVideo, video_id)
    if not v:
        raise HTTPException(status_code=404, detail="Video not found")
    if v.coach_id != coach.id:
        raise HTTPException(status_code=403, detail="Not your video to delete")
    ref = v.video_path
    db.delete(v)
    db.flush()
    # Only once nothing else points at the same upload — an evaluation and the
    # player's film catalog can reference one file.
    from ..film_storage import release
    release(db, [ref] if ref else [])
    db.commit()
    return {"ok": True}


# How much of the player's record to put in front of the model, in characters.
# Roughly three thousand words: enough to carry a season of reports, short of
# the point where the summary starts reciting rather than synthesizing.
SUMMARY_BUDGET_CHARS = 12000

# Sources that are not report types. Everything else in the picker is an
# output_type stored on an evaluation.
SRC_GAME_STATS = "game_stats"   # tracked box scores AND any box-score report
SRC_TRAINING = "training"       # the player's training programs
SRC_SHARED = "shared"           # reports another coach shared about this player


def _summary_sources(db: Session, coach: models.Coach, player, picked: list[str],
                     game_ids: list[int] | None):
    """The documents a summary should read, and a note of where they came from.

    Returns [(heading, text), ...]. The heading names the date and the kind, so
    the model can talk about a trajectory rather than a pile of prose.

    An empty `picked` means everything, which is what this endpoint did before
    it could be asked — a summary generated from an older client must not come
    back empty.
    """
    want = set(picked)
    everything = not want
    pieces: list[tuple[str, str]] = []
    used: set[str] = set()

    def add(when, kind: str, text: str | None, grade=None):
        if not text:
            return
        date_str = when.strftime("%Y-%m-%d") if when else "Unknown"
        grade_str = f" Overall: {grade:.1f}/10" if grade is not None else ""
        pieces.append((f"\n[{date_str} — {kind}]{grade_str}\n", text))

    # Evaluations, by the report type each was written as. A report saved from
    # a combined selection carries both names — "coaching_report,scouting_report"
    # — and counts for either, because it IS partly each of them.
    for ev in player.evaluations:
        kinds = {k.strip() for k in (ev.output_type or "").split(",") if k.strip()}
        is_box = "box_score" in kinds
        if everything or (kinds & want) or (is_box and SRC_GAME_STATS in want):
            add(ev.created_at, ev.output_type or "report", ev.report_text, ev.overall_grade)
            used.update(kinds)

    if everything or SRC_TRAINING in want:
        programs = (db.query(models.TrainingSession)
                      .filter_by(player_id=player.id).all())
        for ts in programs:
            add(ts.created_at, ts.title or "training_program", ts.program_text)
        if programs:
            used.add(SRC_TRAINING)

    if everything or SRC_SHARED in want:
        # Reports another coach shared with this one that are ABOUT this player,
        # including a team report that covers him among others: the coach was
        # given it, and what it says about him counts.
        from .staff_sharing import _resolve_report_text, _report_meta
        shares = (db.query(models.StaffSharedReport)
                    .filter_by(recipient_id=coach.id).all())
        for sr in shares:
            subject, _out, _grade = _report_meta(sr.report_type, sr.report_id, db)
            text = sr.frozen_text or _resolve_report_text(
                sr.report_type, sr.report_id, db, sr.sender_id)
            if not text:
                continue
            about_player = (subject or "").strip().lower() == player.name.strip().lower()
            mentioned = player.name.strip().lower() in text.lower()
            if about_player or mentioned:
                sender = sr.sender.name if sr.sender else "another coach"
                add(sr.created_at, f"shared by {sender}", text)
                used.add(SRC_SHARED)

    return pieces, used


@router.post("/{player_id}/summary", response_model=schemas.SummaryOut)
async def player_summary(
    player_id: int,
    body: schemas.SummaryRequest,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY is not set on the server. Ask the server admin to configure it."
        )
    player = get_owned(db, models.Player, player_id, coach.id, "Player")

    picked = [s for s in (body.sources or []) if s]
    pieces, used = _summary_sources(db, coach, player, picked, body.game_ids)

    # One budget for the whole prompt, shared out between whatever was picked.
    # A fixed 800 characters a report meant a focused summary — one source, two
    # documents — was cut to the same first paragraph as a sweep of twenty, so
    # narrowing the question bought no more depth. Same total either way; the
    # fewer documents in play, the more of each one is read.
    per_doc = max(800, min(6000, SUMMARY_BUDGET_CHARS // max(1, len(pieces))))
    eval_context = "".join(head + (text or "")[:per_doc] + "\n" for head, text in pieces)

    # Real stat lines from tracked games, which follow the Game Stats tick.
    # They used to follow the OUTPUT type — asking for the summary to be
    # written as a box score was the only way to get the numbers into it, which
    # is a strange thing to have to know.
    tracked_block = ""
    if not picked or SRC_GAME_STATS in picked:
        from .game_eval import player_tracked_stats_block
        tracked_block = player_tracked_stats_block(db, coach.id, player.name, body.game_ids)

    # Nothing to read. Checked once, after the stats, because Game Stats on its
    # own is a perfectly good thing to summarize FROM and produces no documents.
    if not pieces and not tracked_block.strip():
        raise HTTPException(
            status_code=400,
            detail=("Nothing to summarize from what you picked. Try another source."
                    if picked else "No evaluations yet for this player"),
        )

    focus = body.focus_prompt or ""
    from video_vision.bim import describe_output_type, comprehensive_directive
    from ..coach_context import resolve_level, language_directive
    _team = db.get(models.Team, player.team_id) if player.team_id else None
    _lvl = resolve_level(coach, player, _team)
    prompt = (
        f"You are the BloomPrint Basketball Intelligence Model. "
        f"Generate a {describe_output_type(body.output_type)} that SUMMARIZES ALL EVALUATION HISTORY for {player.name}.\n\n"
        f"COMPETITION LEVEL: {_lvl} — calibrate every grade, comparison, and recommendation to this level.\n\n"
        f"EVALUATION HISTORY:\n{eval_context}\n"
        f"{tracked_block}\n\n"
        f"{('FOCUS: ' + focus) if focus else ''}\n\n"
        "Synthesize trends, growth over time, consistent strengths, persistent concerns, "
        "and the player's trajectory. Provide an overall composite grade and pillar grades. "
        "Format with clear BIM sections including OVERALL GRADE, pillar grades, GREEN FLAGS, WATCH FLAGS, and KEY QUESTIONS."
        f"{comprehensive_directive(body.output_type)}"
        f"{REPORT_FORMAT_WITH_TABLES}"
        f"{language_directive(coach)}"
    )

    from video_vision.bim import parse_output_types
    summary_max_tokens = 16000 if len(parse_output_types(body.output_type)) > 1 else 6144
    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        response = await client.messages.create(
            model=OPUS,
            max_tokens=summary_max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        text_blocks = [b for b in response.content if hasattr(b, "text")]
        if not text_blocks:
            raise HTTPException(status_code=500, detail="AI returned no text content")
        report_text = text_blocks[0].text

        # Save to DB so it appears in Recent Reports
        from .evaluations import _parse_grade, _parse_pillar_grades, _parse_list_section
        eval_record = models.Evaluation(
            player_id=player_id,
            coach_id=coach.id,
            output_type=body.output_type,
            report_text=report_text,
            overall_grade=_parse_grade(report_text),
            pillar_grades=_parse_pillar_grades(report_text),
            green_flags=_parse_list_section(report_text, "GREEN FLAGS"),
            watch_flags=_parse_list_section(report_text, "WATCH FLAGS"),
            key_questions=_parse_list_section(report_text, "KEY QUESTIONS"),
        )
        db.add(eval_record)
        db.commit()

        return schemas.SummaryOut(report_text=report_text)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")


# The player's BIM score is a living, recency-weighted composite of ALL their
# evaluations (every report is part of the story), not just the latest one.
_BIM_HALF_LIFE_DAYS = 120.0   # ~4 months: recent film counts most, history still counts


def _composite_bim(player: models.Player, evals=None):
    """Returns (composite_overall, composite_pillars, report_count) over the
    given eval list (defaults to all of the player's evals)."""
    from datetime import datetime
    source = player.evaluations if evals is None else evals
    evals = [e for e in source if e.overall_grade is not None]
    if not evals:
        return None, {}, 0
    now = datetime.utcnow()

    def weight(e):
        age = max((now - e.created_at).days, 0) if e.created_at else 0
        return 0.5 ** (age / _BIM_HALF_LIFE_DAYS)

    wsum = sum(weight(e) for e in evals)
    overall = round(sum(e.overall_grade * weight(e) for e in evals) / wsum, 1) if wsum else None

    # Aggregate every pillar key found across evals, each recency-weighted.
    pil_num: dict[str, float] = {}
    pil_den: dict[str, float] = {}
    for e in evals:
        w = weight(e)
        for k, v in (e.pillar_grades or {}).items():
            try:
                fv = float(v)
            except (TypeError, ValueError):
                continue
            pil_num[k] = pil_num.get(k, 0.0) + fv * w
            pil_den[k] = pil_den.get(k, 0.0) + w
    pillars = {k: round(pil_num[k] / pil_den[k], 1) for k in pil_num if pil_den.get(k, 0) > 0}
    return overall, pillars, len(evals)


def _with_grade(player: models.Player, evals=None) -> schemas.PlayerOut:
    # `evals` scopes the BIM: a coach's own evals (their personal score) on the
    # coach side, or the player's SHARED evals (aggregate) on the player side.
    out = schemas.PlayerOut.model_validate(player)
    source = player.evaluations if evals is None else evals
    graded = [e for e in source if e.overall_grade is not None]
    if graded:
        out.latest_grade = graded[-1].overall_grade
        overall, pillars, count = _composite_bim(player, source)
        out.bim_grade = overall
        out.bim_pillars = pillars or None
        out.bim_report_count = count
    if player.team:
        out.team_id = player.team.id
        out.team_name = player.team.name
    return out
