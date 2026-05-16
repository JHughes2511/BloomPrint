import os
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from ..auth import get_current_coach
from .. import models, schemas

router = APIRouter(prefix="/players", tags=["players"])


@router.post("", response_model=schemas.PlayerOut)
def create_player(
    body: schemas.PlayerCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    data = body.model_dump()
    # Derive program_name from team if team_id given
    if data.get("team_id"):
        team = db.get(models.Team, data["team_id"])
        if team:
            data["program_name"] = team.name
    if "program_name" not in data or not data.get("program_name"):
        data["program_name"] = coach.program_name
    player = models.Player(**data)
    db.add(player)
    db.commit()
    db.refresh(player)
    return _with_grade(player)


@router.get("", response_model=list[schemas.PlayerOut])
def list_players(
    team_id: int | None = None,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    q = db.query(models.Player)
    if team_id is not None:
        q = q.filter(models.Player.team_id == team_id)
    return [_with_grade(p) for p in q.all()]


@router.get("/{player_id}", response_model=schemas.PlayerOut)
def get_player(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = db.get(models.Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    return _with_grade(player)


@router.get("/{player_id}/evaluations", response_model=list[schemas.EvalOut])
def player_evaluations(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = db.get(models.Player, player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    return player.evaluations


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

    focus = body.focus_prompt or ""
    prompt = (
        f"You are the BloomPrint Basketball Intelligence Model. "
        f"Generate a {body.output_type.replace('_', ' ')} that SUMMARIZES ALL EVALUATION HISTORY for {player.name}.\n\n"
        f"EVALUATION HISTORY:\n{eval_context}\n\n"
        f"{('COACH FOCUS: ' + focus) if focus else ''}\n\n"
        "Synthesize trends, growth over time, consistent strengths, persistent concerns, "
        "and the player's trajectory. Provide an overall composite grade and pillar grades. "
        "Format with clear BIM sections including OVERALL GRADE, pillar grades, GREEN FLAGS, WATCH FLAGS, and KEY QUESTIONS."
    )

    try:
        import anthropic
        client = anthropic.AsyncAnthropic()
        response = await client.messages.create(
            model="claude-opus-4-7",
            max_tokens=2048,
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


def _with_grade(player: models.Player) -> schemas.PlayerOut:
    out = schemas.PlayerOut.model_validate(player)
    if player.evaluations:
        grades = [e.overall_grade for e in player.evaluations if e.overall_grade is not None]
        out.latest_grade = grades[-1] if grades else None
    if player.team:
        out.team_id = player.team.id
        out.team_name = player.team.name
    return out
