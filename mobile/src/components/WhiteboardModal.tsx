import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  PanResponder, Alert, TextInput, ScrollView, ActivityIndicator,
  Dimensions, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle, Line, Rect, G, Text as SvgText } from 'react-native-svg';
import { whiteboardAPI } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';

const { width: SCREEN_W } = Dimensions.get('window');

// ── Court sizing ──────────────────────────────────────────────────────────
// Classic hardwood court drawn in SVG at a regulation 50ft x 94ft ratio.
const COURT_W   = SCREEN_W - 24;            // nearly full width
const COURT_H   = COURT_W * (94 / 50);      // full court
const HALF_H    = COURT_H / 2;              // half court = bottom half
const THREE_Q_H = COURT_H * 0.75;           // 3/4 court = bottom 75%

type CourtType = 'full' | 'half' | 'three_quarter';
type Tool = 'pen' | 'circle' | 'xmark' | 'arrow' | 'text';

interface Stroke {
  id: string;
  type: 'path' | 'circle' | 'xmark' | 'arrow' | 'text';
  d?: string;
  cx?: number; cy?: number; r?: number; size?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  x?: number; y?: number; label?: string;
  color: string; strokeWidth: number;
}

interface Board {
  id?: number;
  name: string;
  court_type: CourtType;
  strokes: Stroke[];
}

// Three marker colors with strong contrast on maple hardwood, one thickness.
const COLORS = ['#141414', '#1F6F9B', '#C0392B'];   // ink black · sane blue · marker red
const STROKE_WIDTH = 3.5;

const TOOLS: { key: Tool; icon: string }[] = [
  { key: 'pen',    icon: 'pencil' },
  { key: 'circle', icon: 'ellipse-outline' },
  { key: 'xmark',  icon: 'close' },
  { key: 'arrow',  icon: 'arrow-forward' },
  { key: 'text',   icon: 'text' },
];

// ── Classic hardwood court (SVG) ─────────────────────────────────────────────
// Maple plank floor with painted lines: sidelines, center circle, keys,
// free-throw circles, backboards + rims, and three-point arcs.
const WOOD_A = '#E5C593';   // maple plank
const WOOD_B = '#DDBA84';   // alternating plank tone
const LINE = '#7A4326';     // painted line — walnut brown, classic look
const LINE_W = 2;

function HardwoodCourt({ height }: { height: number }) {
  const s = COURT_W / 50;             // feet -> px
  const L = COURT_H;                  // full length in px
  const ft = (n: number) => n * s;

  // Plank stripes (vertical, ~3.5ft wide)
  const planks = [];
  const plankW = ft(3.55);
  for (let i = 0; i * plankW < COURT_W; i++) {
    planks.push(
      <Rect key={i} x={i * plankW} y={0} width={plankW} height={L}
            fill={i % 2 === 0 ? WOOD_A : WOOD_B} />
    );
  }

  // One end's markings; mirrored for the far end via rotation.
  const End = ({ flip }: { flip?: boolean }) => {
    // Drawn relative to the NEAR baseline (y = L); flip rotates 180° about center.
    const base = L;
    const cx = COURT_W / 2;
    const rimY = base - ft(5.25);
    const keyW = ft(16), keyH = ft(19);
    const ftY = base - keyH;
    const r3 = ft(22.15);
    const cornerX = ft(4);
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
        <Line x1={COURT_W - cornerX} y1={base} x2={COURT_W - cornerX} y2={yCorner} stroke={LINE} strokeWidth={LINE_W} />
        <Path d={`M ${cornerX} ${yCorner} A ${r3} ${r3} 0 0 1 ${COURT_W - cornerX} ${yCorner}`}
              stroke={LINE} strokeWidth={LINE_W} fill="none" />
      </G>
    );
  };

  return (
    <View style={{ width: COURT_W, height, overflow: 'hidden', borderRadius: 8 }}>
      {/* Full court anchored to the bottom; half / 3/4 clip the top away. */}
      <View style={{ position: 'absolute', left: 0, bottom: 0, width: COURT_W, height: L }}>
        <Svg width={COURT_W} height={L}>
          {planks}
          {/* boundary */}
          <Rect x={LINE_W / 2} y={LINE_W / 2} width={COURT_W - LINE_W} height={L - LINE_W}
                stroke={LINE} strokeWidth={LINE_W} fill="none" />
          {/* center line + circle */}
          <Line x1={0} y1={L / 2} x2={COURT_W} y2={L / 2} stroke={LINE} strokeWidth={LINE_W} />
          <Circle cx={COURT_W / 2} cy={L / 2} r={ft(6)} stroke={LINE} strokeWidth={LINE_W} fill="none" />
          <Circle cx={COURT_W / 2} cy={L / 2} r={ft(2)} stroke={LINE} strokeWidth={LINE_W} fill="rgba(122,67,38,0.10)" />
          <End />
          <End flip />
        </Svg>
      </View>
    </View>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────
interface Props { visible: boolean; gameId: number; onClose: () => void; }

export default function WhiteboardModal({ visible, gameId, onClose }: Props) {
  const { t } = useTheme();
  const styles = makeStyles(t);
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
  useEffect(() => { toolRef.current = tool; },   [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { activeBoardIdxRef.current = activeBoardIdx; }, [activeBoardIdx]);

  const currentPath = useRef('');
  const startPoint  = useRef({ x: 0, y: 0 });

  const board  = boards[activeBoardIdx];
  const courtH = board?.court_type === 'full' ? COURT_H
               : board?.court_type === 'half'  ? HALF_H : THREE_Q_H;

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
  const saveBoard = useCallback(async (idx: number, b: Board) => {
    setSaving(true);
    try {
      const ds = JSON.stringify(b.strokes);
      if (b.id) {
        await whiteboardAPI.update(b.id, { name: b.name, court_type: b.court_type, data: ds });
      } else {
        const created = await whiteboardAPI.create(gameId, { name: b.name, court_type: b.court_type, data: ds });
        setBoards(prev => { const n = [...prev]; n[idx] = { ...b, id: created.id }; return n; });
      }
    } catch {}
    setSaving(false);
  }, [gameId]);
  useEffect(() => { saveBoardRef.current = saveBoard; }, [saveBoard]);

  const commitStrokes = (idx: number, strokes: Stroke[]) => {
    setBoards(prev => {
      const next    = [...prev];
      const updated = { ...next[idx], strokes };
      next[idx]     = updated;
      saveBoard(idx, updated);
      return next;
    });
  };

  const addNewBoard = () => {
    setBoards(prev => [...prev, { name: `Board ${prev.length + 1}`, court_type: 'full', strokes: [] }]);
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
      if (toolRef.current === 'pen') {
        currentPath.current = `M${x.toFixed(1)},${y.toFixed(1)}`;
      } else if (toolRef.current === 'text') {
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
        push({ id: uid(), type: 'arrow', x1, y1, x2, y2, color: c, strokeWidth: STROKE_WIDTH });
      }
    },
  })).current;

  const addText = () => {
    if (!textInput.trim()) { setShowAddText(false); return; }
    commitStrokes(activeBoardIdx, [...(board?.strokes ?? []), {
      id: uid(), type: 'text',
      x: pendingTextPos.x, y: pendingTextPos.y,
      label: textInput.trim(), color: colorRef.current, strokeWidth: STROKE_WIDTH,
    }]);
    setTextInput('');
    setShowAddText(false);
  };

  const setCourtType = (ct: CourtType) => {
    setBoards(prev => {
      const next    = [...prev];
      const updated = { ...next[activeBoardIdx], court_type: ct };
      next[activeBoardIdx] = updated;
      saveBoard(activeBoardIdx, updated);
      return next;
    });
  };

  const renderStroke = (s: Stroke) => {
    if (s.type === 'path') {
      return <Path key={s.id} d={s.d} stroke={s.color} strokeWidth={s.strokeWidth}
                   fill="none" strokeLinecap="round" strokeLinejoin="round" />;
    }
    if (s.type === 'circle') {
      return <Circle key={s.id} cx={s.cx} cy={s.cy} r={s.r}
                     stroke={s.color} strokeWidth={s.strokeWidth} fill="none" />;
    }
    if (s.type === 'xmark' && s.cx != null && s.cy != null && s.size != null) {
      return (
        <G key={s.id}>
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
      <ScreenBackground>
      <View style={styles.container}>

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setShowBoardList(true)} style={styles.headerBtn}>
            <Ionicons name="layers-outline" size={20} color={t.ink} />
            <Text style={styles.boardName} numberOfLines={1}>{board?.name ?? 'Whiteboard'}</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {saving && <ActivityIndicator size="small" color={t.accent} />}
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
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
                {ct === 'full' ? 'Full' : ct === 'half' ? 'Half' : '3/4'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Toolbar */}
        <View style={styles.toolbar}>
          <View style={styles.toolRow}>
            {TOOLS.map(tl => (
              <TouchableOpacity key={tl.key}
                style={[styles.toolBtn, tool === tl.key && styles.toolBtnActive]}
                onPress={() => setTool(tl.key)}>
                <Ionicons name={tl.icon as any} size={18} color={tool === tl.key ? t.ctaText : t.muted} />
              </TouchableOpacity>
            ))}
            <View style={styles.toolDivider} />
            <TouchableOpacity style={styles.toolBtn} onPress={undo}>
              <Ionicons name="arrow-undo" size={18} color={t.muted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.clearBtn} onPress={clearAll}>
              <Text style={styles.clearBtnText}>Clear</Text>
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

        {/* Canvas — ScrollView so court never gets clipped */}
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={t.accent} size="large" />
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ alignItems: 'center', paddingVertical: 8 }}
            scrollEnabled={tool === 'text'}
          >
            <View style={[styles.canvasWrapper, { height: courtH }]} {...panResponder.panHandlers}>
              <HardwoodCourt height={courtH} />
              <Svg style={StyleSheet.absoluteFill} width={COURT_W} height={courtH}>
                {board?.strokes.map(renderStroke)}
                {livePath ? (
                  <Path d={livePath} stroke={color} strokeWidth={STROKE_WIDTH}
                        fill="none" strokeLinecap="round" strokeLinejoin="round" />
                ) : null}
              </Svg>
            </View>
          </ScrollView>
        )}

        {/* Board list modal */}
        <Modal visible={showBoardList} transparent animationType="slide" onRequestClose={() => setShowBoardList(false)}>
          <View style={styles.listOverlay}>
            <View style={styles.listBox}>
              <Text style={styles.listTitle}>Boards</Text>
              <ScrollView>
                {boards.map((b, i) => (
                  <View key={i} style={styles.listRow}>
                    <TouchableOpacity style={{ flex: 1 }}
                      onPress={() => { setActiveBoardIdx(i); setShowBoardList(false); }}>
                      <Text style={[styles.listItemText, i === activeBoardIdx && { color: t.accent }]}>{b.name}</Text>
                      <Text style={styles.listItemSub}>
                        {b.court_type === 'full' ? 'Full Court' : b.court_type === 'half' ? 'Half Court' : '3/4 Court'} · {b.strokes.length} marks
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteBoard(i)}>
                      <Ionicons name="trash-outline" size={16} color={t.muted2} />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.addBoardBtn} onPress={addNewBoard}>
                <Ionicons name="add" size={18} color={t.ctaText} />
                <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>New Board</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.listClose} onPress={() => setShowBoardList(false)}>
                <Text style={{ color: t.muted, fontSize: 14 }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Text input modal */}
        <Modal visible={showAddText} transparent animationType="fade" onRequestClose={() => setShowAddText(false)}>
          <KeyboardAvoidingView style={styles.listOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.listBox, { padding: 20 }]}>
              <Text style={styles.listTitle}>Add Label</Text>
              <TextInput style={styles.textField} placeholder="Enter text..."
                placeholderTextColor={t.muted2} value={textInput} onChangeText={setTextInput} autoFocus />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={[styles.addBoardBtn, { flex: 1, backgroundColor: t.chip }]}
                  onPress={() => setShowAddText(false)}>
                  <Text style={{ color: t.ink, fontFamily: fonts[700] }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.addBoardBtn, { flex: 1 }]} onPress={addText}>
                  <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>Add</Text>
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
  header:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 56 : 16, paddingBottom: 10 },
  headerBtn:       { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  boardName:       { color: t.ink, fontSize: 16, fontFamily: fonts[700], flex: 1 },
  closeBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' },
  courtSelector:   { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.divider },
  courtChip:       { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: t.line },
  courtChipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  courtChipText:   { color: t.muted, fontSize: 13, fontFamily: fonts[600] },
  toolbar:         { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: t.divider },
  toolRow:         { flexDirection: 'row', alignItems: 'center', gap: 4 },
  toolBtn:         { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip },
  toolBtnActive:   { backgroundColor: t.ctaBg },
  toolDivider:     { width: 1, height: 24, backgroundColor: t.line, marginHorizontal: 4 },
  clearBtn:        { height: 36, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip },
  clearBtnText:    { color: t.negative, fontSize: 13, fontFamily: fonts[700] },
  colorRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  colorDot:        { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  colorDotActive:  { borderColor: t.accent },
  canvasWrapper:   { width: COURT_W, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: t.cardBorder },
  listOverlay:     { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  listBox:         { backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '60%', borderWidth: 1, borderColor: t.cardBorder },
  listTitle:       { color: t.ink, fontSize: 17, fontFamily: fonts[800], marginBottom: 14 },
  listRow:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.divider },
  listItemText:    { color: t.inkSoft, fontSize: 15, fontFamily: fonts[600] },
  listItemSub:     { color: t.muted2, fontSize: 11, marginTop: 2 },
  addBoardBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.ctaBg, borderRadius: 10, paddingVertical: 12, marginTop: 12 },
  listClose:       { alignItems: 'center', marginTop: 10 },
  textField:       { backgroundColor: t.chip, borderRadius: 10, padding: 12, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line },
});
