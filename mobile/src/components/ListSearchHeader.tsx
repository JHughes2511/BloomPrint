/**
 * A section title with a way to search the list under it.
 *
 * The pickers behind Game Report and Scout are grids that run to a season's
 * worth of cards, and finding one meant reading all of them.
 *
 * On a desktop the box sits on the title line, where there is room for both.
 * A phone has no such room — a box beside the words broke "Game Report" onto
 * two lines and left the title fighting the field for the same inch — so
 * there the line carries a search icon and the box drops in underneath it,
 * full width, when it is pressed.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useBreakpoint } from '../responsive/useBreakpoint';
import { useTheme } from '../theme/ThemeProvider';

export default function ListSearchHeader({
  title, titleStyle, value, onChange, placeholder, subtitle,
}: {
  title: string;
  titleStyle?: any;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** Rendered under the title line, above the box on a phone. */
  subtitle?: React.ReactNode;
}) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const { isPhone } = useBreakpoint();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<any>(null);

  // Focused by hand on the web so it can be asked not to scroll: the browser
  // bringing a newly focused field into view yanks the page out from under
  // the coach who has just tapped the icon.
  useEffect(() => {
    if (!open || Platform.OS !== 'web') return;
    const id = requestAnimationFrame(() => {
      const node: any = inputRef.current;
      try { node?.focus?.({ preventScroll: true }); } catch { node?.focus?.(); }
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const field = (style?: any) => (
    <View style={[{
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingHorizontal: 10, paddingVertical: isPhone ? 5 : 7, borderRadius: 10,
      borderWidth: 1, borderColor: t.line, backgroundColor: t.card,
    }, style]}>
      <Ionicons name="search" size={14} color={t.muted} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={t.muted2}
        style={{
          flex: 1, minWidth: 0, color: t.ink, fontSize: 13, paddingVertical: 2,
          ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null),
        }}
      />
      {!!value && (
        <TouchableOpacity onPress={() => onChange('')} style={{ padding: 2 }}
                          accessibilityLabel={tr('common.close')}>
          <Ionicons name="close" size={14} color={t.muted} />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={[{ flex: 1 }, titleStyle]} numberOfLines={2}>{title}</Text>
        {isPhone ? (
          <TouchableOpacity
            accessibilityLabel={tr('reportSearch.open')}
            onPress={() => {
              // Closing puts the list back: a filter left on behind a shut box
              // is a page of missing games with nothing on screen saying why.
              if (open) onChange('');
              setOpen(o => !o);
            }}
            // The frame is light beside a heading; the target is not.
            //
            // The padding here is the target and the border below is the
            // frame, so the square a coach sees is small and the area that
            // answers a thumb is not. hitSlop would have been the obvious way
            // and does nothing on the web — measured: a press six pixels
            // outside the box did not open the search. The negative margin
            // gives the padding back to the layout, so the frame still sits
            // where it looks like it sits.
            style={{ padding: 8, margin: -8 }}
          >
            <View style={{
              padding: 5, borderRadius: 7, borderWidth: 1,
              borderColor: open ? t.accent : t.line,
              backgroundColor: open ? t.accentSoft : 'transparent',
            }}>
              <Ionicons name="search-outline" size={15} color={open ? t.accent : t.muted} />
            </View>
          </TouchableOpacity>
        ) : field({ width: '100%', maxWidth: 260, flexShrink: 1 })}
      </View>
      {subtitle}
      {isPhone && open && field({ marginTop: 8 })}
    </View>
  );
}
