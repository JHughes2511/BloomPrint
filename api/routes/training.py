from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth import get_current_coach
from .. import models, schemas

router = APIRouter(prefix="/training", tags=["training"])


@router.post("", response_model=schemas.TrainingOut)
async def generate_training(
    body: schemas.TrainingRequest,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    player = db.get(models.Player, body.player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    eval_record = None
    if body.evaluation_id:
        eval_record = db.get(models.Evaluation, body.evaluation_id)
        if not eval_record or eval_record.player_id != body.player_id:
            raise HTTPException(status_code=404, detail="Evaluation not found for this player")

    # Build context from the most recent eval if available
    focus = body.focus_prompt or ""
    if eval_record and eval_record.report_text:
        focus = f"Base this training program on the following player evaluation:\n\n{eval_record.report_text[:3000]}\n\n{focus}"
    elif player.notes:
        focus = f"Player notes: {player.notes}\n\n{focus}"

    import sys
    sys.path.insert(0, ".")
    from video_vision.bim import build_prompt
    import anthropic

    prompt = build_prompt(
        "training_program",
        coach.program_name,
        player.competition_level,
        coach.weight,
        player.name,
    )
    if focus:
        prompt += f"\n\nCOACH CONTEXT:\n{focus}"

    client = anthropic.Anthropic()
    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=3000,
        messages=[{"role": "user", "content": prompt}],
    )
    program_text = response.content[0].text

    # Extract ordered priorities from the program text
    import re
    priorities: list[str] = []
    m = re.search(r"KPI TARGETS(.*?)(?:CORRECTABLE|PROGRESS|$)", program_text, re.DOTALL | re.IGNORECASE)
    if m:
        for line in m.group(1).splitlines():
            line = re.sub(r"^[-·*\d\.\s↑↓]+", "", line).strip()
            if line:
                priorities.append(line)

    session = models.TrainingSession(
        player_id=body.player_id,
        coach_id=coach.id,
        evaluation_id=body.evaluation_id,
        program_text=program_text,
        priorities=priorities[:6],
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/player/{player_id}", response_model=list[schemas.TrainingOut])
def list_training(
    player_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    return db.query(models.TrainingSession).filter_by(player_id=player_id).all()
