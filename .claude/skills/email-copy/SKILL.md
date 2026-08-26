---
name: email-copy
description: Write or edit BloomPrint's transactional email copy, subject lines and notification wording. Use when drafting, rewriting or reviewing the text of an email the app sends, or the notification strings that describe the same events. Not for interface copy, report prompts or code comments.
---

# Writing BloomPrint's email copy

Deliberately scoped to email and to the notification strings that describe the
same events. The app's interface copy is already written and already translated
into twenty-five languages, and re-running it through a style pass would mean
re-translating thousands of strings for nothing a coach would notice. Email is
being written fresh, so the standard costs nothing to apply here.

The exception is the `notifs.*` strings. A share notification and a share email
are the same sentence delivered twice. Letting them drift apart is how a coach
ends up reading two different accounts of one event.

## Say what happened, to whom, about what

Every message names the specific thing. Not "a report was shared with you" but
"Ashten Bloom shared a game report with you: Angola vs Egypt". A notification
that says something happened without saying what is a badge with postage on it.

Front-load the meaning in subject lines. A third of ours run past the width a
phone shows, and the ones that get cut are the ones that end with a name. Put
the event first and the name after, so a truncated subject still reads.

## Do not claim more than the app does

Check the behaviour before describing it. Fields that default off are not
features the reader has. A setting that improves output is not a setting whose
absence breaks it. If a claim cannot be traced to something in the code or the
interface, it does not go in an email that reaches thousands of people.

## Patterns to cut

- **Em dashes. All of them.** Use a full stop, a comma, or a colon.
- Corporate filler: pivotal, seamless, robust, elevate, unlock, leverage,
  streamline, empower, evolving landscape.
- Pretentious verbs where a plain one exists: delve, garner, utilise, showcase,
  facilitate. Prefer use, get, show, help.
- Circumlocutions for "is": serves as, acts as, boasts, stands as.
- "Not just X but Y." Say Y.
- Triads assembled for rhythm. Three items because there are three, never
  three because three sounds finished.
- Hedging stacked on hedging: may potentially, could possibly, generally tends.
- Padding: in order to, at this time, please note that, it is important to.
- Sycophancy and chatbot pleasantries. Nobody thanks a receipt.
- Hollow closers that restate the message in worse words.

## What to do instead

Vary sentence length; a short one after two long ones is what makes prose
sound spoken. Prefer the active voice and a stronger verb over a weak verb
propped up with an adverb. Break a dense sentence into two. Name the mechanism
rather than the feeling: "every report is written through it" beats "helps you
get more out of BloomPrint".

Write for someone reading on a phone between drills, not at a desk.

## Before showing anyone

Read it back and ask which line an AI would have written. Then check, by
grepping rather than by eye, that no em dash survived.
