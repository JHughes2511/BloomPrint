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

// Scale court so the full court always fits on screen.
// UI chrome: header ~130px, court selector ~50px, toolbar ~90px, safe areas ~40px = ~310px
const UI_CHROME = 310;
const MAX_W = SCREEN_W - 32;
const MAX_H = SCREEN_H - UI_CHROME;
// Full court ratio is 94 tall : 50 wide. Pick the width that keeps height within MAX_H.
const COURT_W = Math.min(MAX_W, MAX_H * (50 / 94));
const COURT_H = COURT_W * (94 / 50);
const HALF_H  = COURT_H / 2;
const THREE_Q_H = COURT_H * 0.75;

type CourtType = 'full' | 'half' | 'three_quarter';
type Tool = 'pen' | 'circle' | 'arrow' | 'text' | 'eraser';

interface Stroke {
  id: string;
  type: 'path' | 'circle' | 'arrow' | 'text';
  d?: string;
  cx?: number; cy?: number; r?: number;
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

const COLORS = ['#ffffff', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#000000'];
const TOOLS: { key: Tool; icon: string }[] = [
  { key: 'pen',    icon: 'pencil' },
  { key: 'circle', icon: 'ellipse-outline' },
  { key: 'arrow',  icon: 'arrow-forward' },
  { key: 'text',   icon: 'text' },
  { key: 'eraser', icon: 'trash-outline' },
];

const WOOD_BASE = '#C8874A';
const LINE_COLOR = '#ffffff';
const PAINT_COLOR = 'rgba(180,100,40,0.35)';
const LW = 1.5;

function WoodGrain({ w, h }: { w: number; h: number }) {
  const numPlanks = 14;
  const plankW = w / numPlanks;
  const colors = ['#C8874A','#C07840','#C8874A','#BF7B3E','#C08245','#C8874A','#BB7840'];
  return (
    <G>
      {Array.from({ length: numPlanks }).map((_, i) => (
        <Rect key={i} x={i * plankW} y={0} width={plankW} height={h} fill={colors[i % colors.length]} />
      ))}
      {Array.from({ length: numPlanks - 1 }).map((_, i) => (
        <Line key={`d${i}`} x1={(i+1)*plankW} y1={0} x2={(i+1)*plankW} y2={h} stroke="rgba(0,0,0,0.18)" strokeWidth={1.5} />
      ))}
      {Array.from({ length: numPlanks }).map((_, i) => (
        <Line key={`g${i}`} x1={i*plankW + plankW*0.4} y1={0} x2={i*plankW + plankW*0.4} y2={h} stroke="rgba(0,0,0,0.06)" strokeWidth={0.8} />
      ))}
    </G>
  );
}

function BasketBottom({ w, courtH, s }: { w: number; courtH: number; s: number }) {
  const baseY = courtH - 2;
  const rimY  = baseY - 5.25 * s;
  const rimR  = Math.max(1.5 * s, 8);
  const bw    = 3 * s;
  const bxh   = 1.5 * s;
  return (
    <G>
      <Line x1={w/2 - bw} y1={baseY} x2={w/2 + bw} y2={baseY} stroke={LINE_COLOR} strokeWidth={3} />
      <Rect x={w/2 - s} y={baseY - bxh} width={2*s} height={bxh} fill="none" stroke={LINE_COLOR} strokeWidth={1} />
      <Circle cx={w/2} cy={rimY} r={rimR} stroke="#f59e0b" strokeWidth={2} fill="none" />
    </G>
  );
}

function BasketTop({ w, s }: { w: number; s: number }) {
  const baseY = 2;
  const rimY  = baseY + 5.25 * s;
  const rimR  = Math.max(1.5 * s, 8);
  const bw    = 3 * s;
  const bxh   = 1.5 * s;
  return (
    <G>
      <Line x1={w/2 - bw} y1={baseY} x2={w/2 + bw} y2={baseY} stroke={LINE_COLOR} strokeWidth={3} />
      <Rect x={w/2 - s} y={baseY} width={2*s} height={bxh} fill="none" stroke={LINE_COLOR} strokeWidth={1} />
      <Circle cx={w/2} cy={rimY} r={rimR} stroke="#f59e0b" strokeWidth={2} fill="none" />
    </G>
  );
}

// Court markings for the bottom end (basket near y=courtH)
function EndBottom({ w, courtH, s }: { w: number; courtH: number; s: number }) {
  const paintW = 16 * s;
  const paintH = 19 * s;
  const threeR = 23.75 * s;
  const laneX  = (w - paintW) / 2;
  const baseY  = courtH - 2;
  const ftY    = baseY - paintH;        // free throw line
  const crnY   = baseY - 14 * s;       // where corner 3pt line ends

  return (
    <G>
      {/* Paint / lane */}
      <Rect x={laneX} y={ftY} width={paintW} height={paintH} fill={PAINT_COLOR} stroke={LINE_COLOR} strokeWidth={LW} />
      {/* Free throw circle — solid half toward basket, dashed half toward center */}
      <Path d={`M ${w/2 - 6*s} ${ftY} A ${6*s} ${6*s} 0 0 1 ${w/2 + 6*s} ${ftY}`}
            fill="none" stroke={LINE_COLOR} strokeWidth={LW} />
      <Path d={`M ${w/2 - 6*s} ${ftY} A ${6*s} ${6*s} 0 0 0 ${w/2 + 6*s} ${ftY}`}
            fill="none" stroke={LINE_COLOR} strokeWidth={LW} strokeDasharray="5,4" />
      {/* 3-point corner lines */}
      <Line x1={3*s} y1={baseY} x2={3*s} y2={crnY} stroke={LINE_COLOR} strokeWidth={LW} />
      <Line x1={w-3*s} y1={baseY} x2={w-3*s} y2={crnY} stroke={LINE_COLOR} strokeWidth={LW} />
      {/* 3-point arc — large-arc=1, sweep=1 curves TOWARD center court */}
      <Path d={`M ${3*s} ${crnY} A ${threeR} ${threeR} 0 1 1 ${w-3*s} ${crnY}`}
            fill="none" stroke={LINE_COLOR} strokeWidth={LW} />
    </G>
  );
}

// Court markings for the top end (basket near y=0)
function EndTop({ w, s }: { w: number; s: number }) {
  const paintW = 16 * s;
  const paintH = 19 * s;
  const threeR = 23.75 * s;
  const laneX  = (w - paintW) / 2;
  const baseY  = 2;
  const ftY    = baseY + paintH;
  const crnY   = baseY + 14 * s;

  return (
    <G>
      <Rect x={laneX} y={baseY} width={paintW} height={paintH} fill={PAINT_COLOR} stroke={LINE_COLOR} strokeWidth={LW} />
      <Path d={`M ${w/2 - 6*s} ${ftY} A ${6*s} ${6*s} 0 0 0 ${w/2 + 6*s} ${ftY}`}
            fill="none" stroke={LINE_COLOR} strokeWidth={LW} />
      <Path d={`M ${w/2 - 6*s} ${ftY} A ${6*s} ${6*s} 0 0 1 ${w/2 + 6*s} ${ftY}`}
            fill="none" stroke={LINE_COLOR} strokeWidth={LW} strokeDasharray="5,4" />
      <Line x1={3*s} y1={baseY} x2={3*s} y2={crnY} stroke={LINE_COLOR} strokeWidth={LW} />
      <Line x1={w-3*s} y1={baseY} x2={w-3*s} y2={crnY} stroke={LINE_COLOR} strokeWidth={LW} />
      {/* Top arc also uses large=1, sweep=1 */}
      <Path d={`M ${3*s} ${crnY} A ${threeR} ${threeR} 0 1 1 ${w-3*s} ${crnY}`}
            fill="none" stroke={LINE_COLOR} strokeWidth={LW} />
    </G>
  );
}

function CourtSvg({ courtType }: { courtType: CourtType }) {
  const h = courtType === 'full' ? COURT_H : courtType === 'half' ? HALF_H : THREE_Q_H;
  const w = COURT_W;
  const s = w / 50;
  const midY = COURT_H / 2;

  if (courtType === 'full') {
    return (
      <Svg width={w} height={h}>
        <WoodGrain w={w} h={h} />
        <Rect x={2} y={2} width={w-4} height={h-4} fill="none" stroke={LINE_COLOR} strokeWidth={LW} />
        <Line x1={2} y1={h/2} x2={w-2} y2={h/2} stroke={LINE_COLOR} strokeWidth={LW} />
        <Circle cx={w/2} cy={h/2} r={6*s} fill="none" stroke={LINE_COLOR} strokeWidth={LW} />
        <EndTop w={w} s={s} />
        <BasketTop w={w} s={s} />
        <EndBottom w={w} courtH={h} s={s} />
        <BasketBottom w={w} courtH={h} s={s} />
      </Svg>
    );
  }

  // Half / three_quarter — clip to bottom portion of full court
  const offsetY = courtType === 'half' ? -midY : -(COURT_H - THREE_Q_H);
  return (
    <Svg width={w} height={h}>
      <WoodGrain w={w} h={h} />
      <G transform={`translate(0, ${offsetY})`}>
        <Rect x={2} y={2} width={w-4} height={COURT_H-4} fill="none" stroke={LINE_COLOR} strokeWidth={LW} />
        <Line x1={2} y1={midY} x2={w-2} y2={midY} stroke={LINE_COLOR} strokeWidth={LW} />
        <Circle cx={w/2} cy={midY} r={6*s} fill="none" stroke={LINE_COLOR} strokeWidth={LW} />
        <EndBottom w={w} courtH={COURT_H} s={s} />
        <BasketBottom w={w} courtH={COURT_H} s={s} />
      </G>
    </Svg>
  );
}

interface Props {
  visible: boolean;
  gameId: number;
  onClose: () => void;
}

export default function WhiteboardModal({ visible, gameId, onClose }: Props) {
  const [boards, setBoards]           = useState<Board[]>([]);
  const [activeBoardIdx, setActiveBoardIdx] = useState(0);
  const [tool, setTool]               = useState<Tool>('pen');
  const [color, setColor]             = useState('#ffffff');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [showBoardList, setShowBoardList] = useState(false);
  const [showAddText, setShowAddText] = useState(false);
  const [pendingTextPos, setPendingTextPos] = useState({ x: 0, y: 0 });
  const [textInput, setTextInput]     = useState('');
  const [loading, setLoading]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [livePath, setLivePath]       = useState('');

  // Refs so panResponder callbacks always see current values (avoids stale closures)
  const toolRef         = useRef<Tool>('pen');
  const colorRef        = useRef('#ffffff');
  const strokeWidthRef  = useRef(3);
  const activeBoardIdxRef = useRef(0);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { strokeWidthRef.current = strokeWidth; }, [strokeWidth]);
  useEffect(() => { activeBoardIdxRef.current = activeBoardIdx; }, [activeBoardIdx]);

  const currentPath  = useRef('');
  const startPoint   = useRef({ x: 0, y: 0 });

  const board   = boards[activeBoardIdx];
  const courtH  = board?.court_type === 'full' ? COURT_H : board?.court_type === 'half' ? HALF_H : THREE_Q_H;

  useEffect(() => {
    if (visible && gameId) loadBoards();
  }, [visible, gameId]);

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

  // Ref so panResponder can always call the latest saveBoard
  const saveBoardRef = useRef<(idx: number, b: Board) => void>(() => {});

  const saveBoard = useCallback(async (idx: number, updatedBoard: Board) => {
    setSaving(true);
    try {
      const dataStr = JSON.stringify(updatedBoard.strokes);
      if (updatedBoard.id) {
        await whiteboardAPI.update(updatedBoard.id, { name: updatedBoard.name, court_type: updatedBoard.court_type, data: dataStr });
      } else {
        const created = await whiteboardAPI.create(gameId, { name: updatedBoard.name, court_type: updatedBoard.court_type, data: dataStr });
        setBoards(prev => {
          const next = [...prev];
          next[idx] = { ...updatedBoard, id: created.id };
          return next;
        });
      }
    } catch {}
    setSaving(false);
  }, [gameId]);

  useEffect(() => { saveBoardRef.current = saveBoard; }, [saveBoard]);

  const updateStrokes = (idx: number, strokes: Stroke[]) => {
    setBoards(prev => {
      const next = [...prev];
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

  const undo = () => {
    if (!board) return;
    updateStrokes(activeBoardIdx, board.strokes.slice(0, -1));
  };

  const clearAll = () => {
    Alert.alert('Clear Board', 'Remove all strokes?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => updateStrokes(activeBoardIdx, []) },
    ]);
  };

  const uid = () => Math.random().toString(36).slice(2);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,

      onPanResponderGrant: (evt) => {
        const { locationX: x, locationY: y } = evt.nativeEvent;
        startPoint.current = { x, y };
        const t = toolRef.current;
        if (t === 'pen' || t === 'eraser') {
          currentPath.current = `M${x.toFixed(1)},${y.toFixed(1)}`;
        } else if (t === 'text') {
          setPendingTextPos({ x, y });
          setShowAddText(true);
        }
      },

      onPanResponderMove: (evt) => {
        const { locationX: x, locationY: y } = evt.nativeEvent;
        const t = toolRef.current;
        if (t === 'pen' || t === 'eraser') {
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

        if ((t === 'pen' || t === 'eraser') && currentPath.current) {
          const stroke: Stroke = {
            id: uid(), type: 'path', d: currentPath.current,
            color: t === 'eraser' ? WOOD_BASE : c,
            strokeWidth: t === 'eraser' ? 20 : sw,
          };
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
          const r = Math.sqrt((x2-x1)**2 + (y2-y1)**2) / 2;
          const stroke: Stroke = { id: uid(), type: 'circle', cx: (x1+x2)/2, cy: (y1+y2)/2, r: Math.max(r, 10), color: c, strokeWidth: sw };
          setBoards(prev => {
            const next = [...prev];
            const updated = { ...next[idx], strokes: [...next[idx].strokes, stroke] };
            next[idx] = updated;
            saveBoardRef.current(idx, updated);
            return next;
          });
        } else if (t === 'arrow') {
          if (Math.sqrt((x2-x1)**2 + (y2-y1)**2) < 5) return;
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
    })
  ).current;

  const addText = () => {
    if (!textInput.trim()) { setShowAddText(false); return; }
    const stroke: Stroke = {
      id: uid(), type: 'text',
      x: pendingTextPos.x, y: pendingTextPos.y,
      label: textInput.trim(),
      color: colorRef.current,
      strokeWidth: strokeWidthRef.current,
    };
    updateStrokes(activeBoardIdx, [...(board?.strokes ?? []), stroke]);
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

  const renderArrow = (s: Stroke) => {
    if (s.x1 == null || s.y1 == null || s.x2 == null || s.y2 == null) return null;
    const dx = s.x2 - s.x1; const dy = s.y2 - s.y1;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len < 5) return null;
    const ux = dx/len; const uy = dy/len;
    const as = 12;
    const px = -uy; const py = ux;
    const tip = { x: s.x2, y: s.y2 };
    const b1  = { x: s.x2 - ux*as + px*as*0.5, y: s.y2 - uy*as + py*as*0.5 };
    const b2  = { x: s.x2 - ux*as - px*as*0.5, y: s.y2 - uy*as - py*as*0.5 };
    return (
      <G key={s.id}>
        <Line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={s.strokeWidth} />
        <Path d={`M${tip.x},${tip.y} L${b1.x},${b1.y} L${b2.x},${b2.y} Z`} fill={s.color} />
      </G>
    );
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

        {/* Toolbar above the canvas */}
        <View style={styles.toolbar}>
          <View style={styles.toolRow}>
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
            <TouchableOpacity style={styles.toolBtn} onPress={undo}>
              <Ionicons name="arrow-undo" size={18} color="#9ca3af" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.toolBtn} onPress={clearAll}>
              <Ionicons name="refresh" size={18} color="#9ca3af" />
            </TouchableOpacity>
          </View>
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
                {board?.strokes.map(s => {
                  if (s.type === 'path')   return <Path key={s.id} d={s.d} stroke={s.color} strokeWidth={s.strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
                  if (s.type === 'circle') return <Circle key={s.id} cx={s.cx} cy={s.cy} r={s.r} stroke={s.color} strokeWidth={s.strokeWidth} fill="none" />;
                  if (s.type === 'arrow')  return renderArrow(s);
                  if (s.type === 'text')   return <SvgText key={s.id} x={s.x} y={s.y} fill={s.color} fontSize={16} fontWeight="bold">{s.label}</SvgText>;
                  return null;
                })}
                {livePath ? (
                  <Path
                    d={livePath}
                    stroke={tool === 'eraser' ? WOOD_BASE : color}
                    strokeWidth={tool === 'eraser' ? 20 : strokeWidth}
                    fill="none" strokeLinecap="round" strokeLinejoin="round"
                  />
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
                        {b.court_type === 'full' ? 'Full Court' : b.court_type === 'half' ? 'Half Court' : '3/4 Court'} · {b.strokes.length} strokes
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
  container:      { flex: 1, backgroundColor: '#0a0a0a' },
  header:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 56 : 16, paddingBottom: 10, backgroundColor: '#111827' },
  headerBtn:      { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  boardName:      { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1 },
  closeBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1f2937', alignItems: 'center', justifyContent: 'center' },
  courtSelector:  { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  courtChip:      { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: '#374151' },
  courtChipActive:{ backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  courtChipText:  { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  toolbar:        { backgroundColor: '#111827', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#1f2937', gap: 10 },
  toolRow:        { flexDirection: 'row', alignItems: 'center', gap: 4 },
  toolBtn:        { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f2937' },
  toolBtnActive:  { backgroundColor: '#7c3aed' },
  colorRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  colorDot:       { width: 22, height: 22, borderRadius: 11 },
  colorDotActive: { borderWidth: 2, borderColor: '#fff' },
  widthDot:       { backgroundColor: '#fff' },
  canvasWrapper:  { width: COURT_W, borderRadius: 8, overflow: 'hidden' },
  listOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  listBox:        { backgroundColor: '#1f2937', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '60%' },
  listTitle:      { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 14 },
  listRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#374151' },
  listItemText:   { color: '#d1d5db', fontSize: 15, fontWeight: '600' },
  listItemSub:    { color: '#6b7280', fontSize: 11, marginTop: 2 },
  addBoardBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#7c3aed', borderRadius: 10, paddingVertical: 12, marginTop: 12 },
  listClose:      { alignItems: 'center', marginTop: 10 },
  textField:      { backgroundColor: '#111827', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#374151' },
});
