import React, { useRef } from 'react';
import { Animated, PanResponder, Dimensions, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeProvider';

const SIZE = 52;

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
    new Animated.ValueXY({ x: width - SIZE - 20, y: height - SIZE - 160 })
  ).current;
  const offset = useRef({ x: width - SIZE - 20, y: height - SIZE - 160 });
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
        nx = Math.max(8, Math.min(nx, width - SIZE - 8));
        ny = Math.max(40, Math.min(ny, height - SIZE - 40));
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
        { backgroundColor: t.ctaBg, transform: pan.getTranslateTransform() },
      ]}
      {...panResponder.panHandlers}
    >
      <Ionicons name="clipboard-outline" size={24} color={t.ctaText} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 100,
  },
});
