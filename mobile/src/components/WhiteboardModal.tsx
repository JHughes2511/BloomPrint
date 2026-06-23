import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  PanResponder, Alert, TextInput, ScrollView, ActivityIndicator,
  Dimensions, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle, Line, G, Rect, Text as SvgText } from 'react-native-svg';
import { whiteboardAPI } from '../api/client';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const UI_CHROME = 310;
const MAX_W = SCREEN_W - 16;
const MAX_H = SCREEN_H - UI_CHROME;
const COURT_W   = Math.min(MAX_W, MAX_H * (50 / 94));
const COURT_H   = COURT_W * (94 / 50);
const HALF_H    = COURT_H / 2;
const THREE_Q_H = COURT_H * 0.75;

type CourtType = 'full' | 'half' | 'three_quarter';
type Tool = 'pen' | 'circle' | 'xmark' | 'arrow' | 'text';

interface Stroke {
  id: string;
  type: 'path' | 'circle' | 'xmark' | 'arrow' | 'text';
  d?: string;
  cx?: number; cy?: number; r?: number; size?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  x?: number; y?: number; label?: string;
  color: string;
  strokeWidth: number;
}

interface Board {
  id?: number;
  name: string;
  court_type: CourtType;
  strokes: Stroke[];
}

const COLORS = ['#ffffff', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#000000'];

// Tools — eraser removed, xmark added
const TOOLS: { key: Tool; icon: string; label: string }[] = [
  { key: 'pen',    icon: 'pencil',         label: 'Draw' },
  { key: 'circle', icon: 'ellipse-outline', label: 'Circle' },
  { key: 'xmark',  icon: 'close',           label: 'X' },
  { key: 'arrow',  icon: 'arrow-forward',   label: 'Arrow' },
  { key: 'text',   icon: 'text',            label: 'Text' },
];

// ── Court colours ─────────────────────────────────────────────────────────
const FLOOR_COLS = ['#D4A466','#C99050','#CE9C58','#CA9050','#D29855','#C38845','#CB9555'];
const PAINT_FILL = '#8B5438';
const LINE_C     = '#FFFFFF';
const RIM_C      = '#F97316';
const LW         = 1.8;

// ── Wood floor with vertical planks + horizontal grain ───────────────────
function WoodFloor({ w, h }: { w: number; h: number }) {
  const numPlanks   = 13;
  const plankW      = w / numPlanks;
  const grainStep   = 10;
  const numGrain    = Math.floor(h / grainStep);
  return (
    <G>
      {Array.from({ length: numPlanks }).map((_, i) => (
        <Rect key={`p${i}`} x={i * plankW} y={0} width={plankW} height={h}
              fill={FLOOR_COLS[i % FLOOR_COLS.length]} />
      ))}
      {Array.from({ length: numPlanks - 1 }).map((_, i) => (
        <Line key={`d${i}`} x1={(i+1)*plankW} y1={0} x2={(i+1)*plankW} y2={h}
              stroke="rgba(0,0,0,0.22)" strokeWidth={1.5} />
      ))}
      {Array.from({ length: numGrain }).map((_, row) =>
        Array.from({ length: numPlanks }).map((_, col) => (
          <Line key={`g${row}-${col}`}
                x1={col*plankW + 2} y1={row * grainStep + grainStep / 2}
                x2={(col+1)*plankW - 2} y2={row * grainStep + grainStep / 2}
                stroke="rgba(0,0,0,0.05)" strokeWidth={0.6} />
        ))
      )}
    </G>
  );
}

// ── Basket (backboard line + red rim circle) ─────────────────────────────
function BasketAt({ w, baseY, s, up }: { w: number; baseY: number; s: number; up: boolean }) {
  const rimY = up ? baseY + 5.25 * s : baseY - 5.25 * s;
  const rimR = Math.max(1.5 * s, 9);
  const bW   = 3 * s;
  return (
    <G>
      <Line x1={w/2 - bW} y1={baseY} x2={w/2 + bW} y2={baseY}
            stroke={LINE_C} strokeWidth={4} strokeLinecap="round" />
      <Circle cx={w/2} cy={rimY} r={rimR} stroke={RIM_C} strokeWidth={2.5} fill="none" />
    </G>
  );
}

// ── One end of court (paint + FT circle + 3pt) ──────────────────────────
// up=true  → top end: baseline at y=2, markings extend downward
// up=false → bottom end: baseline at y=courtH-2, markings extend upward
function CourtEnd({ w, courtH, s, up }: { w: number; courtH: number; s: number; up: boolean }) {
  const paintW   = 16 * s;
  const paintH   = 19 * s;
  const threeR   = 23.75 * s;
  const ftR      = 6 * s;
  const laneX    = (w - paintW) / 2;
  const hashTick = 5;
  const hashCount = 7;

  // All coords relative to the baseline of this end
  const baseY   = up ? 2           : courtH - 2;
  const paintY  = up ? baseY       : baseY - paintH;  // top of paint rect
  const ftY     = up ? baseY + paintH : baseY - paintH; // free throw line y
  const crnY    = up ? baseY + 14*s : baseY - 14*s;   // where 3pt corner ends
  const hashDir = up ? 1 : -1; // direction toward center court

  const hashStep = paintH / (hashCount + 1);

  return (
    <G>
      {/* Solid paint fill */}
      <Rect x={laneX} y={paintY} width={paintW} height={paintH} fill={PAINT_FILL} />
      {/* Lane border */}
      <Rect x={laneX} y={paintY} width={paintW} height={paintH} fill="none" stroke={LINE_C} strokeWidth={LW} />

      {/* Hash marks — left side of lane */}
      {Array.from({ length: hashCount }).map((_, i) => {
        const hy = paintY + hashStep * (i + 1);
        return <Line key={`hl${i}`} x1={laneX - hashTick} y1={hy} x2={laneX} y2={hy} stroke={LINE_C} strokeWidth={LW} />;
      })}
      {/* Hash marks — right side of lane */}
      {Array.from({ length: hashCount }).map((_, i) => {
        const hy = paintY + hashStep * (i + 1);
        return <Line key={`hr${i}`} x1={laneX + paintW} y1={hy} x2={laneX + paintW + hashTick} y2={hy} stroke={LINE_C} strokeWidth={LW} />;
      })}

      {/* Free throw circle
          Half toward center court = solid
          Half inside paint (toward basket) = dashed
          sweep=0 (CCW in SVG) from left to right goes toward center = solid half */}
      <Path
        d={`M ${w/2 - ftR} ${ftY} A ${ftR} ${ftR} 0 0 ${up ? 1 : 0} ${w/2 + ftR} ${ftY}`}
        fill="none" stroke={LINE_C} strokeWidth={LW}
      />
      <Path
        d={`M ${w/2 - ftR} ${ftY} A ${ftR} ${ftR} 0 0 ${up ? 0 : 1} ${w/2 + ftR} ${ftY}`}
        fill="none" stroke={LINE_C} strokeWidth={LW} strokeDasharray="5,4"
      />

      {/* 3-point corner lines */}
      <Line x1={3*s} y1={baseY} x2={3*s} y2={crnY} stroke={LINE_C} strokeWidth={LW} />
      <Line x1={w - 3*s} y1={baseY} x2={w - 3*s} y2={crnY} stroke={LINE_C} strokeWidth={LW} />

      {/* 3-point arc — large=1 sweep=1 curves toward center court on BOTH ends */}
      <Path
        d={`M ${3*s} ${crnY} A ${threeR} ${threeR} 0 1 1 ${w - 3*s} ${crnY}`}
        fill="none" stroke={LINE_C} strokeWidth={LW}
      />
    </G>
  );
}

// ── Full court SVG ────────────────────────────────────────────────────────
function CourtSvg({ courtType }: { courtType: CourtType }) {
  const h    = courtType === 'full' ? COURT_H : courtType === 'half' ? HALF_H : THREE_Q_H;
  const w    = COURT_W;
  const s    = w / 50;
  const midY = COURT_H / 2;
  const ftR  = 6 * s;

  if (courtType === 'full') {
    return (
      <Svg width={w} height={h}>
        <WoodFloor w={w} h={h} />
        {/* Court boundary */}
        <Rect x={2} y={2} width={w-4} height={h-4} fill="none" stroke={LINE_C} strokeWidth={LW} />
        {/* Half-court line */}
        <Line x1={2} y1={h/2} x2={w-2} y2={h/2} stroke={LINE_C} strokeWidth={LW} />
        {/* Center circles: large restraining + small tip-off */}
        <Circle cx={w/2} cy={h/2} r={ftR}       fill="none" stroke={LINE_C} strokeWidth={LW} />
        <Circle cx={w/2} cy={h/2} r={ftR * 0.28} fill="none" stroke={LINE_C} strokeWidth={LW} />
        {/* Top end */}
        <CourtEnd w={w} courtH={h} s={s} up={true} />
        <BasketAt w={w} baseY={2}     s={s} up={true} />
        {/* Bottom end */}
        <CourtEnd w={w} courtH={h} s={s} up={false} />
        <BasketAt w={w} baseY={h-2}   s={s} up={false} />
      </Svg>
    );
  }

  // Half / 3-quarter: translate so bottom end (with basket) is visible
  const offsetY = courtType === 'half' ? -midY : -(COURT_H - THREE_Q_H);
  return (
    <Svg width={w} height={h}>
      <WoodFloor w={w} h={h} />
      <G transform={`translate(0, ${offsetY})`}>
        <Rect x={2} y={2} width={w-4} height={COURT_H-4} fill="none" stroke={LINE_C} strokeWidth={LW} />
        <Line x1={2} y1={midY} x2={w-2} y2={midY} stroke={LINE_C} strokeWidth={LW} />
        <Circle cx={w/2} cy={midY} r={ftR}        fill="none" stroke={LINE_C} strokeWidth={LW} />
        <Circle cx={w/2} cy={midY} r={ftR * 0.28} fill="none" stroke={LINE_C} strokeWidth={LW} />
        <CourtEnd w={w} courtH={COURT_H} s={s} up={false} />
        <BasketAt w={w} baseY={COURT_H - 2} s={s} up={false} />
      </G>
    </Svg>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────
interface Props {
  visible: boolean;
  gameId: number;
  onClose: () => void;
}

export default function WhiteboardModal({ visible, gameId, onClose }: Props) {
  const [boards, setBoards]                 = useState<Board[]>([]);
  const [activeBoardIdx, setActiveBoardIdx] = useState(0);
  const [tool, setTool]                     = useState<Tool>('pen');
  const [color, setColor]                   = useState('#ffffff');
  const [strokeWidth, setStrokeWidth]       = useState(3);
  const [showBoardList, setShowBoardList]   = useState(false);
  const [showAddText, setShowAddText]       = useState(false);
  const [pendingTextPos, setPendingTextPos] = useState({ x: 0, y: 0 });
  const [textInput, setTextInput]           = useState('');
  const [loading, setLoading]               = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [livePath, setLivePath]             = useState('');

  // Refs so panResponder always has current values (no stale closure)
  const toolRef           = useRef<Tool>('pen');
  const colorRef          = useRef('#ffffff');
  const strokeWidthRef    = useRef(3);
  const activeBoardIdxRef = useRef(0);
  useEffect(() => { toolRef.current = tool; },              [tool]);
  useEffect(() => { colorRef.current = color; },            [color]);
  useEffect(() => { strokeWidthRef.current = strokeWidth; },[strokeWidth]);
  useEffect(() => { activeBoardIdxRef.current = activeBoardIdx; }, [activeBoardIdx]);

  const currentPath = useRef('');
  const startPoint  = useRef({ x: 0, y: 0 });

  const board  = boards[activeBoardIdx];
  const courtH = board?.court_type === 'full' ? COURT_H : board?.court_type === 'half' ? HALF_H : THREE_Q_H;

  useEffect(() => { if (visible && gameId) loadBoards(); }, [visible, gameId]);

  const loadBoards = async () => {
    setLoading(true);
    try {
      const data = await whiteboardAPI.list(gameId);
      if (data.length > 0) {
        setBoards(data.map((b: any) => ({ ...b, strokes: JSON.parse(b.data || '[]') })));
      } else {
        setBoards([{ name: 'Board 1', court_type: 'full', strokes: [] }]);
      }
      setActiveBoardIdx(0);
    } catch {
      setBoards([{ name: 'Board 1', court_type: 'full', strokes: [] }]);
    }
    setLoading(false);
  };

  const saveBoardRef = useRef<(idx: number, b: Board) => void>(() => {});
  const saveBoard = useCallback(async (idx: number, updatedBoard: Board) => {
    setSaving(true);
    try {
      const dataStr = JSON.stringify(updatedBoard.strokes);
      if (updatedBoard.id) {
        await whiteboardAPI.update(updatedBoard.id, { name: updatedBoard.name, court_type: updatedBoard.court_type, data: dataStr });
      } else {
        const created = await whiteboardAPI.create(gameId, { name: updatedBoard.name, court_type: updatedBoard.court_type, data: dataStr });
        setBoards(prev => { const n = [...prev]; n[idx] = { ...updatedBoard, id: created.id }; return n; });
      }
    } catch {}
    setSaving(false);
  }, [gameId]);
  useEffect(() => { saveBoardRef.current = saveBoard; }, [saveBoard]);

  const commitStrokes = (idx: number, strokes: Stroke[]) => {
    setBoards(prev => {
      const next    = [...prev];
      const updated = { ...next[idx], strokes };
      next[idx] = updated;
      saveBoard(idx, updated);
      return next;
    });
  };

  const addNewBoard = () => {
    const nb: Board = { name: `Board ${boards.length + 1}`, court_type: 'full', strokes: [] };
    setBoards(prev => [...prev, nb]);
    setActiveBoardIdx(boards.length);
    setShowBoardList(false);
  };

  const deleteBoard = (idx: number) => {
    const b = boards[idx];
    Alert.alert('Delete Board', `Delete "${b.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        if (b.id) await whiteboardAPI.delete(b.id);
        setBoards(prev => prev.filter((_, i) => i !== idx));
        setActiveBoardIdx(Math.max(0, idx - 1));
      }},
    ]);
  };

  const undo     = () => { if (board) commitStrokes(activeBoardIdx, board.strokes.slice(0, -1)); };
  const clearAll = () => Alert.alert('Clear Board', 'Remove all marks?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear', style: 'destructive', onPress: () => commitStrokes(activeBoardIdx, []) },
  ]);

  const uid = () => Math.random().toString(36).slice(2);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,

    onPanResponderGrant: (evt) => {
      const { locationX: x, locationY: y } = evt.nativeEvent;
      startPoint.current = { x, y };
      const t = toolRef.current;
      if (t === 'pen') {
        currentPath.current = `M${x.toFixed(1)},${y.toFixed(1)}`;
      } else if (t === 'text') {
        setPendingTextPos({ x, y });
        setShowAddText(true);
      }
    },

    onPanResponderMove: (evt) => {
      const { locationX: x, locationY: y } = evt.nativeEvent;
      if (toolRef.current === 'pen') {
        currentPath.current += ` L${x.toFixed(1)},${y.toFixed(1)}`;
        setLivePath(currentPath.current);
      }
    },

    onPanResponderRelease: (evt) => {
      const { locationX: x2, locationY: y2 } = evt.nativeEvent;
      const { x: x1, y: y1 } = startPoint.current;
      const idx = activeBoardIdxRef.current;
      const t   = toolRef.current;
      const c   = colorRef.current;
      const sw  = strokeWidthRef.current;

      if (t === 'pen' && currentPath.current) {
        const stroke: Stroke = { id: uid(), type: 'path', d: currentPath.current, color: c, strokeWidth: sw };
        setBoards(prev => {
          const next = [...prev];
          const updated = { ...next[idx], strokes: [...next[idx].strokes, stroke] };
          next[idx] = updated;
          saveBoardRef.current(idx, updated);
          return next;
        });
        currentPath.current = '';
        setLivePath('');
      } else if (t === 'circle') {
        const r = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) / 2;
        const stroke: Stroke = { id: uid(), type: 'circle', cx: (x1+x2)/2, cy: (y1+y2)/2, r: Math.max(r, 10), color: c, strokeWidth: sw };
        setBoards(prev => {
          const next = [...prev];
          const updated = { ...next[idx], strokes: [...next[idx].strokes, stroke] };
          next[idx] = updated;
          saveBoardRef.current(idx, updated);
          return next;
        });
      } else if (t === 'xmark') {
        const size = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2;
        const stroke: Stroke = { id: uid(), type: 'xmark', cx: (x1+x2)/2, cy: (y1+y2)/2, size: Math.max(size, 10), color: c, strokeWidth: sw };
        setBoards(prev => {
          const next = [...prev];
          const updated = { ...next[idx], strokes: [...next[idx].strokes, stroke] };
          next[idx] = updated;
          saveBoardRef.current(idx, updated);
          return next;
        });
      } else if (t === 'arrow') {
        if (Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2) < 5) return;
        const stroke: Stroke = { id: uid(), type: 'arrow', x1, y1, x2, y2, color: c, strokeWidth: sw };
        setBoards(prev => {
          const next = [...prev];
          const updated = { ...next[idx], strokes: [...next[idx].strokes, stroke] };
          next[idx] = updated;
          saveBoardRef.current(idx, updated);
          return next;
        });
      }
    },
  })).current;

  const addText = () => {
    if (!textInput.trim()) { setShowAddText(false); return; }
    const stroke: Stroke = {
      id: uid(), type: 'text',
      x: pendingTextPos.x, y: pendingTextPos.y,
      label: textInput.trim(),
      color: colorRef.current, strokeWidth: strokeWidthRef.current,
    };
    commitStrokes(activeBoardIdx, [...(board?.strokes ?? []), stroke]);
    setTextInput('');
    setShowAddText(false);
  };

  const setCourtType = (ct: CourtType) => {
    setBoards(prev => {
      const next = [...prev];
      const updated = { ...next[activeBoardIdx], court_type: ct };
      next[activeBoardIdx] = updated;
      saveBoard(activeBoardIdx, updated);
      return next;
    });
  };

  const renderStroke = (s: Stroke) => {
    if (s.type === 'path') {
      return <Path key={s.id} d={s.d} stroke={s.color} strokeWidth={s.strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    }
    if (s.type === 'circle') {
      return <Circle key={s.id} cx={s.cx} cy={s.cy} r={s.r} stroke={s.color} strokeWidth={s.strokeWidth} fill="none" />;
    }
    if (s.type === 'xmark' && s.cx != null && s.cy != null && s.size != null) {
      return (
        <G key={s.id}>
          <Line x1={s.cx - s.size} y1={s.cy - s.size} x2={s.cx + s.size} y2={s.cy + s.size} stroke={s.color} strokeWidth={s.strokeWidth} strokeLinecap="round" />
          <Line x1={s.cx + s.size} y1={s.cy - s.size} x2={s.cx - s.size} y2={s.cy + s.size} stroke={s.color} strokeWidth={s.strokeWidth} strokeLinecap="round" />
        </G>
      );
    }
    if (s.type === 'arrow' && s.x1 != null && s.y1 != null && s.x2 != null && s.y2 != null) {
      const dx = s.x2 - s.x1; const dy = s.y2 - s.y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 5) return null;
      const ux = dx / len; const uy = dy / len;
      const as = 12; const px = -uy; const py = ux;
      const tip = { x: s.x2, y: s.y2 };
      const b1  = { x: s.x2 - ux*as + px*as*0.5, y: s.y2 - uy*as + py*as*0.5 };
      const b2  = { x: s.x2 - ux*as - px*as*0.5, y: s.y2 - uy*as - py*as*0.5 };
      return (
        <G key={s.id}>
          <Line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={s.strokeWidth} />
          <Path d={`M${tip.x},${tip.y} L${b1.x},${b1.y} L${b2.x},${b2.y} Z`} fill={s.color} />
        </G>
      );
    }
    if (s.type === 'text') {
      return <SvgText key={s.id} x={s.x} y={s.y} fill={s.color} fontSize={16} fontWeight="bold">{s.label}</SvgText>;
    }
    return null;
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setShowBoardList(true)} style={styles.headerBtn}>
            <Ionicons name="layers-outline" size={20} color="#fff" />
            <Text style={styles.boardName} numberOfLines={1}>{board?.name ?? 'Whiteboard'}</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {saving && <ActivityIndicator size="small" color="#7c3aed" />}
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Court type selector */}
        <View style={styles.courtSelector}>
          {(['full', 'half', 'three_quarter'] as CourtType[]).map(ct => (
            <TouchableOpacity
              key={ct}
              style={[styles.courtChip, board?.court_type === ct && styles.courtChipActive]}
              onPress={() => setCourtType(ct)}
            >
              <Text style={[styles.courtChipText, board?.court_type === ct && { color: '#fff' }]}>
                {ct === 'full' ? 'Full' : ct === 'half' ? 'Half' : '3/4'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Toolbar */}
        <View style={styles.toolbar}>
          <View style={styles.toolRow}>
            {/* Drawing tools */}
            {TOOLS.map(t => (
              <TouchableOpacity
                key={t.key}
                style={[styles.toolBtn, tool === t.key && styles.toolBtnActive]}
                onPress={() => setTool(t.key)}
              >
                <Ionicons name={t.icon as any} size={18} color={tool === t.key ? '#fff' : '#9ca3af'} />
              </TouchableOpacity>
            ))}

            <View style={{ width: 1, height: 24, backgroundColor: '#374151', marginHorizontal: 4 }} />

            {/* Undo */}
            <TouchableOpacity style={styles.toolBtn} onPress={undo}>
              <Ionicons name="arrow-undo" size={18} color="#9ca3af" />
            </TouchableOpacity>

            {/* Clear all — text button */}
            <TouchableOpacity style={styles.clearBtn} onPress={clearAll}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          </View>

          {/* Color + stroke width row */}
          <View style={styles.colorRow}>
            {COLORS.map(c => (
              <TouchableOpacity
                key={c}
                style={[styles.colorDot, { backgroundColor: c }, color === c && styles.colorDotActive]}
                onPress={() => setColor(c)}
              />
            ))}
            <View style={{ marginLeft: 8, flexDirection: 'row', gap: 6 }}>
              {[2, 4, 7].map(w => (
                <TouchableOpacity
                  key={w}
                  style={[styles.widthDot, { width: w*3, height: w*3, borderRadius: w*3 }, strokeWidth === w && { borderColor: '#fff', borderWidth: 2 }]}
                  onPress={() => setStrokeWidth(w)}
                />
              ))}
            </View>
          </View>
        </View>

        {/* Canvas */}
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#7c3aed" size="large" />
          </View>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <View style={[styles.canvasWrapper, { height: courtH }]} {...panResponder.panHandlers}>
              <CourtSvg courtType={board?.court_type ?? 'full'} />
              <Svg style={StyleSheet.absoluteFill} width={COURT_W} height={courtH}>
                {board?.strokes.map(renderStroke)}
                {livePath ? (
                  <Path d={livePath} stroke={color} strokeWidth={strokeWidth}
                        fill="none" strokeLinecap="round" strokeLinejoin="round" />
                ) : null}
              </Svg>
            </View>
          </View>
        )}

        {/* Board list modal */}
        <Modal visible={showBoardList} transparent animationType="slide" onRequestClose={() => setShowBoardList(false)}>
          <View style={styles.listOverlay}>
            <View style={styles.listBox}>
              <Text style={styles.listTitle}>Boards</Text>
              <ScrollView>
                {boards.map((b, i) => (
                  <View key={i} style={styles.listRow}>
                    <TouchableOpacity style={{ flex: 1 }} onPress={() => { setActiveBoardIdx(i); setShowBoardList(false); }}>
                      <Text style={[styles.listItemText, i === activeBoardIdx && { color: '#7c3aed' }]}>{b.name}</Text>
                      <Text style={styles.listItemSub}>
                        {b.court_type === 'full' ? 'Full Court' : b.court_type === 'half' ? 'Half Court' : '3/4 Court'} · {b.strokes.length} marks
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteBoard(i)}>
                      <Ionicons name="trash-outline" size={16} color="#4b5563" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.addBoardBtn} onPress={addNewBoard}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700' }}>New Board</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.listClose} onPress={() => setShowBoardList(false)}>
                <Text style={{ color: '#9ca3af', fontSize: 14 }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Text input modal */}
        <Modal visible={showAddText} transparent animationType="fade" onRequestClose={() => setShowAddText(false)}>
          <View style={styles.listOverlay}>
            <View style={[styles.listBox, { padding: 20 }]}>
              <Text style={styles.listTitle}>Add Label</Text>
              <TextInput
                style={styles.textField}
                placeholder="Enter text..."
                placeholderTextColor="#4b5563"
                value={textInput}
                onChangeText={setTextInput}
                autoFocus
              />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={[styles.addBoardBtn, { flex: 1, backgroundColor: '#374151' }]} onPress={() => setShowAddText(false)}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.addBoardBtn, { flex: 1 }]} onPress={addText}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0a0a0a' },
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 56 : 16, paddingBottom: 10, backgroundColor: '#111827' },
  headerBtn:       { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  boardName:       { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1 },
  closeBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1f2937', alignItems: 'center', justifyContent: 'center' },
  courtSelector:   { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  courtChip:       { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: '#374151' },
  courtChipActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  courtChipText:   { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  toolbar:         { backgroundColor: '#111827', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#1f2937', gap: 10 },
  toolRow:         { flexDirection: 'row', alignItems: 'center', gap: 4 },
  toolBtn:         { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f2937' },
  toolBtnActive:   { backgroundColor: '#7c3aed' },
  clearBtn:        { height: 36, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#374151' },
  clearBtnText:    { color: '#f87171', fontSize: 13, fontWeight: '700' },
  colorRow:        { flexDirection: 'row', alignItems: 'center', gap: 8 },
  colorDot:        { width: 22, height: 22, borderRadius: 11 },
  colorDotActive:  { borderWidth: 2, borderColor: '#fff' },
  widthDot:        { backgroundColor: '#fff' },
  canvasWrapper:   { width: COURT_W, borderRadius: 8, overflow: 'hidden' },
  listOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  listBox:         { backgroundColor: '#1f2937', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '60%' },
  listTitle:       { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 14 },
  listRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#374151' },
  listItemText:    { color: '#d1d5db', fontSize: 15, fontWeight: '600' },
  listItemSub:     { color: '#6b7280', fontSize: 11, marginTop: 2 },
  addBoardBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#7c3aed', borderRadius: 10, paddingVertical: 12, marginTop: 12 },
  listClose:       { alignItems: 'center', marginTop: 10 },
  textField:       { backgroundColor: '#111827', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#374151' },
});
