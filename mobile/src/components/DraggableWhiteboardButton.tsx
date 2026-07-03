import React, { useRef } from 'react';
import { Animated, PanResponder, Dimensions, StyleSheet } from 'react-native';
import Svg, { Rect, Circle, Path, Line } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

const W = 54;
const H = 54;

// Same palette as the whiteboard's hardwood court.
const WOOD_A = '#E5C593';
const WOOD_B = '#DDBA84';
const LINE = '#7A4326';

/** The button IS a miniature hardwood half-court — no surrounding bubble. */
function MiniCourt() {
  const lw = 1.6;
  return (
    <Svg width={W} height={H}>
      {/* wood planks */}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <Rect key={i} x={i * (W / 6)} y={0} width={W / 6} height={H}
              fill={i % 2 === 0 ? WOOD_A : WOOD_B} />
      ))}
      {/* boundary */}
      <Rect x={lw} y={lw} width={W - lw * 2} height={H - lw * 2}
            rx={9} stroke={LINE} strokeWidth={lw} fill="none" />
      {/* key */}
      <Rect x={W / 2 - 9} y={H - 22} width={18} height={20}
            stroke={LINE} strokeWidth={lw} fill="rgba(122,67,38,0.10)" />
      {/* free-throw circle */}
      <Circle cx={W / 2} cy={H - 22} r={7} stroke={LINE} strokeWidth={lw} fill="none" />
      {/* rim */}
      <Circle cx={W / 2} cy={H - 7} r={2.4} stroke={LINE} strokeWidth={lw} fill="none" />
      {/* backboard */}
      <Line x1={W / 2 - 5} y1={H - 4} x2={W / 2 + 5} y2={H - 4} stroke={LINE} strokeWidth={lw + 0.6} />
      {/* three-point arc */}
      <Path d={`M 7 ${H - 2} Q 7 14 ${W / 2} 14 Q ${W - 7} 14 ${W - 7} ${H - 2}`}
            stroke={LINE} strokeWidth={lw} fill="none" />
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
  const { width, height } = Dimensions.get('window');
  const { t } = useTheme();

  // Start near the bottom-right corner.
  const pan = useRef(
    new Animated.ValueXY({ x: width - W - 20, y: height - H - 160 })
  ).current;
  const offset = useRef({ x: width - W - 20, y: height - H - 160 });
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
        nx = Math.max(8, Math.min(nx, width - W - 8));
        ny = Math.max(40, Math.min(ny, height - H - 40));
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
    <Animated.View
      style={[
        styles.button,
        { borderColor: t.cardBorder, transform: pan.getTranslateTransform() },
      ]}
      {...panResponder.panHandlers}
    >
      <MiniCourt />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: W,
    height: H,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 10,
    zIndex: 100,
  },
});
