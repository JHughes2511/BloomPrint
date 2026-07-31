/**
 * The frame around sign-in, registration and role select on a wide screen.
 *
 * These four screens were capped at 460px, which put a phone-width column in
 * the middle of a 2000px window with nothing either side — the same letterbox
 * the app shell had already moved away from. A signup form is not a phone
 * screen with margins: at this width it needs a container, and the empty half
 * of the window is the first thing anyone sees of the product.
 *
 * So the width gets used rather than avoided: a brand panel on one side, the
 * form on the other. The panel carries no new copy — it reuses the wordmark and
 * subtitle these screens already show, so nothing here needs translating that
 * isn't already translated.
 *
 * Below the sidebar breakpoint this is a pass-through. Phones and tablets get
 * exactly the layout they had, which is the right one for their width.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { useBreakpoint } from './useBreakpoint';
import PageContainer from './PageContainer';

/** Form column width. Wide enough for a comfortable field, narrow enough that
 *  a label and its input stay visually connected. */
const FORM_WIDTH = 520;

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { isDesktop } = useBreakpoint();
  const { t } = useTheme();
  const { t: tr } = useTranslation();

  if (!isDesktop) return <PageContainer>{children}</PageContainer>;

  const s = makeStyles(t);
  return (
    <View style={s.split}>
      <View style={s.panel}>
        <View style={s.panelInner}>
          <Text style={s.panelMark}>BloomPrint</Text>
          <Text style={s.panelSub}>{tr('auth.coachScoutTrainer')}</Text>
        </View>
      </View>

      <View style={s.formSide}>
        <View style={s.formCol}>{children}</View>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  split: { flex: 1, flexDirection: 'row' },

  // A proportion with bounds, not a fixed width: at 420px flat the panel read
  // as a stripe down the side of a 2000px window rather than as half of a
  // deliberate split. The cap stops it becoming a mostly-empty field of colour
  // on an ultrawide, and the floor keeps the wordmark off the edge at 1024.
  panel: {
    width: '38%',
    minWidth: 360,
    maxWidth: 620,
    backgroundColor: t.isDark ? '#0C2331' : '#123B52',
    justifyContent: 'center',
    paddingHorizontal: 48,
  },
  panelInner: { gap: 10 },
  panelMark: { color: '#FFFFFF', fontSize: 40, fontFamily: fonts[800], letterSpacing: -0.5 },
  panelSub: { color: 'rgba(255,255,255,0.72)', fontSize: 15, fontFamily: fonts[500] },

  formSide: { flex: 1, alignItems: 'center' },
  formCol: { flex: 1, width: '100%', maxWidth: FORM_WIDTH, paddingHorizontal: 24 },
});
