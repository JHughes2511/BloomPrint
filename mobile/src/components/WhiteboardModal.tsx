import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  PanResponder, Alert, TextInput, ScrollView, ActivityIndicator,
  Platform, KeyboardAvoidingView, Dimensions, Keyboard, TouchableWithoutFeedback, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Svg, { Path, Circle, Line, Rect, G, Text as SvgText } from 'react-native-svg';

const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedG = Animated.createAnimatedComponent(G);
import { whiteboardAPI, evalsAPI, gameEvalAPI } from '../api/client';
import VoiceTextInput from './VoiceTextInput';
import { reportSubject } from '../utils/reportSubject';
import { outputTypeLabel } from '../utils/reportType';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import { GeneratingOverlay } from './GeneratingBasketball';

// ── Court sizing ──────────────────────────────────────────────────────────
// Classic hardwood court drawn in SVG at regulation 50ft x 94ft proportions.
// Each view scales to FIT the available screen area:
//   full  = whole court (both hoops visible),
//   half  = bottom 47ft (fills the screen much larger),
//   3/4   = bottom 78ft (includes the far free-throw line at 75ft).
const COURT_FT_W = 50;
const COURT_FT_L = 94;
const VISIBLE_FT: Record<string, number> = { full: 94, three_quarter: 78, half: 47 };
// Out-of-bounds floor so inbound (BLOB / SLOB) plays fit: the painted 50×94
// court is inset inside a slightly larger wood canvas. Feet→px adds OOB_SIDE_FT
// on x; the baseline OOB sits below the court at the hoop end.
const OOB_SIDE_FT = 3;                        // wood beyond each sideline
const OOB_BASE_FT = 4;                        // wood beyond a baseline
const PADDED_FT_W = COURT_FT_W + OOB_SIDE_FT * 2;   // 56
// Baseline OOB applies to each REAL endline in view. The bottom is always a
// baseline (all views); the top is a baseline only on full court (its top edge
// is court-feet y=0). Half / 3/4 clip the top mid-court, so no top OOB there.
const topPadFt = (visFt: number) => (COURT_FT_L - visFt === 0 ? OOB_BASE_FT : 0);
const vTotalFt = (visFt: number) => visFt + topPadFt(visFt) + OOB_BASE_FT;

type CourtType = 'full' | 'half' | 'three_quarter';
type Tool = 'pen' | 'circle' | 'xmark' | 'arrow' | 'arrow_dash' | 'text' | 'move';

interface Stroke {
  id: string;
  type: 'path' | 'circle' | 'xmark' | 'arrow' | 'text';
  d?: string;
  cx?: number; cy?: number; r?: number; size?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  x?: number; y?: number; label?: string;
  color: string; strokeWidth: number;
  dash?: boolean;                 // dashed rendering (passes, suggested movement)
  layer?: 'offense' | 'defense' | 'counter' | 'key';  // AI scheme layer
  side?: 'off' | 'def';           // offensive vs defensive element (for ghosting)
  step?: number;                  // animation order within a scheme (1-based)
  opacity?: number;               // render opacity (ghosting)
}

type SchemeKey = 'offense' | 'defense' | 'counter';

// Defenders are stored as X1..X5 (X1 guards O1) but shown to the coach as
// D1..D5 so it's clear they're defensive players.
const dispId = (id: string) => (id && id[0] === 'X' ? 'D' + id.slice(1) : id);
// Relabel defender references in free text (key items, roles) X#→D# for display.
const dispText = (s?: string) => (s || '').replace(/\bX([1-5])\b/g, 'D$1');
// Standing per-player edits are keyed by "scheme:id" so O1 on offense and
// counter stay independent.
const gKey = (scheme: string, id: string) => `${scheme}:${id}`;

// Scale every pixel coordinate of a stroke by `ratio` (used when the court
// resizes for the same view, so marks keep their court location).
const scaleStroke = (s: Stroke, ratio: number): Stroke => ({
  ...s,
  d: s.d ? s.d.replace(/-?\d*\.?\d+/g, m => (parseFloat(m) * ratio).toFixed(2)) : s.d,
  cx: s.cx != null ? s.cx * ratio : s.cx, cy: s.cy != null ? s.cy * ratio : s.cy,
  r: s.r != null ? s.r * ratio : s.r, size: s.size != null ? s.size * ratio : s.size,
  x1: s.x1 != null ? s.x1 * ratio : s.x1, y1: s.y1 != null ? s.y1 * ratio : s.y1,
  x2: s.x2 != null ? s.x2 * ratio : s.x2, y2: s.y2 != null ? s.y2 * ratio : s.y2,
  x: s.x != null ? s.x * ratio : s.x, y: s.y != null ? s.y * ratio : s.y,
});

// Perpendicular distance from a point to a line segment (px).
const distToSeg = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

interface Board {
  id?: number;
  name: string;
  court_type: CourtType;
  strokes: Stroke[];
  ai?: {
    play_name: string;
    key: { n: number; text: string; from?: number[]; to?: number[] }[];
    source?: string;
    prompt?: string;   // what the coach wrote to generate/refine the play
    attachedTitle?: string; // report attached at generation, if any
    schemes?: Record<string, {
      players?: { id: string; x: number; y: number; role?: string }[];
      defenders?: { id: string; x: number; y: number; role?: string }[];
      actions?: { actor?: string; kind?: string; from: number[]; to: number[]; step?: number }[];
    }>;
    // Coach's standing per-player edits, keyed "scheme:id". Always re-applied on
    // regeneration and shown in the panel until the coach changes them.
    guidance?: Record<string, string>;
  };
  // Canvas dimensions the hand-drawn strokes were baked at (px). Used on reload to
  // rescale strokes to the current court size so they don't drift when the board is
  // reopened on a different-sized canvas.
  canvas?: { w: number; h: number; type?: CourtType };
}

// Three marker colors with strong contrast on maple hardwood, one thickness.
const COLORS = ['#141414', '#1F6F9B', '#C0392B'];   // ink black · sane blue · marker red
const STROKE_WIDTH = 3.5;

const TOOLS: { key: Tool; icon: string }[] = [
  { key: 'pen',        icon: 'pencil' },
  { key: 'circle',     icon: 'ellipse-outline' },
  { key: 'xmark',      icon: 'close' },
  { key: 'arrow',      icon: 'arrow-forward' },
  { key: 'arrow_dash', icon: 'arrow-forward' },   // dashed blue pass arrow
  { key: 'text',       icon: 'text' },
];
const PASS_BLUE = '#1F6F9B';

// ── Classic hardwood court (SVG) ─────────────────────────────────────────────
// Maple plank floor with painted lines: sidelines, center circle, keys,
// free-throw circles, backboards + rims, and three-point arcs.
const WOOD_A = '#E5C593';   // maple plank
const WOOD_B = '#DDBA84';   // alternating plank tone
const LINE = '#7A4326';     // painted line — walnut brown, classic look
const LINE_W = 2;

// `width`/`height` are the FULL padded canvas (court + out-of-bounds wood);
// `scale` is px-per-foot. The painted 50×94 court is inset by OOB_SIDE_FT on the
// sides and lifted OOB_BASE_FT off the bottom so there's floor beyond the lines.
function HardwoodCourt({ width, height, scale }: { width: number; height: number; scale: number }) {
  const s = scale;                    // feet -> px
  const cw = COURT_FT_W * s;          // painted court width in px
  const L = COURT_FT_L * s;           // full court length in px
  const ft = (n: number) => n * s;
  const M = 6;                        // uniform wood margin inside the painted boundary

  // Plank stripes fill the ENTIRE canvas (court + out-of-bounds wood).
  const planks = [];
  const plankW = ft(3.55);
  for (let i = 0; i * plankW < width; i++) {
    planks.push(
      <Rect key={i} x={i * plankW} y={0} width={plankW} height={height}
            fill={i % 2 === 0 ? WOOD_A : WOOD_B} />
    );
  }

  // One end's markings; mirrored for the far end via rotation.
  const End = ({ flip }: { flip?: boolean }) => {
    // Drawn relative to the NEAR baseline (y = L - M); flip rotates 180° about center.
    const base = L - M;
    const cx = cw / 2;
    const rimY = base - ft(5.25);
    const keyW = ft(16), keyH = ft(19);
    const ftY = base - keyH;
    const r3 = ft(22.15);
    const cornerX = M + ft(4);
    const yCorner = rimY - Math.sqrt(Math.max(r3 * r3 - (cx - cornerX) ** 2, 0));
    return (
      <G transform={flip ? `rotate(180 ${cx} ${L / 2})` : undefined}>
        {/* key */}
        <Rect x={cx - keyW / 2} y={ftY} width={keyW} height={keyH}
              stroke={LINE} strokeWidth={LINE_W} fill="rgba(122,67,38,0.08)" />
        {/* free-throw circle */}
        <Circle cx={cx} cy={ftY} r={ft(6)} stroke={LINE} strokeWidth={LINE_W} fill="none" />
        {/* backboard + rim */}
        <Line x1={cx - ft(3)} y1={base - ft(4)} x2={cx + ft(3)} y2={base - ft(4)}
              stroke={LINE} strokeWidth={LINE_W + 1} />
        <Circle cx={cx} cy={rimY} r={ft(0.75)} stroke={LINE} strokeWidth={LINE_W} fill="none" />
        {/* three-point line: two corner segments + arc */}
        <Line x1={cornerX} y1={base} x2={cornerX} y2={yCorner} stroke={LINE} strokeWidth={LINE_W} />
        <Line x1={cw - cornerX} y1={base} x2={cw - cornerX} y2={yCorner} stroke={LINE} strokeWidth={LINE_W} />
        {/* baseline-to-arc geometry uses the inset base, so edges stay uniform */}
        <Path d={`M ${cornerX} ${yCorner} A ${r3} ${r3} 0 0 1 ${cw - cornerX} ${yCorner}`}
              stroke={LINE} strokeWidth={LINE_W} fill="none" />
      </G>
    );
  };

  return (
    <View style={{ width, height, overflow: 'hidden' }}>
      {/* Wood (incl. out-of-bounds) fills the whole canvas. */}
      <Svg style={StyleSheet.absoluteFill} width={width} height={height}>{planks}</Svg>
      {/* Painted court: inset by side OOB, lifted off the bottom by baseline OOB.
          Full court anchored to the bottom; half / 3/4 clip the top away. */}
      <View style={{ position: 'absolute', left: OOB_SIDE_FT * s, bottom: OOB_BASE_FT * s, width: cw, height: L }}>
        <Svg width={cw} height={L}>
          {/* boundary — inset by the same margin on all four sides */}
          <Rect x={M} y={M} width={cw - M * 2} height={L - M * 2}
                stroke={LINE} strokeWidth={LINE_W} fill="none" />
          {/* center line + circle */}
          <Line x1={M} y1={L / 2} x2={cw - M} y2={L / 2} stroke={LINE} strokeWidth={LINE_W} />
          <Circle cx={cw / 2} cy={L / 2} r={ft(6)} stroke={LINE} strokeWidth={LINE_W} fill="none" />
          <Circle cx={cw / 2} cy={L / 2} r={ft(2)} stroke={LINE} strokeWidth={LINE_W} fill="rgba(122,67,38,0.10)" />
          <End />
          <End flip />
        </Svg>
      </View>
    </View>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────
interface Props { visible: boolean; gameId: number; playbook?: boolean; onClose: () => void; }

export default function WhiteboardModal({ visible, gameId, playbook = false, onClose }: Props) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const styles = makeStyles(t);
  // Display label for a scheme (the scheme KEY strings stay English — they're data).
  const schemeLabel = (s: SchemeKey) => tr(`whiteboard.${s}`);
  const [boards, setBoards]                 = useState<Board[]>([]);
  const [activeBoardIdx, setActiveBoardIdx] = useState(0);
  const [tool, setTool]                     = useState<Tool>('pen');
  const [color, setColor]                   = useState(COLORS[0]);
  const [showBoardList, setShowBoardList]   = useState(false);
  const [showAddText, setShowAddText]       = useState(false);
  const [pendingTextPos, setPendingTextPos] = useState({ x: 0, y: 0 });
  const [textInput, setTextInput]           = useState('');
  const [loading, setLoading]               = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [livePath, setLivePath]             = useState('');

  const toolRef           = useRef<Tool>('pen');
  const colorRef          = useRef(COLORS[0]);
  const activeBoardIdxRef = useRef(0);
  useEffect(() => { toolRef.current = tool; if (tool !== 'text') setSelectedTextId(null); }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { activeBoardIdxRef.current = activeBoardIdx; }, [activeBoardIdx]);

  const currentPath = useRef('');
  const startPoint  = useRef({ x: 0, y: 0 });

  // Text selection: with the Text tool, tap a label to select it, drag to move,
  // resize with the A-/A+ controls. Tap empty court to place a new label.
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const selectedTextIdRef = useRef<string | null>(null);
  useEffect(() => { selectedTextIdRef.current = selectedTextId; }, [selectedTextId]);
  const boardsRef = useRef<Board[]>([]);
  useEffect(() => { boardsRef.current = boards; }, [boards]);
  const dragRef = useRef<{ id: string; dx: number; dy: number; wasSelected?: boolean; label?: string } | null>(null);

  // ── AI play draw-up ──────────────────────────────────────────────────────
  const [showAI, setShowAI]             = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [showRefine, setShowRefine]     = useState(false);
  const [refineText, setRefineText]     = useState('');
  const [refining, setRefining]         = useState(false);
  // Draw-up "By Player": optional per-position intent (O1-O5 offense, D1-D5
  // defense) captured BEFORE generating and folded into the prompt.
  const [aiByPlayer, setAiByPlayer]     = useState(false);
  const [byPlayerNotes, setByPlayerNotes] = useState<Record<string, string>>({});
  const byPlayerCount = Object.values(byPlayerNotes).filter(v => v.trim()).length;
  const [activeScheme, setActiveScheme] = useState<SchemeKey>('offense');
  const [showKey, setShowKey]           = useState(true);
  // Court orientation — portrait (default) or landscape for tablets / wide screens.
  const [orientation, setOrientation]   = useState<'portrait' | 'landscape'>('portrait');
  const didAutoOrient                   = useRef(false);
  // Per-player guidance: lock a player in place (AI cascades the others around
  // it) and/or attach a per-player note. Keyed by player id (O1..O5). Reset per
  // board. Applied on regenerate.
  const [showPlayers, setShowPlayers]       = useState(false);
  const [lockedPlayers, setLockedPlayers]   = useState<Record<string, boolean>>({});
  const [playerGuidance, setPlayerGuidance] = useState<Record<string, string>>({});
  const [applyingGuidance, setApplyingGuidance] = useState(false);
  useEffect(() => { setLockedPlayers({}); setPlayerGuidance({}); }, [activeBoardIdx]);
  // ── Direct drag on AI boards (Move tool) ──
  // Drag player/defender markers OR arrow endpoints (action arrows + key arrows).
  // Drops are local and instant; the coach then taps "Adapt play" to re-solve the
  // active scheme around whatever was moved (moved pieces stay locked).
  type DragTarget =
    | { t: 'unit'; scheme: SchemeKey; id: string; kind: 'O' | 'X'; xpx: number; ypx: number }
    | { t: 'action'; scheme: SchemeKey; idx: number; end: 'from' | 'to'; xpx: number; ypx: number }
    | { t: 'key'; idx: number; end: 'from' | 'to'; xpx: number; ypx: number };
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [adapting, setAdapting] = useState(false);
  const [pinCount, setPinCount] = useState(0);
  // A tapped (not dragged) arrow, selected for deletion.
  const [selectedArrow, setSelectedArrow] = useState<{ kind: 'action'; scheme: SchemeKey; idx: number } | { kind: 'key'; idx: number } | null>(null);
  const deleteArrowRef = useRef<() => void>(() => {});
  // An arrow drawn on an AI board, awaiting a movement-type choice (pass/cut/…).
  const [pendingArrow, setPendingArrow] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  useEffect(() => { setSelectedArrow(null); }, [activeScheme, activeBoardIdx, tool]);
  const dragTargetRef = useRef<DragTarget | null>(null);
  const hitTestRef = useRef<(x: number, y: number) => DragTarget | null>(() => null);
  const dropRef = useRef<(x: number, y: number) => void>(() => {});
  // What the coach manually placed → locked when the play is adapted.
  const pinsRef = useRef<{ units: Set<string>; actions: Set<string>; keys: Set<number> }>({ units: new Set(), actions: new Set(), keys: new Set() });
  const clearPins = () => { pinsRef.current = { units: new Set(), actions: new Set(), keys: new Set() }; setPinCount(0); };
  useEffect(() => { clearPins(); }, [activeBoardIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  // Reset the Move tool when the active board has no AI play to drag.
  useEffect(() => { if (tool === 'move' && !boards[activeBoardIdx]?.ai) setTool('pen'); }, [activeBoardIdx]); // eslint-disable-line react-hooks/exhaustive-deps
  // ── Scheme play-through animation ──
  const [animating, setAnimating]       = useState(false);
  const [animDone, setAnimDone]         = useState(false); // finished — markers at final spots
  const [animStep, setAnimStep]         = useState(0);   // step value currently drawing
  const drawProgress                    = useRef(new Animated.Value(0)).current;
  const animCancel                      = useRef(false);
  // ── Freehand sequencing + play-through ──
  const [orderMode, setOrderMode]       = useState(false);   // tap arrows to number them
  const [freehandPlaying, setFreehandPlaying] = useState(false);
  const [freehandDone, setFreehandDone] = useState(false);
  const orderModeRef                    = useRef(false);
  const arrowAtRef                      = useRef<any>(() => null);
  const assignStepRef                   = useRef<any>(() => {});
  const orderCounterRef                 = useRef(0);   // running number as you tap arrows
  const activeSchemeRef                 = useRef<SchemeKey>('offense');
  useEffect(() => { orderModeRef.current = orderMode; }, [orderMode]);
  useEffect(() => { activeSchemeRef.current = activeScheme; }, [activeScheme]);
  useEffect(() => { setOrderMode(false); }, [activeBoardIdx]);
  // Draw up from a report: pick a source type (Scout / Team), then a report.
  // The chosen report ATTACHES to the request (shown as a chip) so the text box
  // stays free for the coach's own additional details.
  type SeedItem = { id: string; title: string; sub: string; text: string };
  const [seedMode, setSeedMode]       = useState<'none' | 'type' | 'list'>('none');
  const [seedType, setSeedType]       = useState<'scout' | 'team' | null>(null);
  const [seedItems, setSeedItems]     = useState<SeedItem[]>([]);
  const [seedLoading, setSeedLoading] = useState(false);
  const [attachedReport, setAttachedReport] = useState<SeedItem | null>(null);

  const openSeedList = async (kind: 'scout' | 'team') => {
    setSeedType(kind);
    setSeedMode('list');
    setSeedLoading(true);
    try {
      const items: SeedItem[] = [];
      if (kind === 'team') {
        const teamReports = await evalsAPI.teamReports(30).catch(() => []);
        (teamReports ?? []).forEach((r: any) => {
          if (!r.report_text) return;
          const typeLabel = outputTypeLabel(r.output_type) || tr('whiteboard.teamReport');
          const subject = reportSubject(r.report_text, r.output_type ?? '');
          items.push({
            id: `team-${r.id}`,
            title: subject ?? typeLabel,
            sub: `${typeLabel} · ${new Date(r.created_at).toLocaleDateString()}`,
            text: r.report_text,
          });
        });
      } else {
        const sessions = await gameEvalAPI.listSessions().catch(() => []);
        (sessions ?? []).forEach((g: any) => {
          if (!g.ai_scouting_report) return;
          const subject = reportSubject(g.ai_scouting_report, 'scouting_report');
          items.push({
            id: `scout-${g.id}`,
            title: subject
              ? tr('whiteboard.vsOpponentSubject', { opponent: g.opponent_name, subject })
              : tr('whiteboard.vsOpponent', { opponent: g.opponent_name }),
            sub: `${tr('whiteboard.scoutReport')} · ${new Date(g.date).toLocaleDateString()}`,
            text: g.ai_scouting_report,
          });
        });
      }
      setSeedItems(items);
    } catch { setSeedItems([]); }
    setSeedLoading(false);
  };

  const attachReport = (item: SeedItem) => {
    setAttachedReport(item);
    setSeedMode('none');
  };

  // Convert the AI scheme JSON (court feet) into layered strokes (canvas px),
  // mapped for the FULL court view this board defaults to.
  const buildPlayStrokes = (res: any): Stroke[] => {
    // AI plays are drawn on a HALF court (bigger, easier to read). The half
    // court shows the near half (court-feet y 47..94) with the hoop at the
    // bottom, so we scale to that view and offset y by the half-court line.
    const fs = scaleForType('half');
    const HALF_OFFSET = COURT_FT_L - VISIBLE_FT.half; // 94 - 47 = 47
    const X = (xft: number) => (xft + OOB_SIDE_FT) * fs;
    const Y = (yft: number) => (yft - HALF_OFFSET) * fs;
    const mk = () => Math.random().toString(36).slice(2);
    const out: Stroke[] = [];
    (['offense', 'defense', 'counter'] as SchemeKey[]).forEach(layer => {
      const sc = res?.schemes?.[layer];
      if (!sc) return;
      (sc.players ?? []).forEach((pl: any) => {
        out.push({ id: mk(), type: 'circle', cx: X(pl.x), cy: Y(pl.y), r: 13, color: '#141414', strokeWidth: 3, layer, side: 'off' });
        out.push({ id: mk(), type: 'text', x: X(pl.x) - 8, y: Y(pl.y) + 5, label: pl.id, size: 13, color: '#141414', strokeWidth: 1, layer, side: 'off' });
      });
      (sc.defenders ?? []).forEach((df: any) => {
        out.push({ id: mk(), type: 'xmark', cx: X(df.x), cy: Y(df.y), size: 10, color: '#C0392B', strokeWidth: 3, layer, side: 'def' });
        out.push({ id: mk(), type: 'text', x: X(df.x) + 12, y: Y(df.y) + 5, label: dispId(df.id), size: 12, color: '#C0392B', strokeWidth: 1, layer, side: 'def' });
      });
      (sc.actions ?? []).forEach((a: any, i: number) => {
        const side: 'off' | 'def' = String(a.actor || '')[0] === 'X' ? 'def' : 'off';
        const isPass = a.kind === 'pass';
        out.push({ id: mk(), type: 'arrow', x1: X(a.from[0]), y1: Y(a.from[1]), x2: X(a.to[0]), y2: Y(a.to[1]),
                   color: isPass ? '#1F6F9B' : '#141414', strokeWidth: 3, dash: isPass, layer, side, step: a.step ?? (i + 1) });
      });
    });
    (res?.key ?? []).forEach((k: any) => {
      if (!Array.isArray(k.from) || !Array.isArray(k.to)) return;   // no coords → no arrow
      out.push({ id: mk(), type: 'arrow', x1: X(k.from[0]), y1: Y(k.from[1]), x2: X(k.to[0]), y2: Y(k.to[1]),
                 color: '#1F6F9B', strokeWidth: 3.5, dash: true, layer: 'key' });
      out.push({ id: mk(), type: 'text', x: X(k.to[0]) + 6, y: Y(k.to[1]) - 6, label: String(k.n), size: 15, color: '#1F6F9B', strokeWidth: 1, layer: 'key' });
    });
    return out;
  };

  const buildByPlayerBlock = () => {
    const off = ['O1', 'O2', 'O3', 'O4', 'O5'].filter(id => (byPlayerNotes[id] || '').trim())
      .map(id => `- ${id}: ${byPlayerNotes[id].trim()}`);
    const def = ['D1', 'D2', 'D3', 'D4', 'D5'].filter(id => (byPlayerNotes[id] || '').trim())
      .map(id => `- ${id}: ${byPlayerNotes[id].trim()}`);
    const block = [
      off.length ? `OFFENSE:\n${off.join('\n')}` : '',
      def.length ? `DEFENSE:\n${def.join('\n')}` : '',
    ].filter(Boolean).join('\n');
    return block ? `BY-PLAYER INSTRUCTIONS (assign each player exactly this):\n${block}` : '';
  };

  const generatePlay = async () => {
    if (!aiDescription.trim() && !attachedReport && byPlayerCount === 0) return;
    setAiGenerating(true);
    try {
      const composed = [
        aiDescription.trim(),
        buildByPlayerBlock(),
        attachedReport ? `REPORT (${attachedReport.title}):\n${attachedReport.text.trim().slice(0, 4000)}` : '',
      ].filter(Boolean).join('\n\n');
      const res = await whiteboardAPI.aiPlay(composed);
      syncOffenseAcrossSchemes(res);   // same offense across defense/counter
      const idx = boards.length;
      // Seed standing per-player guidance from any By-Player draw-up notes so the
      // coach's intent persists (offense O#, defense D#→X#).
      const seedGuidance: Record<string, string> = {};
      ['O1', 'O2', 'O3', 'O4', 'O5'].forEach(id => {
        const v = (byPlayerNotes[id] || '').trim();
        if (v) seedGuidance[gKey('offense', id)] = v;
      });
      ['D1', 'D2', 'D3', 'D4', 'D5'].forEach(id => {
        const v = (byPlayerNotes[id] || '').trim();
        if (v) seedGuidance[gKey('defense', 'X' + id.slice(1))] = v;
      });
      const newBoard: Board = {
        name: res.play_name || tr('whiteboard.aiPlayN', { n: idx + 1 }),
        court_type: 'half',
        strokes: buildPlayStrokes(res),
        ai: { play_name: res.play_name ?? tr('whiteboard.aiPlay'), key: (res.key ?? []).map((k: any) => ({ n: k.n, text: k.text, from: k.from, to: k.to })), source: composed, schemes: res.schemes,
              prompt: aiDescription.trim(), attachedTitle: attachedReport?.title, guidance: seedGuidance },
      };
      setBoards(prev => [...prev, newBoard]);
      setActiveBoardIdx(idx);
      setActiveScheme('offense');
      setShowKey(true);
      saveBoard(idx, newBoard);
      setShowAI(false);
      setAiDescription('');
      setAttachedReport(null);
      setByPlayerNotes({});
      setAiByPlayer(false);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('whiteboard.couldNotGenerate'));
    } finally {
      setAiGenerating(false);
    }
  };

  // Refine an existing AI play with extra text: regenerate all schemes from the
  // original description + the refinement, replace the AI strokes in place, and
  // keep any hand-drawn marks (strokes with no scheme layer).
  // Shared regenerate: recompose from the play's original source + extra text,
  // replace the AI strokes in place, keep hand-drawn marks (no scheme layer).
  // Turn the standing per-player edits into a prompt block that is re-applied on
  // EVERY regeneration so the coach's edits are never lost (only reworded).
  const buildStickyBlock = (gmap: Record<string, string>) => {
    const bySch: Record<string, string[]> = {};
    Object.entries(gmap || {}).forEach(([k, v]) => {
      if (!v || !v.trim()) return;
      const [sch, id] = k.split(':');
      (bySch[sch] = bySch[sch] || []).push(`- ${dispId(id)}: ${v.trim()}`);
    });
    const parts = (['offense', 'defense', 'counter'] as SchemeKey[])
      .filter(s => bySch[s]?.length)
      .map(s => `${s.toUpperCase()}:\n${bySch[s].join('\n')}`);
    return parts.length
      ? `STANDING PER-PLAYER INSTRUCTIONS (ALWAYS honor these — you may reword them, but never drop the coach's intent):\n${parts.join('\n')}`
      : '';
  };

  // Shared regenerate. `extra` = this-run instructions. persistExtra keeps it in
  // the play's durable source (refinements); otherwise it's transient (formation
  // snapshots). Standing guidance is always re-applied and carried forward.
  const regenerateWith = async (
    extra: string,
    promptNote?: string,
    opts?: { guidanceMap?: Record<string, string>; persistExtra?: boolean; preservePositions?: boolean },
  ) => {
    const b = boards[activeBoardIdx];
    if (!b?.ai) return;
    const gmap = opts?.guidanceMap ?? b.ai.guidance ?? {};
    const baseSource = b.ai.source || b.ai.play_name || '';
    const sticky = buildStickyBlock(gmap);
    const promptToSend = [baseSource, sticky, extra].filter(Boolean).join('\n\n');
    const res = await whiteboardAPI.aiPlay(promptToSend);
    // Minimal-change mode (Players panel): keep every current starting position;
    // take only the new roles + movement so it's a minor edit, like Adapt.
    let finalSchemes = res.schemes;
    if (opts?.preservePositions && b.ai.schemes) {
      finalSchemes = {};
      (['offense', 'defense', 'counter'] as SchemeKey[]).forEach(name => {
        const rs = res.schemes?.[name]; if (!rs) return;
        const cs: any = (b.ai!.schemes as any)?.[name] || {};
        const keepPos = (resArr: any[], curArr: any[]) => (resArr || []).map((u: any) => {
          const cur = (curArr || []).find((x: any) => x.id === u.id);
          return cur ? { ...u, x: cur.x, y: cur.y } : u;
        });
        (finalSchemes as any)[name] = { players: keepPos(rs.players, cs.players), defenders: keepPos(rs.defenders, cs.defenders), actions: rs.actions };
      });
    }
    syncOffenseAcrossSchemes({ schemes: finalSchemes });   // same offense across schemes
    const aiStrokes = remapStrokes(buildPlayStrokes({ ...res, schemes: finalSchemes }), 'half', b.court_type);
    const kept = b.strokes.filter(st => !st.layer);   // hand-drawn marks only
    const newSource = opts?.persistExtra && extra
      ? [baseSource, extra].filter(Boolean).join('\n\n')
      : baseSource;
    const updated: Board = {
      ...b,
      name: res.play_name || b.name,
      strokes: [...kept, ...aiStrokes],
      ai: { play_name: res.play_name ?? b.ai.play_name, key: (res.key ?? []).map((k: any) => ({ n: k.n, text: k.text, from: k.from, to: k.to })), source: newSource, schemes: finalSchemes,
            prompt: [b.ai.prompt, promptNote].filter(Boolean).join('\n'), attachedTitle: b.ai.attachedTitle, guidance: gmap },
    };
    setBoards(prev => { const n = [...prev]; n[activeBoardIdx] = updated; return n; });
    setActiveScheme('offense');
    // Clear only the TRANSIENT field edits — they're now saved in ai.guidance and
    // will still show (and keep being applied) from there.
    setPlayerGuidance({});
    clearPins();   // geometry changed — manual-move locks no longer apply
    saveBoard(activeBoardIdx, updated);
  };

  const refinePlay = async () => {
    const b = boards[activeBoardIdx];
    if (!b?.ai || !refineText.trim()) return;
    setRefining(true);
    try {
      await regenerateWith(`REFINEMENT (update the play): ${refineText.trim()}`, `+ ${refineText.trim()}`, { persistExtra: true });
      setShowRefine(false);
      setRefineText('');
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('whiteboard.couldNotUpdate'));
    } finally {
      setRefining(false);
    }
  };

  // Apply per-player lock/cascade + guidance, then regenerate. Locked players
  // keep their exact court-feet positions; the AI moves the rest around them.
  // Units the Players panel controls for the active scheme: offense/counter
  // control the offensive players; defense controls the defenders (shown D1-D5).
  const guidanceUnits = () => {
    const scheme = boards[activeBoardIdx]?.ai?.schemes?.[activeScheme];
    return (activeScheme === 'defense' ? scheme?.defenders : scheme?.players) ?? [];
  };

  const applyPlayerGuidance = async () => {
    const b = boards[activeBoardIdx];
    const scheme = b?.ai?.schemes?.[activeScheme];
    if (!b?.ai || !scheme) return;
    const units = activeScheme === 'defense' ? (scheme.defenders ?? []) : (scheme.players ?? []);
    // Merge the coach's field edits into the standing guidance map (empty = clear).
    const newGuidance = { ...(b.ai.guidance ?? {}) };
    units.forEach(p => {
      const k = gKey(activeScheme, p.id);
      if (playerGuidance[k] != null) {
        const v = playerGuidance[k].trim();
        if (v) newGuidance[k] = v; else delete newGuidance[k];
      }
    });
    const lockedIds = units.filter(p => lockedPlayers[p.id]).map(p => dispId(p.id));
    if (!lockedIds.length && Object.keys(newGuidance).length === 0) {
      Alert.alert(tr('whiteboard.nothingToApplyTitle'), tr('whiteboard.nothingToApplyMsg'));
      return;
    }
    // Full current formation for EVERY scheme — the AI must keep them all exactly
    // where they are (same side, no mirror); only edited players move.
    const schemesObj = b.ai.schemes ?? {};
    const formationBlocks = (['offense', 'defense', 'counter'] as SchemeKey[])
      .filter(s => schemesObj[s])
      .map(s => {
        const all = [...(schemesObj[s]?.players ?? []), ...(schemesObj[s]?.defenders ?? [])];
        if (!all.length) return '';
        return `${s.toUpperCase()}:\n${all.map(p => `- ${dispId(p.id)} at x=${Math.round(p.x)}, y=${Math.round(p.y)}`).join('\n')}`;
      })
      .filter(Boolean)
      .join('\n\n');
    const extra = [
      'EDIT the existing play — do NOT redraw a new one. Keep ALL THREE schemes (offense, defense, counter) exactly as they are: same side of the floor, NO mirroring or flipping. Start every player from their CURRENT position below and keep them there. Move a player ONLY if a standing per-player instruction applies to them; make minimal adjustments, only to non-locked players, and only if genuinely required to make an instruction work.',
      `CURRENT POSITIONS — keep every player at these exact spots:\n${formationBlocks}`,
      `LOCKED (must not move at all): ${lockedIds.length ? lockedIds.join(', ') : 'none'}`,
    ].join('\n\n');
    setApplyingGuidance(true);
    try {
      await regenerateWith(extra, '+ player lock / guidance', { guidanceMap: newGuidance, persistExtra: false, preservePositions: true });
      setShowPlayers(false);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('whiteboard.couldNotUpdate'));
    } finally {
      setApplyingGuidance(false);
    }
  };

  const textAt = (x: number, y: number): Stroke | null => {
    const strokes = boardsRef.current[activeBoardIdxRef.current]?.strokes ?? [];
    for (let i = strokes.length - 1; i >= 0; i--) {
      const st = strokes[i];
      if (st.type !== 'text' || st.x == null || st.y == null) continue;
      const fs = st.size ?? 16;
      const w = (st.label?.length ?? 1) * fs * 0.62;
      if (x >= st.x - 10 && x <= st.x + w + 10 && y >= st.y - fs - 10 && y <= st.y + 12) return st;
    }
    return null;
  };

  // Nearest orderable arrow to a point — a hand-drawn arrow OR one of the active
  // scheme's action arrows (passes/movements). Returns which one to number.
  const orderAt = (x: number, y: number): { kind: 'hand'; id: string } | { kind: 'action'; idx: number } | null => {
    const b = boardsRef.current[activeBoardIdxRef.current];
    if (!b) return null;
    let best: { kind: 'hand'; id: string } | { kind: 'action'; idx: number } | null = null;
    let bd = 26;
    for (const s of b.strokes) {
      if (s.type !== 'arrow' || s.layer || s.x1 == null || s.y1 == null || s.x2 == null || s.y2 == null) continue;
      const d = distToSeg(x, y, s.x1, s.y1, s.x2, s.y2);
      if (d < bd) { bd = d; best = { kind: 'hand', id: s.id }; }
    }
    const acts = b.ai?.schemes?.[activeSchemeRef.current]?.actions ?? [];
    acts.forEach((a: any, idx: number) => {
      if (!Array.isArray(a.from) || !Array.isArray(a.to)) return;
      const p1 = unitToPx(a.from[0], a.from[1]), p2 = unitToPx(a.to[0], a.to[1]);
      const d = distToSeg(x, y, p1.x, p1.y, p2.x, p2.y);
      if (d < bd) { bd = d; best = { kind: 'action', idx }; }
    });
    return best;
  };
  arrowAtRef.current = orderAt as any;

  // Tap-to-order: give the tapped arrow the next number in the sequence you tap.
  const assignOrder = (target: { kind: 'hand'; id: string } | { kind: 'action'; idx: number }) => {
    const idx = activeBoardIdxRef.current;
    const b = boardsRef.current[idx];
    if (!b) return;
    const next = orderCounterRef.current + 1;
    orderCounterRef.current = next;
    let updated: Board;
    if (target.kind === 'hand') {
      updated = { ...b, strokes: b.strokes.map(s => s.id === target.id ? { ...s, step: next } : s) };
    } else {
      if (!b.ai) return;
      const ai = JSON.parse(JSON.stringify(b.ai));
      const sc = ai.schemes?.[activeSchemeRef.current];
      if (!sc?.actions?.[target.idx]) return;
      sc.actions[target.idx].step = next;
      const keep = b.strokes.filter(st => !st.layer);
      updated = { ...b, ai, strokes: [...keep, ...buildAllStrokes(ai, b.court_type)] };
    }
    setBoards(prev => { const n = [...prev]; n[idx] = updated; return n; });
    saveBoardRef.current(idx, updated);
  };
  assignStepRef.current = assignOrder as any;

  // Clear the order: hand-drawn arrows go back to draw order (no number); AI
  // action arrows go back to the order they were placed (their array order).
  const clearOrder = () => {
    const idx = activeBoardIdx;
    const b = boards[idx];
    if (!b) return;
    orderCounterRef.current = 0;
    let ai = b.ai;
    if (ai) {
      ai = JSON.parse(JSON.stringify(ai));
      const sc = ai.schemes?.[activeScheme];
      if (sc?.actions) sc.actions.forEach((a: any, i: number) => { a.step = i + 1; });
    }
    const cleared = b.strokes.map(s => (s.type === 'arrow' && !s.layer && s.step != null) ? { ...s, step: undefined } : s);
    const updated: Board = ai
      ? { ...b, ai, strokes: [...cleared.filter(st => !st.layer), ...buildAllStrokes(ai, b.court_type)] }
      : { ...b, strokes: cleared };
    setBoards(prev => { const n = [...prev]; n[idx] = updated; return n; });
    saveBoard(idx, updated);
  };

  // Ordered freehand arrows for playback: numbered ones by number (ties = same
  // step), then un-numbered last in draw order (each its own step).
  const freehandSequence = () => {
    const strokes = boards[activeBoardIdx]?.strokes ?? [];
    const handArrows = strokes.filter(s => s.type === 'arrow' && !s.layer && s.x1 != null);
    const numbered = handArrows.filter(s => s.step != null).sort((a, b) => (a.step! - b.step!));
    const unnumbered = handArrows.filter(s => s.step == null);
    const maxStep = numbered.reduce((m, s) => Math.max(m, s.step ?? 0), 0);
    const seq: { s: Stroke; step: number }[] = [
      ...numbered.map(s => ({ s, step: s.step as number })),
      ...unnumbered.map((s, i) => ({ s, step: maxStep + 1 + i })),
    ];
    return seq;
  };
  const freehandMarkers = () => (boards[activeBoardIdx]?.strokes ?? []).filter(s => (s.type === 'circle' || s.type === 'xmark') && !s.layer && s.cx != null);

  const updateTextStroke = (id: string, patch: Partial<Stroke>, save: boolean) => {
    setBoards(prev => {
      const idx = activeBoardIdxRef.current;
      const next = [...prev];
      const updated = {
        ...next[idx],
        strokes: next[idx].strokes.map(st => st.id === id ? { ...st, ...patch } : st),
      };
      next[idx] = updated;
      if (save) saveBoardRef.current(idx, updated);
      return next;
    });
  };

  const deleteSelectedText = () => {
    const id = selectedTextIdRef.current;
    if (!id) return;
    const idx = activeBoardIdxRef.current;
    const b = boardsRef.current[idx];
    if (b) commitStrokes(idx, b.strokes.filter(st => st.id !== id));
    setSelectedTextId(null);
  };

  const resizeSelectedText = (delta: number) => {
    const id = selectedTextIdRef.current;
    if (!id) return;
    const b = boardsRef.current[activeBoardIdxRef.current];
    const st = b?.strokes.find(x => x.id === id);
    if (!st) return;
    const next = Math.min(48, Math.max(10, (st.size ?? 16) + delta));
    updateTextStroke(id, { size: next }, true);
  };

  // Fit the court to the canvas area for the chosen view. Start from the window
  // size (minus header/toolbar estimate) so the court ALWAYS renders instantly;
  // onLayout then refines to the exact measured area. Unknown or legacy
  // court_type values fall back to full court (never NaN -> blank).
  const win = Dimensions.get('window');
  const [avail, setAvail] = useState({ w: win.width, h: Math.max(win.height - 240, 300) });
  // Sync during render, not just in the effect below: commitStrokes and the
  // save queue read this in the same tick they are called.
  boardsRef.current = boards;
  const board  = boards[activeBoardIdx];
  const visFt  = VISIBLE_FT[board?.court_type ?? 'full'] ?? VISIBLE_FT.full;
  const rawScale = avail.w > 20 && avail.h > 20
    ? Math.min((avail.w - 20) / PADDED_FT_W, (avail.h - 20) / vTotalFt(visFt))
    : 0;
  const scale  = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 0;
  const courtW = PADDED_FT_W * scale;
  const courtH = vTotalFt(visFt) * scale;
  // Landscape: rotate the whole court 90° for display and uniformly scale it to
  // fit the wide area. Strokes stay aligned (one transform on the whole wrapper).
  // Drawing is a portrait activity, so hand-draw input is paused in landscape.
  const isLandscape = orientation === 'landscape';
  const landscapeFit = isLandscape && courtW > 0 && courtH > 0
    ? Math.min((avail.w - 12) / courtH, (avail.h - 12) / courtW)
    : 1;

  // Geometry snapshot for the (once-created) pan responder and for saveBoard's
  // canvas-dimension capture.
  const geomRef = useRef({ isLandscape: false, landscapeFit: 1, availW: 0, availH: 0, courtW: 0, courtH: 0 });
  geomRef.current = { isLandscape, landscapeFit, availW: avail.w, availH: avail.h, courtW, courtH };
  // The pan responder is attached to the court WRAPPER, so locationX/locationY
  // are already in the wrapper's local (untransformed) coordinate space — the
  // exact space the strokes are drawn in. That holds in landscape too: the
  // rotate/scale transform is visual only, and the same transform is applied to
  // the SVG we draw into, so a raw local point lands under the finger. No mapping.
  const mapPoint = (lx: number, ly: number) => ({ x: lx, y: ly });
  const mapPointRef = useRef(mapPoint);
  mapPointRef.current = mapPoint;

  useEffect(() => { if (visible && (playbook || gameId)) loadBoards(); }, [visible, gameId, playbook]);

  const loadBoards = async () => {
    setLoading(true);
    try {
      // Never hang on a slow/unreachable API — fall back to a fresh board.
      const data = await Promise.race([
        playbook ? whiteboardAPI.playbookList() : whiteboardAPI.list(gameId),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]);
      if (data.length > 0) {
        setBoards(data.map((b: any) => {
          const parsed = JSON.parse(b.data || '[]');
          return Array.isArray(parsed)
            ? { ...b, strokes: parsed }
            : { ...b, strokes: parsed.strokes ?? [], ai: parsed.ai, canvas: parsed.canvas };
        }));
      } else {
        setBoards([{ name: tr('whiteboard.boardN', { n: 1 }), court_type: 'full', strokes: [] }]);
      }
      setActiveBoardIdx(0);
    } catch {
      setBoards([{ name: tr('whiteboard.boardN', { n: 1 }), court_type: 'full', strokes: [] }]);
    }
    setLoading(false);
  };

  const saveBoardRef = useRef<(idx: number, b: Board) => void>(() => {});
  // A drawing is real work — never lose it silently. If a save fails the board
  // is flagged so the UI can show it and offer a retry.
  const [saveFailed, setSaveFailed] = useState(false);
  const lastSaveRef = useRef<{ idx: number; board: Board } | null>(null);

  // Saves are serialized PER BOARD and coalesced: while one request is in
  // flight, later strokes replace the queued payload instead of racing it.
  // Without this, a brand-new board (no id yet) issues one CREATE per stroke —
  // producing duplicate boards — and out-of-order responses can persist an
  // older stroke set than what is on screen.
  const saveQ = useRef<Map<number, { running: boolean; next: Board | null }>>(new Map());

  const writeBoard = async (idx: number, b: Board) => {
    // Persist the canvas dimensions for this board's court view so the backend
    // can convert hand-drawn pixel strokes back to court-feet when learning the
    // coach's play-style.
    const g = geomRef.current;
    const vf = VISIBLE_FT[b.court_type] ?? VISIBLE_FT.full;
    const sc = Math.min((g.availW - 20) / PADDED_FT_W, (g.availH - 20) / vTotalFt(vf));
    const payload: any = { strokes: b.strokes };
    if (b.ai) payload.ai = b.ai;
    if (Number.isFinite(sc) && sc > 0) payload.canvas = { w: PADDED_FT_W * sc, h: vTotalFt(vf) * sc, type: b.court_type };
    const ds = JSON.stringify(payload);
    if (b.id) {
      await whiteboardAPI.update(b.id, { name: b.name, court_type: b.court_type, data: ds });
    } else {
      const created = playbook
        ? await whiteboardAPI.playbookCreate({ name: b.name, court_type: b.court_type, data: ds })
        : await whiteboardAPI.create(gameId, { name: b.name, court_type: b.court_type, data: ds });
      // Attach the new id to whatever is CURRENT — not to the snapshot this
      // request started with — so strokes drawn during the request survive.
      setBoards(prev => {
        const n = [...prev];
        if (n[idx]) n[idx] = { ...n[idx], id: created.id };
        return n;
      });
    }
  };

  const saveBoard = useCallback(async (idx: number, b: Board) => {
    const slot = saveQ.current.get(idx) ?? { running: false, next: null };
    saveQ.current.set(idx, slot);
    if (slot.running) { slot.next = b; return; }   // coalesce onto the in-flight save
    slot.running = true;
    setSaving(true);
    let cur: Board | null = b;
    while (cur) {
      lastSaveRef.current = { idx, board: cur };
      try {
        await writeBoard(idx, cur);
        setSaveFailed(false);
      } catch {
        setSaveFailed(true);   // surfaced in the UI; the payload stays in lastSaveRef
        break;
      }
      cur = slot.next;
      slot.next = null;
    }
    slot.running = false;
    setSaving(false);
  }, [gameId, playbook]);
  useEffect(() => { saveBoardRef.current = saveBoard; }, [saveBoard]);

  const retrySave = () => {
    const last = lastSaveRef.current;
    if (last) saveBoard(last.idx, last.board);
  };

  const commitStrokes = (idx: number, strokes: Stroke[]) => {
    // Build the next board, set state, then save OUTSIDE the updater — an
    // updater must stay pure (React may invoke it twice in dev/concurrent mode,
    // which would double every request).
    const updated = { ...boardsRef.current[idx], strokes } as Board;
    setBoards(prev => { const n = [...prev]; n[idx] = updated; return n; });
    saveBoard(idx, updated);
  };

  const addNewBoard = () => {
    setBoards(prev => [...prev, { name: tr('whiteboard.boardN', { n: prev.length + 1 }), court_type: 'full', strokes: [] }]);
    setActiveBoardIdx(boards.length);
    setShowBoardList(false);
  };

  // Duplicate a board (fresh id so it saves as a new board, deep-copied strokes).
  const duplicateBoard = (idx: number) => {
    const src = boards[idx];
    if (!src) return;
    const copy: Board = {
      name: tr('whiteboard.copyName', { name: src.name }),
      court_type: src.court_type,
      strokes: src.strokes.map(s => ({ ...s, id: Math.random().toString(36).slice(2) })),
      ai: src.ai ? { ...src.ai, key: src.ai.key.map(k => ({ ...k })) } : undefined,
    };
    const newIdx = boards.length;
    const next = [...boards, copy];
    setBoards(next);
    setActiveBoardIdx(newIdx);
    setShowBoardList(false);
    saveBoard(newIdx, copy);
  };

  const deleteBoard = (idx: number) => {
    const b = boards[idx];
    Alert.alert(tr('whiteboard.deleteBoardTitle'), tr('whiteboard.deleteBoardMsg', { name: b.name }), [
      { text: tr('common.cancel'), style: 'cancel' },
      { text: tr('common.delete'), style: 'destructive', onPress: async () => {
        try {
          if (b.id) await whiteboardAPI.delete(b.id);
        } catch (e: any) {
          // Without this the rejection was unhandled and the board stayed put
          // with no feedback — the coach taps Delete and nothing happens.
          Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('whiteboard.deleteFailed'));
          return;
        }
        setBoards(prev => prev.filter((_, i) => i !== idx));
        setActiveBoardIdx(Math.max(0, idx - 1));
      }},
    ]);
  };

  const undo     = () => { if (board) commitStrokes(activeBoardIdx, board.strokes.slice(0, -1)); };
  const clearAll = () => Alert.alert(tr('whiteboard.clearBoardTitle'), tr('whiteboard.clearBoardMsg'), [
    { text: tr('common.cancel'), style: 'cancel' },
    { text: tr('whiteboard.clear'), style: 'destructive', onPress: () => commitStrokes(activeBoardIdx, []) },
  ]);

  const uid = () => Math.random().toString(36).slice(2);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,

    onPanResponderGrant: (evt) => {
      const { x, y } = mapPointRef.current(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
      startPoint.current = { x, y };
      if (orderModeRef.current) {
        const hit = (arrowAtRef.current as any)(x, y);
        if (hit) (assignStepRef.current as any)(hit);
        return;
      }
      if (toolRef.current === 'move') {
        const hit = hitTestRef.current(x, y);
        if (hit) { dragTargetRef.current = hit; setDragTarget(hit); }
        return;
      }
      if (toolRef.current === 'pen') {
        currentPath.current = `M${x.toFixed(1)},${y.toFixed(1)}`;
      } else if (toolRef.current === 'text') {
        const hit = textAt(x, y);
        if (hit && hit.x != null && hit.y != null) {
          dragRef.current = { id: hit.id, dx: x - hit.x, dy: y - hit.y, wasSelected: hit.id === selectedTextIdRef.current, label: hit.label ?? '' };
          setSelectedTextId(hit.id);
        } else if (selectedTextIdRef.current) {
          setSelectedTextId(null);              // tap empty court: deselect first
        } else {
          setPendingTextPos({ x, y });
          setShowAddText(true);
        }
      }
    },

    onPanResponderMove: (evt) => {
      const { x, y } = mapPointRef.current(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
      if (toolRef.current === 'move') {
        if (dragTargetRef.current) setDragTarget(dt => (dt ? { ...dt, xpx: x, ypx: y } : dt));
        return;
      }
      if (toolRef.current === 'pen') {
        currentPath.current += ` L${x.toFixed(1)},${y.toFixed(1)}`;
        setLivePath(currentPath.current);
      } else if (toolRef.current === 'text' && dragRef.current) {
        const d = dragRef.current;
        updateTextStroke(d.id, { x: x - d.dx, y: y - d.dy }, false);
      }
    },

    onPanResponderRelease: (evt) => {
      const { x: x2, y: y2 } = mapPointRef.current(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
      const { x: x1, y: y1 } = startPoint.current;
      const idx = activeBoardIdxRef.current;
      const tl  = toolRef.current;
      const c   = colorRef.current;

      const push = (stroke: Stroke) => {
        setBoards(prev => {
          const next    = [...prev];
          const updated = { ...next[idx], strokes: [...next[idx].strokes, stroke] };
          next[idx] = updated;
          saveBoardRef.current(idx, updated);
          return next;
        });
      };

      if (tl === 'move') {
        const dt = dragTargetRef.current;
        if (dt) {
          const moved = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) > 8;
          if (!moved && (dt.t === 'action' || dt.t === 'key')) {
            // Tap (no drag) on an arrow end: select it for deletion.
            setSelectedArrow(dt.t === 'action' ? { kind: 'action', scheme: dt.scheme, idx: dt.idx } : { kind: 'key', idx: dt.idx });
          } else {
            dropRef.current(x2, y2);
            setSelectedArrow(null);
          }
        }
        dragTargetRef.current = null;
        setDragTarget(null);
        return;
      }
      if (tl === 'text' && dragRef.current) {
        const d = dragRef.current;
        const moved = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) > 6;
        if (!moved && d.wasSelected) {
          // Second tap on the selected label: edit its text in place.
          setEditingTextId(d.id);
          setTextInput(d.label ?? '');
          setShowAddText(true);
        } else {
          const idx2 = activeBoardIdxRef.current;
          const b = boardsRef.current[idx2];
          if (b) saveBoardRef.current(idx2, b);
        }
        dragRef.current = null;
        return;
      }
      if (tl === 'pen' && currentPath.current) {
        push({ id: uid(), type: 'path', d: currentPath.current, color: c, strokeWidth: STROKE_WIDTH });
        currentPath.current = '';
        setLivePath('');
      } else if (tl === 'circle') {
        const r = Math.sqrt((x2-x1)**2 + (y2-y1)**2) / 2;
        push({ id: uid(), type: 'circle', cx: (x1+x2)/2, cy: (y1+y2)/2, r: Math.max(r, 10), color: c, strokeWidth: STROKE_WIDTH });
      } else if (tl === 'xmark') {
        const size = Math.max(Math.abs(x2-x1), Math.abs(y2-y1)) / 2;
        push({ id: uid(), type: 'xmark', cx: (x1+x2)/2, cy: (y1+y2)/2, size: Math.max(size, 10), color: c, strokeWidth: STROKE_WIDTH });
      } else if (tl === 'arrow') {
        if (Math.sqrt((x2-x1)**2 + (y2-y1)**2) < 5) return;
        // On an AI board, offer to add the drawn arrow to the play as a
        // pass/cut/screen/dribble (or keep it as a plain mark).
        if (boardsRef.current[activeBoardIdxRef.current]?.ai) {
          setPendingArrow({ x1, y1, x2, y2 });
        } else {
          push({ id: uid(), type: 'arrow', x1, y1, x2, y2, color: c, strokeWidth: STROKE_WIDTH });
        }
      } else if (tl === 'arrow_dash') {
        if (Math.sqrt((x2-x1)**2 + (y2-y1)**2) < 5) return;
        // Freehand pass: blue dashed arrow (no type prompt).
        push({ id: uid(), type: 'arrow', x1, y1, x2, y2, color: PASS_BLUE, strokeWidth: STROKE_WIDTH, dash: true });
      }
    },
  })).current;

  const addText = () => {
    if (!textInput.trim()) { setShowAddText(false); setEditingTextId(null); return; }
    if (editingTextId) {
      updateTextStroke(editingTextId, { label: textInput.trim() }, true);
      setTextInput('');
      setShowAddText(false);
      setEditingTextId(null);
      return;
    }
    const id = uid();
    commitStrokes(activeBoardIdx, [...(board?.strokes ?? []), {
      id, type: 'text',
      x: pendingTextPos.x, y: pendingTextPos.y, size: 16,
      label: textInput.trim(), color: colorRef.current, strokeWidth: STROKE_WIDTH,
    }]);
    setTextInput('');
    setShowAddText(false);
    setSelectedTextId(id);
  };

  // Scale + court-feet offset for a given court view (court is bottom-anchored,
  // so the top of the canvas corresponds to court-feet = COURT_FT_L - visibleFt).
  const scaleForType = (type: CourtType) => {
    const visFt = VISIBLE_FT[type] ?? VISIBLE_FT.full;
    const raw = Math.min((avail.w - 20) / PADDED_FT_W, (avail.h - 20) / vTotalFt(visFt));
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  };
  // Court-feet at the top edge of the canvas. Shifted up by the top baseline OOB
  // (full court only) so both baselines sit off the wood edge equally.
  const offsetFtForType = (type: CourtType) => {
    const visFt = VISIBLE_FT[type] ?? VISIBLE_FT.full;
    return (COURT_FT_L - visFt) - topPadFt(visFt);
  };

  // Re-map all strokes from one court view's pixel space into another so a play
  // drawn on (say) half court stays in the same real court location on full/¾.
  const remapStrokes = (strokes: Stroke[], from: CourtType, to: CourtType): Stroke[] => {
    if (from === to) return strokes;
    const sA = scaleForType(from), sB = scaleForType(to);
    const offA = offsetFtForType(from), offB = offsetFtForType(to);
    const mapX = (px?: number) => px == null ? px : (px / sA) * sB;
    const mapY = (px?: number) => px == null ? px : ((px / sA + offA) - offB) * sB;
    const mapSize = (v?: number) => v == null ? v : v * (sB / sA);
    const mapPath = (d?: string) => !d ? d : d.replace(/([-\d.]+)\s+([-\d.]+)/g,
      (_m, a, b) => `${mapX(parseFloat(a))!.toFixed(2)} ${mapY(parseFloat(b))!.toFixed(2)}`);
    return strokes.map(s => ({
      ...s,
      d: mapPath(s.d),
      cx: mapX(s.cx), cy: mapY(s.cy), r: mapSize(s.r), size: mapSize(s.size),
      x1: mapX(s.x1), y1: mapY(s.y1), x2: mapX(s.x2), y2: mapY(s.y2),
      x: mapX(s.x), y: mapY(s.y),
    }));
  };

  const setCourtType = (ct: CourtType) => {
    setBoards(prev => {
      const next    = [...prev];
      const cur     = next[activeBoardIdx];
      const remapped = remapStrokes(cur.strokes, cur.court_type, ct);
      const updated = { ...cur, court_type: ct, strokes: remapped };
      next[activeBoardIdx] = updated;
      saveBoard(activeBoardIdx, updated);
      return next;
    });
  };

  // ── Direct drag (Move tool) ───────────────────────────────────────────────
  // Rebuild ALL AI strokes (players/defenders/actions + key) from feet-data.
  const buildAllStrokes = (ai: any, to: CourtType) =>
    remapStrokes(buildPlayStrokes({ schemes: ai.schemes, key: ai.key ?? [] }), 'half', to);

  // Guarantee the offense is shown IDENTICALLY across schemes: the DEFENSE and
  // COUNTER views reuse the OFFENSE scheme's exact offensive players + positions;
  // DEFENSE also reuses the exact offensive actions (keeping only its own
  // defenders' reactions), so the coach always sees the same offense being
  // defended / countered. Mutates and returns `ai`.
  const syncOffenseAcrossSchemes = (ai: any) => {
    const off = ai?.schemes?.offense;
    if (!off || !Array.isArray(off.players)) return ai;
    const offPlayers = JSON.parse(JSON.stringify(off.players));
    const offActions = JSON.parse(JSON.stringify((off.actions || []).filter((a: any) => String(a.actor || '')[0] !== 'X')));
    (['defense', 'counter'] as SchemeKey[]).forEach(name => {
      const sc = ai.schemes?.[name];
      if (!sc) return;
      sc.players = JSON.parse(JSON.stringify(offPlayers));   // same offensive alignment
      if (name === 'defense') {
        const defActions = (sc.actions || []).filter((a: any) => String(a.actor || '')[0] === 'X');
        sc.actions = [...JSON.parse(JSON.stringify(offActions)), ...defActions];   // exact offense + defenders' reactions
      }
    });
    return ai;
  };

  // Keep an AI play's arrows/markers crisp and aligned to the CURRENT court size.
  // Strokes are stored as pixels baked at the size they were first drawn, so on a
  // different-sized screen (iPad vs phone, rotate, resize, web) they mis-scale and
  // the grab handles drift off. Rebuild them from the feet-data whenever the
  // display scale changes; hand-drawn marks are left untouched.
  const prevScaleRef = useRef({ idx: -1, scale: 0 });
  useEffect(() => {
    if (!scale || loading) return;
    // Do NOT record a scale before the board is loaded. `avail` starts as a
    // window-size ESTIMATE and is refined by onLayout; recording the estimate
    // here made the first real layout look like a resize and rescaled strokes
    // by a ratio derived from a guessed header height.
    if (!boardsRef.current[activeBoardIdx]) return;
    const p = prevScaleRef.current;
    const sameBoard = p.idx === activeBoardIdx && p.scale > 0;
    const ratio = sameBoard ? scale / p.scale : 1;
    if (sameBoard && Math.abs(ratio - 1) < 0.002) { prevScaleRef.current = { idx: activeBoardIdx, scale }; return; }
    prevScaleRef.current = { idx: activeBoardIdx, scale };
    setBoards(prev => {
      const b = prev[activeBoardIdx];
      if (!b) return prev;
      const n = [...prev];
      if (ratio !== 1) {
        // Court resized for the SAME board (e.g. a bar appeared / rotation):
        // rescale the hand-drawn marks so they keep their court location.
        const hand = b.strokes.filter(st => !st.layer).map(st => scaleStroke(st, ratio));
        // Re-stamp `canvas` to the size the strokes are NOW baked at. Leaving it
        // stale made a later board switch compute the same ratio a second time
        // and scale the drawing again (S1^2/S0), which a following stroke then
        // persisted — permanently corrupting the board.
        n[activeBoardIdx] = {
          ...b,
          canvas: { w: courtW, h: courtH, type: b.court_type },
          strokes: b.ai ? [...hand, ...buildAllStrokes(b.ai, b.court_type)] : hand,
        };
      } else {
        // Board switch / first render (e.g. reopening the board later). Hand-drawn
        // strokes were baked at the canvas size they were drawn on; if that size
        // differs from the current court, rescale them so they keep their court
        // location instead of drifting. AI marks rebuild crisp from feet-data.
        const bakedScale = b.canvas && b.canvas.w > 0 ? b.canvas.w / PADDED_FT_W : 0;
        const loadRatio = bakedScale > 0 ? scale / bakedScale : 1;
        const needsHandRescale = Math.abs(loadRatio - 1) > 0.002;
        if (!b.ai && !needsHandRescale) return prev;
        const hand = needsHandRescale
          ? b.strokes.filter(st => !st.layer).map(st => scaleStroke(st, loadRatio))
          : b.strokes.filter(st => !st.layer);
        n[activeBoardIdx] = {
          ...b,
          // Mark strokes as now baked at the current scale so this doesn't re-apply.
          canvas: { w: courtW, h: courtH, type: b.court_type },
          strokes: b.ai ? [...hand, ...buildAllStrokes(b.ai, b.court_type)] : hand,
        };
      }
      return n;
    });
  }, [scale, activeBoardIdx, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Feet↔px for the CURRENT board's court view (same mapping the strokes use).
  const unitToPx = (xf: number, yf: number) => ({ x: (xf + OOB_SIDE_FT) * scale, y: (yf - offsetFtForType(board?.court_type ?? 'full')) * scale });
  const pxToFeet = (xpx: number, ypx: number) => ({
    x: Math.max(-2, Math.min(52, xpx / scale - OOB_SIDE_FT)),
    y: Math.max(48, Math.min(96, ypx / scale + offsetFtForType(board?.court_type ?? 'full'))),
  });
  // Grab-handle position (px) for one end of an arrow. The tail ('from') handle
  // is nudged a little along the shaft so it clears the player it starts on — you
  // can still grab the player. The head ('to') handle sits at the tip.
  const arrowHandlePx = (fromFt: number[], toFt: number[], end: 'from' | 'to') => {
    const a = unitToPx(fromFt[0], fromFt[1]);
    const b = unitToPx(toFt[0], toFt[1]);
    if (end === 'to') return b;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = Math.min(15, len * 0.4);
    return { x: a.x + (dx / len) * off, y: a.y + (dy / len) * off };
  };

  // Nearest draggable thing on the active scheme: a player/defender marker, an
  // action-arrow endpoint, or (when the Key is shown) a key-arrow endpoint.
  const hitTestDrag = (xpx: number, ypx: number): DragTarget | null => {
    const ai = boards[activeBoardIdx]?.ai;
    if (!ai) return null;
    const cands: { d: number; target: DragTarget }[] = [];
    // `bias` shrinks a candidate's effective distance so it wins ties — arrow
    // ENDS beat the player sitting under them, so you can bend an arrow without
    // grabbing the player.
    const consider = (px: number, py: number, target: DragTarget, r: number, bias = 0) => {
      const d = Math.hypot(px - xpx, py - ypx);
      if (d < r) cands.push({ d: d - bias, target });
    };
    const sc = ai.schemes?.[activeScheme];
    if (sc) {
      (sc.players ?? []).forEach((u: any) => { const p = unitToPx(u.x, u.y); consider(p.x, p.y, { t: 'unit', scheme: activeScheme, id: u.id, kind: 'O', xpx: p.x, ypx: p.y }, 24); });
      (sc.defenders ?? []).forEach((u: any) => { const p = unitToPx(u.x, u.y); consider(p.x, p.y, { t: 'unit', scheme: activeScheme, id: u.id, kind: 'X', xpx: p.x, ypx: p.y }, 24); });
      // Action arrows: BOTH ends draggable — grab the head to redirect, or the
      // tail (its handle sits just off the player) to move where it starts.
      (sc.actions ?? []).forEach((a: any, idx: number) => {
        if (!Array.isArray(a.from) || !Array.isArray(a.to)) return;
        (['from', 'to'] as const).forEach(end => {
          const h = arrowHandlePx(a.from, a.to, end);
          consider(h.x, h.y, { t: 'action', scheme: activeScheme, idx, end, xpx: h.x, ypx: h.y }, 18, 10);
        });
      });
    }
    if (showKey) {
      (ai.key ?? []).forEach((k: any, idx: number) => {
        (['from', 'to'] as const).forEach(end => {
          const pt = k[end]; if (!Array.isArray(pt)) return;
          const p = unitToPx(pt[0], pt[1]); consider(p.x, p.y, { t: 'key', idx, end, xpx: p.x, ypx: p.y }, 22, 12);
        });
      });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.d - b.d);
    return cands[0].target;
  };
  hitTestRef.current = hitTestDrag;

  // Commit a dropped drag target: write the new feet coords, re-attach a moved
  // player's own arrows, rebuild all strokes locally, and record a lock ("pin").
  const commitDrag = (xpx: number, ypx: number) => {
    const dt = dragTargetRef.current;
    const b = boards[activeBoardIdx];
    if (!dt || !b?.ai) return;
    const { x: xft, y: yft } = pxToFeet(xpx, ypx);
    const ai = JSON.parse(JSON.stringify(b.ai));
    if (dt.t === 'unit') {
      const scm = ai.schemes?.[dt.scheme]; if (!scm) return;
      const arr = dt.kind === 'X' ? (scm.defenders ?? []) : (scm.players ?? []);
      const unit = arr.find((u: any) => u.id === dt.id); if (!unit) return;
      const oldX = unit.x, oldY = unit.y; unit.x = xft; unit.y = yft;
      const near = (pt: any, X: number, Y: number) => Array.isArray(pt) && Math.abs(pt[0] - X) < 2 && Math.abs(pt[1] - Y) < 2;
      (scm.actions ?? []).forEach((a: any) => {
        if (a.actor === dt.id && near(a.from, oldX, oldY)) a.from = [xft, yft];
        if (near(a.to, oldX, oldY)) a.to = [xft, yft];
      });
      pinsRef.current.units.add(`${dt.scheme}:${dt.id}`);
    } else if (dt.t === 'action') {
      const a = ai.schemes?.[dt.scheme]?.actions?.[dt.idx]; if (!a) return;
      a[dt.end] = [xft, yft];
      pinsRef.current.actions.add(`${dt.scheme}:${dt.idx}`);
    } else if (dt.t === 'key') {
      const k = ai.key?.[dt.idx]; if (!k) return;
      k[dt.end] = [xft, yft];
      pinsRef.current.keys.add(dt.idx);
    }
    syncOffenseAcrossSchemes(ai);   // keep the offense mirrored into defense/counter
    const keep = b.strokes.filter(st => !st.layer);   // hand-drawn only; AI strokes fully rebuilt
    const updated: Board = { ...b, strokes: [...keep, ...buildAllStrokes(ai, b.court_type)], ai };
    setBoards(prev => { const n = [...prev]; n[activeBoardIdx] = updated; return n; });
    saveBoard(activeBoardIdx, updated);
    setPinCount(pinsRef.current.units.size + pinsRef.current.actions.size + pinsRef.current.keys.size);
  };
  dropRef.current = commitDrag;

  // Delete the tapped arrow (an action movement/pass, or a key arrow). The change
  // is reflected in the play so Adapt re-solves around it.
  const deleteSelectedArrow = () => {
    const sel = selectedArrow;
    const b = boards[activeBoardIdx];
    if (!sel || !b?.ai) return;
    const ai = JSON.parse(JSON.stringify(b.ai));
    if (sel.kind === 'action') {
      const scm = ai.schemes?.[sel.scheme];
      if (scm?.actions && sel.idx < scm.actions.length) scm.actions.splice(sel.idx, 1);
    } else if (ai.key && sel.idx < ai.key.length) {
      ai.key.splice(sel.idx, 1);
    }
    syncOffenseAcrossSchemes(ai);   // removing an offensive action mirrors into defense
    const keep = b.strokes.filter(st => !st.layer);
    const updated: Board = { ...b, strokes: [...keep, ...buildAllStrokes(ai, b.court_type)], ai };
    setBoards(prev => { const n = [...prev]; n[activeBoardIdx] = updated; return n; });
    saveBoard(activeBoardIdx, updated);
    setSelectedArrow(null);
    setPinCount(c => c + 1);   // a change worth adapting
  };
  deleteArrowRef.current = deleteSelectedArrow;

  // Add the pending drawn arrow to the active scheme as a movement of the chosen
  // kind. Actor = the nearest player/defender to where the arrow starts.
  const addPendingAsAction = (kind: 'pass' | 'cut' | 'screen' | 'dribble') => {
    const p = pendingArrow;
    const b = boards[activeBoardIdx];
    if (!p || !b?.ai) { setPendingArrow(null); return; }
    const fromFt = pxToFeet(p.x1, p.y1);
    const toFt = pxToFeet(p.x2, p.y2);
    const ai = JSON.parse(JSON.stringify(b.ai));
    const scm = ai.schemes[activeScheme] || (ai.schemes[activeScheme] = { players: [], defenders: [], actions: [] });
    const units = [...(scm.players ?? []), ...(scm.defenders ?? [])];
    let actor = '', bestD = Infinity;
    units.forEach((u: any) => { const d = Math.hypot(u.x - fromFt.x, u.y - fromFt.y); if (d < bestD) { bestD = d; actor = u.id; } });
    const maxStep = (scm.actions ?? []).reduce((m: number, a: any) => Math.max(m, a.step || 1), 0);
    scm.actions = [...(scm.actions ?? []), { actor, kind, from: [fromFt.x, fromFt.y], to: [toFt.x, toFt.y], step: maxStep + 1 }];
    syncOffenseAcrossSchemes(ai);   // a new offensive action mirrors into defense
    const keep = b.strokes.filter(st => !st.layer);
    const updated: Board = { ...b, ai, strokes: [...keep, ...buildAllStrokes(ai, b.court_type)] };
    setBoards(prev => { const n = [...prev]; n[activeBoardIdx] = updated; return n; });
    saveBoard(activeBoardIdx, updated);
    setPendingArrow(null);
    setPinCount(c => c + 1);
  };
  const keepPendingAsMark = () => {
    const p = pendingArrow;
    if (!p) return;
    const b = boards[activeBoardIdx];
    if (b) commitStrokes(activeBoardIdx, [...b.strokes, { id: uid(), type: 'arrow', x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, color: colorRef.current, strokeWidth: STROKE_WIDTH }]);
    setPendingArrow(null);
  };

  // Re-solve the active scheme around the coach's manual moves. Locked pieces
  // stay put; the rest of the offense AND defense reposition/redraw to fit, and
  // the roles + key refresh.
  const adaptPlay = async () => {
    const b = boards[activeBoardIdx];
    const scm = b?.ai?.schemes?.[activeScheme];
    if (!b?.ai || !scm) return;
    const ai = b.ai;
    const pins = pinsRef.current;
    const lockedUnits = [...(scm.players ?? []), ...(scm.defenders ?? [])]
      .filter((u: any) => pins.units.has(`${activeScheme}:${u.id}`))
      .map((u: any) => ({ id: u.id, x: u.x, y: u.y }));
    const lockedActions = (scm.actions ?? [])
      .map((a: any, idx: number) => ({ a, idx }))
      .filter(({ idx }) => pins.actions.has(`${activeScheme}:${idx}`))
      .map(({ a }) => ({ actor: a.actor, kind: a.kind, from: a.from, to: a.to }));
    const lockedKeys = (ai.key ?? [])
      .map((k: any, idx: number) => ({ k, idx }))
      .filter(({ idx }) => pins.keys.has(idx))
      .map(({ k }) => ({ from: k.from, to: k.to }));
    // Editing a scheme cascades to the schemes that depend on it: offense →
    // defense → counter. Downstream schemes re-solve; the edited one keeps its
    // starting positions.
    const order: SchemeKey[] = ['offense', 'defense', 'counter'];
    const downstream = order.slice(order.indexOf(activeScheme) + 1).filter(sname => ai.schemes?.[sname]);
    setAdapting(true);
    try {
      const res = await whiteboardAPI.adaptPlay({
        edited: activeScheme,
        downstream,
        schemes: ai.schemes,
        key: ai.key ?? [],
        locked: { units: lockedUnits, actions: lockedActions, keys: lockedKeys },
        source: ai.source ?? '',
      });
      setBoards(prev => {
        const n = [...prev];
        const cur = n[activeBoardIdx];
        if (!cur?.ai) return prev;
        const newAi = JSON.parse(JSON.stringify(cur.ai));
        const resSchemes = res?.schemes || {};
        // Edited scheme: hard-preserve starting positions — keep every x,y, pull
        // in only the updated role text and the (minimally changed) action arrows.
        if (resSchemes[activeScheme]) {
          const rs = resSchemes[activeScheme];
          const curScm = newAi.schemes?.[activeScheme] || {};
          const mergeRoles = (curArr: any[], resArr: any[]) => (curArr || []).map((u: any) => {
            const r = (resArr || []).find((x: any) => x.id === u.id);
            return r && r.role ? { ...u, role: r.role } : u;   // keep x,y
          });
          newAi.schemes[activeScheme] = {
            players: mergeRoles(curScm.players, rs.players),
            defenders: mergeRoles(curScm.defenders, rs.defenders),
            actions: Array.isArray(rs.actions) ? rs.actions : (curScm.actions ?? []),
          };
        }
        // Downstream schemes: take the re-solved version wholesale (they react).
        downstream.forEach(sname => { if (resSchemes[sname]) newAi.schemes[sname] = resSchemes[sname]; });
        if (res?.key?.length) newAi.key = res.key.map((k: any) => ({ n: k.n, text: k.text, from: k.from, to: k.to }));
        syncOffenseAcrossSchemes(newAi);   // defense/counter show the exact same offense
        const keep = cur.strokes.filter((st: Stroke) => !st.layer);
        const updated: Board = { ...cur, ai: newAi, strokes: [...keep, ...buildAllStrokes(newAi, cur.court_type)] };
        n[activeBoardIdx] = updated;
        saveBoard(activeBoardIdx, updated);
        return n;
      });
      clearPins();
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('whiteboard.couldNotAdapt'));
    } finally {
      setAdapting(false);
    }
  };

  // Animate the current scheme step by step (same step = together): each actor
  // marker travels its path while its arrow draws; passes send a ball.
  const playScheme = () => {
    const b = boards[activeBoardIdx];
    const scheme = b?.ai?.schemes?.[activeScheme];
    const actions = scheme?.actions ?? [];
    const steps = [...new Set(actions.map(a => a.step ?? 1))].sort((x, y) => x - y);
    if (steps.length === 0) return;
    animCancel.current = false;
    setAnimDone(false);
    setAnimating(true);
    let i = 0;
    const runStep = () => {
      if (animCancel.current) { setAnimating(false); return; }
      setAnimStep(steps[i]);
      drawProgress.setValue(0);
      Animated.timing(drawProgress, { toValue: 1, duration: 750, useNativeDriver: false }).start(({ finished }) => {
        if (!finished || animCancel.current) { setAnimating(false); return; }
        i += 1;
        if (i < steps.length) setTimeout(runStep, 250);
        else { setAnimating(false); setAnimDone(false); }   // return to the START view
      });
    };
    runStep();
  };
  // Reset animation when switching schemes/boards.
  useEffect(() => { animCancel.current = true; setAnimating(false); setAnimDone(false); }, [activeScheme, activeBoardIdx]);

  // Play the FREEHAND drawing: run the hand-drawn arrows in order — a player
  // (circle/X) whose spot an arrow starts on slides along it; a blue dashed arrow
  // sends a ball. On an unnamed board, review + auto-name it when done.
  const playFreehand = () => {
    const seq = freehandSequence();
    if (!seq.length) return;
    const steps = [...new Set(seq.map(x => x.step))].sort((a, b) => a - b);
    animCancel.current = false;
    setFreehandDone(false);
    setFreehandPlaying(true);
    let i = 0;
    const runStep = () => {
      if (animCancel.current) { setFreehandPlaying(false); return; }
      setAnimStep(steps[i]);
      drawProgress.setValue(0);
      Animated.timing(drawProgress, { toValue: 1, duration: 800, useNativeDriver: false }).start(({ finished }) => {
        if (!finished || animCancel.current) { setFreehandPlaying(false); return; }
        i += 1;
        if (i < steps.length) setTimeout(runStep, 260);
        else { setFreehandPlaying(false); setFreehandDone(true); maybeAutoName(); }
      });
    };
    runStep();
  };
  useEffect(() => { setFreehandPlaying(false); setFreehandDone(false); }, [activeBoardIdx]);

  const renderStroke = (s: Stroke) => {
    const op = s.opacity ?? 1;
    if (s.type === 'path') {
      return <Path key={s.id} d={s.d} stroke={s.color} strokeWidth={s.strokeWidth} opacity={op}
                   strokeDasharray={s.dash ? '7,6' : undefined}
                   fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    }
    if (s.type === 'circle') {
      return <Circle key={s.id} cx={s.cx} cy={s.cy} r={s.r} opacity={op}
                     strokeDasharray={s.dash ? '7,6' : undefined}
                     stroke={s.color} strokeWidth={s.strokeWidth} fill="none" />;
    }
    if (s.type === 'xmark' && s.cx != null && s.cy != null && s.size != null) {
      return (
        <G key={s.id} opacity={op}>
          <Line x1={s.cx - s.size} y1={s.cy - s.size} x2={s.cx + s.size} y2={s.cy + s.size}
                stroke={s.color} strokeWidth={s.strokeWidth} strokeLinecap="round" />
          <Line x1={s.cx + s.size} y1={s.cy - s.size} x2={s.cx - s.size} y2={s.cy + s.size}
                stroke={s.color} strokeWidth={s.strokeWidth} strokeLinecap="round" />
        </G>
      );
    }
    if (s.type === 'arrow' && s.x1 != null && s.y1 != null && s.x2 != null && s.y2 != null) {
      const dx = s.x2-s.x1, dy = s.y2-s.y1;
      const len = Math.sqrt(dx*dx + dy*dy);
      if (len < 5) return null;
      const ux = dx/len, uy = dy/len, as = 12, px = -uy, py = ux;
      const tip = { x: s.x2, y: s.y2 };
      const b1  = { x: s.x2 - ux*as + px*as*0.5, y: s.y2 - uy*as + py*as*0.5 };
      const b2  = { x: s.x2 - ux*as - px*as*0.5, y: s.y2 - uy*as - py*as*0.5 };
      // Shaft stops at the arrowhead's base so the line never pokes past the tip.
      const shaftEnd = { x: s.x2 - ux*as*0.85, y: s.y2 - uy*as*0.85 };
      return (
        <G key={s.id} opacity={op}>
          <Line x1={s.x1} y1={s.y1} x2={shaftEnd.x} y2={shaftEnd.y} stroke={s.color} strokeWidth={s.strokeWidth} strokeLinecap="round"
                strokeDasharray={s.dash ? '8,6' : undefined} />
          <Path d={`M${tip.x},${tip.y} L${b1.x},${b1.y} L${b2.x},${b2.y} Z`} fill={s.color} />
        </G>
      );
    }
    if (s.type === 'text') {
      const fs = s.size ?? 16;
      const selected = s.id === selectedTextId;
      const w = (s.label?.length ?? 1) * fs * 0.62;
      return (
        <G key={s.id} opacity={op}>
          {selected && s.x != null && s.y != null && (
            <Rect x={s.x - 6} y={s.y - fs - 4} width={w + 12} height={fs + 12}
                  stroke={s.color} strokeWidth={1} strokeDasharray="4,3" fill="none" rx={4} />
          )}
          <SvgText x={s.x} y={s.y} fill={s.color} fontSize={fs} fontWeight="bold">{s.label}</SvgText>
        </G>
      );
    }
    return null;
  };

  // An arrow that visibly "draws itself" from start to arrowhead (playback).
  const renderAnimatedArrow = (s: Stroke) => {
    if (s.x1 == null || s.y1 == null || s.x2 == null || s.y2 == null) return null;
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 5) return null;
    const ux = dx / len, uy = dy / len, as = 12, px = -uy, py = ux;
    const tip = { x: s.x2, y: s.y2 };
    const b1 = { x: s.x2 - ux * as + px * as * 0.5, y: s.y2 - uy * as + py * as * 0.5 };
    const b2 = { x: s.x2 - ux * as - px * as * 0.5, y: s.y2 - uy * as - py * as * 0.5 };
    const shaftEnd = { x: s.x2 - ux * as * 0.85, y: s.y2 - uy * as * 0.85 };
    const shaftLen = Math.max(len - as * 0.85, 0.1);
    const dashoffset = drawProgress.interpolate({ inputRange: [0, 1], outputRange: [shaftLen, 0] });
    const headOpacity = drawProgress.interpolate({ inputRange: [0.75, 1], outputRange: [0, 1], extrapolate: 'clamp' });
    return (
      <G key={s.id}>
        <AnimatedLine x1={s.x1} y1={s.y1} x2={shaftEnd.x} y2={shaftEnd.y} stroke={s.color} strokeWidth={s.strokeWidth}
          strokeLinecap="round" strokeDasharray={`${shaftLen},${shaftLen}`} strokeDashoffset={dashoffset as any} />
        <AnimatedG opacity={headOpacity as any}>
          <Path d={`M${tip.x},${tip.y} L${b1.x},${b1.y} L${b2.x},${b2.y} Z`} fill={s.color} />
        </AnimatedG>
      </G>
    );
  };

  // The full play as a diagram, animated: each actor marker travels its path,
  // arrows draw in, and passes send a ball — driven from the structured scheme
  // data (feet coords) so it also survives court-type toggles.
  const renderAnimatedScheme = () => {
    const b = boards[activeBoardIdx];
    const scheme = b?.ai?.schemes?.[activeScheme];
    if (!scheme) return [];
    const sc = scaleForType(b!.court_type);
    const offFt = offsetFtForType(b!.court_type);
    const px = (fx: number, fy: number) => ({ x: (fx + OOB_SIDE_FT) * sc, y: (fy - offFt) * sc });
    const actions = (scheme.actions ?? []).slice().sort((a, c) => (a.step ?? 1) - (c.step ?? 1));
    const steps = [...new Set(actions.map(a => a.step ?? 1))].sort((x, y) => x - y);
    const maxStep = steps.length ? steps[steps.length - 1] : 0;
    const curStep = animDone ? maxStep + 1 : animStep;
    const OINK = '#141414', XRED = '#C0392B', BALL = '#E67E22';
    const els: any[] = [];

    // Markers — offense (circles) and defense (xmarks), with their labels.
    const markers = [
      ...(scheme.players ?? []).map(p => ({ ...p, kind: 'O' as const })),
      ...(scheme.defenders ?? []).map(p => ({ ...p, kind: 'X' as const })),
    ];
    markers.forEach(m => {
      const moves = actions.filter(a => a.actor === m.id && a.kind !== 'pass');
      let baseFt = { x: m.x, y: m.y };
      for (const mv of moves) if ((mv.step ?? 1) < curStep) baseFt = { x: mv.to[0], y: mv.to[1] };
      const curMove = moves.find(mv => (mv.step ?? 1) === curStep);
      const at = px(baseFt.x, baseFt.y);
      const shape = m.kind === 'O'
        ? (<><Circle cx={at.x} cy={at.y} r={13} stroke={OINK} strokeWidth={3} fill="none" />
             <SvgText x={at.x - 8} y={at.y + 5} fill={OINK} fontSize={13} fontWeight="bold">{m.id}</SvgText></>)
        : (<><Line x1={at.x - 10} y1={at.y - 10} x2={at.x + 10} y2={at.y + 10} stroke={XRED} strokeWidth={3} strokeLinecap="round" />
             <Line x1={at.x + 10} y1={at.y - 10} x2={at.x - 10} y2={at.y + 10} stroke={XRED} strokeWidth={3} strokeLinecap="round" />
             <SvgText x={at.x + 12} y={at.y + 5} fill={XRED} fontSize={12} fontWeight="bold">{dispId(m.id)}</SvgText></>);
      if (curMove) {
        const to = px(curMove.to[0], curMove.to[1]);
        const tx = drawProgress.interpolate({ inputRange: [0, 1], outputRange: [0, to.x - at.x] });
        const ty = drawProgress.interpolate({ inputRange: [0, 1], outputRange: [0, to.y - at.y] });
        els.push(<AnimatedG key={`m${m.id}`} translateX={tx as any} translateY={ty as any}>{shape}</AnimatedG>);
      } else {
        els.push(<G key={`m${m.id}`}>{shape}</G>);
      }
    });

    // Actions — arrows draw in; balls fly on passes.
    actions.forEach((a, i) => {
      const st = a.step ?? 1;
      if (st > curStep) return;
      const f = px(a.from[0], a.from[1]), tt = px(a.to[0], a.to[1]);
      const pseudo: Stroke = { id: `act${i}`, type: 'arrow', x1: f.x, y1: f.y, x2: tt.x, y2: tt.y,
        color: a.kind === 'pass' ? '#1F6F9B' : OINK, strokeWidth: 3, dash: a.kind === 'pass' };
      els.push(st < curStep ? renderStroke(pseudo) : renderAnimatedArrow(pseudo));
      if (a.kind === 'pass' && st === curStep) {
        const tx = drawProgress.interpolate({ inputRange: [0, 1], outputRange: [0, tt.x - f.x] });
        const ty = drawProgress.interpolate({ inputRange: [0, 1], outputRange: [0, tt.y - f.y] });
        els.push(<AnimatedG key={`ball${i}`} translateX={tx as any} translateY={ty as any}>
          <Circle cx={f.x} cy={f.y} r={6} fill={BALL} /></AnimatedG>);
      }
    });
    return els;
  };

  // Court strokes with playback awareness. Idle = static strokes. Playing/Done =
  // hand-drawn + key stay static, the active scheme animates from its data.
  const renderCourtStrokes = () => {
    const b = boards[activeBoardIdx];
    const strokes = b?.strokes ?? [];
    const freehandMode = freehandPlaying || freehandDone;
    if (freehandMode) {
      // Static: scheme context + hand-drawn text/paths. The hand-drawn arrows and
      // markers are animated by renderFreehandPlay().
      const statics = strokes
        .filter(st => st.layer ? (st.layer === activeScheme || (showKey && st.layer === 'key'))
                               : !(st.type === 'arrow' || st.type === 'circle' || st.type === 'xmark'))
        .map(renderStroke);
      return [...statics, ...renderFreehandPlay()];
    }
    const animMode = (animating || animDone) && !!b?.ai?.schemes?.[activeScheme];
    if (!animMode) {
      // On the DEFENSE view, ghost the offensive elements so the coach sees the
      // offense the defenders are reacting to, with the defense solid on top.
      const ghost = activeScheme === 'defense';
      return strokes
        .filter(st => !st.layer || st.layer === activeScheme || (showKey && st.layer === 'key'))
        .map(st => renderStroke(ghost && st.layer === 'defense' && st.side === 'off' ? { ...st, opacity: 0.28 } : st));
    }
    const statics = strokes
      .filter(st => !st.layer || (showKey && st.layer === 'key'))
      .map(renderStroke);
    return [...statics, ...renderAnimatedScheme()];
  };

  // Freehand playback: hand-drawn arrows run in order; a player (circle/X) whose
  // spot an arrow starts on slides along it; a dashed arrow sends a ball.
  const renderFreehandPlay = () => {
    const seq = freehandSequence();
    const markers = freehandMarkers();
    const steps = [...new Set(seq.map(x => x.step))].sort((a, b) => a - b);
    const maxStep = steps.length ? steps[steps.length - 1] : 0;
    const curStep = freehandDone ? maxStep + 1 : animStep;
    const BALL = '#E67E22';
    const pos: Record<string, { x: number; y: number }> = {};
    markers.forEach(m => { pos[m.id] = { x: m.cx!, y: m.cy! }; });
    const moverOf = (s: Stroke): string | null => {
      let mv: string | null = null, bd = 34;
      for (const m of markers) { const p = pos[m.id]; const d = Math.hypot(p.x - s.x1!, p.y - s.y1!); if (d < bd) { bd = d; mv = m.id; } }
      return mv;
    };
    // Settle marker positions for steps before the current one.
    for (const st of steps) {
      if (st >= curStep) break;
      seq.filter(x => x.step === st).forEach(({ s }) => {
        if (s.dash) return;
        const mv = moverOf(s);
        if (mv) pos[mv] = { x: s.x2!, y: s.y2! };
      });
    }
    const active: Record<string, Stroke> = {};
    seq.filter(x => x.step === curStep).forEach(({ s }) => {
      if (s.dash) return;
      const mv = moverOf(s);
      if (mv && !active[mv]) active[mv] = s;
    });
    const els: any[] = [];
    markers.forEach(m => {
      const at = pos[m.id];
      const mvArrow = active[m.id];
      if (mvArrow) {
        const tx = drawProgress.interpolate({ inputRange: [0, 1], outputRange: [0, mvArrow.x2! - at.x] });
        const ty = drawProgress.interpolate({ inputRange: [0, 1], outputRange: [0, mvArrow.y2! - at.y] });
        els.push(<AnimatedG key={`fm${m.id}`} translateX={tx as any} translateY={ty as any}>{renderStroke({ ...m, cx: at.x, cy: at.y })}</AnimatedG>);
      } else {
        els.push(<G key={`fm${m.id}`}>{renderStroke({ ...m, cx: at.x, cy: at.y })}</G>);
      }
    });
    seq.forEach(({ s, step }, i) => {
      if (step > curStep) return;
      if (step < curStep) { els.push(renderStroke({ ...s, id: `fa${i}` })); return; }
      els.push(renderAnimatedArrow({ ...s, id: `fa${i}` }));
      if (s.dash) {
        const tx = drawProgress.interpolate({ inputRange: [0, 1], outputRange: [0, s.x2! - s.x1!] });
        const ty = drawProgress.interpolate({ inputRange: [0, 1], outputRange: [0, s.y2! - s.y1!] });
        els.push(<AnimatedG key={`fb${i}`} translateX={tx as any} translateY={ty as any}><Circle cx={s.x1} cy={s.y1} r={6} fill={BALL} /></AnimatedG>);
      }
    });
    return els;
  };

  // Number badges: on sequenced freehand arrows (always), and on the active
  // scheme's action arrows while ordering (so you can re-sequence passes/moves).
  const renderStepBadges = () => {
    if (freehandPlaying || freehandDone || animating || animDone) return null;
    const b = boards[activeBoardIdx];
    const els: React.ReactElement[] = [];
    const badge = (key: string, x: number, y: number, n: any) => els.push(
      <G key={key}>
        <Circle cx={x} cy={y} r={9} fill="#141414" opacity={0.9} />
        <SvgText x={x} y={y + 4} fill="#FFFFFF" fontSize={11} fontWeight="bold" textAnchor="middle">{String(n)}</SvgText>
      </G>
    );
    (b?.strokes ?? []).filter(s => s.type === 'arrow' && !s.layer && s.step != null && s.x1 != null)
      .forEach(s => badge(`sb${s.id}`, (s.x1! + s.x2!) / 2, (s.y1! + s.y2!) / 2, s.step));
    if (orderMode) {
      (b?.ai?.schemes?.[activeScheme]?.actions ?? []).forEach((a: any, i: number) => {
        if (!Array.isArray(a.from) || !Array.isArray(a.to)) return;
        const p1 = unitToPx(a.from[0], a.from[1]), p2 = unitToPx(a.to[0], a.to[1]);
        badge(`ab${i}`, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, a.step ?? i + 1);
      });
    }
    return els;
  };

  // On finishing a freehand play, if the board isn't named yet, have the AI
  // review the drawn play and name it (which saves the board).
  const maybeAutoName = async () => {
    const b = boards[activeBoardIdx];
    if (!b) return;
    const unnamed = !b.name || /^Board \d+$/i.test(b.name) || /^AI Play/i.test(b.name);
    const seq = freehandSequence();
    if (!unnamed || !seq.length) return;
    const off = offsetFtForType(b.court_type);
    const toFt = (px: number, py: number) => ({ x: +(px / scale - OOB_SIDE_FT).toFixed(1), y: +(py / scale + off).toFixed(1) });
    const markers = freehandMarkers().map(m => ({ kind: m.type === 'circle' ? 'O' : 'X', ...toFt(m.cx!, m.cy!) }));
    const arrows = seq.map(({ s, step }) => { const a = toFt(s.x1!, s.y1!); const c = toFt(s.x2!, s.y2!); return { step, kind: s.dash ? 'pass' : 'move', from: [a.x, a.y], to: [c.x, c.y] }; });
    const labels = (boards[activeBoardIdx]?.strokes ?? []).filter(s => s.type === 'text' && !s.layer && s.label).map(s => s.label);
    try {
      const res = await whiteboardAPI.nameFreehand({ markers, arrows, labels });
      if (res?.name) {
        setBoards(prev => {
          const n = [...prev]; const cur = n[activeBoardIdx]; if (!cur) return prev;
          const updated = { ...cur, name: res.name };
          n[activeBoardIdx] = updated; saveBoard(activeBoardIdx, updated); return n;
        });
        if (res.read) Alert.alert(res.name, res.read);
      }
    } catch { /* naming is best-effort */ }
  };

  // Small grab handles at the draggable arrow ends (Move tool only) so the coach
  // can see where to grab to bend an arrow without moving the player.
  const renderDragHandles = () => {
    const ai = boards[activeBoardIdx]?.ai;
    if (tool !== 'move' || !ai || animating || animDone) return null;
    const els: React.ReactElement[] = [];
    const handle = (key: string, xf: number, yf: number, color: string) => {
      const p = unitToPx(xf, yf);
      els.push(<Circle key={key} cx={p.x} cy={p.y} r={7} fill="#FFFFFF" stroke={color} strokeWidth={2.5} opacity={0.95} />);
    };
    (ai.schemes?.[activeScheme]?.actions ?? []).forEach((a: any, idx: number) => {
      if (!Array.isArray(a.from) || !Array.isArray(a.to)) return;
      const sel = selectedArrow?.kind === 'action' && selectedArrow.scheme === activeScheme && selectedArrow.idx === idx;
      const color = sel ? '#C0392B' : '#141414';
      const fill = sel ? '#C0392B' : '#FFFFFF';
      const hf = arrowHandlePx(a.from, a.to, 'from');
      els.push(<Circle key={`af${idx}`} cx={hf.x} cy={hf.y} r={6} fill={fill} stroke={color} strokeWidth={2.5} opacity={0.9} />);
      const ht = unitToPx(a.to[0], a.to[1]);
      els.push(<Circle key={`ah${idx}`} cx={ht.x} cy={ht.y} r={7} fill={fill} stroke={color} strokeWidth={2.5} opacity={0.95} />);
    });
    if (showKey) (ai.key ?? []).forEach((k: any, idx: number) => {
      if (Array.isArray(k.from)) handle(`kf${idx}`, k.from[0], k.from[1], '#1F6F9B');
      if (Array.isArray(k.to)) handle(`kt${idx}`, k.to[0], k.to[1], '#1F6F9B');
    });
    return els;
  };

  // Compact controls that FLOAT over the top of the court (so the court never
  // resizes when they show/hide, and we keep maximum court vision).
  const hasFreehandArrows = (board?.strokes ?? []).some(s => s.type === 'arrow' && !s.layer);
  const floatingControls = (
    <View style={styles.floatWrap} pointerEvents="box-none">
      {selectedTextId && (
        <View style={styles.floatBar}>
          <TouchableOpacity style={styles.textCtrlBtn} onPress={() => {
            const b = boardsRef.current[activeBoardIdxRef.current];
            const st = b?.strokes.find(x => x.id === selectedTextIdRef.current);
            if (st) { setEditingTextId(st.id); setTextInput(st.label ?? ''); setShowAddText(true); }
          }}>
            <Ionicons name="pencil" size={15} color={t.ink} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.textCtrlBtn} onPress={() => resizeSelectedText(-2)}><Text style={styles.textCtrlBtnLabel}>A−</Text></TouchableOpacity>
          <TouchableOpacity style={styles.textCtrlBtn} onPress={() => resizeSelectedText(2)}><Text style={styles.textCtrlBtnLabel}>A+</Text></TouchableOpacity>
          <TouchableOpacity style={styles.textCtrlBtn} onPress={deleteSelectedText}><Ionicons name="trash-outline" size={16} color={t.negative} /></TouchableOpacity>
          <TouchableOpacity style={[styles.textCtrlBtn, { backgroundColor: t.ctaBg }]} onPress={() => setSelectedTextId(null)}><Ionicons name="checkmark" size={16} color={t.ctaText} /></TouchableOpacity>
        </View>
      )}
      {tool === 'move' && board?.ai && !selectedTextId && (
        <View style={styles.floatBar}>
          {selectedArrow ? (
            <>
              <TouchableOpacity style={[styles.textCtrlBtn, { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12 }]} onPress={() => deleteArrowRef.current()}>
                <Ionicons name="trash-outline" size={15} color={t.negative} />
                <Text style={[styles.textCtrlBtnLabel, { color: t.negative }]}>{tr('whiteboard.deleteArrow')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.textCtrlBtn, { backgroundColor: t.ctaBg }]} onPress={() => setSelectedArrow(null)}><Ionicons name="checkmark" size={16} color={t.ctaText} /></TouchableOpacity>
            </>
          ) : (
            <Text style={[styles.textCtrlLabel, { paddingHorizontal: 6 }]}>{tr('whiteboard.moveHint')}</Text>
          )}
        </View>
      )}
      {hasFreehandArrows && !selectedTextId && (
        <View style={styles.floatBar}>
          <TouchableOpacity style={styles.floatChip} onPress={clearAll}><Text style={styles.floatChipText}>{tr('whiteboard.clearBoard')}</Text></TouchableOpacity>
          <TouchableOpacity
            style={[styles.floatChip, { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.ctaBg, borderColor: t.ctaBg }]}
            onPress={() => { if (freehandPlaying) { animCancel.current = true; setFreehandPlaying(false); setFreehandDone(true); } else playFreehand(); }}>
            <Ionicons name={freehandPlaying ? 'stop' : freehandDone ? 'refresh' : 'play'} size={13} color={t.ctaText} />
            <Text style={[styles.floatChipText, { color: t.ctaText }]}>{freehandPlaying ? tr('whiteboard.stop') : freehandDone ? tr('whiteboard.replay') : tr('whiteboard.playDrawing')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScreenBackground>
      <View style={styles.container}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setShowBoardList(true)} style={styles.headerBtn}>
            <Ionicons name="layers-outline" size={20} color={t.ink} />
            <Text style={styles.boardName} numberOfLines={1}>{board?.name ?? tr('whiteboard.title')}</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {saving && <ActivityIndicator size="small" color={t.accent} />}
            {saveFailed && !saving && (
              <TouchableOpacity onPress={retrySave} style={styles.saveFailChip}>
                <Ionicons name="cloud-offline-outline" size={13} color={t.negative} />
                <Text style={styles.saveFailText}>{tr('whiteboard.notSavedRetry')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => {
                if (saveFailed) {
                  Alert.alert(tr('whiteboard.unsavedTitle'), tr('whiteboard.unsavedMsg'), [
                    { text: tr('common.cancel'), style: 'cancel' },
                    { text: tr('whiteboard.retrySave'), onPress: retrySave },
                    { text: tr('whiteboard.closeAnyway'), style: 'destructive', onPress: onClose },
                  ]);
                } else onClose();
              }}
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={22} color={t.ink} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Court type */}
        <View style={styles.courtSelector}>
          {(['full', 'half', 'three_quarter'] as CourtType[]).map(ct => (
            <TouchableOpacity key={ct}
              style={[styles.courtChip, board?.court_type === ct && styles.courtChipActive]}
              onPress={() => setCourtType(ct)}>
              <Text style={[styles.courtChipText, board?.court_type === ct && { color: t.ctaText }]}>
                {ct === 'full' ? tr('whiteboard.full') : ct === 'half' ? tr('whiteboard.half') : tr('whiteboard.threeQuarter')}
              </Text>
            </TouchableOpacity>
          ))}
          {/* Orientation toggle — portrait / landscape */}
          <TouchableOpacity
            style={[styles.courtChip, { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5 }, isLandscape && styles.courtChipActive]}
            onPress={() => setOrientation(o => (o === 'portrait' ? 'landscape' : 'portrait'))}>
            <Ionicons name={isLandscape ? 'tablet-landscape-outline' : 'tablet-portrait-outline'} size={14} color={isLandscape ? t.ctaText : t.muted} />
            <Text style={[styles.courtChipText, isLandscape && { color: t.ctaText }]}>
              {isLandscape ? tr('whiteboard.landscape') : tr('whiteboard.portrait')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* AI scheme switcher — only on AI-generated boards */}
        {board?.ai && (
          <View style={styles.schemeRow}>
            {(['offense', 'defense', 'counter'] as SchemeKey[]).map(sc => (
              <TouchableOpacity key={sc}
                style={[styles.schemeChip, activeScheme === sc && styles.schemeChipActive]}
                onPress={() => setActiveScheme(sc)}>
                <Text style={[styles.schemeChipText, activeScheme === sc && { color: t.ctaText }]}>
                  {schemeLabel(sc)}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.schemeChip, showKey && { backgroundColor: '#1F6F9B22', borderColor: '#1F6F9B' }]}
              onPress={() => setShowKey(v => !v)}>
              <Text style={[styles.schemeChipText, showKey && { color: '#1F6F9B' }]}>{tr('whiteboard.keyChip')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.schemeChip, { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.ctaBg, borderColor: t.ctaBg }]}
              onPress={() => { if (animating) { animCancel.current = true; setAnimating(false); setAnimDone(true); } else playScheme(); }}>
              <Ionicons name={animating ? 'stop' : animDone ? 'refresh' : 'play'} size={13} color={t.ctaText} />
              <Text style={[styles.schemeChipText, { color: t.ctaText }]}>{animating ? tr('whiteboard.stop') : animDone ? tr('whiteboard.replay') : tr('whiteboard.play')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.schemeChip, { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.accentSoft, borderColor: t.accent }]}
              onPress={() => { setRefineText(''); setShowRefine(true); }}>
              <Ionicons name="create-outline" size={13} color={t.accent} />
              <Text style={[styles.schemeChipText, { color: t.accent }]}>{tr('whiteboard.refine')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.schemeChip, { flexDirection: 'row', alignItems: 'center', gap: 5 }]}
              onPress={() => setShowPlayers(true)}>
              <Ionicons name="people-outline" size={13} color={t.muted} />
              <Text style={styles.schemeChipText}>{tr('whiteboard.players')}</Text>
            </TouchableOpacity>
            {pinCount > 0 && (
              <TouchableOpacity
                style={[styles.schemeChip, { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.ctaBg, borderColor: t.ctaBg }]}
                onPress={adaptPlay} disabled={adapting}>
                <Ionicons name="git-branch-outline" size={13} color={t.ctaText} />
                <Text style={[styles.schemeChipText, { color: t.ctaText }]}>{tr('whiteboard.adaptPlay')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Toolbar — available in both orientations */}
        <View style={styles.toolbar}>
          <View style={styles.toolRow}>
            {TOOLS.map(tl => (
              <TouchableOpacity key={tl.key}
                style={[styles.toolBtn, tool === tl.key && styles.toolBtnActive, tl.key === 'arrow_dash' && tool !== tl.key && { borderWidth: 1, borderColor: PASS_BLUE, borderStyle: 'dashed' }]}
                onPress={() => setTool(tl.key)}>
                <Ionicons name={tl.icon as any} size={16} color={tool === tl.key ? t.ctaText : (tl.key === 'arrow_dash' ? PASS_BLUE : t.muted)} />
              </TouchableOpacity>
            ))}
            <View style={styles.toolDivider} />
            <TouchableOpacity style={[styles.toolBtn, { backgroundColor: t.accentSoft }]} onPress={() => setShowAI(true)}>
              <Ionicons name="sparkles" size={15} color={t.accent} />
            </TouchableOpacity>
            {board?.ai && (
              <TouchableOpacity
                style={[styles.toolBtn, tool === 'move' && styles.toolBtnActive]}
                onPress={() => setTool(tool === 'move' ? 'pen' : 'move')}>
                <Ionicons name="move" size={16} color={tool === 'move' ? t.ctaText : t.muted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.toolBtn} onPress={undo}>
              <Ionicons name="arrow-undo" size={16} color={t.muted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.clearBtn} onPress={clearAll}>
              <Ionicons name="trash-outline" size={16} color={t.negative} />
            </TouchableOpacity>
            {/* Marker colors — single thickness */}
            <View style={styles.colorRow}>
              {COLORS.map(c => (
                <TouchableOpacity key={c}
                  style={[styles.colorDot, { backgroundColor: c }, color === c && styles.colorDotActive]}
                  onPress={() => setColor(c)} />
              ))}
            </View>
          </View>
        </View>

        {/* Canvas — court scales to fit the available area for the chosen view */}
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={t.accent} size="large" />
          </View>
        ) : (
          <View
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
            onLayout={e => {
              const { width: lw, height: lh } = e.nativeEvent.layout;
              if (lw > 50 && lh > 50) {
                setAvail({ w: lw, h: lh });
                // Auto-pick landscape once on wide screens (tablets / web).
                if (!didAutoOrient.current) {
                  didAutoOrient.current = true;
                  if (lw > lh * 1.2) setOrientation('landscape');
                }
              }
            }}
          >
            {scale > 0 && (
              <View
                key={`cw-${Math.round(courtW)}x${Math.round(courtH)}`}
                style={[
                  styles.canvasWrapper,
                  { width: courtW, height: courtH },
                  isLandscape ? { transform: [{ rotate: '90deg' }, { scale: landscapeFit }] } : null,
                ]}
                {...panResponder.panHandlers}
              >
                <HardwoodCourt width={courtW} height={courtH} scale={scale} />
                <Svg style={StyleSheet.absoluteFill} width={courtW} height={courtH}>
                  {renderCourtStrokes()}
                  {renderDragHandles()}
                  {renderStepBadges()}
                  {livePath ? (
                    <Path d={livePath} stroke={color} strokeWidth={STROKE_WIDTH}
                          fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  ) : null}
                  {dragTarget ? (
                    dragTarget.t === 'unit' ? (
                      dragTarget.kind === 'O' ? (
                        <G>
                          <Circle cx={dragTarget.xpx} cy={dragTarget.ypx} r={14} stroke="#141414" strokeWidth={3} fill="rgba(31,111,155,0.25)" />
                          <SvgText x={dragTarget.xpx - 8} y={dragTarget.ypx + 5} fill="#141414" fontSize={13} fontWeight="bold">{dragTarget.id}</SvgText>
                        </G>
                      ) : (
                        <G>
                          <Line x1={dragTarget.xpx - 10} y1={dragTarget.ypx - 10} x2={dragTarget.xpx + 10} y2={dragTarget.ypx + 10} stroke="#C0392B" strokeWidth={3.5} strokeLinecap="round" />
                          <Line x1={dragTarget.xpx + 10} y1={dragTarget.ypx - 10} x2={dragTarget.xpx - 10} y2={dragTarget.ypx + 10} stroke="#C0392B" strokeWidth={3.5} strokeLinecap="round" />
                          <SvgText x={dragTarget.xpx + 12} y={dragTarget.ypx + 5} fill="#C0392B" fontSize={12} fontWeight="bold">{dispId(dragTarget.id)}</SvgText>
                        </G>
                      )
                    ) : (
                      <Circle cx={dragTarget.xpx} cy={dragTarget.ypx} r={9}
                              fill={dragTarget.t === 'key' ? '#1F6F9B' : '#141414'} opacity={0.85} />
                    )
                  ) : null}
                </Svg>
              </View>
            )}
            {floatingControls}
          </View>
        )}

        {adapting && (
          <View style={styles.adaptOverlay}>
            <View style={styles.adaptCard}>
              <GeneratingOverlay visible label={tr('whiteboard.adaptingLabel')} />
            </View>
          </View>
        )}

        {/* Add-movement type picker (after drawing an arrow on an AI board) */}
        <Modal visible={!!pendingArrow} transparent animationType="fade" onRequestClose={() => setPendingArrow(null)}>
          <View style={styles.listOverlay}>
            <View style={[styles.listBox, { padding: 20 }]}>
              <Text style={styles.listTitle}>{tr('whiteboard.addMovement')}</Text>
              <Text style={styles.aiHint}>{tr('whiteboard.addMovementHint', { scheme: schemeLabel(activeScheme) })}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(['pass', 'cut', 'screen', 'dribble'] as const).map(k => (
                  <TouchableOpacity key={k} style={[styles.schemeChip, { backgroundColor: t.ctaBg, borderColor: t.ctaBg }]} onPress={() => addPendingAsAction(k)}>
                    <Text style={[styles.schemeChipText, { color: t.ctaText, textTransform: 'capitalize' }]}>{tr(`whiteboard.${k}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <TouchableOpacity style={[styles.addBoardBtn, { flex: 1, backgroundColor: t.chip }]} onPress={keepPendingAsMark}>
                  <Text style={{ color: t.ink, fontFamily: fonts[700] }}>{tr('whiteboard.justALine')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.addBoardBtn, { flex: 1, backgroundColor: t.chip }]} onPress={() => setPendingArrow(null)}>
                  <Text style={{ color: t.ink, fontFamily: fonts[700] }}>{tr('common.cancel')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* AI Key — bottom overlay that pops up over the court when Key is on */}
        {board?.ai && showKey && board.ai.key.length > 0 && (
          <View style={styles.keyPanel}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={styles.keyTitle}>{tr('whiteboard.keyPanelTitle')}</Text>
              <TouchableOpacity onPress={() => setShowKey(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="chevron-down" size={18} color={t.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 150 }} showsVerticalScrollIndicator={true}>
              {board.ai.key.map(k => (
                <Text key={k.n} style={styles.keyItem}>
                  <Text style={{ color: '#1F6F9B', fontFamily: fonts[800] }}>{k.n}. </Text>
                  {dispText(k.text)}
                </Text>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Refine play modal */}
        <Modal visible={showRefine} transparent animationType="slide" onRequestClose={() => setShowRefine(false)}>
          <KeyboardAvoidingView style={styles.listOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={[styles.listBox, { padding: 20, maxHeight: '88%' }]}>
                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <Text style={styles.listTitle}>{tr('whiteboard.refinePlay')}</Text>
                  {!!boards[activeBoardIdx]?.ai?.prompt && (
                    <View style={{ backgroundColor: t.chip, borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: t.line }}>
                      <Text style={{ color: t.muted2, fontSize: 10, fontFamily: fonts[700], letterSpacing: 1, marginBottom: 4 }}>{tr('whiteboard.whatYouWrote')}</Text>
                      <Text style={{ color: t.inkSoft, fontSize: 13, lineHeight: 18 }}>{boards[activeBoardIdx]!.ai!.prompt}</Text>
                      {!!boards[activeBoardIdx]?.ai?.attachedTitle && (
                        <Text style={{ color: t.muted, fontSize: 11, marginTop: 4 }}>📎 {boards[activeBoardIdx]!.ai!.attachedTitle}</Text>
                      )}
                    </View>
                  )}
                  <Text style={styles.aiHint}>{tr('whiteboard.refineHint')}</Text>
                  <VoiceTextInput
                    style={[styles.textField, { minHeight: 90 }]}
                    placeholder={tr('whiteboard.refinePlaceholder')}
                    placeholderTextColor={t.muted2}
                    value={refineText}
                    onChangeText={setRefineText}
                    multiline
                    textAlignVertical="top"
                  />
                </ScrollView>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <TouchableOpacity style={[styles.addBoardBtn, { flex: 1, backgroundColor: t.chip }]} onPress={() => setShowRefine(false)}>
                    <Text style={{ color: t.ink, fontFamily: fonts[700] }}>{tr('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.addBoardBtn, { flex: 1, opacity: (refineText.trim() && !refining) ? 1 : 0.5 }]}
                    onPress={refinePlay} disabled={!refineText.trim() || refining}>
                    {refining
                      ? <ActivityIndicator color={t.ctaText} size="small" />
                      : <><Ionicons name="sparkles" size={16} color={t.ctaText} /><Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>{tr('whiteboard.updatePlay')}</Text></>}
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </Modal>

        {/* Player guidance modal — per-player lock/cascade + notes */}
        <Modal visible={showPlayers} transparent animationType="slide" onRequestClose={() => setShowPlayers(false)}>
          <KeyboardAvoidingView style={styles.listOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={[styles.listBox, { padding: 20, maxHeight: '88%' }]}>
                <Text style={styles.listTitle}>
                  {tr('whiteboard.playersTitle', { scheme: schemeLabel(activeScheme) })}
                </Text>
                <Text style={styles.aiHint}>{tr('whiteboard.playersHint')}</Text>
                <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                  {guidanceUnits().map(pl => {
                    const locked = !!lockedPlayers[pl.id];
                    const gk = gKey(activeScheme, pl.id);
                    const persisted = boards[activeBoardIdx]?.ai?.guidance?.[gk];
                    return (
                      <View key={pl.id} style={styles.guideRow}>
                        <View style={styles.guideHead}>
                          <View style={[styles.guideBadge, activeScheme === 'defense' && { borderColor: '#C0392B' }]}>
                            <Text style={[styles.guideBadgeText, activeScheme === 'defense' && { color: '#C0392B' }]}>{dispId(pl.id)}</Text>
                          </View>
                          <TouchableOpacity
                            style={[styles.lockBtn, locked && { backgroundColor: t.accentSoft, borderColor: t.accent }]}
                            onPress={() => setLockedPlayers(prev => ({ ...prev, [pl.id]: !locked }))}>
                            <Ionicons name={locked ? 'lock-closed' : 'lock-open-outline'} size={14} color={locked ? t.accent : t.muted} />
                            <Text style={[styles.lockBtnText, locked && { color: t.accent }]}>{locked ? tr('whiteboard.locked') : tr('whiteboard.open')}</Text>
                          </TouchableOpacity>
                        </View>
                        <TextInput
                          style={[styles.guideInput, { minHeight: 44 }, persisted != null && { borderColor: t.accent }]}
                          placeholder={tr('whiteboard.playerDoesPlaceholder', { id: dispId(pl.id) })}
                          placeholderTextColor={t.muted2}
                          value={playerGuidance[gk] ?? persisted ?? dispText(pl.role)}
                          onChangeText={txt => setPlayerGuidance(prev => ({ ...prev, [gk]: txt }))}
                          multiline
                        />
                      </View>
                    );
                  })}
                  {guidanceUnits().length === 0 && (
                    <Text style={styles.aiHint}>{activeScheme === 'defense' ? tr('whiteboard.noDefendersYet') : tr('whiteboard.noPlayersYet')}</Text>
                  )}
                </ScrollView>
                <GeneratingOverlay visible={applyingGuidance} label={tr('whiteboard.cascadingLabel')} />
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <TouchableOpacity style={[styles.addBoardBtn, { flex: 1, backgroundColor: t.chip }]} onPress={() => setShowPlayers(false)}>
                    <Text style={{ color: t.ink, fontFamily: fonts[700] }}>{tr('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.addBoardBtn, { flex: 1, opacity: applyingGuidance ? 0.5 : 1 }]}
                    onPress={applyPlayerGuidance} disabled={applyingGuidance}>
                    {applyingGuidance
                      ? <ActivityIndicator color={t.ctaText} size="small" />
                      : <><Ionicons name="sparkles" size={16} color={t.ctaText} /><Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>{tr('whiteboard.applyRegenerate')}</Text></>}
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </Modal>

        {/* AI play modal */}
        <Modal visible={showAI} transparent animationType="slide" onRequestClose={() => { setShowAI(false); setSeedMode('none'); setAiByPlayer(false); }}>
          {/* seedMode handled inside */}
          <KeyboardAvoidingView
            style={styles.listOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}
          >
            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={[styles.listBox, { padding: 20, maxHeight: '80%' }]}>
              {(!aiByPlayer && seedMode === 'none') ? (
                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <Text style={styles.listTitle}>{tr('whiteboard.aiTitle')}</Text>
                  <Text style={styles.aiHint}>{tr('whiteboard.aiHint')}</Text>
                  <VoiceTextInput
                    style={[styles.textField, { minHeight: 110 }]}
                    placeholder={tr('whiteboard.aiPlaceholder')}
                    placeholderTextColor={t.muted2}
                    value={aiDescription}
                    onChangeText={setAiDescription}
                    multiline
                    textAlignVertical="top"
                  />
                  {attachedReport ? (
                    <View style={styles.attachChip}>
                      <Ionicons name="document-attach-outline" size={15} color={t.accent} />
                      <Text style={styles.attachChipText} numberOfLines={1}>
                        {attachedReport.title} · {attachedReport.sub}
                      </Text>
                      <TouchableOpacity onPress={() => setAttachedReport(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close-circle" size={17} color={t.muted} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.seedBtn} onPress={() => { Keyboard.dismiss(); setSeedMode('type'); }}>
                      <Ionicons name="document-text-outline" size={16} color={t.accent} />
                      <Text style={styles.seedBtnText}>{tr('whiteboard.drawFromReport')}</Text>
                    </TouchableOpacity>
                  )}
                  {/* By Player — set what each player does before drawing it up */}
                  <TouchableOpacity style={styles.seedBtn} onPress={() => { Keyboard.dismiss(); setAiByPlayer(true); }}>
                    <Ionicons name="people-outline" size={16} color={t.accent} />
                    <Text style={styles.seedBtnText}>
                      {byPlayerCount ? tr('whiteboard.byPlayerSet', { n: byPlayerCount }) : tr('whiteboard.byPlayerCta')}
                    </Text>
                  </TouchableOpacity>
                  <GeneratingOverlay visible={aiGenerating} label={tr('whiteboard.drawingUp')} />
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                    <TouchableOpacity style={[styles.addBoardBtn, { flex: 1, backgroundColor: t.chip }]}
                      onPress={() => setShowAI(false)}>
                      <Text style={{ color: t.ink, fontFamily: fonts[700] }}>{tr('common.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.addBoardBtn, { flex: 1, opacity: (aiDescription.trim() || attachedReport || byPlayerCount > 0) && !aiGenerating ? 1 : 0.5 }]}
                      onPress={generatePlay} disabled={(!aiDescription.trim() && !attachedReport && byPlayerCount === 0) || aiGenerating}>
                      {aiGenerating
                        ? <ActivityIndicator color={t.ctaText} size="small" />
                        : <><Ionicons name="sparkles" size={16} color={t.ctaText} /><Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>{tr('whiteboard.drawItUp')}</Text></>}
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              ) : aiByPlayer ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <TouchableOpacity onPress={() => setAiByPlayer(false)}>
                      <Ionicons name="chevron-back" size={22} color={t.ink} />
                    </TouchableOpacity>
                    <Text style={[styles.listTitle, { marginBottom: 0 }]}>{tr('whiteboard.byPlayer')}</Text>
                  </View>
                  <Text style={styles.aiHint}>{tr('whiteboard.byPlayerHint')}</Text>
                  <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                    {(['O1', 'O2', 'O3', 'O4', 'O5', 'D1', 'D2', 'D3', 'D4', 'D5']).map(id => (
                      <View key={id} style={styles.byPlayerRow}>
                        <View style={[styles.guideBadge, id[0] === 'D' && { borderColor: '#C0392B' }]}>
                          <Text style={[styles.guideBadgeText, id[0] === 'D' && { color: '#C0392B' }]}>{id}</Text>
                        </View>
                        <TextInput
                          style={[styles.guideInput, { flex: 1 }]}
                          placeholder={id[0] === 'O' ? tr('whiteboard.playerRunsPlaceholder', { id }) : tr('whiteboard.playerDefendsPlaceholder', { id })}
                          placeholderTextColor={t.muted2}
                          value={byPlayerNotes[id] ?? ''}
                          onChangeText={txt => setByPlayerNotes(prev => ({ ...prev, [id]: txt }))}
                        />
                      </View>
                    ))}
                  </ScrollView>
                  <TouchableOpacity style={[styles.addBoardBtn, { marginTop: 12 }]} onPress={() => setAiByPlayer(false)}>
                    <Ionicons name="checkmark" size={18} color={t.ctaText} />
                    <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>{byPlayerCount ? tr('whiteboard.doneCountSet', { n: byPlayerCount }) : tr('common.done')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <TouchableOpacity onPress={() => setSeedMode(seedMode === 'list' ? 'type' : 'none')}>
                      <Ionicons name="chevron-back" size={22} color={t.ink} />
                    </TouchableOpacity>
                    <Text style={[styles.listTitle, { marginBottom: 0 }]}>
                      {seedMode === 'type' ? tr('whiteboard.reportSource') : seedType === 'scout' ? tr('whiteboard.scoutReports') : tr('whiteboard.teamReports')}
                    </Text>
                  </View>
                  {seedMode === 'type' ? (
                    <>
                      <TouchableOpacity style={styles.sourceCard} onPress={() => openSeedList('scout')}>
                        <View style={[styles.sourceIcon, { backgroundColor: t.accentSoft }]}>
                          <Ionicons name="telescope-outline" size={22} color={t.accent} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.listItemText}>{tr('whiteboard.scoutReport')}</Text>
                          <Text style={styles.listItemSub}>{tr('whiteboard.scoutReportDesc')}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={t.muted2} />
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.sourceCard} onPress={() => openSeedList('team')}>
                        <View style={[styles.sourceIcon, { backgroundColor: t.positiveSoft }]}>
                          <Ionicons name="people-outline" size={22} color={t.positive} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.listItemText}>{tr('whiteboard.teamReport')}</Text>
                          <Text style={styles.listItemSub}>{tr('whiteboard.teamReportDesc')}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={t.muted2} />
                      </TouchableOpacity>
                    </>
                  ) : seedLoading ? (
                    <ActivityIndicator color={t.accent} style={{ marginVertical: 24 }} />
                  ) : (
                    <ScrollView style={{ maxHeight: 340 }}>
                      {seedItems.length === 0
                        ? <Text style={styles.aiHint}>
                            {seedType === 'scout'
                              ? tr('whiteboard.noScoutReports')
                              : tr('whiteboard.noTeamReports')}
                          </Text>
                        : seedItems.map(item => (
                          <TouchableOpacity key={item.id} style={styles.listRow} onPress={() => attachReport(item)}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.listItemText} numberOfLines={2}>{item.title}</Text>
                              <Text style={styles.listItemSub}>{item.sub}</Text>
                            </View>
                            <Ionicons name="add-circle-outline" size={18} color={t.accent} />
                          </TouchableOpacity>
                        ))}
                    </ScrollView>
                  )}
                </>
              )}
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </Modal>

        {/* Board list modal */}
        <Modal visible={showBoardList} transparent animationType="slide" onRequestClose={() => setShowBoardList(false)}>
          <View style={styles.listOverlay}>
            <View style={styles.listBox}>
              <Text style={styles.listTitle}>{tr('whiteboard.boards')}</Text>
              <ScrollView>
                {boards.map((b, i) => (
                  <View key={i} style={styles.listRow}>
                    <TouchableOpacity style={{ flex: 1 }}
                      onPress={() => { setActiveBoardIdx(i); setShowBoardList(false); }}>
                      <Text style={[styles.listItemText, i === activeBoardIdx && { color: t.accent }]}>{b.name}</Text>
                      <Text style={styles.listItemSub}>
                        {b.court_type === 'full' ? tr('whiteboard.fullCourt') : b.court_type === 'half' ? tr('whiteboard.halfCourt') : tr('whiteboard.threeQuarterCourt')} · {tr('whiteboard.marksCount', { n: b.strokes.length })}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => duplicateBoard(i)} style={{ padding: 4 }}>
                      <Ionicons name="copy-outline" size={16} color={t.muted2} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteBoard(i)} style={{ padding: 4, marginLeft: 6 }}>
                      <Ionicons name="trash-outline" size={16} color={t.muted2} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.addBoardBtn} onPress={addNewBoard}>
                <Ionicons name="add" size={18} color={t.ctaText} />
                <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>{tr('whiteboard.newBoard')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.listClose} onPress={() => setShowBoardList(false)}>
                <Text style={{ color: t.muted, fontSize: 14 }}>{tr('common.close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Text input modal */}
        <Modal visible={showAddText} transparent animationType="fade" onRequestClose={() => setShowAddText(false)}>
          <KeyboardAvoidingView style={styles.listOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.listBox, { padding: 20 }]}>
              <Text style={styles.listTitle}>{editingTextId ? tr('whiteboard.editLabel') : tr('whiteboard.addLabel')}</Text>
              <TextInput style={styles.textField} placeholder={tr('whiteboard.enterText')}
                placeholderTextColor={t.muted2} value={textInput} onChangeText={setTextInput} autoFocus />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={[styles.addBoardBtn, { flex: 1, backgroundColor: t.chip }]}
                  onPress={() => { setShowAddText(false); setEditingTextId(null); }}>
                  <Text style={{ color: t.ink, fontFamily: fonts[700] }}>{tr('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.addBoardBtn, { flex: 1 }]} onPress={addText}>
                  <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>{tr('whiteboard.add')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

      </View>
      </ScreenBackground>
    </Modal>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container:       { flex: 1 },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 52 : 12, paddingBottom: 6 },
  headerBtn:       { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  boardName:       { color: t.ink, fontSize: 16, fontFamily: fonts[700], flex: 1 },
  saveFailChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1,
    borderColor: t.negative, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  saveFailText: { color: t.negative, fontSize: 11, fontFamily: fonts[700] },
  closeBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' },
  courtSelector:   { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.divider },
  courtChip:       { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: t.line },
  courtChipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  courtChipText:   { color: t.muted, fontSize: 13, fontFamily: fonts[600] },
  toolbar:         { paddingVertical: 6, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: t.divider },
  toolRow:         { flexDirection: 'row', alignItems: 'center', gap: 3, flexWrap: 'wrap', rowGap: 6 },
  toolBtn:         { width: 31, height: 31, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip },
  toolBtnActive:   { backgroundColor: t.ctaBg },
  toolDivider:     { width: 1, height: 20, backgroundColor: t.line, marginHorizontal: 2 },
  clearBtn:        { width: 31, height: 31, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip },
  clearBtnText:    { color: t.negative, fontSize: 13, fontFamily: fonts[700] },
  colorRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  colorDot:        { width: 21, height: 21, borderRadius: 11, borderWidth: 2, borderColor: 'transparent' },
  colorDotActive:  { borderColor: t.accent },
  canvasWrapper:   { overflow: 'hidden', borderWidth: 1, borderColor: t.cardBorder },
  listOverlay:     { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  listBox:         { backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '60%', borderWidth: 1, borderColor: t.cardBorder },
  listTitle:       { color: t.ink, fontSize: 17, fontFamily: fonts[800], marginBottom: 14 },
  listRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.divider },
  listItemText:    { color: t.inkSoft, fontSize: 15, fontFamily: fonts[600] },
  listItemSub:     { color: t.muted2, fontSize: 11, marginTop: 2 },
  addBoardBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.ctaBg, borderRadius: 10, paddingVertical: 12, marginTop: 12 },
  listClose:       { alignItems: 'center', marginTop: 10 },
  textField:       { backgroundColor: t.chip, borderRadius: 10, padding: 12, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line },
  textCtrlBar:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.divider },
  textCtrlLabel:   { color: t.muted, fontSize: 12, fontFamily: fonts[600], flex: 1 },
  textCtrlBtn:     { minWidth: 36, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip, paddingHorizontal: 8 },
  textCtrlBtnLabel:{ color: t.ink, fontSize: 13, fontFamily: fonts[800] },
  schemeRow:       { flexDirection: 'row', flexWrap: 'wrap', rowGap: 6, gap: 8, paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.divider },
  schemeChip:      { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: t.line },
  schemeChipActive:{ backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  schemeChipText:  { color: t.muted, fontSize: 13, fontFamily: fonts[700] },
  keyPanel:        {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 20,
    backgroundColor: t.sheet, borderTopWidth: 1, borderTopColor: t.cardBorder,
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: -3 }, elevation: 12,
  },
  keyTitle:        { color: t.label, fontSize: 10.5, fontFamily: fonts[700], letterSpacing: 1.4 },
  keyItem:         { color: t.inkSoft, fontSize: 12.5, lineHeight: 18, marginBottom: 4 },
  aiHint:          { color: t.muted, fontSize: 12.5, lineHeight: 18, marginBottom: 12 },
  seedBtn:         { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: t.line, alignSelf: 'flex-start' },
  seedBtnText:     { color: t.accent, fontSize: 13, fontFamily: fonts[700] },
  attachChip:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: t.accentSoft, borderWidth: 1, borderColor: t.accent },
  attachChipText:  { color: t.accent, fontSize: 13, fontFamily: fonts[700], flex: 1 },
  sourceCard:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: t.chip, borderWidth: 1, borderColor: t.line, marginBottom: 10 },
  sourceIcon:      { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  guideRow:        { backgroundColor: t.chip, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: t.line },
  guideHead:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  guideBadge:      { width: 34, height: 28, borderRadius: 8, backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, alignItems: 'center', justifyContent: 'center' },
  guideBadgeText:  { color: t.ink, fontSize: 13, fontFamily: fonts[800] },
  lockBtn:         { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: t.line, backgroundColor: t.card },
  lockBtnText:     { color: t.muted, fontSize: 12, fontFamily: fonts[700] },
  guideInput:      { backgroundColor: t.card, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: t.ink, fontSize: 13.5, borderWidth: 1, borderColor: t.line },
  byPlayerRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  floatWrap:       { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center', gap: 6 },
  floatBar:        { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, maxWidth: '94%', backgroundColor: t.sheet, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: t.cardBorder, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 5 },
  floatChip:       { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: t.line, backgroundColor: t.card },
  floatChipText:   { color: t.inkSoft, fontSize: 12.5, fontFamily: fonts[700] },
  adaptOverlay:    { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: t.scrim, paddingHorizontal: 30 },
  adaptCard:       { backgroundColor: t.sheet, borderRadius: 16, padding: 20, width: '100%', maxWidth: 360, borderWidth: 1, borderColor: t.cardBorder },
});
