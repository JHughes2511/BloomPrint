import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  PanResponder, Alert, TextInput, ScrollView, ActivityIndicator,
  Dimensions, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle, Line, Defs, Marker, G, Rect, Text as SvgText } from 'react-native-svg';
import { whiteboardAPI } from '../api/client';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const COURT_W = SCREEN_W - 32;
const COURT_H = COURT_W * (94 / 50); // full court ratio
const HALF_H = COURT_H / 2;
const THREE_Q_H = COURT_H * 0.75;

type CourtType = 'full' | 'half' | 'three_quarter';
type Tool = 'pen' | 'circle' | 'arrow' | 'text' | 'eraser';

interface Stroke {
  id: string;
  type: 'path' | 'circle' | 'arrow' | 'text';
  d?: string;           // SVG path string
  cx?: number; cy?: number; r?: number;  // circle
  x1?: number; y1?: number; x2?: number; y2?: number; // arrow
  x?: number; y?: number; label?: string;              // text
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

function CourtSvg({ courtType }: { courtType: CourtType }) {
  const h = courtType === 'full' ? COURT_H : courtType === 'half' ? HALF_H : THREE_Q_H;
  const w = COURT_W;
  const s = w / 50; // scale: 1 foot = s px  (court is 50ft wide)

  // Key court measurements in feet → pixels
  const midY = h / 2;
  const paint_w = 16 * s;
  const paint_h = 19 * s;
  const three_r = 23.75 * s;
  const ft_line = 15 * s;
  const lane_x = (w - paint_w) / 2;

  const courtColor = '#1a3a1a';
  const lineColor = '#ffffff';
  const lw = 1.5;

  if (courtType === 'full') {
    return (
      <Svg width={w} height={h}>
        <Rect x={0} y={0} width={w} height={h} fill={courtColor} />
        {/* Boundary */}
        <Rect x={2} y={2} width={w - 4} height={h - 4} fill="none" stroke={lineColor} strokeWidth={lw} />
        {/* Half court line */}
        <Line x1={0} y1={midY} x2={w} y2={midY} stroke={lineColor} strokeWidth={lw} />
        {/* Center circle */}
        <Circle cx={w / 2} cy={midY} r={6 * s} fill="none" stroke={lineColor} strokeWidth={lw} />
        {/* Top paint */}
        <Rect x={lane_x} y={2} width={paint_w} height={paint_h} fill="none" stroke={lineColor} strokeWidth={lw} />
        {/* Bottom paint */}
        <Rect x={lane_x} y={h - 2 - paint_h} width={paint_w} height={paint_h} fill="none" stroke={lineColor} strokeWidth={lw} />
        {/* Top free throw circle */}
        <Circle cx={w / 2} cy={2 + paint_h} r={6 * s} fill="none" stroke={lineColor} strokeWidth={lw} strokeDasharray="6,4" />
        {/* Bottom free throw circle */}
        <Circle cx={w / 2} cy={h - 2 - paint_h} r={6 * s} fill="none" stroke={lineColor} strokeWidth={lw} strokeDasharray="6,4" />
        {/* Top 3pt arc */}
        <Path d={`M ${lane_x - (three_r - paint_w / 2)} 2 A ${three_r} ${three_r} 0 0 1 ${lane_x + paint_w + (three_r - paint_w / 2)} 2`} fill="none" stroke={lineColor} strokeWidth={lw} />
        {/* Bottom 3pt arc */}
        <Path d={`M ${lane_x - (three_r - paint_w / 2)} ${h - 2} A ${three_r} ${three_r} 0 0 0 ${lane_x + paint_w + (three_r - paint_w / 2)} ${h - 2}`} fill="none" stroke={lineColor} strokeWidth={lw} />
        {/* Top basket */}
        <Circle cx={w / 2} cy={2 + ft_line * 0.4} r={9} fill="none" stroke="#f59e0b" strokeWidth={1.5} />
        {/* Bottom basket */}
        <Circle cx={w / 2} cy={h - 2 - ft_line * 0.4} r={9} fill="none" stroke="#f59e0b" strokeWidth={1.5} />
      </Svg>
    );
  }

  // Half / three_quarter — show bottom half of full court
  const offsetY = courtType === 'half' ? -midY : -(h - THREE_Q_H);
  return (
    <Svg width={w} height={h}>
      <Rect x={0} y={0} width={w} height={h} fill={courtColor} />
      <G transform={`translate(0, ${offsetY})`}>
        {/* Boundary */}
        <Rect x={2} y={2} width={w - 4} height={COURT_H - 4} fill="none" stroke={lineColor} strokeWidth={lw} />
        {/* Half court line */}
        <Line x1={0} y1={midY} x2={w} y2={midY} stroke={lineColor} strokeWidth={lw} />
        {/* Center circle */}
        <Circle cx={w / 2} cy={midY} r={6 * s} fill="none" stroke={lineColor} strokeWidth={lw} />
        {/* Bottom paint */}
        <Rect x={lane_x} y={COURT_H - 2 - paint_h} width={paint_w} height={paint_h} fill="none" stroke={lineColor} strokeWidth={lw} />
        {/* Bottom free throw circle */}
        <Circle cx={w / 2} cy={COURT_H - 2 - paint_h} r={6 * s} fill="none" stroke={lineColor} strokeWidth={lw} strokeDasharray="6,4" />
        {/* Bottom 3pt arc */}
        <Path d={`M ${lane_x - (three_r - paint_w / 2)} ${COURT_H - 2} A ${three_r} ${three_r} 0 0 0 ${lane_x + paint_w + (three_r - paint_w / 2)} ${COURT_H - 2}`} fill="none" stroke={lineColor} strokeWidth={lw} />
        {/* Bottom basket */}
        <Circle cx={w / 2} cy={COURT_H - 2 - ft_line * 0.4} r={9} fill="none" stroke="#f59e0b" strokeWidth={1.5} />
      </G>
      {/* Clip overlay to hide content outside bounds */}
      <Rect x={0} y={0} width={w} height={2} fill="#111827" />
    </Svg>
  );
}

interface Props {
  visible: boolean;
  gameId: number;
  onClose: () => void;
}

export default function WhiteboardModal({ visible, gameId, onClose }: Props) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoardIdx, setActiveBoardIdx] = useState(0);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#ffffff');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [showBoardList, setShowBoardList] = useState(false);
  const [showAddText, setShowAddText] = useState(false);
  const [pendingTextPos, setPendingTextPos] = useState({ x: 0, y: 0 });
  const [textInput, setTextInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const currentPath = useRef('');
  const startPoint = useRef({ x: 0, y: 0 });

  const board = boards[activeBoardIdx];
  const courtH = board?.court_type === 'full' ? COURT_H : board?.court_type === 'half' ? HALF_H : THREE_Q_H;

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
    const newBoard: Board = { name: `Board ${boards.length + 1}`, court_type: 'full', strokes: [] };
    setBoards(prev => [...prev, newBoard]);
    setActiveBoardIdx(boards.length);
    setShowBoardList(false);
  };

  const deleteBoard = (idx: number) => {
    const b = boards[idx];
    Alert.alert('Delete Board', `Delete "${b.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          if (b.id) await whiteboardAPI.delete(b.id);
          setBoards(prev => prev.filter((_, i) => i !== idx));
          setActiveBoardIdx(Math.max(0, idx - 1));
        },
      },
    ]);
  };

  const undo = () => {
    if (!board) return;
    const strokes = [...board.strokes];
    strokes.pop();
    updateStrokes(activeBoardIdx, strokes);
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
      onMoveShouldSetPanResponder: () => true,

      onPanResponderGrant: (evt) => {
        const { locationX: x, locationY: y } = evt.nativeEvent;
        startPoint.current = { x, y };
        if (tool === 'pen' || tool === 'eraser') {
          currentPath.current = `M${x.toFixed(1)},${y.toFixed(1)}`;
        } else if (tool === 'text') {
          setPendingTextPos({ x, y });
          setShowAddText(true);
        }
      },

      onPanResponderMove: (evt) => {
        const { locationX: x, locationY: y } = evt.nativeEvent;
        if (tool === 'pen' || tool === 'eraser') {
          currentPath.current += ` L${x.toFixed(1)},${y.toFixed(1)}`;
          // Force re-render by updating a live path state
          setLivePath(currentPath.current);
        }
      },

      onPanResponderRelease: (evt) => {
        const { locationX: x2, locationY: y2 } = evt.nativeEvent;
        const { x: x1, y: y1 } = startPoint.current;

        if ((tool === 'pen' || tool === 'eraser') && currentPath.current) {
          const stroke: Stroke = {
            id: uid(),
            type: 'path',
            d: currentPath.current,
            color: tool === 'eraser' ? '#1a3a1a' : color,
            strokeWidth: tool === 'eraser' ? 18 : strokeWidth,
          };
          setBoards(prev => {
            const next = [...prev];
            const updated = { ...next[activeBoardIdxRef.current], strokes: [...next[activeBoardIdxRef.current].strokes, stroke] };
            next[activeBoardIdxRef.current] = updated;
            saveBoard(activeBoardIdxRef.current, updated);
            return next;
          });
          currentPath.current = '';
          setLivePath('');
        } else if (tool === 'circle') {
          const r = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) / 2;
          const stroke: Stroke = { id: uid(), type: 'circle', cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, r: Math.max(r, 10), color, strokeWidth };
          setBoards(prev => {
            const next = [...prev];
            const updated = { ...next[activeBoardIdxRef.current], strokes: [...next[activeBoardIdxRef.current].strokes, stroke] };
            next[activeBoardIdxRef.current] = updated;
            saveBoard(activeBoardIdxRef.current, updated);
            return next;
          });
        } else if (tool === 'arrow') {
          const stroke: Stroke = { id: uid(), type: 'arrow', x1, y1, x2, y2, color, strokeWidth };
          setBoards(prev => {
            const next = [...prev];
            const updated = { ...next[activeBoardIdxRef.current], strokes: [...next[activeBoardIdxRef.current].strokes, stroke] };
            next[activeBoardIdxRef.current] = updated;
            saveBoard(activeBoardIdxRef.current, updated);
            return next;
          });
        }
      },
    })
  ).current;

  const activeBoardIdxRef = useRef(activeBoardIdx);
  useEffect(() => { activeBoardIdxRef.current = activeBoardIdx; }, [activeBoardIdx]);

  const [livePath, setLivePath] = useState('');

  const addText = () => {
    if (!textInput.trim()) { setShowAddText(false); return; }
    const stroke: Stroke = { id: uid(), type: 'text', x: pendingTextPos.x, y: pendingTextPos.y, label: textInput.trim(), color, strokeWidth };
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
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 5) return null;
    const ux = dx / len; const uy = dy / len;
    const arrowSize = 12;
    const px = -uy; const py = ux;
    const tip = { x: s.x2, y: s.y2 };
    const base1 = { x: s.x2 - ux * arrowSize + px * arrowSize * 0.5, y: s.y2 - uy * arrowSize + py * arrowSize * 0.5 };
    const base2 = { x: s.x2 - ux * arrowSize - px * arrowSize * 0.5, y: s.y2 - uy * arrowSize - py * arrowSize * 0.5 };
    return (
      <G key={s.id}>
        <Line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={s.strokeWidth} />
        <Path d={`M${tip.x},${tip.y} L${base1.x},${base1.y} L${base2.x},${base2.y} Z`} fill={s.color} />
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

        {/* Drawing canvas */}
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color="#7c3aed" size="large" />
          </View>
        ) : (
          <View style={[styles.canvasWrapper, { height: courtH }]} {...panResponder.panHandlers}>
            <CourtSvg courtType={board?.court_type ?? 'full'} />
            <Svg style={StyleSheet.absoluteFill} width={COURT_W} height={courtH}>
              {board?.strokes.map(s => {
                if (s.type === 'path') return <Path key={s.id} d={s.d} stroke={s.color} strokeWidth={s.strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
                if (s.type === 'circle') return <Circle key={s.id} cx={s.cx} cy={s.cy} r={s.r} stroke={s.color} strokeWidth={s.strokeWidth} fill="none" />;
                if (s.type === 'arrow') return renderArrow(s);
                if (s.type === 'text') return <SvgText key={s.id} x={s.x} y={s.y} fill={s.color} fontSize={16} fontWeight="bold">{s.label}</SvgText>;
                return null;
              })}
              {/* Live stroke preview */}
              {livePath ? <Path d={livePath} stroke={tool === 'eraser' ? '#1a3a1a' : color} strokeWidth={tool === 'eraser' ? 18 : strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
            </Svg>
          </View>
        )}

        {/* Bottom toolbar */}
        <View style={styles.toolbar}>
          {/* Tools */}
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
          {/* Colors */}
          <View style={styles.colorRow}>
            {COLORS.map(c => (
              <TouchableOpacity
                key={c}
                style={[styles.colorDot, { backgroundColor: c }, color === c && styles.colorDotActive]}
                onPress={() => setColor(c)}
              />
            ))}
            {/* Stroke width */}
            <View style={{ marginLeft: 8, flexDirection: 'row', gap: 6 }}>
              {[2, 4, 7].map(w => (
                <TouchableOpacity
                  key={w}
                  style={[styles.widthDot, { width: w * 3, height: w * 3, borderRadius: w * 3 }, strokeWidth === w && { borderColor: '#fff', borderWidth: 2 }]}
                  onPress={() => setStrokeWidth(w)}
                />
              ))}
            </View>
          </View>
        </View>

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
                      <Text style={styles.listItemSub}>{b.court_type === 'full' ? 'Full Court' : b.court_type === 'half' ? 'Half Court' : '3/4 Court'} · {b.strokes.length} strokes</Text>
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
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 56 : 16, paddingBottom: 10, backgroundColor: '#111827' },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  boardName: { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1f2937', alignItems: 'center', justifyContent: 'center' },
  courtSelector: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#111827', borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  courtChip: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: '#374151' },
  courtChipActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  courtChipText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
  canvasWrapper: { width: COURT_W, marginHorizontal: 16, marginTop: 12, borderRadius: 8, overflow: 'hidden', alignSelf: 'center' },
  toolbar: { backgroundColor: '#111827', paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: '#1f2937', gap: 10, marginTop: 'auto' },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  toolBtn: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f2937' },
  toolBtnActive: { backgroundColor: '#7c3aed' },
  colorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  colorDot: { width: 22, height: 22, borderRadius: 11 },
  colorDotActive: { borderWidth: 2, borderColor: '#fff' },
  widthDot: { backgroundColor: '#fff' },
  listOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  listBox: { backgroundColor: '#1f2937', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '60%' },
  listTitle: { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 14 },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#374151' },
  listItemText: { color: '#d1d5db', fontSize: 15, fontWeight: '600' },
  listItemSub: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  addBoardBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#7c3aed', borderRadius: 10, paddingVertical: 12, marginTop: 12 },
  listClose: { alignItems: 'center', marginTop: 10 },
  textField: { backgroundColor: '#111827', borderRadius: 10, padding: 12, color: '#fff', fontSize: 15, borderWidth: 1, borderColor: '#374151' },
});
