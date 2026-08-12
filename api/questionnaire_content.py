"""The questionnaire itself — five roles, seven questions each.

WHY THIS LIVES ON THE SERVER

The questions are the instrument, and an instrument only works if every
respondent answered the same one. Holding them in the app would mean a coach on
a stale web build answering last week's wording while the results page counts
them under this week's, with nothing to say the two differ. The server hands out
the questions and the server records the answers, so a stored response and the
summary that counts it are always reading the same list.

WHAT IT IS FOR

Discovery, from people who have never seen BloomPrint. Nothing here names a
product or describes a feature: every question asks about the respondent's own
working week, so the answers are evidence rather than agreement. Questions 1–4
describe the work; 5–7 test three assumptions — a daily-use ceiling, a release
cadence, and how long before someone drifts off.

CHANGING THE WORDING

Answers are stored by INDEX against a version. Editing an option's text in
place would silently rewrite what past respondents said, so a change to the
questions is a bump to VERSION, and the summary counts each version separately
rather than adding two different questions together.
"""

# The ANSWER SCHEMA: the questions and their options, in order. Answers are
# stored as indexes into this, so it bumps only when an option is added,
# removed or reordered — never for a change of wording elsewhere. Bumping it
# detaches every response collected before the change from the summary, which
# is right when the question changed and wrong when only the page around it
# did.
VERSION = 2

# Anything VISIBLE, including the strings below and the questions themselves.
# Separate from VERSION because it is the cache key for translations: reword a
# button and every language needs retranslating, while the stored answers still
# mean exactly what they meant before.
CONTENT_REVISION = 7

# Deliberately ranges rather than a number. A range still cuts the results by
# age, and asking a fourteen-year-old for their date of birth to answer six
# questions about basketball is more than the question is worth.
AGE_RANGES = [
    "Under 14", "14–16", "17–18", "19–22", "23–29", "30–44", "45+",
]

ROLES = [
    {"id": "coach",   "name": "Coach",              "blurb": "You run or help run a team"},
    {"id": "scout",   "name": "Scout",              "blurb": "You evaluate players you don't coach"},
    {"id": "trainer", "name": "Trainer",            "blurb": "You train athletes one to one or in small groups"},
    {"id": "ga",      "name": "Graduate Assistant", "blurb": "You're on a college staff"},
    {"id": "player",  "name": "Player",             "blurb": "You play"},
]

ROLE_IDS = [r["id"] for r in ROLES]

# Every role answers the same seven positions in the same order — output,
# capture, turnaround, friction, daily ceiling, cadence, churn — so the five
# result sets can be read side by side instead of as five separate studies.
QUESTIONS: dict[str, list[dict]] = {
    "coach": [
        {
            "text": "In a normal week during the season, which of these do you produce?",
            "multi": True,
            "options": [
                "A written report on an upcoming opponent",
                "A breakdown of our own last game",
                "Individual player evaluations or grades",
                "A practice plan built off what the last game showed",
                "A practice plan aimed at the next opponent",
                "A development plan for a specific player",
                "Mostly verbal — very little of it gets written down",
            ],
        },
        {
            "text": "When your team plays, how does the game usually end up on record?",
            "options": [
                "Someone keeps the book on paper",
                "A stat or scorekeeping app",
                "Film only — no stats kept",
                "Film, plus a box score from the league or the other school",
                "It depends who is there that night",
                "Nothing is kept beyond the final score",
            ],
        },
        {
            "text": "After a game, how long does it take before your staff and your players have feedback they can use?",
            "options": [
                "Under an hour",
                "One to three hours",
                "Most of the next day",
                "Two or three days",
                "It usually doesn't get finished",
            ],
        },
        {
            "text": "Which of these would change your week if they were already done for you?",
            "multi": True,
            "options": [
                "Film turned into written notes I can hand out",
                "The next opponent's tendencies pulled together",
                "Every player's development kept on record across the season",
                "My assistants seeing what I see without me repeating it",
                "Feedback reaching players in a form they will open",
                "Last season's notes findable when I need them",
            ],
        },
        {
            "text": "On a day with no game, how long do you spend on work for the team — notes, stats, planning, messages — before it starts to feel like homework?",
            "options": [
                "Under 10 minutes",
                "10 to 20 minutes",
                "30 to 40 minutes",
                "An hour or more",
                "Only on game days — nothing in between",
            ],
        },
        {
            "text": "Think about the software you already use for your team. What do you most want from it over time?",
            "options": [
                "Something new every two or three weeks, with a note saying what changed",
                "A few improvements a season, at a steady pace",
                "It gets better at the job the more I use it",
                "Everything I've put into it stays in one place and carries forward",
                "Nothing new — I'd rather it stayed exactly as it is",
                "I don't notice either way",
            ],
        },
        {
            "text": "Think of the last coaching tool you stopped opening. What happened?",
            "options": [
                "It took more time to keep up than it saved me",
                "The season got busy, I fell behind, and I never caught up",
                "What it produced wasn't good enough to use",
                "My staff never got in it, so I was the only one",
                "The part I needed was behind a price I couldn't justify",
                "Nothing — I'm still using everything I've started",
            ],
        },
    ],
    "scout": [
        {
            "text": "In a normal week, what do you turn in?",
            "multi": True,
            "options": [
                "Written reports on individual prospects",
                "Reports on how a team plays — tendencies, sets, personnel",
                "A board or ranked list I keep updated",
                "Clips with notes attached",
                "Calls and texts — little of it in writing",
                "Numbers only — a spreadsheet of grades",
            ],
        },
        {
            "text": "While you're watching a game — live or on film — where do your notes usually go?",
            "options": [
                "A notebook",
                "A notes app or a Google Doc",
                "A spreadsheet with my own columns and grades",
                "A platform my organization gives me",
                "Nowhere — I write it up afterwards from memory",
            ],
        },
        {
            "text": "How long does one prospect take, from watching them to a report someone else can act on?",
            "options": [
                "Under 30 minutes",
                "30 to 90 minutes",
                "Two to four hours",
                "A full day or more",
                "It varies too much to say",
            ],
        },
        {
            "text": "Which part of the job takes up the most time you'd rather spend somewhere else?",
            "options": [
                "Finding the possessions that matter inside a full game",
                "Writing it up once I already know what I think",
                "Keeping my grades consistent across a whole season",
                "Finding what I already wrote about this player or team",
                "Reformatting the same report for different people",
                "Watching a second game to confirm what I think I saw",
                "None of it — the time goes where it should",
            ],
        },
        {
            "text": "After a game, how much time are you willing to spend writing up and filing what you saw?",
            "options": [
                "Under 10 minutes",
                "10 to 20 minutes",
                "30 to 40 minutes",
                "An hour or more",
                "Only when a report is due — nothing in between",
            ],
        },
        {
            "text": "Think about the software you already use to scout. What do you most want from it over time?",
            "options": [
                "Something new every two or three weeks, with a note saying what changed",
                "A few improvements a season, at a steady pace",
                "It gets better at the job the more I use it",
                "Everything I've put into it stays in one place and carries forward",
                "Nothing new — I'd rather it stayed exactly as it is",
                "I don't notice either way",
            ],
        },
        {
            "text": "Think of the last scouting tool you stopped opening. What happened?",
            "options": [
                "It took more time to keep up than it saved me",
                "My own notes were faster in the format I already had",
                "What it produced didn't sound like me",
                "I couldn't get my existing work into it",
                "A season got away from me and I never went back to it",
                "Nothing — I'm still using everything I've started",
            ],
        },
    ],
    "trainer": [
        {
            "text": "In a normal week, what do you produce for the athletes you train?",
            "multi": True,
            "options": [
                "Individual workout or skill plans",
                "Written progress updates for the athlete",
                "Updates for a parent or for their team coach",
                "Assessments with scores or measurements",
                "Session notes only I read",
                "Nothing written — it lives in the session",
            ],
        },
        {
            "text": "What do you rely on most to know whether an athlete is improving?",
            "options": [
                "Measurements and numbers I log myself",
                "Film from before and after",
                "How they perform in games or practice",
                "What their coach tells me",
                "My own read — I can see it",
                "I don't track it formally",
            ],
        },
        {
            "text": "How long does it take to build a week of individual plans for everyone you train?",
            "options": [
                "Under 30 minutes",
                "One to two hours",
                "Half a day",
                "More than a day",
                "I reuse the same plans and adjust during the session",
            ],
        },
        {
            "text": "Which of these would make the biggest difference to your week?",
            "options": [
                "A session turned into a written plan the athlete keeps",
                "Showing a parent or a coach real evidence of progress",
                "Knowing what their team coach is working on so I don't contradict it",
                "Every athlete's history in one place instead of scattered",
                "Athletes doing the work between sessions",
                "Taking on more athletes without more paperwork",
                "None of these — my week works as it is",
            ],
        },
        {
            "text": "On a day of back-to-back sessions, how long do you spend on planning and paperwork before it cuts into the training itself?",
            "options": [
                "Under 10 minutes",
                "10 to 20 minutes",
                "30 to 40 minutes",
                "An hour or more",
                "Only on a day off — never on a training day",
            ],
        },
        {
            "text": "Think about the software you already use with your athletes. What do you most want from it over time?",
            "options": [
                "Something new every two or three weeks, with a note saying what changed",
                "A few improvements a season, at a steady pace",
                "It gets better at the job the more I use it",
                "Everything I've put into it stays in one place and carries forward",
                "Nothing new — I'd rather it stayed exactly as it is",
                "I don't notice either way",
            ],
        },
        {
            "text": "Think of the last tool you used with your athletes and stopped opening. What happened?",
            "options": [
                "It took more time to keep up than it saved me",
                "My athletes never opened what I sent them",
                "It didn't fit the way I train",
                "The price stopped making sense for the number of athletes I have",
                "I got busy and never restarted",
                "Nothing — I'm still using everything I've started",
            ],
        },
    ],
    "ga": [
        {
            "text": "In a normal week during the season, which of these are your responsibility?",
            "multi": True,
            "options": [
                "Cutting and tagging film",
                "Entering or cleaning up stats",
                "The first draft of the scouting report",
                "Prep materials for practice",
                "Recruiting notes and prospect tracking",
                "Whatever nobody else has time for",
            ],
        },
        {
            "text": "When a coach asks “what do we have on this team”, where do you go first?",
            "options": [
                "A shared drive of documents and clips",
                "Our video platform",
                "A spreadsheet I maintain",
                "Ask another staff member",
                "The conference or league site",
                "Build it again from scratch — nothing usable was kept",
            ],
        },
        {
            "text": "In a normal week in season, how many hours go into work that's mostly typing, tagging or copying rather than thinking?",
            "options": ["Under 5", "5 to 10", "10 to 20", "More than 20"],
        },
        {
            "text": "If one of these were already done before you started, which would save you the most time?",
            "options": [
                "Film cut down to the possessions worth watching",
                "Stats entered and checked",
                "A first draft of the scouting report to edit rather than write",
                "Last year's work on this opponent, findable",
                "Getting one file to five coaches without five versions of it",
                "Anything that stops me working past midnight before a game",
                "None of these — my time goes somewhere else",
            ],
        },
        {
            "text": "On a day with no game, how long can you stay at your desk before you need a break?",
            "options": [
                "Under 10 minutes",
                "10 to 20 minutes",
                "30 to 40 minutes",
                "An hour or more",
                "As long as it takes — this is the job",
            ],
        },
        {
            "text": "Think about the software your staff already uses. What do you most want from it over time?",
            "options": [
                "Something new every two or three weeks, with a note saying what changed",
                "A few improvements a season, at a steady pace",
                "It gets better at the job the more I use it",
                "Everything I've put into it stays in one place and carries forward",
                "Nothing new — I'd rather it stayed exactly as it is",
                "I don't notice either way",
            ],
        },
        {
            "text": "Think of a tool your staff stopped using. What happened?",
            "options": [
                "It was slower than the way we already did it",
                "The staff moved on and nobody kept it alive",
                "I inherited it, was never shown how it worked, and gave up",
                "It broke down at the busiest part of the season",
                "The head coach didn't trust what came out of it",
                "Nothing — we're still using everything we've started",
            ],
        },
    ],
    "player": [
        {
            "text": "After a game, what do you get back?",
            "multi": True,
            "options": [
                "A stat line",
                "Film I can watch",
                "Written feedback from a coach",
                "A conversation, nothing written",
                "A message to the whole team, not to me",
                "Nothing",
            ],
        },
        {
            "text": "What tells you most that you're getting better?",
            "options": [
                "My stats",
                "Watching my own film",
                "What my coach tells me",
                "What my trainer tells me",
                "How much I'm playing",
                "I don't really know",
            ],
        },
        {
            "text": "After a game, how long before you get feedback you can use?",
            "options": [
                "That night",
                "The next day",
                "At the next practice",
                "Not until the next game",
                "Usually never",
            ],
        },
        {
            "text": "If you could have one of these, which would you want most?",
            "options": [
                "Knowing exactly what to work on this week, in writing",
                "Seeing my own clips without hunting for them",
                "Something I could send to a college coach",
                "Seeing whether I'm improving across the season, not just the last game",
                "A workout that matches what my coach wants from me",
                "Being able to ask a question and get a real answer",
                "None of these",
            ],
        },
        {
            # The ladder starts lower than the adult versions on purpose:
            # offering "under 10 minutes" as the floor to a teenager compresses
            # every honest answer into one bucket.
            "text": "When you pick up your phone, how long do you spend on basketball — watching your film, checking your stats, looking up workouts?",
            "options": [
                "Under 5 minutes",
                "5 to 10 minutes",
                "15 to 20 minutes",
                "30 minutes or more",
                "Only right after a game",
            ],
        },
        {
            "text": "When you want to work on your game on your own, what usually gets in the way?",
            "options": [
                "I don't know what to work on",
                "No gym or court I can get into",
                "Nobody to run the workout with me",
                "No time around school and practice",
                "I lose interest partway through",
                "Nothing — I get out there",
            ],
        },
        {
            "text": "Think of the last basketball app you stopped opening. What happened?",
            "options": [
                "Nothing new ever showed up in it",
                "It felt like work, not something I wanted to open",
                "Nobody else on my team used it",
                "What it told me I already knew",
                "I just forgot it existed",
                "It took too long to set up",
                "Nothing — I still use all of them",
            ],
        },
    ],
}


# The screen's own words, translated by the same cached call as the questions.
#
# Not in the app's locale files, and deliberately: those are 25 hand-maintained
# JSON files, and a research form that may be reworded weekly would mean 25
# edits per change. These travel with the questions they sit around, so a
# language is either fully translated or fully English — never half of each,
# which is what a missing locale key looks like on screen.
UI_STRINGS = {
    "eyebrow": "Seven questions · about five minutes",
    "title": "Where does your basketball week go?",
    "lede": "We're trying to find out where the time really goes — what gets written, "
            "how games get recorded, and how long it all takes. Answer for a normal "
            "week, not your best one.",
    "name_label": "Your name",
    "name_placeholder": "First and last",
    "email_label": "Email",
    "email_placeholder": "you@example.com",
    "age_label": "Age",
    "role_label": "Which one are you?",
    "start": "Start",
    "required_hint": "Name and role are required.",
    "questions_title": "Your week",
    # Says "some" rather than a number on purpose. A coach has two questions
    # that take several answers and every other role has one, so any count here
    # is wrong for somebody — and it would go stale again the next time a
    # question changed. The badge on each question is what actually tells a
    # person; this line only sets the expectation.
    "questions_lede": "Some questions let you pick more than one answer.",
    "question_of": "QUESTION {n} OF {total}",
    "select_all": "SELECT ALL THAT APPLY",
    "comment_label": "Anything else? What would save you the most time?",
    "comment_placeholder": "Optional — but this is the most useful box on the page.",
    "back": "Back",
    "submit": "Submit",
    "answered": "{n} of {total} answered",
    "thanks": "Thanks, {name}.",
    "thanks_body": "That's everything. Seven questions answered honestly is genuinely "
                   "useful — it tells us where the week goes.",
    "again": "Fill in another",
    "load_failed": "We can't load the questions right now.",
    "retry": "Try again",
    "send_failed": "That did not send. Check your connection and try again.",
    "translating": "Translating…",
}


def questions_for(role: str) -> list[dict]:
    return QUESTIONS.get(role, [])


def label(role: str, q_index: int, opt_index: int) -> str | None:
    """The text a respondent actually chose, from the indexes stored on the row."""
    qs = questions_for(role)
    if not (0 <= q_index < len(qs)):
        return None
    opts = qs[q_index]["options"]
    if not (0 <= opt_index < len(opts)):
        return None
    return opts[opt_index]


def role_name(role_id: str) -> str:
    for r in ROLES:
        if r["id"] == role_id:
            return r["name"]
    return role_id
