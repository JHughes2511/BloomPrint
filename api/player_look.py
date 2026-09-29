"""Knowing a player on film: what the analysis is told, and what it learns.

`who_for` is what a highlight tape is given to find the player with: every
number on record (roster, box scores, earlier tapes, the one the coach just
typed), position and height, the traits seen most often, and a few reference
frames. Nothing is asked of the coach that the app already knows.

`clip_checker` is the hook the analysis calls once it has decided, clip by
clip, whether the player is there (video_vision/identify.py). It saves every
clip, shows the unsure ones to the coach (a frame with a box round who it
thinks it is), waits a while for answers, and then learns from every clip that
is the player — so the next tape knows more and asks less.
"""
from __future__ import annotations

import io
import os
import time
import uuid
from collections import Counter

from sqlalchemy.orm import Session

from . import models

CLIP_WAIT_SECONDS = int(os.environ.get("BLOOMPRINT_CLIP_WAIT", "180"))
MAX_REFS = 6
MAX_TRAITS = 10


def look_for(db: Session, coach_id: int, player: models.Player) -> models.PlayerLook:
    row = db.query(models.PlayerLook).filter_by(player_id=player.id).first()
    if row is None:
        row = models.PlayerLook(player_id=player.id, coach_id=coach_id, player_name=player.name,
                                numbers=[], traits={}, refs=[])
        db.add(row)
        db.flush()
    return row


def _read(ref: str) -> bytes | None:
    try:
        from .storage import ensure_local
        with open(ensure_local(ref), "rb") as f:
            return f.read()
    except Exception:
        return None


def _save(data: bytes, key: str) -> str | None:
    try:
        from .storage import save_fileobj
        return save_fileobj(io.BytesIO(data), key)
    except Exception:
        return None


def known_numbers(db: Session, coach_id: int, player: models.Player, extra: str | None = None) -> list[str]:
    """Every number on record for the player, most recent first."""
    import re
    nums: list[str] = []

    def add(n):
        n = re.sub(r"[^0-9]", "", str(n or ""))
        if n:
            n = n if n == "00" else str(int(n))
            if n not in nums:
                nums.append(n)
    add(extra)
    add(player.jersey_number)
    look = db.query(models.PlayerLook).filter_by(player_id=player.id).first()
    for n in reversed(look.numbers or []) if look else []:
        add(n)
    try:
        rows = (db.query(models.GamePlayerStat.jersey_number)
                .join(models.GameSession, models.GameSession.id == models.GamePlayerStat.game_id)
                .filter(models.GameSession.coach_id == coach_id, models.GamePlayerStat.is_opponent.is_(False),
                        models.GamePlayerStat.player_name == player.name,
                        models.GamePlayerStat.jersey_number.isnot(None)).distinct().all())
        for (n,) in rows:
            add(n)
    except Exception:
        pass
    return nums


def who_for(db: Session, coach_id: int, player: models.Player, typed_number: str | None = None) -> dict:
    """What the analysis is told to find the player by."""
    look = db.query(models.PlayerLook).filter_by(player_id=player.id).first()
    traits = [t for t, _ in Counter(look.traits or {}).most_common(MAX_TRAITS)] if look else []
    refs = [b for b in (_read(r) for r in (look.refs or [])[-3:]) if b] if look else []
    return {"name": player.name, "numbers": known_numbers(db, coach_id, player, typed_number),
            "position": player.position, "height": player.height, "traits": traits, "refs": refs}


def learn(db: Session, coach_id: int, player: models.Player, clips: list[dict]) -> None:
    """Fold the clips that are the player into what is known about them."""
    from video_vision.identify import crop
    mine = [c for c in clips if c.get("final") == "yes"]
    if not mine:
        return
    look = look_for(db, coach_id, player)
    nums = list(look.numbers or [])
    traits = Counter(look.traits or {})
    refs = list(look.refs or [])
    for c in mine:
        if c.get("no") and c["no"] not in nums:
            nums.append(c["no"])
        for t in c.get("traits") or []:
            traits[t.lower()] += 1
    # A few new reference frames: the coach's confirmations first (they are
    # the ones the analysis was unsure of, so the most to learn from).
    ranked = sorted(mine, key=lambda c: (c.get("answer") != "yes",))
    for c in ranked[:2]:
        piece = crop(c.get("frame"), c.get("box"))
        if piece:
            ref = _save(piece, f"looks/{player.id}/{uuid.uuid4().hex}.jpg")
            if ref:
                refs.append(ref)
    look.numbers = nums[-8:]
    look.traits = dict(traits.most_common(30))
    look.refs = refs[-MAX_REFS:]
    look.confirmed = (look.confirmed or 0) + len(mine)
    db.commit()


def clip_checker(job_id: int, coach_id: int, player_id: int):
    """The `_on_clips` hook for one eval job (see the module docstring)."""
    from video_vision.identify import thumbnail
    from .database import SessionLocal

    def run(clips: list[dict]) -> list[dict]:
        db = SessionLocal()
        try:
            for c in clips:
                thumb = None
                if c.get("present") == "unsure":
                    data = thumbnail(c.get("frame"), c.get("box"))
                    thumb = _save(data, f"clipchecks/{job_id}/{c['clip']}.jpg") if data else None
                db.add(models.FilmClipCheck(
                    job_id=job_id, coach_id=coach_id, player_id=player_id, clip=c["clip"], film=c.get("film", 0),
                    start=c["start"], end=c["end"], present=c["present"], uni=c.get("uni"), no=c.get("no"),
                    traits=c.get("traits"), box=c.get("box"), thumb_ref=thumb))
            unsure = [c for c in clips if c.get("present") == "unsure"]
            if unsure:
                job = db.get(models.GenerationJob, job_id)
                if job:
                    job.progress = f"job:confirmClips:{len(unsure)}"
            db.commit()
            # Wait for the coach, a while: every unsure clip answered (or the
            # coach said done), or time up — then carry on either way.
            deadline = time.time() + (CLIP_WAIT_SECONDS if unsure else 0)
            answers: dict[int, str] = {}
            while True:
                db.expire_all()
                rows = db.query(models.FilmClipCheck).filter_by(job_id=job_id).all()
                answers = {r.clip: r.answer for r in rows if r.answer}
                if all(c["clip"] in answers for c in unsure) or time.time() >= deadline:
                    break
                time.sleep(2)
            for c in clips:
                a = answers.get(c["clip"])
                c["answer"] = a
                if c.get("present") == "unsure":
                    c["final"] = a if a in ("yes", "no") else "left_out"
            player = db.get(models.Player, player_id)
            if player is not None:
                try:
                    learn(db, coach_id, player, clips)
                except Exception:
                    db.rollback()
            job = db.get(models.GenerationJob, job_id)
            if job and unsure:
                job.progress = "job:identified"
                db.commit()
            return clips
        finally:
            db.close()
    return run


# ── Teams on a film cut from several games (Game Report film, scouting) ─────

def packet_teams(db: Session, gr: models.GameReport, coach: models.Coach) -> list[dict]:
    """The two teams a packet is about, each with its roster numbers and the
    colours it has been seen in before."""
    mode_vs = gr.mode == "opp_vs_opp"
    a = gr.my_team.name if gr.my_team else ((gr.opponent_a_name or "Opponent A") if mode_vs else coach.program_name)
    b = gr.opponent_team.name if gr.opponent_team else (gr.opponent_name or ("Opponent B" if mode_vs else "Opponent"))
    out = []
    for name, team_id in ((a, gr.my_team_id), (b, gr.opponent_team_id)):
        if not name:
            continue
        nums: list[str] = []
        if team_id:
            nums += [p.jersey_number for p in db.query(models.Player).filter_by(team_id=team_id).all() if p.jersey_number]
        nums += [o.jersey_number for o in db.query(models.OpponentPlayer).filter_by(coach_id=coach.id).all()
                 if o.jersey_number and (o.opponent_name or "").strip().lower() == name.strip().lower()]
        tl = db.query(models.TeamLook).filter_by(coach_id=coach.id, team_name=name).first()
        colours = [c for c, _ in Counter(tl.colours or {}).most_common(6)] if tl else []
        out.append({"name": name, "numbers": list(dict.fromkeys(str(n) for n in nums)), "colours": colours})
    return out


def learn_team_colours(db: Session, coach_id: int, clips: list[dict]) -> None:
    counts: dict[str, Counter] = {}
    for c in clips:
        for colour, team in (c.get("final") or {}).items():
            if team and team != "neither":
                counts.setdefault(team, Counter())[colour] += 1
    for team, cnt in counts.items():
        tl = db.query(models.TeamLook).filter_by(coach_id=coach_id, team_name=team).first()
        if tl is None:
            tl = models.TeamLook(coach_id=coach_id, team_name=team, colours={})
            db.add(tl)
        merged = Counter(tl.colours or {})
        merged.update(cnt)
        tl.colours = dict(merged.most_common(12))
    db.commit()


def segment_checker(clip_id: int, job_id: int, coach_id: int):
    """Save each clip's colours, ask the coach about the unsure ones, wait a
    while, learn, and return the clips with `final` colour maps."""
    from video_vision.identify import thumbnail
    from .database import SessionLocal

    def run(clips: list[dict]) -> list[dict]:
        db = SessionLocal()
        try:
            db.query(models.FilmSegment).filter_by(clip_id=clip_id).delete()
            for c in clips:
                thumb = None
                if not c["sure"]:
                    data = thumbnail(c.get("frame"), None)
                    thumb = _save(data, f"segments/{clip_id}/{c['clip']}.jpg") if data else None
                db.add(models.FilmSegment(clip_id=clip_id, idx=c["clip"], start=c["start"], end=c["end"],
                                          seen=c.get("seen"), colours=c.get("colours") if c["sure"] else None,
                                          sure=c["sure"], thumb_ref=thumb))
            unsure = [c for c in clips if not c["sure"]]
            if unsure:
                job = db.get(models.GenerationJob, job_id)
                if job:
                    job.progress = f"job:confirmTeams:{len(unsure)}"
            db.commit()
            deadline = time.time() + (CLIP_WAIT_SECONDS if unsure else 0)
            while True:
                db.expire_all()
                rows = {r.idx: r for r in db.query(models.FilmSegment).filter_by(clip_id=clip_id).all()}
                if all(rows.get(c["clip"]) is not None and rows[c["clip"]].answer for c in unsure) \
                        or time.time() >= deadline:
                    break
                time.sleep(2)
            for c in clips:
                r = rows.get(c["clip"])
                c["final"] = (r.colours or {}) if r is not None and (r.sure or r.answer == "answered") else {}
            learn_team_colours(db, coach_id, clips)
            return clips
        finally:
            db.close()
    return run
