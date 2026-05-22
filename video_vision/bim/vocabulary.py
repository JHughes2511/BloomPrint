"""Basketball Intelligence Model — core vocabulary, KPIs, and framework constants."""

FILM_VOCABULARY = {
    "ballscreen_reads": [
        "drop coverage → midrange jumper",
        "snake dribble → middle redirect",
        "short roll → floater / pass",
        "2 on ball → short roll automatic",
        "load the gun → pre-screen momentum",
        "speed dribble → exploit drop",
        "runner / floater → over the big",
    ],
    "off_ball_reads": [
        "back cut → over-deny trigger",
        "pin-down → under/over/switch reads",
        "DHO → layered screen action",
        "drive & kick → attack or hold",
        "mismatch hunt → post or iso",
    ],
    "transition_defensive": [
        "push pace → numbers advantage",
        "leak out / crash hard",
        "hard hedge / switch / over-deny",
    ],
}

KPIS = {
    "shooting_efficiency": [
        "FG% — overall baseline",
        "2PT FG% — interior + midrange",
        "3PT FG% — spacing indicator",
        "open shot % — true ceiling",
        "contested shot % — decision IQ",
        "contact scoring % — physical strength",
    ],
    "playmaking_ball_security": [
        "assists — floor general read (with AST/TO ratio)",
        "turnovers — live-ball weighted heavier than dead-ball",
    ],
    "defense_disruption": [
        "steals — anticipation + gamble risk",
        "blocks — rim protection + foul ratio",
        "deflections — active hands + motor",
        "deflected passes — passing lane anticipation + IQ",
    ],
    "rebounding": [
        "offensive rebounds — motor + second-chance creation",
        "defensive rebounds — possession termination + box-out technique",
    ],
    "advanced": [
        "P&R efficiency — PPP per action, BH + screener separate",
        "shooting chart — zone volume + efficiency visual",
        "hot zones — preferred + efficient areas",
        "cold zones — avoidance + defensive exploitation",
        "spacing efficiency — on/off PPP splits",
    ],
    "physical_athleticism": [
        "speed — straight-line + lateral, level-normalized",
        "first step quickness — initial burst, lower body explosion",
    ],
}

SIX_PILLARS = [
    "1 · Offensive skills — 3PT%, spot-up shooting, speed of play, PPP, TS%, usage, shot quality, open/contested split, hot/cold zones, spacing efficiency",
    "2 · Defensive capabilities — on-ball guarding, rebounding %, deflections, deflected passes, steals, blocks, box-out technique",
    "3 · Physical attributes — burst, lateral quickness, vertical, lower body size/durability, core strength, speed, first step quickness",
    "4 · Intangibles — system adaptability, response to officiating, coach-ability, team-first mentality, deflections (motor), contested shot % (composure)",
    "5 · Advanced analysis — P&R proficiency (BH + screener), unique attributes, correctable vs structural labeling, 2PT FG%, open vs contested split",
    "6 · Strategic fit — position-less compatibility, program-player alignment, college translation, dual-end impact, spacing efficiency on/off",
]

NBA_INTANGIBLES = [
    "Shooting", "Pass", "Handle", "Attack", "Finish", "Off. rebound",
    "Defense", "Def. rebound", "Athleticism", "Speed", "Toughness", "Motor", "IQ",
]

RATING_LADDER = [
    "Top 3", "Lottery", "First round", "Second round", "Undrafted",
    "High Europe", "Low Europe", "Two-way", "G-League", "CNP",
]

COACH_WEIGHTS = {
    "nba":              98,
    "euro":             90,
    "d1_high_major":    82,
    "g_league":         78,
    "d1_mid_low":       75,
    "d2_d3_juco":       60,
    "hs_varsity":       45,
    "aau":              40,
    "hs_jv_ms":         35,
    "youth":            25,
}

COMPETITION_LEVELS = [
    "NBA", "G-League", "High Europe", "Low Europe",
    "D1", "D2", "D3", "JUCO",
    "HS Varsity", "17U AAU", "16U AAU", "14U/15U AAU",
    "Youth (5-13)", "European Pro", "International Academy",
]

AGE_TIERS = {
    "fundamentals": {"range": "5–14", "kpi_mode": "form-based, not efficiency-based"},
    "refinement":   {"range": "14–18", "kpi_mode": "FG%, 3PT%, open vs contested %, hot zones, cold zones"},
    "precision":    {"range": "18–Pro", "kpi_mode": "full 22-metric suite, weighted against competition level"},
}

GAME_WINDOW = {
    "primary_sample": 25,
    "minimum_cnp_threshold": 10,
    "form_flag_games": 5,
    "anchor_metric": "PPP",
}

OUTPUT_TYPES = [
    "film_breakdown",
    "player_eval",
    "scouting_report",
    "coaching_report",
    "training_program",
    "recruitment_profile",
    "position_analysis",
    "game_analysis",
]
