# Handoff: BloomPrint — Luxury Recolor + Light/Dark Theming

## Overview
This package recolors the BloomPrint basketball-intelligence app into a "luxury" visual system and adds a full **light/dark mode**:

- **Light mode = "Beige Luxury"** — warm beige canvas, Sane Blue accent, white cards.
- **Dark mode = "Blue Luxury"** — deep blue gradient canvas, cyan accent, frosted translucent cards.

Both modes are driven by **one shared set of CSS variables**. Every screen is authored once and themed twice — switching mode only swaps the variable values, never the markup. The goal of the recolor is a calmer, more premium, more scannable UI: muted palette, generous spacing, pill controls, one strong accent at a time, and semantic colors (success/warning/destructive) folded into the brand palette instead of bright competing highlights.

The same system spans two role surfaces that share the palette:
- **Coach App** (primary) — reports, evaluations, game tracking, roster.
- **Player Portal** — the player-facing side, folded into the *same* light/dark palette (no separate green identity), distinguished only by its own bottom tab bar.

## Screenshots
Rendered reference screenshots of all 22 screens are in `screenshots/light/` and `screenshots/dark/`, numbered to match the screen list below (e.g. `08-roster.png`). **Both themes are included for every screen** — compare the two folders side by side to see the exact light/dark treatment of each surface. These reflect the improved, cleaner layouts; where they differ from the current build, **the screenshots are the target.**

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing the intended look, color system, and behavior. They are **not production code to copy directly.** They were authored as "Design Components" (a custom HTML prototyping format); do not try to ship that runtime.

The task is to **recreate these designs in BloomPrint's existing codebase**, using its established framework, component library, navigation, and state patterns (React Native / Expo, SwiftUI, Flutter, web React — whatever the real app uses). Pull the **color system, typography, spacing, component styling, and theming approach** from these references and implement them with your existing primitives. If no environment exists yet, choose the most appropriate framework for the project and implement there.

The single most important deliverable is the **Design Tokens** section below and the **theming model** — those are framework-agnostic and should map directly onto your app's theme provider.

## Fidelity
**High-fidelity (hifi).** Colors, typography, spacing, radii, and component treatments are final and intentional. Recreate the UI faithfully using your codebase's existing libraries and patterns. Exact hex values, font, weights, and sizes are documented below. The specific copy/data in screens (player names, dates, scores) is **placeholder sample data** — wire it to real data; don't hardcode it.

---

## Theming Model (read this first)

Implement these as **theme tokens** in your app's theming layer (e.g. a `ThemeProvider`, `useColorScheme()`, design-token file, or `.xcassets` color set). Each token has a light and dark value. Components reference the token, never a raw hex.

| Token | Role | Light (Beige Luxury) | Dark (Blue Luxury) |
|---|---|---|---|
| `canvas` | screen background | `linear-gradient(180deg, #F7F2EA 0%, #EFE7DA 100%)` | `linear-gradient(168deg, #0C2331 0%, #1A4258 48%, #0D2636 100%)` |
| `ink` | primary text | `#16242E` | `#FFFFFF` |
| `inkSoft` | body text | `#34424B` | `rgba(255,255,255,.82)` |
| `muted` | secondary text | `#8A8174` | `rgba(255,255,255,.62)` |
| `muted2` | tertiary text / inactive tab | `#ABA192` | `rgba(255,255,255,.45)` |
| `label` | small uppercase labels | `#1F6F9B` | `#41B8E8` |
| `accent` | primary accent / active | `#1F6F9B` | `#41B8E8` |
| `accentSoft` | accent tint fill | `rgba(31,111,155,.10)` | `rgba(65,184,232,.16)` |
| `card` | card background | `#FFFFFF` | `rgba(255,255,255,.07)` |
| `cardBorder` | card border | `#E7DFD0` | `rgba(255,255,255,.13)` |
| `cardBlur` | card backdrop-filter | `none` | `blur(14px)` |
| `divider` | hairline divider | `#EAE2D5` | `rgba(255,255,255,.12)` |
| `line` | input/control border | `#E1D9CA` | `rgba(255,255,255,.16)` |
| `chip` | neutral chip fill | `#EFE8DC` | `rgba(255,255,255,.10)` |
| `badgeBg` / `badgeText` | dark pill badge | `#171513` / `#F5F0E8` | `#0C1318` / `#FFFFFF` |
| `ctaBg` / `ctaText` | primary button | `#1F6F9B` / `#FFFFFF` | `#FFFFFF` / `#0E2230` |
| `cta2Text` / `cta2Border` | secondary (outline) button | `#16242E` / `#D9D2C7` | `#FFFFFF` / `rgba(255,255,255,.32)` |
| `pistachio` | positive / "Send to Player" | `#B8C98A` | `#C6D89E` |
| `positive` / `positiveSoft` | success text / fill | `#6F8B45` / `rgba(111,139,69,.16)` | `#C6D89E` / `rgba(184,201,138,.2)` |
| `negative` / `negativeSoft` | destructive text / fill | `#B0654C` / `rgba(176,101,76,.14)` | `#E6A98F` / `rgba(230,169,143,.18)` |
| `brown` / `brownSoft` | secondary accent / "Share w/ Staff" | `#8A624A` / `rgba(138,98,74,.12)` | `#CDA079` / `rgba(205,160,121,.2)` |
| `tile` / `tileIcon` | icon tile fill / icon | `rgba(31,111,155,.10)` / `#1F6F9B` | `rgba(65,184,232,.16)` / `#5CC4EE` |
| `navbar` | bottom bar background | `rgba(245,240,232,.72)` | `rgba(11,30,42,.55)` |

**Key theming rules**
- **Dark mode is not just inverted.** The accent shifts from Sane Blue `#1F6F9B` to a brighter cyan `#41B8E8`/`#5CC4EE` for contrast on the deep gradient, and cards become **translucent + blurred** (`rgba(255,255,255,.07)` + `blur(14px)`) instead of solid white.
- **Pistachio, brown, positive, negative all have separate light/dark values** — they're lightened in dark mode so they read on the navy. Don't reuse the light hex on a dark background.
- **`canvas` is a gradient in both modes**, not a flat fill.

---

## Brand Palette (source colors)
The luxury palette these tokens derive from:
- Pistachio Green `#B8C98A`
- Beige White `#F5F0E8`
- Toast Brown `#8A624A`
- Sane Blue `#1F6F9B`
- Deep Navy `#10283A`
- Soft Divider `#D9D2C7`
- Ink Black `#111111`

Usage discipline (applies app-wide):
- **Beige White** is the main light canvas; **Deep Navy gradient** the dark canvas.
- **Sane Blue** (cyan in dark) is the single active accent — primary buttons, links, active tab, selected state. One strong accent per screen.
- **Pistachio** = selected/positive signals and the "Send to Player" action.
- **Toast Brown** = secondary labels, borders, "Share w/ Staff", premium detail moments — used sparingly.
- **Semantic colors are muted into the palette:** success → pistachio/olive `#6F8B45`, destructive → clay `#B0654C`. No bright red/green/purple competing with the brand.

---

## Design Tokens

### Typography
- **Family:** `Hanken Grotesk` (Google Fonts), weights 400/500/600/700/800/900. Substitute your app's closest grotesk if needed.
- **Scale (px @ 390-wide mobile):**
  - Screen title (H1): 30, weight 800, letter-spacing −0.02em
  - Section/card title: 17–19, weight 800
  - Large metric numbers: 42–46, weight 900, letter-spacing −0.02em
  - Body: 13.5–15, weight 400–600, line-height ~1.5–1.6
  - **Small uppercase label:** 11–12.5, weight 700, `letter-spacing: .16em–.20em`, `text-transform: uppercase`, colored with `label` token — this is a signature element, used above every section.
  - Tab bar labels: 11, weight 600 (700 when active)

### Spacing & Layout
- Screen horizontal padding: 22–24px
- Card padding: 16–20px
- Gap between stacked cards: 11–13px
- Section label → content gap: ~11–13px; section → section: ~22–26px
- Screen frame: 390 × 852 (iPhone-class), corner radius 46px

### Radius
- Cards: 18–22px
- Inputs / small controls: 13–15px
- Icon tiles: 12–17px
- **Pills (filters, buttons, badges): 999px** (fully rounded) — pills are a core part of the premium feel; keep them large and consistent.

### Shadows
- Light-mode cards: very subtle or none — rely on `cardBorder`. Optional `0 1px 4px rgba(0,0,0,.06)`.
- Dark-mode cards: no shadow; the blur + translucent fill does the lifting.
- Elevated/floating elements (device frame in prototype only): `0 30px 70px rgba(0,0,0,.3)`.

### Iconography
- **Lucide icons** throughout (`lucide` / `lucide-react` / SF Symbols equivalents). Stroke style, 16–24px. Map to your icon set; names referenced per-screen below.

---

## Shared Components

**Section label** — small uppercase tracked text in `label` color, sits above every content group.

**Card** — `card` bg, 1px `cardBorder`, radius 18–22, padding 16–20. In dark mode add `backdrop-filter: blur(14px)`. A *selected* card uses a 1.5px `accent` border instead of `cardBorder`.

**Pill button (primary)** — `ctaBg` fill, `ctaText` label, radius 999, padding ~10×19, weight 800. **Secondary** — transparent fill, 1px `cta2Border`, `cta2Text` label.

**Filter pill row** — horizontal row of pills; active = `ctaBg`/`ctaText`, inactive = transparent with 1px `line` border. Use flex with `gap`.

**Icon tile** — rounded square (radius 12–14), `tile` fill, `tileIcon` colored glyph, ~44–48px. Used for list-row leading icons and report-type tiles. Variants tint with `brownSoft`/`brown`, `positiveSoft`/`positive`, etc. by category.

**Dark pill badge** — `badgeBg` fill, `badgeText` text, radius 999 — used for report-type tags ("Film Breakdown").

**Status badge** — small pill using a soft token fill + matching solid token text: `accentSoft`/`accent` ("Report Ready"), `positiveSoft`/`positive` (win "W"), `negativeSoft`/`negative` (loss "L"), `chip`/`muted` ("In Progress").

**Bottom tab bar** — `navbar` bg, 1px top `divider`. Active item uses `accent`; inactive uses `muted2`. Icon (22px) above an 11px label.
- **Coach tab bar:** Home · Team Eval · Team Grade · Roster · Recent
- **Player tab bar:** Home · Reports · Training · Alerts · Profile

**Action button family (semantic, muted):**
- Positive / "Send to Player": `pistachio` fill, dark text `#16201A`.
- Secondary / "Share w/ Staff": `brown` fill, `brownInk` text (`#FFFFFF` light / `#241608` dark).
- Primary: `ctaBg`/`ctaText`.
- Neutral: `chip` fill, `ink` text.
- Destructive ("End Game"): 1.5px `negative` border, `negative` text, transparent fill.

---

## Screens / Views

All screens are 390-wide mobile, status bar on top, most with a bottom tab bar. Listed by section. For each, recreate layout + apply tokens; copy is sample data.

### Coach App
1. **Home** (`HomeScreen.dc.html`) — Header with "Intelligence Model" label, "BloomPrint" title, user subline, 3 circular icon buttons (logout/mail/bell). "Report Types" 2×2 grid of cards (Player Eval, Film Breakdown, Scouting Report, Coaching Report) each with an icon tile + title + description. "The 6 Pillars" list rows (icon tile + title + subtitle, divider between). Coach tab bar, Home active.
2. **Team Reports** (`ReportsScreen.dc.html`) — Title + outline "Import" pill. "Game Reports" section with primary "New" pill; report cards showing opponent, type, date, status badge, clip count, trash/chevron. A selected card uses accent border. "Previous Reports" with filter pill row (All/Coaching Report/Game) and a Film Breakdown card with dark badge + "View Full Report" link.
3. **Report Detail** (`ReportDetail.dc.html`) — Title + date, close circle. Report heading block, "Executive Summary" labeled section. 2×2 action grid: Send to Player (pistachio), Share w/ Staff (brown), Print (outline), Export PDF (outline). "Add Correction" input card + Apply & Regenerate (primary) / Save for Later (neutral).
4. **Scouting Report** (`ScoutingReportDetail.dc.html`) — Back chevron + title + player/date, print/share circles. Two pill badges (BIM score, Recruit Grade). Scrollable labeled sections: Offensive Skills, Defense, Projection (each = uppercase label + body). Sticky bottom: Send to Player (pistachio) / Share w/ Staff (brown).
5. **Generate Report** (`GenerateForm.dc.html`) — Title input row with back + mic. "Report Context" radio-style option list (selected = accentSoft fill + accent border). My Team / Opponent dropdown cards. "Report Type" filter pills. "Film" section with "Add Film" pill and film source cards (My Team / Opponent tags). Primary "Generate Report" button with sparkles icon.
6. **Share Report** (`ShareReport.dc.html`) — Bottom-sheet modal over a dimmed screen (`scrim` rgba(16,40,58,.45)). Grab handle, header with brown share tile. "Share With" recipient rows (selected = accent border + filled check). "Permissions" two-pill toggle (View & Comment / View Only). Primary "Send Report".
7. **Team Grade** (`TeamGrade.dc.html`) — "Team Eval" title, top tab pills (Dashboard/Games/Scout), grade-view pills. "Season Record" stat card (big number + %). "Season Avg Grade" big accent number. "Grade Trend" bar chart (bars use chip/pistachio, W/L badges). "Player Leaderboard" ranked rows with grade pills (accentSoft, or negativeSoft for negative).
8. **Roster** (`Roster.dc.html`) — Title + count, Import pill + round "+". Team filter pills. Player cards (name, position · org); one card shows a circular BIM-score ring (accent border).
9. **Add Player** (`AddPlayer.dc.html`) — Close + title + Save pill. Centered dashed "Add Photo" avatar. Form fields (Name, Position dropdown, Jersey, Team dropdown, School). "Invite player to link portal" toggle row (accent track, on).
10. **Player Profile** (`PlayerProfileCoach.dc.html`) — Back + name/position, edit pencil. "Evaluation History" with "New Eval" pill + scouting report card. 2×2 action grid (Summarize primary, Generate outline, Send to Player pistachio, Share brown). "Regenerate with Feedback" input card + Regenerate button. "Game History" row (win badge + grade pill).
11. **Recent Reports** (`RecentReports.dc.html`) — Title, filter pills, date-grouped sections. Report cards with brown icon tile, title, "Game Report Packet" subline, chevron; first card expands to View Report / Edit / Share outline pills. Coach tab bar, Recent active.
12. **Live Game Tracker** (`TeamEvalLive.dc.html`) — "Team Eval" title + Dashboard/Games/Scout pills. Scoreboard card (US / vs / THEM with −/+ steppers and big score). Quarter pills (Q1–OT). Our Team / Opponent toggle. "Offense" event chips (FG made/missed, assists, turnover=negative) and "Defense" event chips, color-coded by token. Bottom: Lineup (outline) / End Game (destructive outline).
13. **New Game** (`NewGame.dc.html`) — Back + title. "Select Your Team" selectable cards (selected = accent border + check). Opponent input. Date / Type fields. "Tracking Mode" two big cards (Live Track selected / Post-Game). Primary "Start Game".
14. **Notifications** (`Notifications.dc.html`) — Back + title. Notification cards: category icon tile (varies: tile/positiveSoft/brownSoft), title, body, date, chevron-down. Coach context.
15. **Staff Hub** (`StaffHub.dc.html`) — Back + title. Segmented control (Inbox active / Team Games / My Teams) inside a card. Empty state: large outlined mail icon + "No reports shared with you yet."

### Onboarding
16. **Who Are You?** (`RoleSelect.dc.html`) — Centered: "BloomPrint" label, "Who are you?" H1, subtitle. Two large role cards — **Coach** (accent-bordered, accentSoft tile, clipboard icon) and **Player** (brownSoft tile, user icon) — each with title + description + chevron. "Already have an account? Sign in" footer. This is the role fork that routes to Coach App or Player Portal.

### Player Portal (same palette, player tab bar)
17. **Player Home** (`PlayerHome.dc.html`) — "Player Portal" label, "Hey, Marcus" greeting, avatar. "Current BIM Score" card: big 6.1 metric, trend badge (positive), 4-segment pillar bar (accent/pistachio/brown/chip) with labels. "From Your Coach" rows (new report, training update) with icon tiles + chevrons. Player tab bar, Home active.
18. **My Reports** (`MyReports.dc.html`) — Title + subtitle, filter pills. Report cards with type badge (accentSoft or dark), date, title, coach + BIM, a "New" pistachio chip and comment count. Player tab bar, Reports active.
19. **My Training** (`MyTraining.dc.html`) — Title + week subtitle, round "+". "This Week's Progress" card with accent progress bar (4/6). "Today's Drills" checklist: completed rows (pistachio check + strikethrough), an active row (accent border + play-circle), pending rows (line-border checkbox). Player tab bar, Training active.
20. **My Evaluation** (`PlayerEvalDetail.dc.html`) — Back + title + "From Coach" date. Card with circular BIM ring + Offense/Defense bars (accent / pistachio). "Strengths" (positive label) and "Focus Areas" (brown label) body cards. Primary "Build Training From This".
21. **Edit Profile** (`EditMyProfile.dc.html`) — Back + title + Save pill. Avatar with camera-badge. Form fields (Name, Position, Height, School). "Linked Team" card with shield icon, "Linked · Coach Jaire" (positive), "Unlink" (negative text).
22. **Link to Staff** (`LinkToStaff.dc.html`) — Back + title. Centered link icon tile + heading + instructions. 6-box code entry (first box filled = accent border). "OR" divider. "Scan QR Code" outline button. Primary "Link Account".

---

## Interactions & Behavior
- **Theme toggle:** a single light/dark switch swaps the entire token set; persist the choice (e.g. `AsyncStorage`/`UserDefaults`/`localStorage`) and optionally follow system `prefers-color-scheme` on first launch. No layout changes between modes — tokens only.
- **Navigation:** tab bars switch top-level destinations; cards/rows push detail screens; "+" and "New" open create flows (New Game, Add Player, Generate Report); Share opens a **bottom-sheet modal** over a dimmed scrim.
- **Selection states:** selected list cards / options / team picks swap a neutral `cardBorder` for a 1.5px `accent` border (+ filled check where shown). Active filter pill = `ctaBg`; inactive = `line`-bordered transparent.
- **Role fork:** "Who Are You?" routes to either the Coach tab set or the Player tab set; the palette is identical across both.
- **Transitions:** standard platform push/modal; if custom, keep easing gentle (ease-out ~200–300ms). Pills/cards can have a subtle press state (slight opacity/scale).

## State Management
- `theme: 'light' | 'dark'` (persisted) — drives the token provider.
- `role: 'coach' | 'player'` — selects tab navigator + start screen.
- Active tab per navigator; selected filter per filtered list; form field state on create/edit screens; selected recipients + permission on Share; live game state (scores, quarter, team toggle, event log) on Live Game Tracker.
- All displayed content (players, reports, scores, dates) is **sample data** — back it with your real data layer.

## Assets
- **Font:** Hanken Grotesk (Google Fonts) — bundle or link; substitute closest grotesk if your app standardizes elsewhere.
- **Icons:** Lucide (names referenced per screen). Map to `lucide-react`/`lucide-react-native`/SF Symbols.
- No raster images or logos are required by the designs; avatars are initials in tinted circles. Player/photo slots are dashed "add photo" placeholders.

## Files
The HTML design references in this bundle:
- `BloomPrint App.dc.html` — **the master interactive prototype**: light/dark toggle + grouped navigation across all 22 screens. Start here to see the system in motion.
- `BloomPrint Recolor.dc.html` — side-by-side comparison canvas (both themes per screen) — useful for seeing light vs dark of the same screen at a glance.
- Per-screen files (each a single screen): `HomeScreen`, `ReportsScreen`, `ReportDetail`, `ScoutingReportDetail`, `GenerateForm`, `ShareReport`, `TeamGrade`, `Roster`, `AddPlayer`, `PlayerProfileCoach`, `RecentReports`, `TeamEvalLive`, `NewGame`, `Notifications`, `StaffHub`, `RoleSelect`, `PlayerHome`, `MyReports`, `MyTraining`, `PlayerEvalDetail`, `EditMyProfile`, `LinkToStaff` (all `.dc.html`).

> Note: `.dc.html` files are HTML prototypes in a component runtime. Open them in a browser to view; read the markup for exact inline styles (every color/size is inline and maps to the tokens above). Do **not** port the runtime — reimplement in your app's framework.
