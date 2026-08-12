"""Game Report Packet routes — persistent multi-source report builder."""

import json
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal, revive_if_stalled
from ..auth import get_current_coach
from ..report_format import REPORT_FORMAT, REPORT_FORMAT_WITH_TABLES
from .. import models, schemas
from ..softdelete import soft_delete
from ..ownership import owns
from ..ai_models import long_text
from ..uploadguard import read_upload


def _film_context(gr: models.GameReport, coach: models.Coach) -> tuple[str, str, str]:
    """What this packet's film is of: (subject, directive, segment note).

    The packet already knows — the coach chose a report context when they made
    it. The film analysis never asked. It was handed `program_name` and
    `opp_name` and made its own guess, which is wrong in exactly the case the
    coach was most explicit about: on an opponent-vs-opponent packet Opponent A
    lives in the `my_team` slot, so the analyzer was told the first opponent was
    the coach's own program and wrote the whole report about them.
    """
    from video_vision.bim import matchup_directive

    program = (coach.program_name or "").strip() or "the coach's program"
    a_name = (gr.my_team.name if gr.my_team else None) or getattr(gr, "opponent_a_name", None)
    b_name = (gr.opponent_team.name if gr.opponent_team else None) or gr.opponent_name

    if gr.mode == "opp_vs_opp":
        # Neither side is the coach's. my_team holds Opponent A here.
        a = a_name or "Opponent A"
        b = b_name or "Opponent B"
        subject = f"{a} vs {b}"
    elif gr.mode == "opponent_only":
        a = program
        b = b_name or "the opponent"
        subject = b
    elif gr.mode == "my_program":
        a = a_name or program
        b = ""
        subject = a
        program = a
    else:                                    # vs_opponent
        a = a_name or program
        b = b_name or "the opponent"
        subject = f"{a} vs {b}"
        program = a

    directive, note = matchup_directive(gr.mode or "vs_opponent", a, b, program)
    return subject, directive, note


def _run_clip_analysis(clip_id: int, job_id: int, video_path: str, output_type: str,
                       program_name: str, opp_name: str, label_text: str,
                       coach_weight: int, focus_prompt: str, level: str = "HS Varsity",
                       report_subject: str = "", report_context: str = "",
                       report_segment_note: str = ""):
    """Background task: analyze a (possibly hour-long) film and fill in the clip.
    Reports per-segment progress on the GenerationJob so the app shows the same
    "Analyzing segment i of N" bar as the player-eval flow."""
    import asyncio

    # No session is held across the analysis. Reading a film takes the better
    # part of an hour, and a session opened at the start of that is a
    # transaction left open for the whole of it — PostgreSQL closes those
    # ("terminating connection due to idle-in-transaction timeout"), so the
    # write at the END failed on a connection that had been dead for forty
    # minutes. The error handler then failed the same way, and the job was left
    # saying "Synthesizing report" with nothing coming. Every touch of the
    # database here is its own short-lived session instead.
    try:
        import sys
        sys.path.insert(0, ".")
        from video_vision.server import _handle_analyze_basketball_video

        def _prog(done, total, label):
            pdb = SessionLocal()
            try:
                j = pdb.get(models.GenerationJob, job_id)
                if j:
                    j.progress = label
                    pdb.commit()
            finally:
                pdb.close()

        # Segments already finished by an earlier attempt, and the hook that
        # records each new one. See _resume_orphaned_jobs: a deploy in the
        # middle of a twenty-minute film used to cost the whole analysis.
        def _save_segment(index, text):
            sdb = SessionLocal()
            try:
                j = sdb.get(models.GenerationJob, job_id)
                if not j:
                    return
                data = json.loads(j.partial or "{}")
                data.setdefault("segments", {})[str(index)] = text
                j.partial = json.dumps(data)
                sdb.commit()
            except Exception:
                sdb.rollback()
            finally:
                sdb.close()

        # The pre-scan from an earlier attempt, alongside the finished segments.
        # Reading a three-hour film is thousands of seeks and produces a few
        # hundred numbers; keeping them is what stops a restart at 99% throwing
        # away the hour it took.
        def _save_profile(index, profile):
            pdb = SessionLocal()
            try:
                j = pdb.get(models.GenerationJob, job_id)
                if not j:
                    return
                data = json.loads(j.partial or "{}")
                profiles = data.setdefault("profiles", {})
                blob = json.dumps(profile)
                # A guard, not a policy: a pre-scan is tens of kilobytes, and a
                # runaway one should not become the reason a job row cannot save.
                if len(blob) <= 400_000:
                    profiles[str(index)] = profile
                    j.partial = json.dumps(data)
                    pdb.commit()
            except Exception:
                pdb.rollback()
            finally:
                pdb.close()

        done_segments = {}
        done_profiles = {}
        rdb = SessionLocal()
        try:
            j0 = rdb.get(models.GenerationJob, job_id)
            if j0 and j0.partial:
                try:
                    _p = json.loads(j0.partial)
                    done_segments = _p.get("segments", {})
                    done_profiles = _p.get("profiles", {})
                except Exception:
                    done_segments, done_profiles = {}, {}
        finally:
            rdb.close()

        from ..storage import ensure_local
        result = asyncio.run(_handle_analyze_basketball_video({
            "video_path": ensure_local(video_path),
            "output_type": output_type,
            "program_name": program_name,
            "competition_level": level,
            "coach_weight": coach_weight,
            # A team is not a player. This used to carry the film's team label
            # ("Angola vs Egypt") in the player-focus slot, so every segment was
            # asked for "strengths and weaknesses for Angola vs Egypt" as though
            # that were somebody on the roster.
            "player_name": "",
            "report_subject": report_subject or label_text,
            "report_context": report_context,
            "report_segment_note": report_segment_note,
            "focus_prompt": focus_prompt or "",
            "audio_auto": True,         # gauge whether the film's audio is worth transcribing
            "_progress": _prog,
            "_resume_notes": done_segments,
            "_on_segment": _save_segment,
            "_resume_profiles": done_profiles,
            "_on_profile": _save_profile,
        }))
        text = result[0].text
        wdb = SessionLocal()
        try:
            clip = wdb.get(models.GameReportClip, clip_id)
            if clip:
                clip.analysis_text = text
            job = wdb.get(models.GenerationJob, job_id)
            if job:
                job.status = "done"
                job.result_id = clip_id
            wdb.commit()
        finally:
            wdb.close()
    except Exception as exc:
        # A fresh session for the failure too: the one that failed may be the
        # reason we are here, and recording "this went wrong" through a broken
        # connection is how a job ends up stuck rather than errored.
        edb = SessionLocal()
        try:
            clip = edb.get(models.GameReportClip, clip_id)
            if clip:
                clip.analysis_text = f"Analysis failed — {str(exc)[:300]}"
            job = edb.get(models.GenerationJob, job_id)
            if job:
                job.status = "error"
                job.error = str(exc)[:500]
            edb.commit()
        except Exception:
            edb.rollback()
        finally:
            edb.close()
    finally:
        # The job has reached an end either way, so the gigabytes downloaded to
        # read it are no longer needed. Reaching here at all means we were not
        # killed — an interrupted attempt deliberately leaves the file, because
        # the attempt that follows it wants exactly that copy.
        try:
            from ..storage import release_local
            release_local(video_path)
        except Exception:
            pass


def _film_team_id(db: Session, gr: models.GameReport, clip: models.GameReportClip,
                  coach: models.Coach) -> int | None:
    """Which team a film is about, for remembering a correction against it.

    The clip carries the name the coach labelled it with, which is the most
    specific thing available — on an opponent-vs-opponent packet both sides are
    someone else's and the packet's own my_team slot holds Opponent A. Falling
    back to the packet's team is right for every other mode.
    """
    name = (getattr(clip, "team_name", None) or "").strip().lower()
    if name:
        for tm in db.query(models.Team).filter_by(coach_id=coach.id).all():
            if (tm.name or "").strip().lower() == name:
                return tm.id
    return gr.my_team_id


def _split_corrected_section(text: str) -> tuple[str | None, str]:
    """Pull the "CORRECTED SECTION: ..." line off the front of a re-watch.

    Returns (heading, the analysis without that line). A reply that does not
    carry the line still works — the merge falls back to taking the rewrite's
    own differences — so a model that forgets the format costs formatting, not
    the correction.
    """
    if not text:
        return None, ""
    first, sep, rest = text.partition("\n")
    label = first.strip()
    if label.upper().startswith("CORRECTED SECTION:"):
        heading = label.split(":", 1)[1].strip().strip('"').rstrip(":").strip()
        return (heading or None), rest.lstrip("\n") if sep else ""
    return None, text


def _run_clip_recorrection(clip_id: int, job_id: int, video_path: str, output_type: str,
                           program_name: str, opp_name: str, label_text: str,
                           coach_weight: int, prior_text: str, correction: str, level: str = "HS Varsity",
                           report_subject: str = "", report_context: str = "",
                           report_segment_note: str = ""):
    """Background task: RE-WATCH the film guided by a coach correction.

    The re-watch is the point: the model goes back to the frames, finds what
    the coach is describing and verifies it, rather than taking their word for
    it and rewording the paragraph.

    What comes back replaces ONE SECTION. Everything the coach did not question
    is restored from the analysis they already read — see report_sections. A
    correction about the defensive rotations is not a reason for the executive
    summary to come back differently worded, and a coach who has to re-read the
    whole document to find out what changed will stop making corrections.
    """
    import asyncio

    # As in _run_clip_analysis: no session is held across the re-watch, which
    # takes as long as the first pass. See the note there.
    try:
        import sys
        sys.path.insert(0, ".")
        from video_vision.server import _handle_analyze_basketball_video

        def _prog(done, total, label):
            pdb = SessionLocal()
            try:
                j = pdb.get(models.GenerationJob, job_id)
                if j:
                    j.progress = label
                    pdb.commit()
            finally:
                pdb.close()

        focus = (
            "A coach reviewed your PRIOR analysis of this exact film and made a correction. "
            "Re-watch the film and LOCATE the specific action, play, or moment the coach is "
            "describing. VERIFY it visually in the frames — identify the concept/action they "
            "mean (a screen, a rotation, a coverage, a read, whoever was involved), cite it by "
            "film timestamp (MM:SS). Do NOT simply repeat the coach's words — find what they "
            "are pointing at in the film and describe it accurately. If, after re-watching, you "
            "still cannot see what they describe, say so plainly rather than inventing it.\n\n"
            "CHANGE ONE SECTION, NOT THE REPORT. The coach has already read and accepted the "
            "rest of this analysis. Reproduce the prior analysis in full, with ONLY the section "
            "the correction is about rewritten. Every other section must come back WORD FOR "
            "WORD as it is below — do not improve, reword, reorder or shorten any of them. If "
            "the correction is about something no section covers, add one section for it and "
            "leave the others alone.\n"
            "Begin your reply with a single line naming that section, exactly:\n"
            "CORRECTED SECTION: <the heading, as it appears>\n"
            "then the full analysis.\n\n"
            f"PRIOR ANALYSIS:\n{prior_text}\n\nCOACH CORRECTION:\n{correction}"
        )

        from ..storage import ensure_local
        result = asyncio.run(_handle_analyze_basketball_video({
            "video_path": ensure_local(video_path),
            "output_type": output_type,
            "program_name": program_name,
            "competition_level": level,
            "coach_weight": coach_weight,
            "player_name": "",
            "report_subject": report_subject or label_text,
            "report_context": report_context,
            "report_segment_note": report_segment_note,
            "focus_prompt": focus,
            "audio_auto": True,        # gauge whether the film's audio is worth transcribing
            "_progress": _prog,
        }))
        # The model is asked for one section; this is what makes it so. Its
        # reply names the section it changed, and everything else is taken back
        # from the analysis the coach already has.
        heading, body = _split_corrected_section(result[0].text)
        from ..report_sections import apply_section_correction
        merged = apply_section_correction(prior_text, body, heading)

        wdb = SessionLocal()
        try:
            clip = wdb.get(models.GameReportClip, clip_id)
            if clip:
                clip.analysis_text = merged
            job = wdb.get(models.GenerationJob, job_id)
            if job:
                job.status = "done"
                job.result_id = clip_id
            wdb.commit()
        finally:
            wdb.close()
    except Exception as exc:
        edb = SessionLocal()
        try:
            job = edb.get(models.GenerationJob, job_id)
            if job:
                job.status = "error"
                job.error = str(exc)[:500]
            edb.commit()
        except Exception:
            edb.rollback()
        finally:
            edb.close()
    finally:
        try:
            from ..storage import release_local
            release_local(video_path)
        except Exception:
            pass

UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

router = APIRouter(prefix="/game-reports", tags=["game-reports"])



# ── Tying a film to the game it is of ─────────────────────────────────────────
#
# A film and a box score of the same night are two readings of one game, and
# neither helps the other while nothing says they belong together: the analysis
# cannot cite the numbers, and a scouting report built from the numbers cannot
# say what the film showed.
#
# Suggested, never assumed. The teams and the date are enough to propose a
# match and not enough to be sure of one — a squad can play twice in a weekend,
# and a night game logged after midnight is a day out — so the coach confirms.

# How far apart a film's date and a game's date can be and still be offered.
# A day either side covers a game logged after midnight and a date typed from
# memory; beyond that the app is guessing at which fixture the coach means.
LINK_DAY_WINDOW = 1


def _teams_of_packet(gr: models.GameReport) -> set[str]:
    """Every team name this packet is about, normalised."""
    names = {
        (gr.my_team.name if gr.my_team else None),
        (gr.opponent_team.name if gr.opponent_team else None),
        gr.opponent_name,
        getattr(gr, "opponent_a_name", None),
    }
    return {_norm_team(n) for n in names if n and str(n).strip()}


def _norm_team(name) -> str:
    return "".join(ch for ch in str(name or "").lower() if ch.isalnum())


def _game_label(db: Session, game: models.GameSession) -> str:
    """How a game reads in the picker: who played, when, and the score."""
    team = db.get(models.Team, game.team_id) if game.team_id else None
    ours = (team.name if team else None) or "Us"
    theirs = game.opponent_name or "Opponent"
    when = game.date.strftime("%b %d, %Y") if game.date else ""
    score = ("" if game.our_score is None or game.opponent_score is None
             else f" · {game.our_score}-{game.opponent_score}")
    return f"{ours} vs {theirs}" + (f" · {when}" if when else "") + score


def search_games_by_team(db: Session, coach: models.Coach, q: str) -> list[models.GameSession]:
    """Every game of this coach's involving a team whose name contains `q`.

    Both sides are searched, and the date is deliberately ignored: this runs
    because the coach typed a name, which means the automatic match did not
    find what they were after.
    """
    needle = _norm_team(q)
    if not needle:
        return []
    out = []
    for game in db.query(models.GameSession).filter_by(coach_id=coach.id).all():
        team = db.get(models.Team, game.team_id) if game.team_id else None
        names = [_norm_team(team.name if team else ""), _norm_team(game.opponent_name)]
        if any(needle in n for n in names if n):
            out.append(game)
    out.sort(key=lambda g: (g.date or g.created_at), reverse=True)
    return out[:50]


def suggest_games_for_packet(db: Session, gr: models.GameReport,
                             coach: models.Coach) -> list[models.GameSession]:
    """Tracked games that could be the one this packet's film is of.

    Matched on the teams, and then on the date when the packet has one. A
    packet with no date offers nothing on date alone — the coach said they did
    not know when it was, and a list of every game this team ever played is not
    a suggestion.
    """
    wanted = _teams_of_packet(gr)
    if not wanted:
        return []
    # No date, no suggestion. The coach was asked when the game was and left it
    # blank, and "every game this team has ever played" is a list, not a
    # suggestion — it puts the work of picking back on them and invites the
    # wrong answer.
    if not gr.game_date:
        return []
    out = []
    for game in db.query(models.GameSession).filter_by(coach_id=coach.id).all():
        if not game.date:
            continue
        team = db.get(models.Team, game.team_id) if game.team_id else None
        names = {_norm_team(team.name if team else ""), _norm_team(game.opponent_name)}
        names.discard("")
        if not names:
            continue
        # BOTH sides, when the packet knows both. Angola vs Egypt and Angola vs
        # Senegal share a team and are not the same fixture; matching on one
        # side offered the coach a different opponent's game with the right
        # date on it, which is exactly the mistake this confirms against.
        if len(wanted) >= 2:
            if not names.issubset(wanted):
                continue
        elif not (names & wanted):
            continue
        if abs((game.date.date() - gr.game_date.date()).days) > LINK_DAY_WINDOW:
            continue
        out.append(game)
    out.sort(key=lambda g: (g.date or g.created_at), reverse=True)
    return out


def linked_box_score(db: Session, clip: models.GameReportClip) -> str:
    """The tracked box score for the game this film is of, as prompt text.

    Empty when the film is not linked, which is the normal case and not a
    problem: a film analysis stands on its own. When it IS linked, the numbers
    stop the analysis having to estimate what it can simply be told — "they
    shot poorly from three" becomes "they shot 23.8%".
    """
    if not clip or not clip.game_id:
        return ""
    game = db.get(models.GameSession, clip.game_id)
    if not game:
        return ""
    rows = (db.query(models.GamePlayerStat)
              .filter_by(game_id=game.id).all())
    if not rows:
        return ""
    # Totalled per player per side, because a stat row is one event and a
    # coach reads a box score.
    totals: dict[tuple[bool, str], dict[str, float]] = {}
    for r in rows:
        key = (bool(r.is_opponent), r.player_name)
        totals.setdefault(key, {})
        totals[key][r.stat_name] = totals[key].get(r.stat_name, 0) + (r.count or 1)
    team = db.get(models.Team, game.team_id) if game.team_id else None
    sides = {False: (team.name if team else "Our team"),
             True: game.opponent_name or "Opponent"}
    lines = ["", "TRACKED BOX SCORE FOR THIS GAME:",
             "These are recorded numbers, not something to read off the film. "
             "Where they and your count of what you saw disagree, THESE are "
             "right — cite them rather than estimating."]
    if game.our_score is not None and game.opponent_score is not None:
        lines.append(f"Final: {sides[False]} {game.our_score}, {sides[True]} {game.opponent_score}")
    for is_opp in (False, True):
        players = [(name, st) for (opp, name), st in totals.items() if opp == is_opp]
        if not players:
            continue
        lines.append(f"\n{sides[is_opp]}:")
        for name, st in sorted(players):
            stat_str = ", ".join(f"{k} {int(v)}" for k, v in sorted(st.items()))
            lines.append(f"  {name}: {stat_str}")
    return "\n".join(lines)


def _build_out(gr: models.GameReport, db: Session | None = None) -> schemas.GameReportOut:
    out = schemas.GameReportOut.model_validate(gr)
    out.my_team_name = gr.my_team.name if gr.my_team else None
    out.opponent_team_name = gr.opponent_team.name if gr.opponent_team else None
    if db is not None:
        _attach_clip_jobs(db, out)
        for c in out.clips:
            if c.game_id:
                game = db.get(models.GameSession, c.game_id)
                c.game_label = _game_label(db, game) if game else None
    return out


def _attach_clip_jobs(db: Session, out: schemas.GameReportOut) -> None:
    """Say what a still-blank clip is actually doing.

    A clip with no breakdown yet reads "Analyzing…" forever, whether the film is
    being watched right now or the job died hours ago. The job row knows which,
    and the coach has no way to see it — so it travels with the clip.
    """
    pending = [c for c in out.clips if not c.analysis_text]
    if not pending:
        return
    jobs = (
        db.query(models.GenerationJob)
        .filter(models.GenerationJob.kind == "clip",
                models.GenerationJob.result_id.in_([c.id for c in pending]))
        .all()
    )
    by_clip = {j.result_id: j for j in jobs}
    # A job only records result_id when it finishes, so a running one is found
    # through its payload instead.
    running = (
        db.query(models.GenerationJob)
        .filter(models.GenerationJob.kind == "clip",
                models.GenerationJob.status.in_(["processing", "error"]))
        .order_by(models.GenerationJob.id.desc())
        .limit(50)
        .all()
    )
    for j in running:
        try:
            cid = json.loads(j.payload or "{}").get("clip_id")
        except Exception:
            cid = None
        if cid and cid not in by_clip:
            by_clip[cid] = j
    for c in out.clips:
        j = by_clip.get(c.id)
        if not j:
            continue
        # The packet page polls this too, and a clip stuck "analyzing" forever
        # is exactly the thing a coach stares at — see revive_if_stalled.
        if revive_if_stalled(db, j):
            db.refresh(j)
        c.job_status = j.status
        c.job_progress = j.progress
        c.job_error = j.error


def _packet_level(db: Session, gr: models.GameReport, coach: models.Coach) -> str:
    """Competition level to frame a packet's AI at — the packet's own team's
    level, else the coach's signup level."""
    from ..coach_context import resolve_level
    team = gr.my_team or gr.opponent_team
    return resolve_level(coach, team=team)


def _save_version(db: Session, gr: models.GameReport, text: str) -> None:
    """Persist a generated report inside the packet, keyed by its output_type
    selection. Same selection overwrites its version; a new selection adds one.
    Also mirrors the text onto gr.report_text as the packet's 'latest'."""
    sig = gr.output_type or "coaching_report"
    row = (
        db.query(models.GameReportVersion)
        .filter_by(game_report_id=gr.id, output_type=sig)
        .first()
    )
    if row:
        row.report_text = text
    else:
        db.add(models.GameReportVersion(
            game_report_id=gr.id, coach_id=gr.coach_id, output_type=sig, report_text=text,
        ))
    gr.report_text = text


@router.get("", response_model=list[schemas.GameReportOut])
def list_game_reports(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    reports = (
        db.query(models.GameReport)
        .filter_by(coach_id=coach.id)
        .order_by(models.GameReport.updated_at.desc())
        .all()
    )
    return [_build_out(r) for r in reports]


@router.post("", response_model=schemas.GameReportOut)
def create_game_report(
    body: schemas.GameReportCreate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = models.GameReport(coach_id=coach.id, **body.model_dump())
    db.add(gr)
    db.commit()
    db.refresh(gr)
    return _build_out(gr, db)


def _packet_title(gr: models.GameReport) -> str:
    my = gr.my_team.name if gr.my_team else None
    opp = gr.opponent_team.name if gr.opponent_team else gr.opponent_name
    if gr.title:
        return gr.title
    if gr.mode == "opp_vs_opp":
        a = gr.my_team.name if gr.my_team else (gr.opponent_a_name or "Opponent A")
        return f"{a} vs {opp or 'Opponent B'}"
    if gr.mode == "vs_opponent" and opp:
        return f"{my or 'My Team'} vs {opp}"
    if gr.mode == "my_program":
        return my or "My Team"
    return opp or "Opponent"


def _ensure_versions(db: Session, gr: models.GameReport) -> list[models.GameReportVersion]:
    """Return a packet's saved versions, backfilling one from the legacy
    report_text for packets generated before versioning existed."""
    versions = list(gr.versions)
    if not versions and gr.report_text:
        v = models.GameReportVersion(
            game_report_id=gr.id, coach_id=gr.coach_id,
            output_type=gr.output_type or "coaching_report", report_text=gr.report_text,
        )
        db.add(v)
        db.commit()
        db.refresh(gr)
        versions = list(gr.versions)
    return versions


def _version_out(v: models.GameReportVersion, gr: models.GameReport) -> dict:
    return {
        "id": v.id,
        "report_id": gr.id,
        "output_type": v.output_type,
        "title": _packet_title(gr),
        "report_text": v.report_text,
        "created_at": v.created_at,
        "updated_at": v.updated_at,
    }


@router.get("/film-analyses")
def all_film_analyses(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Every film analysis the coach has, across all their packets.

    A film's breakdown is written once, stored on the clip, and until now was
    readable only by opening the packet it was attached to and finding the
    film. It is a report — often the longest one in the app — and it belongs in
    Recent with the rest of them.
    """
    reports = {r.id: r for r in db.query(models.GameReport).filter_by(coach_id=coach.id).all()}
    if not reports:
        return []
    out = []
    for clip in (db.query(models.GameReportClip)
                   .filter(models.GameReportClip.game_report_id.in_(reports.keys()))
                   .order_by(models.GameReportClip.id.desc()).all()):
        if not (clip.analysis_text or "").strip():
            continue
        gr = reports[clip.game_report_id]
        out.append({
            "id": clip.id,
            "report_id": gr.id,
            # The report type the film was actually analysed AS. This was
            # hardcoded to "game analysis" on the theory that a film is always
            # read that way; it is not — _run_clip_analysis is handed the
            # packet's output_type, so a film in a scouting-report packet is a
            # scouting report and the card said otherwise.
            "output_type": gr.output_type,
            # Whose film it is, which is not the same as which side it was
            # filed under — see GameReportClip.team_name.
            "team_name": clip.team_name,
            "label": clip.label,
            "packet_title": _packet_title(gr),
            "report_text": clip.analysis_text,
            "created_at": clip.created_at,
        })
    out.sort(key=lambda x: str(x["created_at"] or ""), reverse=True)
    return out


@router.get("/versions")
def all_report_versions(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Every saved report version across the coach's packets (for Previous
    Reports + Recent), newest first."""
    reports = db.query(models.GameReport).filter_by(coach_id=coach.id).all()
    out = []
    for gr in reports:
        for v in _ensure_versions(db, gr):
            if v.report_text:
                out.append(_version_out(v, gr))
    out.sort(key=lambda x: str(x["updated_at"] or x["created_at"] or ""), reverse=True)
    return out


# Registered before the "/{report_id}" routes on purpose. FastAPI matches in
# registration order, so with this below them the path "/game-reports/videos"
# was matched by "/game-reports/{report_id}" first, "videos" was parsed as an
# int, and the film catalog answered 422 to every request it ever made.
@router.get("/videos")
def game_report_videos(
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Video catalog for the coach's game report packets — every film clip, with
    the report it's attached to and a stream url, like the player video catalog."""
    from ..storage import playback_url, exists
    reports = db.query(models.GameReport).filter_by(coach_id=coach.id).all()
    by_id = {r.id: r for r in reports}
    clips = (
        db.query(models.GameReportClip)
        .filter(models.GameReportClip.game_report_id.in_(list(by_id.keys()) or [0]))
        .order_by(models.GameReportClip.id.desc())
        .all()
    )
    out = []
    for c in clips:
        if not c.video_path or not exists(c.video_path):
            continue
        gr = by_id.get(c.game_report_id)
        title = (gr.title if gr and gr.title else None) or (
            (f"{gr.my_team.name if gr and gr.my_team else 'My Team'} vs "
             f"{(gr.opponent_team.name if gr and gr.opponent_team else (gr.opponent_name if gr else None)) or 'Opponent'}")
            if gr else "Game Report"
        )
        out.append({
            "id": c.id,
            "report_id": c.game_report_id,
            "report_title": title,
            "label": c.team_name or ("My Team" if c.label == "my_team" else "Opponent"),
            "created_at": c.created_at,
            "stream_url": playback_url(c.video_path, f"/game-reports/{c.game_report_id}/clips/{c.id}/stream"),
        })
    return out


@router.get("/{report_id}/versions")
def report_versions(
    report_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    return [_version_out(v, gr) for v in _ensure_versions(db, gr) if v.report_text]


@router.get("/{report_id}", response_model=schemas.GameReportOut)
def get_game_report(
    report_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    return _build_out(gr, db)


@router.patch("/{report_id}", response_model=schemas.GameReportOut)
def update_game_report(
    report_id: int,
    body: schemas.GameReportUpdate,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(gr, field, value)
    db.commit()
    db.refresh(gr)
    return _build_out(gr, db)



class LinkClipBody(BaseModel):
    # The tracked game this film is of. None with declined=False means "unlink".
    game_id: int | None = None
    # The coach said none of the offered games is the one. Remembered so the
    # packet stops asking every time it is opened.
    declined: bool = False
    # Apply to every film in the packet, which is how the question is asked:
    # once, about the packet, not once per clip.
    all_clips: bool = True


@router.get("/{report_id}/game-suggestions")
def game_suggestions(
    report_id: int,
    q: str | None = None,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Tracked games this packet's film might be of, and whether to ask.

    `ask` is the screen's cue: there is film, at least one game it could be,
    and the coach has neither linked nor declined. Everything else is context
    for the sheet — what the packet thinks the date is, and what each game
    reads as.
    """
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    # A typed team name is the coach looking for a game themselves, so it wins
    # over the automatic match entirely: every game that team played, whatever
    # the date says. The suggestion is a convenience; the search is the answer
    # to "it is not in that list".
    games = (search_games_by_team(db, coach, q) if (q or "").strip()
             else suggest_games_for_packet(db, gr, coach))
    clips = list(gr.clips or [])
    unanswered = [c for c in clips if not c.game_id and not c.link_declined]
    return {
        "ask": bool(games) and bool(unanswered),
        "game_date": gr.game_date.isoformat() if gr.game_date else None,
        "linked_game_id": next((c.game_id for c in clips if c.game_id), None),
        "games": [
            {"id": g.id, "label": _game_label(db, g),
             "date": g.date.isoformat() if g.date else None,
             # Whether the dates agree exactly, so the sheet can show a near
             # miss as a near miss rather than presenting it as certain.
             "exact_date": bool(gr.game_date and g.date
                                and g.date.date() == gr.game_date.date())}
            for g in games
        ],
    }


@router.post("/{report_id}/link-game")
def link_clips_to_game(
    report_id: int,
    body: LinkClipBody,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Tie this packet's film to a tracked game, or record that none of them is it.

    The link is not applied to the analysis here. Re-reading a film with the
    box score in front of it is a fresh watch of an hour-long video, and doing
    that because a coach answered a question is spending twenty minutes they
    did not ask for — the packet offers it as a button instead.
    """
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    if body.game_id is not None:
        game = db.get(models.GameSession, body.game_id)
        if not game or game.coach_id != coach.id:
            raise HTTPException(status_code=404, detail="Game not found")
    clips = list(gr.clips or [])
    if not body.all_clips:
        clips = clips[:1]
    for clip in clips:
        clip.game_id = body.game_id
        # Declining is per packet and sticks; linking clears it, because the
        # coach has just answered the question properly.
        clip.link_declined = bool(body.declined) and body.game_id is None
    db.commit()
    return {"linked": len([c for c in clips if c.game_id]), "declined": bool(body.declined)}


@router.delete("/{report_id}")
def delete_game_report(
    report_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    # The packet is hidden rather than destroyed, but its film is not: a deleted
    # packet used to leave gigabytes in the bucket for good. Each clip keeps the
    # breakdown it produced and stops pointing at a file.
    from ..film_storage import release_for_game_report
    freed = release_for_game_report(db, gr)
    soft_delete(db, gr)
    db.commit()
    return {"ok": True, "film_deleted": freed}


@router.post("/{report_id}/clips")
async def add_clip(
    report_id: int,
    background_tasks: BackgroundTasks,
    label: str = Form(...),
    team_name: str = Form(""),
    # Either the film itself, or — for anything long enough to be worth it —
    # a ref to film the browser has already put in storage directly. See
    # routes/film_upload.py: a three-hour game does not survive being sent
    # through this server as one request.
    video: UploadFile | None = File(None),
    video_ref: str = Form(""),
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")

    from ..storage import save_fileobj, StorageFullError, exists as storage_exists
    from uuid import uuid4
    if video_ref:
        # Signed for this coach and just written by them; confirm it is really
        # there before building a job around it.
        if not video_ref.startswith("s3://") or f"_{coach.id}_" not in video_ref:
            raise HTTPException(status_code=400, detail="That film reference is not valid.")
        if not storage_exists(video_ref):
            raise HTTPException(status_code=400, detail="That film is not in storage — upload it again.")
        dest = video_ref
    elif video is not None:
        suffix = Path(video.filename or "clip.mp4").suffix
        try:
            dest = save_fileobj(video.file, f"gr_{report_id}_clip_{uuid4().hex}{suffix}")
        except StorageFullError:
            raise HTTPException(
                status_code=507,
                detail="The server is out of storage space. Free up disk space (or configure S3 storage) and try again.",
            )
    else:
        raise HTTPException(status_code=400, detail="No film was sent.")

    my_team_name = gr.my_team.name if gr.my_team else coach.program_name
    opp_name = gr.opponent_team.name if gr.opponent_team else (gr.opponent_name or "Opponent")
    # Name the team if the coach picked one. It matters most in an
    # opponent-vs-opponent packet, where "the opponent" describes both films and
    # the model has no way to tell which team it is watching.
    team_name = (team_name or "").strip()
    label_text = team_name or ("my team" if label == "my_team" else "the opponent")

    # Create the clip in an "analyzing" state (analysis_text=None) and run the
    # AI breakdown in the BACKGROUND so the upload request returns immediately —
    # long (up to hour-long) film no longer holds the connection open or hangs
    # the app. The client polls the report until analysis_text appears.
    clip = models.GameReportClip(
        game_report_id=report_id,
        video_path=str(dest),
        label=label,
        team_name=team_name or None,
        analysis_text=None,
    )
    db.add(clip)
    db.commit()
    db.refresh(clip)

    # A GenerationJob carries per-segment progress so the app shows the same
    # progress bar as the player-eval flow.
    subject, directive, seg_note = _film_context(gr, coach)
    call = {
        "clip_id": clip.id, "video_path": str(dest), "output_type": gr.output_type,
        "program_name": my_team_name, "opp_name": opp_name, "label_text": label_text,
        "coach_weight": coach.weight, "focus_prompt": gr.focus_prompt or "",
        "level": _packet_level(db, gr, coach),
        # On the payload, not re-derived on resume: the packet's context can be
        # edited while a film is being watched, and the report that comes back
        # should be the one that was asked for.
        "report_subject": subject, "report_context": directive,
        "report_segment_note": seg_note,
    }
    # payload is what makes this job survivable: with the arguments on the row,
    # a server that comes back up can run it again itself.
    job = models.GenerationJob(coach_id=coach.id, kind="clip", status="processing",
                               payload=json.dumps(call), attempts=1)
    db.add(job)
    db.commit()
    db.refresh(job)

    # Everything this coach has taught about this team, read at request time
    # while there is still a session to read it with.
    from . import preferences
    learned = (preferences.for_prompt(db, coach.id, _film_team_id(db, gr, clip, coach))
               + linked_box_score(db, clip))

    background_tasks.add_task(
        _run_clip_analysis, clip.id, job.id, str(dest), gr.output_type,
        my_team_name, opp_name, label_text, coach.weight, (gr.focus_prompt or "") + learned,
        call["level"], subject, directive, seg_note,
    )
    return {"job_id": job.id, "clip_id": clip.id}


@router.delete("/{report_id}/clips/{clip_id}")
def delete_clip(
    report_id: int,
    clip_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    clip = db.get(models.GameReportClip, clip_id)
    if not clip or clip.game_report_id != report_id:
        raise HTTPException(status_code=404, detail="Clip not found")
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    # Free the actual film file, not just the DB row — but only once nothing
    # else points at it (the same upload can also sit in a player's catalog).
    ref = clip.video_path
    db.delete(clip)
    db.flush()
    from ..film_storage import release
    release(db, [ref] if ref else [])
    db.commit()
    return {"ok": True}


@router.get("/{report_id}/clips/{clip_id}/stream")
def stream_clip(
    report_id: int,
    clip_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    from fastapi.responses import FileResponse
    from ..storage import exists, ensure_local
    clip = db.get(models.GameReportClip, clip_id)
    if not clip or clip.game_report_id != report_id:
        raise HTTPException(status_code=404, detail="Clip not found")
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    if not clip.video_path or not exists(clip.video_path):
        raise HTTPException(status_code=404, detail="Video file is no longer available")
    return FileResponse(ensure_local(clip.video_path), media_type="video/mp4")


class ImportGameIn(BaseModel):
    game_id: int


@router.post("/{report_id}/import-game", response_model=schemas.GameReportOut)
def import_game_box_score(
    report_id: int,
    body: ImportGameIn,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Pull the box score out of a game already recorded in Games.

    A coach who has tracked a game in BloomPrint should not have to export it
    and import the file back to use it in a packet — the numbers are already
    here. Appended rather than substituted: a packet often wants two or three
    games, and the file import's replace-everything behaviour would make the
    second one erase the first.
    """
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")

    from .game_eval import _get_game_readable, box_score_text
    game = _get_game_readable(db, body.game_id, coach)
    text = box_score_text(db, game)

    existing = (gr.box_score or "").strip()
    gr.box_score = f"{existing}\n\n{text}".strip() if existing else text
    db.commit()
    db.refresh(gr)
    return _build_out(gr, db)


@router.post("/{report_id}/upload-doc", response_model=schemas.GameReportOut)
async def upload_doc(
    report_id: int,
    doc_type: str = Form(...),  # 'box_score' or 'scouting_notes'
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")

    content = await read_upload(file, what='document')
    from .. import ai_import
    purpose = "a game box score / stat sheet" if doc_type == "box_score" else "opponent scouting notes"
    try:
        text = ai_import.ai_extract_text(content, file.filename or "", file.content_type, purpose)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    if not text:
        raise HTTPException(status_code=422, detail="No readable content was found in that file.")

    if doc_type == "box_score":
        gr.box_score = text
    else:
        gr.scouting_notes = text

    db.commit()
    db.refresh(gr)
    return _build_out(gr, db)


def _packet_prompt(db: Session, gr: models.GameReport, coach: models.Coach) -> str:
    """Everything the packet knows, assembled into one prompt.

    Pulled out of the endpoint so the same prompt is built whether the report is
    generated inline or by the background worker — there is one packet prompt,
    not two that drift.
    """
    my_team_name = gr.my_team.name if gr.my_team else coach.program_name
    opp_name = gr.opponent_team.name if gr.opponent_team else (gr.opponent_name or None)

    # For an Opponent-vs-Opponent report, both sides are opponents (two teams in
    # our division we may face) — my_team_id holds Opponent A, opponent side B.
    is_opp_vs_opp = gr.mode == "opp_vs_opp"
    team_a_name = my_team_name if not is_opp_vs_opp else (gr.my_team.name if gr.my_team else (gr.opponent_a_name or "Opponent A"))
    team_b_name = opp_name if not is_opp_vs_opp else (gr.opponent_team.name if gr.opponent_team else (gr.opponent_name or "Opponent B"))

    # Build matchup header
    if is_opp_vs_opp:
        matchup = f"{team_a_name} vs {team_b_name} (opponent-vs-opponent scouting)"
    elif gr.mode == "vs_opponent" and opp_name:
        matchup = f"{my_team_name} vs {opp_name}"
    elif gr.mode == "my_program":
        matchup = my_team_name
    else:
        matchup = opp_name or "Opponent"

    # For a multi-team match-up, fold the additional teams into the header below
    # (after their rosters are resolved).

    # Build roster context for my team
    my_roster_context = ""
    if gr.my_team_id and gr.mode in ("vs_opponent", "my_program", "opp_vs_opp"):
        players = db.query(models.Player).filter_by(team_id=gr.my_team_id).all()
        for p in players:
            name = f"#{p.jersey_number} {p.name}" if p.jersey_number else p.name
            parts = [name]
            if p.position: parts.append(p.position)
            if p.height: parts.append(p.height)
            if p.wingspan: parts.append(f"ws:{p.wingspan}")
            evals = p.evaluations
            if evals:
                latest = evals[-1]
                grade_str = f"{latest.overall_grade:.1f}/10" if latest.overall_grade else "N/A"
                flags = ", ".join((latest.green_flags or [])[:3])
                watch = ", ".join((latest.watch_flags or [])[:3])
                parts.append(f"Grade {grade_str}")
                if flags: parts.append(f"Strengths: {flags}")
                if watch: parts.append(f"Watch: {watch}")
            my_roster_context += f"- {', '.join(parts)}\n"

    # Build opponent roster context
    opp_roster_context = ""
    if gr.opponent_team_id and gr.mode in ("vs_opponent", "opponent_only", "opp_vs_opp"):
        players = db.query(models.Player).filter_by(team_id=gr.opponent_team_id).all()
        for p in players:
            name = f"#{p.jersey_number} {p.name}" if p.jersey_number else p.name
            parts = [name]
            if p.position: parts.append(p.position)
            if p.height: parts.append(p.height)
            if p.wingspan: parts.append(f"ws:{p.wingspan}")
            evals = p.evaluations
            if evals:
                latest = evals[-1]
                grade_str = f"{latest.overall_grade:.1f}/10" if latest.overall_grade else "N/A"
                parts.append(f"Grade {grade_str}")
            opp_roster_context += f"- {', '.join(parts)}\n"

    # Additional teams for a multi-team (3+) MATCH-UP. Each token is either a
    # saved team ("t<id>") whose roster we pull, or a free-text opponent name.
    extra_matchup_blocks: list[tuple[str, str]] = []  # (team_name, roster_context)
    if "matchup" in gr.output_type and gr.extra_teams:
        for tok in gr.extra_teams.split(","):
            tok = tok.strip()
            if not tok:
                continue
            if tok.startswith("t") and tok[1:].isdigit():
                # A match-up may only pull in rosters from this coach's own
                # teams — otherwise any team id would leak its roster into
                # the prompt (and from there into the report).
                team = db.get(models.Team, int(tok[1:]))
                if not owns(team, coach.id):
                    continue
                roster = ""
                for p in db.query(models.Player).filter_by(team_id=team.id).all():
                    name = f"#{p.jersey_number} {p.name}" if p.jersey_number else p.name
                    parts = [name]
                    if p.position: parts.append(p.position)
                    if p.height: parts.append(p.height)
                    evals = p.evaluations
                    if evals:
                        latest = evals[-1]
                        grade_str = f"{latest.overall_grade:.1f}/10" if latest.overall_grade else "N/A"
                        parts.append(f"Grade {grade_str}")
                        flags = ", ".join((latest.green_flags or [])[:3])
                        if flags: parts.append(f"Strengths: {flags}")
                    roster += f"- {', '.join(parts)}\n"
                extra_matchup_blocks.append((team.name, roster))
            else:
                # Free-text team/opponent name with no roster on file.
                extra_matchup_blocks.append((tok, ""))
    if extra_matchup_blocks:
        matchup = matchup + " vs " + " vs ".join(n for n, _ in extra_matchup_blocks)

    # Build film analysis context
    film_context = ""
    for clip in gr.clips:
        if clip.analysis_text:
            label_str = f"{clip.team_name} Film" if clip.team_name else ("My Team Film" if clip.label == "my_team" else "Opponent Film")
            film_context += f"\n{label_str.upper()}:\n{clip.analysis_text}\n"

    # Auto-include what we've already "remembered" about this opponent — the
    # coach's opponent notes and their most recent scouting report on them — so
    # the packet builds on the full knowledge base, not just this game's inputs.
    remembered = ""
    if opp_name:
        onotes = db.query(models.OpponentNote).filter_by(coach_id=coach.id, opponent_name=opp_name).all()
        if onotes:
            remembered += "\nREMEMBERED OPPONENT NOTES:\n" + "\n".join(f"- {n.note_text}" for n in onotes)
        opp_games = (
            db.query(models.GameSession)
            .filter_by(opponent_name=opp_name)
            .order_by(models.GameSession.id.desc())
            .all()
        )
        scout_added = game_added = False
        for g in opp_games:
            if not scout_added:
                row = db.query(models.GameScoutingReport).filter_by(game_id=g.id, coach_id=coach.id).first()
                if row and row.report_text:
                    remembered += f"\nPRIOR SCOUTING REPORT ON {opp_name}:\n{row.report_text}\n"
                    scout_added = True
            if not game_added:
                grow = db.query(models.GameFullReport).filter_by(game_id=g.id, coach_id=coach.id).first()
                if grow and grow.report_text:
                    remembered += f"\nPRIOR GAME REPORT vs {opp_name}:\n{grow.report_text}\n"
                    game_added = True
            if scout_added and game_added:
                break

    # Assemble prompt
    from video_vision.bim import describe_output_type, comprehensive_directive
    sections = [
        f"You are the BloomPrint Basketball Intelligence Model.",
        f"Generate a {describe_output_type(gr.output_type)} for: {matchup}",
        f"PROGRAM: {my_team_name}",
        f"COMPETITION LEVEL: {_packet_level(db, gr, coach)} — calibrate every grade, "
        f"expectation, comparison, and recommendation to this level.",
    ]
    if my_roster_context or opp_roster_context:
        sections.append(
            "\nWhen the film shows a jersey number, MAP IT to the matching player in the "
            "rosters below (each player is listed as '#<number> <name>') and refer to them by "
            "name. Do NOT claim a player is absent or unknown if their number appears on a "
            "roster below — the roster settles who is on the floor.\n"
            "This instruction is for YOU. Never mention the roster, this rule, or how you "
            "identified anyone in the report itself — write it as a coach who simply knows "
            "the names."
        )
    if is_opp_vs_opp:
        sections.append(
            f"\nThis is an OPPONENT-vs-OPPONENT scouting report: {team_a_name} and {team_b_name} are two "
            "teams we may face. Analyze BOTH teams, how they match up against each other, each team's "
            "strengths/weaknesses, key players, and how WE should prepare for either one."
        )
        if my_roster_context:
            sections.append(f"\n{team_a_name} ROSTER:\n{my_roster_context}")
        if opp_roster_context:
            sections.append(f"\n{team_b_name} ROSTER:\n{opp_roster_context}")
    else:
        if my_roster_context:
            sections.append(f"\nMY TEAM ROSTER ({my_team_name}):\n{my_roster_context}")
        if opp_roster_context:
            sections.append(f"\nOPPONENT ROSTER ({opp_name}):\n{opp_roster_context}")
    # Additional match-up teams (3+): append each one's roster (or a note if none).
    for team_name, roster in extra_matchup_blocks:
        if roster:
            sections.append(f"\nADDITIONAL TEAM ROSTER ({team_name}):\n{roster}")
        else:
            sections.append(f"\nADDITIONAL TEAM: {team_name} (no roster on file — compare from general knowledge and any notes/film provided).")
    if film_context:
        sections.append(f"\nFILM ANALYSIS:{film_context}")
    if gr.box_score:
        sections.append(f"\nBOX SCORE / STATS:\n{gr.box_score}")
    # The tracked stats for the game the film was tied to. The film analysis
    # already gets these; the packet's own report is the document the coach
    # actually reads, and it was being written without the one set of numbers
    # in the app that is not an estimate.
    linked = ""
    for clip in (gr.clips or []):
        if clip.game_id:
            linked = linked_box_score(db, clip)
            break
    if linked:
        sections.append(linked)
    if gr.scouting_notes:
        sections.append(f"\nSCOUTING NOTES:\n{gr.scouting_notes}")
    if remembered:
        sections.append(f"\nKNOWLEDGE BASE ON {opp_name} (use as reference):{remembered}")
    if gr.focus_prompt:
        sections.append(f"\nFOCUS:\n{gr.focus_prompt}")

    from video_vision.bim import parse_output_types as _parse_ot
    if "matchup" in _parse_ot(gr.output_type):
        multi = (
            " NOTE: THREE OR MORE teams are provided — compare ALL of them against each other (not just "
            "two), rank them, and make every comparison table cover every team."
            if extra_matchup_blocks else ""
        )
        sections.append(
            "\nThis is a MATCH-UP report — a head-to-head comparison of the team(s) above." + multi + " Compare them "
            "AS THEY ARE (do NOT normalize across competition levels; flag any level gap, and note "
            "confidence where a side's data is thin). Use ONLY the rosters, film, stats, and notes "
            "provided. Produce these sections: SIDE-BY-SIDE COMPARISON (category-by-category with the "
            "EDGE in each), OVERALL ADVANTAGE (who is better and why), TACTICAL MATCH-UP (how each side "
            "should ATTACK and DEFEND the other — mismatches, what to take away), HEAD-TO-HEAD "
            "PROJECTION (what happens if they play, and the swing factors), LEVEL & CONFIDENCE, and KEY "
            "QUESTIONS. If only ONE team is given, describe how they would match up against a typical "
            "opponent at their level."
            f"{REPORT_FORMAT_WITH_TABLES}"
        )
    elif gr.output_type == "game_situational":
        sections.append(
            "\nGenerate a GAME SITUATIONAL REPORT. Analyze the film and produce a detailed report on: "
            "how the coach and team should read specific on-court actions, defensive sets and how to attack them, "
            "offensive actions and counters, opponent tendencies and how to exploit or defend them, "
            "situational responses (end of clock, press breaks, late-game, transition defense), "
            "and key adjustments to make."
            f"{REPORT_FORMAT_WITH_TABLES}"
        )
    else:
        sections.append(
            "\nProvide a comprehensive analysis using the BIM framework. "
            "Include strengths, weaknesses, key players, strategic recommendations."
            f"{REPORT_FORMAT_WITH_TABLES}"
        )

    directive = comprehensive_directive(gr.output_type)
    if directive:
        sections.append(directive)

    from ..coach_context import language_directive
    lang = language_directive(coach)
    if lang:
        sections.append(lang)

    return "\n".join(sections)


def _run_packet_generation(report_id: int, job_id: int, coach_id: int):
    """Background task: write the packet's report.

    THIS USED TO BE THE HTTP REQUEST ITSELF

    A packet report is the longest single call in the app — two report lenses,
    two films' worth of analysis, rosters, box score and notes, answered at up
    to sixteen thousand tokens. It routinely runs past the app's two-minute
    request timeout. When it did, the browser gave up on a request the server
    was still working on, the coach saw "Could not generate report" (the generic
    message, because a timeout has no response body to read a reason from), and
    the report finished and saved a minute later with nobody watching.

    Nothing was broken except where the waiting happened. The work now runs on a
    job, exactly as film analysis does, so the request returns immediately and
    the app follows the job — which also means a deploy mid-report no longer
    throws it away, and the coach can leave the screen.
    """
    import asyncio

    # No session is held across the generation, for the same reason the film
    # workers hold none: a call that takes minutes leaves an idle transaction
    # open for all of them, and PostgreSQL closes those out from under us.
    try:
        rdb = SessionLocal()
        try:
            gr = rdb.get(models.GameReport, report_id)
            coach = rdb.get(models.Coach, coach_id)
            if not gr or not coach:
                raise RuntimeError("Game report not found")
            prompt = _packet_prompt(rdb, gr, coach)
        finally:
            rdb.close()

        import os
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError("ANTHROPIC_API_KEY is not configured on the server.")

        def _words(n: int):
            # Same progress code the film synthesis uses, so the app already
            # knows how to render it in the coach's language.
            pct = min(99, round(90 * n / 3000)) if n <= 3000 else min(99, 90 + (n - 3000) // 300)
            pdb = SessionLocal()
            try:
                j = pdb.get(models.GenerationJob, job_id)
                if j:
                    j.progress = f"job:writing:{pct}"
                    pdb.commit()
            except Exception:
                pdb.rollback()
            finally:
                pdb.close()

        report = asyncio.run(long_text(prompt, on_words=_words))
        if not report.strip():
            raise RuntimeError("AI returned no content")

        wdb = SessionLocal()
        try:
            gr = wdb.get(models.GameReport, report_id)
            if gr:
                _save_version(wdb, gr, report)
            job = wdb.get(models.GenerationJob, job_id)
            if job:
                job.status = "done"
                job.result_id = report_id
            wdb.commit()
        finally:
            wdb.close()
    except Exception as exc:
        edb = SessionLocal()
        try:
            job = edb.get(models.GenerationJob, job_id)
            if job:
                job.status = "error"
                job.error = str(exc)[:500]
            edb.commit()
        finally:
            edb.close()


@router.post("/{report_id}/generate-job")
def start_game_report_generation(
    report_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Start writing the packet's report, and hand back a job to follow.

    The synchronous /generate below still works and is what an already-open
    browser tab will call; this is the one the app uses.
    """
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")

    job = models.GenerationJob(
        coach_id=coach.id, kind="packet", status="processing",
        progress="job:writing:0",
        payload=json.dumps({"report_id": report_id, "coach_id": coach.id}),
        attempts=1,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    background_tasks.add_task(_run_packet_generation, report_id, job.id, coach.id)
    return {"job_id": job.id}


@router.post("/{report_id}/generate", response_model=schemas.GameReportOut)
async def generate_game_report(
    report_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Generate inline and wait for it.

    Kept for browser tabs loaded before /generate-job existed. New callers
    should use that instead — this one can outlive the request that asked for it.
    """
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")

    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not configured on the server.")

    try:
        report = await long_text(_packet_prompt(db, gr, coach))
        if not report.strip():
            raise HTTPException(status_code=500, detail="AI returned no content")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    _save_version(db, gr, report)
    db.commit()
    db.refresh(gr)
    return _build_out(gr, db)


class TeamTrainingBody(BaseModel):
    focus_prompt: str | None = None


@router.post("/{report_id}/team-training", response_model=schemas.GameReportOut)
async def generate_team_training(
    report_id: int,
    body: TeamTrainingBody,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Generate a team training report based on game report film and eval data."""
    import os
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY is not configured.")

    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")

    my_team_name = gr.my_team.name if gr.my_team else coach.program_name

    # Build roster context
    roster_context = ""
    if gr.my_team_id:
        players = db.query(models.Player).filter_by(team_id=gr.my_team_id).all()
        for p in players:
            evals = p.evaluations
            grade_str = "N/A"
            latest_grade = None
            for ev in sorted(evals, key=lambda e: e.created_at, reverse=True):
                if ev.overall_grade is not None:
                    latest_grade = ev.overall_grade
                    break
            if latest_grade is not None:
                grade_str = f"{latest_grade:.1f}/10"
            flags = ", ".join((evals[-1].green_flags or [])[:3]) if evals else ""
            watch = ", ".join((evals[-1].watch_flags or [])[:3]) if evals else ""
            roster_context += (
                f"- {p.name} ({p.position or 'N/A'}, H:{p.height or 'N/A'}): "
                f"Grade {grade_str}. Strengths: {flags or 'N/A'}. Watch: {watch or 'N/A'}.\n"
            )

    # Build film context
    film_context = ""
    for clip in gr.clips:
        if clip.analysis_text:
            label_str = f"{clip.team_name} Film" if clip.team_name else ("My Team Film" if clip.label == "my_team" else "Opponent Film")
            film_context += f"\n{label_str.upper()}:\n{clip.analysis_text[:800]}\n"

    sections = [
        f"You are the BloomPrint Basketball Intelligence Model.",
        f"Generate a TEAM TRAINING PROGRAM for: {my_team_name}",
        f"PROGRAM: {my_team_name}",
    ]
    if roster_context:
        sections.append(f"\nROSTER DATA:\n{roster_context}")
    if film_context:
        sections.append(f"\nFILM ANALYSIS:{film_context}")
    if body.focus_prompt:
        sections.append(f"\nFOCUS:\n{body.focus_prompt}")

    sections.append(
        "\nGenerate a comprehensive team training program based on the film analysis and player eval data. "
        "Include: team strengths to build on, collective weaknesses to address, specific drills by position group, "
        "weekly practice structure, situational training scenarios, and individual focus areas for key players."
        f"{REPORT_FORMAT}"
    )

    prompt = "\n".join(sections)

    try:
        program = await long_text(prompt)
        if not program.strip():
            raise HTTPException(status_code=500, detail="AI returned no content")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")

    gr.output_type = "team_training"
    _save_version(db, gr, program)
    db.commit()
    db.refresh(gr)
    return _build_out(gr, db)


class GameReportCorrectBody(BaseModel):
    correction: str


@router.post("/{report_id}/clips/{clip_id}/correct")
async def correct_clip(
    report_id: int,
    clip_id: int,
    body: GameReportCorrectBody,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Re-watch the clip's film guided by the coach's correction (background job),
    so the model locates/verifies the described action and folds it in — rather
    than just rewording the old text. The client polls the returned job."""
    clip = db.get(models.GameReportClip, clip_id)
    if not clip or clip.game_report_id != report_id:
        raise HTTPException(status_code=404, detail="Clip not found")
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    if not clip.analysis_text:
        raise HTTPException(status_code=400, detail="No analysis to correct")
    # Re-watching needs the film. It is gone once the packet it belonged to was
    # deleted, and saying so beats a job that fails ten minutes later.
    if not clip.video_path:
        raise HTTPException(
            status_code=400,
            detail="The film for this clip has been deleted, so it can't be re-analyzed. "
                   "Upload it again to change the breakdown.",
        )

    # The team the coach named on the film, when there is one — "the opponent"
    # describes both films in an opponent-vs-opponent packet.
    label_text = clip.team_name or ("my team" if clip.label == "my_team" else "the opponent")
    my_team_name = gr.my_team.name if gr.my_team else coach.program_name
    opp_name = gr.opponent_team.name if gr.opponent_team else (gr.opponent_name or "Opponent")
    subject, directive, seg_note = _film_context(gr, coach)

    # A correction is the coach saying what this report should have been paying
    # attention to. Verifying it against the film fixes THIS report; keeping it
    # is what stops them writing the same note again next week.
    from . import preferences
    team_id = _film_team_id(db, gr, clip, coach)
    preferences.remember(db, coach.id, body.correction, team_id)
    db.flush()
    learned = preferences.for_prompt(db, coach.id, team_id) + linked_box_score(db, clip)

    job = models.GenerationJob(coach_id=coach.id, kind="clip", status="processing")
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(
        _run_clip_recorrection, clip.id, job.id, clip.video_path, gr.output_type,
        my_team_name, opp_name, label_text, coach.weight, clip.analysis_text,
        body.correction + learned,
        _packet_level(db, gr, coach), subject, directive, seg_note,
    )
    return {"job_id": job.id, "clip_id": clip.id}


@router.post("/{report_id}/correct", response_model=schemas.GameReportOut)
async def correct_game_report(
    report_id: int,
    body: GameReportCorrectBody,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id or not gr.report_text:
        raise HTTPException(status_code=404, detail="Game report not found")

    prompt = (
        f"You are a basketball analysis expert. Below is a game report followed by a correction "
        f"from the coach. Update the report to incorporate this correction. "
        f"Return ONLY the updated report text in the same format.\n\n"
        f"ORIGINAL REPORT:\n{gr.report_text}\n\n"
        f"CORRECTION:\n{body.correction}\n\nUPDATED REPORT:"
    )
    try:
        _save_version(db, gr, (await long_text(prompt)).strip())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Correction failed: {exc}")

    db.commit()
    db.refresh(gr)
    return _build_out(gr, db)


@router.get("/{report_id}/corrections")
def list_game_report_corrections(
    report_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    rows = (
        db.query(models.GameReportCorrection)
        .filter_by(game_report_id=report_id)
        .order_by(models.GameReportCorrection.id)
        .all()
    )
    return [
        {"id": c.id, "correction": c.correction, "applied": c.applied, "created_at": c.created_at}
        for c in rows
    ]


@router.post("/{report_id}/corrections")
def add_game_report_correction(
    report_id: int,
    body: GameReportCorrectBody,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Save a correction for later without regenerating."""
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id:
        raise HTTPException(status_code=404, detail="Game report not found")
    c = models.GameReportCorrection(game_report_id=report_id, coach_id=coach.id, correction=body.correction)
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"id": c.id, "correction": c.correction, "applied": c.applied, "created_at": c.created_at}


@router.post("/{report_id}/regenerate", response_model=schemas.GameReportOut)
async def regenerate_game_report(
    report_id: int,
    db: Session = Depends(get_db),
    coach: models.Coach = Depends(get_current_coach),
):
    """Regenerate the game report from all un-applied corrections, then mark
    those corrections applied."""
    gr = db.get(models.GameReport, report_id)
    if not gr or gr.coach_id != coach.id or not gr.report_text:
        raise HTTPException(status_code=404, detail="Game report not found")
    pending = (
        db.query(models.GameReportCorrection)
        .filter_by(game_report_id=report_id, applied=False)
        .order_by(models.GameReportCorrection.id)
        .all()
    )
    if not pending:
        raise HTTPException(status_code=400, detail="No un-applied corrections to apply")
    corrections_text = "\n".join(f"- {c.correction}" for c in pending)
    prompt = (
        f"You are a basketball analysis expert. Below is a game report followed by corrections "
        f"from the coach. Update the report to incorporate ALL of them. "
        f"Return ONLY the updated report text in the same format.\n\n"
        f"ORIGINAL REPORT:\n{gr.report_text}\n\n"
        f"CORRECTIONS:\n{corrections_text}\n\nUPDATED REPORT:"
    )
    try:
        _save_version(db, gr, (await long_text(prompt)).strip())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Correction failed: {exc}")
    for c in pending:
        c.applied = True
    db.commit()
    db.refresh(gr)
    return _build_out(gr, db)
