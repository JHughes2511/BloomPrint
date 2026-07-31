/**
 * Desktop navigation: the bottom tabs, as a proper sidebar.
 *
 * React Navigation's own `tabBarPosition: 'left'` gets most of the way there,
 * but sizes the rail as a fraction of the window — 360px on a 1440px screen,
 * which is a quarter of the display spent on five links — and its active state
 * is a saturated pill that fights the app's palette. Width and emphasis are
 * exactly what a sidebar needs to control, so this renders the same navigation
 * state directly.
 *
 * It reads from the navigator's own descriptors, so routes, icons, labels and
 * the focused route all stay in one place: adding a tab in App.tsx adds it here
 * with no further work.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';

export const SIDEBAR_WIDTH = 236;

export default function Sidebar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { t } = useTheme();
  const s = makeStyles(t);

  return (
    <View style={s.rail}>
      <Text style={s.wordmark}>BLOOMPRINT</Text>

      <View style={s.items}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : (options.title ?? route.name);

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            // Same guard the default tab bar uses: a tab may cancel its own
            // press (to scroll to top, for instance) and navigating anyway
            // would override that.
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const color = focused ? t.accent : t.muted2;

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={typeof label === 'string' ? label : route.name}
              style={({ hovered }: any) => [
                s.item,
                // A hover state is the affordance a browser user expects and a
                // touch screen never needed; without it a sidebar link feels dead.
                hovered && !focused && s.itemHover,
                focused && s.itemActive,
              ]}
            >
              {options.tabBarIcon?.({ focused, color, size: 20 })}
              <Text numberOfLines={1} style={[s.label, { color }, focused && s.labelActive]}>
                {typeof label === 'string' ? label : route.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  rail: {
    width: SIDEBAR_WIDTH,
    paddingTop: 24,
    paddingHorizontal: 12,
    backgroundColor: t.isDark ? '#0C2331' : '#EFE7DA',
    borderRightWidth: 1,
    borderRightColor: t.divider,
  },
  wordmark: {
    color: t.accent,
    fontSize: 12,
    fontFamily: fonts[800],
    letterSpacing: 2,
    marginLeft: 14,
    marginBottom: 22,
  },
  items: { gap: 2 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  // A tint rather than a solid fill: the active row should read as selected,
  // not as a button sitting on top of the navigation.
  itemActive: { backgroundColor: t.accentSoft },
  itemHover: { backgroundColor: t.chip },
  label: { fontSize: 14, fontFamily: fonts[600], flexShrink: 1 },
  labelActive: { fontFamily: fonts[700] },
});
