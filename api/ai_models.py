"""Which Claude model each kind of work runs on — decided once, here.

Every AI call in BloomPrint picks its model from this module. Before this
existed the model name was typed out at ~50 call sites, which meant a model
upgrade was a fifty-file find-and-replace and any site that got missed quietly
kept running the old one. Now upgrading is editing one line.

THE TIERS

  OPUS    Work a coach reads and acts on: game reports, player evaluations,
          film analysis, play design, the assistant. Quality here is the
          product, so this is always the newest Opus.
  SONNET  Work that transforms text someone else's model already reasoned
          about: translation, feedback triage, summaries, pulling structured
          data out of a document. Faster and cheaper with no quality loss on
          this kind of task.
  HAIKU   Reserved for high-volume mechanical work. Nothing uses it yet; it's
          here so the knob exists when something does.

Each is overridable by environment variable, so a new model can be tried — or
rolled back — without a code change or a redeploy.

FALLBACK POLICY

There is deliberately no automatic downgrade. If Opus is unavailable, a report
must fail visibly rather than quietly come back as a weaker one the coach can't
tell apart. Silent substitution is fine for translation or triage, where a
worse result is obvious or harmless; it is not fine for the analysis a coach
makes decisions from.
"""
import os

# The newest Opus. There is no "-latest" alias in the API — model IDs are fixed
# strings — so this constant is what "always use the newest Opus" actually means.
OPUS = os.environ.get("BLOOMPRINT_MODEL_OPUS") or "claude-opus-5"
SONNET = os.environ.get("BLOOMPRINT_MODEL_SONNET") or "claude-sonnet-5"
HAIKU = os.environ.get("BLOOMPRINT_MODEL_HAIKU") or "claude-haiku-4-5-20251001"

# Smallest max_tokens worth sending. Current models may reason before answering,
# and that reasoning is billed against max_tokens along with the visible reply —
# so a budget sized to the answer alone can be spent entirely on thinking and
# return nothing. Several calls here used to ask for 500 because the answer is a
# two-field JSON object; that is now a truncated response rather than a tight
# one. Anything below this floor gets raised to it.
MIN_MAX_TOKENS = 2000


class Refusal(Exception):
    """The model declined to answer. Distinct from a transport or parse error."""


def text_of(resp) -> str:
    """The text of a response, and nothing else.

    Replaces indexing straight into `resp.content[0]`, which assumes the first
    block is a text block. It
    isn't necessarily: a response can lead with a reasoning block, in which case
    index 0 is either the wrong text or has no `.text` at all. Joining every
    text block is correct no matter what precedes them.

    Raises Refusal when the model declined, so callers get a real error instead
    of an empty string they'd otherwise save as a report.
    """
    if getattr(resp, "stop_reason", None) == "refusal":
        raise Refusal("The model declined to answer this request.")
    return "".join(b.text for b in resp.content if hasattr(b, "text"))


async def long_text(prompt: str, *, model: str = OPUS, max_tokens: int = 16000) -> str:
    """A full-length report, streamed.

    Non-streaming requests carry a ten-minute ceiling: the SDK abandons the call
    at 600s and silently retries it twice, so a report that ran long left the
    coach watching a frozen screen for half an hour and then failed — having
    paid for the work three times over. A full game report against a packet's
    worth of film notes is exactly the call that runs long.

    Streaming has no such ceiling. Nothing about the result changes; the text is
    collected and returned whole.
    """
    import anthropic

    client = anthropic.AsyncAnthropic()
    async with client.messages.stream(
        model=model,
        max_tokens=max(max_tokens, MIN_MAX_TOKENS),
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        message = await stream.get_final_message()
    return text_of(message)
