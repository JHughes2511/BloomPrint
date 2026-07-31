/**
 * Two fields side by side once there's room, stacked when there isn't.
 *
 * The register form is ten controls tall. In a single column on a laptop the
 * submit button sits below the fold, so signing up means scrolling past your
 * own form to find it. Pairing the fields that naturally belong together —
 * name and program, level and country, email and password — brings the whole
 * thing above the fold without shrinking anything.
 *
 * On a phone this renders its children exactly as they were, in order.
 */
import React from 'react';
import { View } from 'react-native';
import { useBreakpoint } from './useBreakpoint';

export default function FieldRow({ children }: { children: React.ReactNode }) {
  const { isDesktop } = useBreakpoint();
  const items = React.Children.toArray(children);

  if (!isDesktop) return <>{children}</>;

  return (
    // alignSelf stretch is load-bearing: these forms centre their children
    // (alignItems: 'center'), so without it the row shrinks to fit its content
    // instead of filling the column. The fields inside are width: '100%', which
    // then resolves against a row that has no width of its own, and the pair
    // spills out both sides of the form.
    <View style={{ flexDirection: 'row', gap: 12, alignSelf: 'stretch', width: '100%' }}>
      {items.map((child, i) => (
        // minWidth 0 lets a column shrink below its content: without it a long
        // placeholder keeps the field at its natural width and overflows again.
        <View key={i} style={{ flex: 1, minWidth: 0 }}>
          {child}
        </View>
      ))}
    </View>
  );
}
