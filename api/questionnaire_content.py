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

VERSION = 1

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
            "text": "In a normal week during the season, which of these do you actually produce?",
            "multi": True,
            "options": [
                "A written report on an upcoming opponent",
                "A breakdown of our own last game",
                "Individual player evaluations or grades",
                "A practice plan built off what the last game showed",
                "A development plan for a specific player",
                "Mostly verbal — very little of it gets written down",
            ],
        },
        {
            "text": "When your team plays, how does the game end up on record?",
            "options": [
                "Someone keeps the book on paper",
                "A stat or scorekeeping app",
                "Film only — no stats kept",
                "Film, plus a box score from the league or the other school",
                "Whoever's available that night does whatever they do",
                "It doesn't, beyond the final score",
            ],
        },
        {
            "text": "From the final buzzer to something you'd actually put in front of your staff or your players, how long?",
            "options": [
                "Under an hour",
                "One to three hours",
                "Most of the next day",
                "Two or three days",
                "It usually doesn't get finished",
            ],
        },
        {
            "text": "If one of these were already done for you before you sat down, which would change your week the most?",
            "options": [
                "Film turned into written notes I can hand out",
                "The next opponent's tendencies pulled together",
                "Every player's development kept on record across the season",
                "My assistants seeing what I see without me repeating it",
                "Feedback reaching players in a form they'll actually open",
                "Last season's notes findable when I need them",
            ],
        },
        {
            "text": "On a day with no game, how much time goes to team work off the court — notes, stats, planning, messages — before it starts to feel like homework?",
            "options": [
                "Under 10 minutes",
                "10 to 20 minutes",
                "30 to 40 minutes",
                "An hour or more",
                "Only on game days — nothing in between",
            ],
        },
        {
            "text": "Think about the software you already use for your team. How often should it change?",
            "options": [
                "Something new every two or three weeks, with a note saying what changed",
                "Once a month",
                "A few times a season",
                "Rarely — I'd rather it stay where it is and stay stable",
                "I don't notice either way",
            ],
        },
        {
            "text": "Think of the last coaching tool you stopped opening. What actually happened?",
            "options": [
                "It cost more time to feed than it gave back",
                "The season got busy, I fell behind, and I never caught up",
                "What it produced wasn't good enough to use",
                "My staff never got in it, so I was the only one",
                "The part I needed was behind a price I couldn't justify",
                "I'm still using everything I've started",
            ],
        },
    ],
    "scout": [
        {
            "text": "In a normal week, what do you actually turn in?",
            "multi": True,
            "options": [
                "Written reports on individual prospects",
                "Reports on how a team plays — tendencies, sets, personnel",
                "A board or ranked list I keep updated",
                "Clips with notes attached",
                "Calls and texts — little of it written",
                "Numbers only — a spreadsheet of grades",
            ],
        },
        {
            "text": "While you're watching, where do the notes live?",
            "options": [
                "A notebook",
                "A notes app or a Google Doc",
                "A spreadsheet with my own columns and grades",
                "A platform my organization gives me",
                "Nowhere — I write it up afterwards from memory",
            ],
        },
        {
            "text": "From watching a player to a report someone else can act on, how long per prospect?",
            "options": [
                "Under 30 minutes",
                "30 to 90 minutes",
                "Two to four hours",
                "A full day or more",
                "It varies too much to say",
            ],
        },
        {
            "text": "Which of these eats the most time you'd rather have back?",
            "options": [
                "Finding the possessions that matter inside a full game",
                "Writing it up once I already know what I think",
                "Keeping my grades consistent between a player I saw in October and one I saw in March",
                "Finding what I already wrote about this player or team",
                "Reformatting the same report for different people",
                "Watching a second game to confirm what I think I saw",
            ],
        },
        {
            "text": "Away from watching, how much time goes to writing up, filing and organising what you've seen before it starts to feel like admin?",
            "options": [
                "Under 10 minutes",
                "10 to 20 minutes",
                "30 to 40 minutes",
                "An hour or more",
                "Only when a report is due — nothing in between",
            ],
        },
        {
            "text": "Think about the software you already use to scout. How often should it change?",
            "options": [
                "Something new every two or three weeks, with a note saying what changed",
                "Once a month",
                "A few times a season",
                "Rarely — I'd rather it stay where it is and stay stable",
                "I don't notice either way",
            ],
        },
        {
            "text": "Think of the last scouting tool you stopped opening. What actually happened?",
            "options": [
                "It cost more time to feed than it gave back",
                "My own notes were faster in the format I already had",
                "What it produced didn't sound like me",
                "I couldn't get my existing work into it",
                "I lost a season to something else and never restarted",
                "I'm still using everything I've started",
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
                "Assessments with actual scores or measurements",
                "Session notes only I read",
                "Nothing written — it lives in the session",
            ],
        },
        {
            "text": "How do you track whether an athlete is actually getting better?",
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
            "text": "Building the week's individualized plans for everyone you train takes about…",
            "options": [
                "Under 30 minutes",
                "One to two hours",
                "Half a day",
                "More than a day",
                "I reuse the same plans and adjust inside the session",
            ],
        },
        {
            "text": "Which of these would help you the most?",
            "options": [
                "A session turned into a written plan the athlete keeps",
                "Showing a parent or a coach real evidence of progress",
                "Knowing what their team coach is working on so I don't contradict it",
                "Every athlete's history in one place instead of scattered",
                "Athletes actually doing the work between sessions",
                "Taking on more athletes without more paperwork",
            ],
        },
        {
            "text": "On a day you're training athletes back to back, how much time goes to the planning and paperwork around the sessions before it starts cutting into the job?",
            "options": [
                "Under 10 minutes",
                "10 to 20 minutes",
                "30 to 40 minutes",
                "An hour or more",
                "Only on a day off — never on a training day",
            ],
        },
        {
            "text": "Think about the software you already use with your athletes. How often should it change?",
            "options": [
                "Something new every two or three weeks, with a note saying what changed",
                "Once a month",
                "A few times a year",
                "Rarely — I'd rather it stay where it is and stay stable",
                "I don't notice either way",
            ],
        },
        {
            "text": "Think of the last tool you used with your athletes and stopped opening. What actually happened?",
            "options": [
                "It cost more time than it gave back",
                "My athletes never opened what I sent them",
                "It didn't fit the way I actually train",
                "The price stopped making sense for the number of athletes I have",
                "I got busy and never restarted",
                "I'm still using everything I've started",
            ],
        },
    ],
    "ga": [
        {
            "text": "In a normal week during the season, what lands on you?",
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
                "Rebuild it from scratch — nothing usable was kept",
            ],
        },
        {
            "text": "In a normal season week, how many hours go to work that's mostly typing, tagging or copying rather than thinking?",
            "options": ["Under 5", "5 to 10", "10 to 20", "More than 20"],
        },
        {
            "text": "If one of these were already handled before you started, which would give you the most back?",
            "options": [
                "Film cut down to the possessions worth watching",
                "Stats entered and checked",
                "A first draft of the scout to edit rather than write",
                "Last year's work on this opponent, findable",
                "Getting one file to five coaches without five versions of it",
                "Anything that means I stop working past midnight before a game",
            ],
        },
        {
            "text": "On a day with no game, how long do you stay on one piece of desk work before you have to get up from it?",
            "options": [
                "Under 10 minutes",
                "10 to 20 minutes",
                "30 to 40 minutes",
                "An hour or more",
                "As long as it takes — this is the job",
            ],
        },
        {
            "text": "Think about the software your staff already uses. How often should it change?",
            "options": [
                "Something new every two or three weeks, with a note saying what changed",
                "Once a month",
                "A few times a season",
                "Rarely — I'd rather it stay where it is and stay stable",
                "I don't notice either way",
            ],
        },
        {
            "text": "Think of a tool your staff stopped using. What actually happened?",
            "options": [
                "It was slower than the way we already did it",
                "The staff moved on and nobody kept it alive",
                "I inherited it, was never shown how it worked, and gave up",
                "It broke down at the busiest part of the season",
                "The head coach didn't trust what came out of it",
                "We're still using everything we've started",
            ],
        },
    ],
    "player": [
        {
            "text": "After a game, what do you actually get back?",
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
            "text": "How do you know whether you're actually getting better?",
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
            "text": "How long after a game before you get feedback you can use?",
            "options": [
                "That night",
                "The next day",
                "At the next practice",
                "Not until the next game",
                "Usually never",
            ],
        },
        {
            "text": "Which of these would you want most?",
            "options": [
                "Knowing exactly what to work on this week, in writing",
                "Seeing my own clips without hunting for them",
                "Something I could send to a college coach",
                "Seeing whether I'm improving across the season, not just the last game",
                "A workout that matches what my coach actually wants from me",
                "Being able to ask a question and get a real answer",
            ],
        },
        {
            # The ladder starts lower than the adult versions on purpose:
            # offering "under 10 minutes" as the floor to a teenager compresses
            # every honest answer into one bucket.
            "text": "On your phone, how long do you spend on anything basketball — your film, your stats, workout stuff — before you lose interest?",
            "options": [
                "Under 5 minutes",
                "5 to 10 minutes",
                "15 to 20 minutes",
                "30 minutes or more",
                "Only right after a game",
            ],
        },
        {
            "text": "Think about an app you actually keep on your phone. How often should there be something new in it?",
            "options": [
                "Every couple of weeks",
                "Once a month",
                "A few times a season",
                "I don't care, as long as it works",
            ],
        },
        {
            "text": "Think of the last basketball app you stopped opening. Why?",
            "options": [
                "Nothing new ever showed up in it",
                "It felt like work, not something I wanted to open",
                "Nobody else on my team used it",
                "What it told me I already knew",
                "I just forgot it existed",
                "I'm still using everything I've started",
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
    "title": "Where does your basketball week actually go?",
    "lede": "We're trying to find out where the time really goes — what gets written, "
            "how games get recorded, and how long it all takes. There are no right "
            "answers. Answer for a normal week, not your best one.",
    "name_label": "Your name",
    "name_placeholder": "First and last",
    "email_label": "Email",
    "email_placeholder": "you@example.com",
    "email_hint": "So we can send you the app when it's ready. Nothing else.",
    "age_label": "Age",
    "role_label": "Which one are you?",
    "start": "Start",
    "required_hint": "Name and role are required.",
    "questions_title": "Your week",
    "questions_lede": "One question lets you pick more than one answer.",
    "question_of": "QUESTION {n} OF {total}",
    "select_all": "SELECT ALL",
    "comment_label": "Anything else? What would save you the most time?",
    "comment_placeholder": "Optional — but this is the most useful box on the page.",
    "back": "Back",
    "submit": "Submit",
    "answered": "{n} of {total} answered",
    "thanks": "Thanks, {name}.",
    "thanks_body": "That's everything. Seven questions honestly answered is genuinely "
                   "useful — it tells us where the week actually goes.",
    "again": "Fill in another",
    "load_failed": "We can't load the questions right now.",
    "retry": "Try again",
    "send_failed": "That did not send. Check your connection and try again.",
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
