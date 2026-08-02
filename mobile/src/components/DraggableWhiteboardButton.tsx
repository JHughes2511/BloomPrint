import React, { useRef } from 'react';
import { Animated, PanResponder, Dimensions, StyleSheet, View, Platform } from 'react-native';
import Svg, { Rect, Circle, Path, Line, Defs, ClipPath } from 'react-native-svg';

const W = 52;
const H = 62;

// Same palette as the whiteboard's hardwood court.
const WOOD_A = '#E5C593';
const WOOD_B = '#DDBA84';
const LINE = '#7A4326';   // walnut painted lines
const CLIP = '#5C3A22';   // dark walnut clip

/** A clipboard whose board face is a classic hardwood court. */
function CourtClipboard() {
  const lw = 1.6;
  const bTop = 8;                 // board starts under the clip
  const bx = 2, bw = W - 4, bh = H - bTop - 2;
  const cx = W / 2;
  return (
    <Svg width={W} height={H}>
      <Defs>
        <ClipPath id="boardClip">
          <Rect x={bx} y={bTop} width={bw} height={bh} rx={8} />
        </ClipPath>
      </Defs>

      {/* board face: wood planks clipped to the rounded board */}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <Rect key={i} x={bx + i * (bw / 6)} y={bTop} width={bw / 6} height={bh}
              fill={i % 2 === 0 ? WOOD_A : WOOD_B} clipPath="url(#boardClip)" />
      ))}

      {/* court markings on the board */}
      <Rect x={cx - 8} y={H - 20} width={16} height={18}
            stroke={LINE} strokeWidth={lw} fill="rgba(122,67,38,0.10)" clipPath="url(#boardClip)" />
      <Circle cx={cx} cy={H - 20} r={6} stroke={LINE} strokeWidth={lw} fill="none" clipPath="url(#boardClip)" />
      <Circle cx={cx} cy={H - 7} r={2.2} stroke={LINE} strokeWidth={lw} fill="none" clipPath="url(#boardClip)" />
      <Line x1={cx - 4.5} y1={H - 4} x2={cx + 4.5} y2={H - 4} stroke={LINE} strokeWidth={lw + 0.5} clipPath="url(#boardClip)" />
      <Path d={`M ${bx + 4} ${H - 2} Q ${bx + 4} 18 ${cx} 18 Q ${bx + bw - 4} 18 ${bx + bw - 4} ${H - 2}`}
            stroke={LINE} strokeWidth={lw} fill="none" clipPath="url(#boardClip)" />

      {/* board border */}
      <Rect x={bx + lw / 2} y={bTop + lw / 2} width={bw - lw} height={bh - lw}
            rx={8} stroke={LINE} strokeWidth={lw} fill="none" />

      {/* clipboard clip — dark walnut, classic metal-clip silhouette */}
      <Rect x={cx - 11} y={3} width={22} height={10} rx={4} fill={CLIP} />
      <Rect x={cx - 5} y={0} width={10} height={7} rx={3.5} stroke={CLIP} strokeWidth={2.4} fill="none" />
    </Svg>
  );
}

type Props = {
  onPress: () => void;
};

/**
 * A floating whiteboard button the user can drag anywhere on the screen.
 * Tapping (without dragging) opens the whiteboard; dragging repositions it.
 * Position persists for the lifetime of the component instance.
 */
export default function DraggableWhiteboardButton({ onPress }: Props) {
  // Seeded from the window, then corrected once the parent measures itself.
  //
  // The window is the wrong frame of reference on web: this button is
  // positioned absolutely inside whatever screen renders it, and those screens
  // now sit in a width-capped, centred container. On a 2000px display the
  // window-derived x lands ~700px past the right edge of that container, so
  // the button renders outside its parent and is clipped — the whiteboard
  // looks like it disappeared.
  const { width, height } = Dimensions.get('window');
  const start = { x: width - W - 20, y: height - H - 160 };

  const pan = useRef(new Animated.ValueXY(start)).current;
  const offset = useRef(start);
  const placed = useRef(false);
  // The box the button is actually positioned inside. Measured, because on web
  // it is NOT the window: screens sit in a width-capped container beside a
  // sidebar. The drag is in this box's coordinates, so the release clamp has to
  // be too — clamping against the window instead is what made the button spring
  // back from an edge that was not the edge it was hitting.
  const parentSize = useRef({ w: width, h: height });

  // Only the first measurement repositions it — after that the coach's own
  // dragged position wins, including across a window resize.
  const placeInParent = (w: number, h: number) => {
    // Web only: the button is clipped there because screens sit in a
    // width-capped container. On a phone the window IS the parent, so the
    // original window-derived position is already correct.
    if (w > 0 && h > 0) parentSize.current = { w, h };   // keeps up with resizes
    if (Platform.OS !== 'web') return;
    if (placed.current || w <= 0 || h <= 0) return;
    placed.current = true;
    const next = { x: Math.max(12, w - W - 20), y: Math.max(12, h - H - 100) };
    offset.current = next;
    pan.setValue(next);
  };
  const dragged = useRef(false);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, g) =>
        Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
      onPanResponderGrant: () => {
        dragged.current = false;
        pan.setOffset({ x: offset.current.x, y: offset.current.y });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (_evt, g) => {
        if (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3) dragged.current = true;
        Animated.event([null, { dx: pan.x, dy: pan.y }], {
          useNativeDriver: false,
        })(_evt, g);
      },
      onPanResponderRelease: (_evt, g) => {
        pan.flattenOffset();
        // Clamp inside the screen.
        let nx = offset.current.x + g.dx;
        let ny = offset.current.y + g.dy;
        const { w: pw, h: ph } = parentSize.current;
        nx = Math.max(8, Math.min(nx, pw - W - 8));
        ny = Math.max(40, Math.min(ny, ph - H - 40));
        offset.current = { x: nx, y: ny };
        Animated.spring(pan, {
          toValue: { x: nx, y: ny },
          useNativeDriver: false,
          bounciness: 4,
        }).start();
        if (!dragged.current) onPress();
      },
    })
  ).current;

  return (
    // A transparent full-size layer purely to measure the space the button
    // actually has. box-none so it never intercepts touches meant for the
    // screen underneath — only the button itself is interactive.
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      onLayout={e => placeInParent(e.nativeEvent.layout.width, e.nativeEvent.layout.height)}
    >
      <Animated.View
        style={[styles.button, { transform: pan.getTranslateTransform() }]}
        {...panResponder.panHandlers}
      >
        <CourtClipboard />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: W,
    height: H,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    // The clipboard is a transparent SVG in a rectangular view, so on web the
    // shadow props become a box-shadow that follows the border-box rather than
    // the artwork — a rectangle painted behind a clipboard-shaped drawing.
    //
    // drop-shadow would follow the alpha channel and was tried here, but this
    // view is dragged by an animated transform, and the filter re-rasterised
    // every frame and smeared a trail across the screen. A button you drag
    // cannot carry a filter. No shadow on web is the honest trade: the icon
    // reads fine without one, and nothing is painted that shouldn't be.
    ...Platform.select({
      web: {},
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
        elevation: 8,
      },
    }),
  },
});
