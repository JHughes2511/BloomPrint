import os
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_coach
from .. import models, schemas


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
    if data.get("team_id"):
        team = db.get(models.Team, data["team_id"])
        if team:
            data["program_name"] = team.name
            data["coach_id"] = team.coach_id
    if not data.get("coach_id"):
        data["coach_id"] = coach.id
    if "program_name" not in data or not data.get("program_name"):
        data["program_name"] = coach.program_name
    player = models.Player(**data)
    db.add(player)
    db.commit()
    db.refresh(player)
    return _with_grade(player, [e for e in player.evaluations if e.coach_id == coach.id])


def _accessible_team_ids(db: Session, coach: models.Coach) -> set[int]:
    ids = {tm.id for tm in db.query(models.Team).filter_by(coach_id=coach.id).all()}
    ids |= {l.team_id for l in db.query(models.TeamStaff).filter_by(coach_id=coach.id).all()}
    return ids


def _can_see_player(db: Session, coach: models.Coach, player: models.Player) -> bool:
    if player.coach_id == coach.id:
        return True
    return player.team_id is not None and player.team_id in _accessible_team_ids(db, coach)


@router.get("", response_model=list[schemas.PlayerOut])
def list_players(
    team_id: int | None = None,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    from sqlalchemy import or_
    team_ids = _accessible_team_ids(db, coach)
    conds = [models.Player.coach_id == coach.id]
    if team_ids:
        conds.append(models.Player.team_id.in_(team_ids))
    q = db.query(models.Player).filter(or_(*conds))
    if team_id is not None:
        q = q.filter(models.Player.team_id == team_id)
    return [_with_grade(p, [e for e in p.evaluations if e.coach_id == coach.id]) for p in q.all()]


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
    return _with_grade(player, [e for e in player.evaluations if e.coach_id == coach.id])


@router.patch("/{player_id}", response_model=schemas.PlayerOut)
def update_player(
    player_id: int,
    body: PlayerUpdate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = db.get(models.Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    if body.name is not None:
        player.name = body.name
    if body.position is not None:
        player.position = body.position
    if body.jersey_number is not None:
        player.jersey_number = body.jersey_number
    if body.competition_level is not None:
        player.competition_level = body.competition_level
    if body.team_id is not None:
        team = db.get(models.Team, body.team_id)
        player.team_id = body.team_id
        if team:
            player.program_name = team.name
    elif body.team_id == 0:
        player.team_id = None
    if body.height is not None:
        player.height = body.height
    if body.wingspan is not None:
        player.wingspan = body.wingspan
    for field in ("weight", "standing_reach", "country", "state", "city", "school_name"):
        val = getattr(body, field)
        if val is not None:
            setattr(player, field, val)
    db.commit()
    db.refresh(player)
    return _with_grade(player, [e for e in player.evaluations if e.coach_id == coach.id])


@router.delete("/{player_id}")
def delete_player(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = db.get(models.Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    db.delete(player)
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
    return [e for e in player.evaluations if e.coach_id == coach.id]


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
    player = db.get(models.Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    evals = player.evaluations
    if not evals:
        raise HTTPException(status_code=400, detail="No evaluations yet for this player")

    eval_context = ""
    for ev in evals:
        grade_str = f"{ev.overall_grade:.1f}/10" if ev.overall_grade is not None else "N/A"
        date_str = ev.created_at.strftime("%Y-%m-%d") if ev.created_at else "Unknown"
        eval_context += f"\n[{date_str} — {ev.output_type}] Overall: {grade_str}\n"
        if ev.report_text:
            eval_context += ev.report_text[:800] + "\n"

    # Tracked game stats from selected games (real box-score data from Team Grade).
    from .game_eval import player_tracked_stats_block
    tracked_block = player_tracked_stats_block(db, coach.id, player.name, body.game_ids)

    focus = body.focus_prompt or ""
    from video_vision.bim import describe_output_type, comprehensive_directive
    prompt = (
        f"You are the BloomPrint Basketball Intelligence Model. "
        f"Generate a {describe_output_type(body.output_type)} that SUMMARIZES ALL EVALUATION HISTORY for {player.name}.\n\n"
        f"EVALUATION HISTORY:\n{eval_context}\n"
        f"{tracked_block}\n\n"
        f"{('COACH FOCUS: ' + focus) if focus else ''}\n\n"
        "Synthesize trends, growth over time, consistent strengths, persistent concerns, "
        "and the player's trajectory. Provide an overall composite grade and pillar grades. "
        "Format with clear BIM sections including OVERALL GRADE, pillar grades, GREEN FLAGS, WATCH FLAGS, and KEY QUESTIONS."
        f"{comprehensive_directive(body.output_type)}"
        "\n\nIMPORTANT: Do NOT use ## headers or ** bold markers anywhere (including KEY QUESTIONS). "
        "Use plain section titles in ALL CAPS followed by a colon."
    )

    from video_vision.bim import parse_output_types
    summary_max_tokens = 8192 if len(parse_output_types(body.output_type)) > 1 else 2048
    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        response = await client.messages.create(
            model="claude-opus-4-7",
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
