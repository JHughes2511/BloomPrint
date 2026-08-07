import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
  Platform, Share, Clipboard,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Sheet from './Sheet';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { teamInviteAPI, joinUrl } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { sheetCap } from '../responsive/modalSizes';

/**
 * The link a coach hands out to fill a team.
 *
 * The QR encodes a URL rather than a bare code, which is the whole point: a
 * phone's own camera opens it, so it works held up in a team meeting, printed
 * on a gym wall, or pasted into a group chat by someone who has never heard of
 * this app.
 *
 * A link belongs to whoever made it. Revoke kills yours and nobody else's — an
 * assistant with their own link for the same team keeps it, and revokes it
 * themselves. Revoking closes the door; it does not remove anyone already in.
 */
export default function TeamInviteSheet({
  visible, teamId, teamName, onClose,
}: {
  visible: boolean;
  teamId: number | null;
  teamName?: string;
  onClose: () => void;
}) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const [link, setLink] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const url = link?.code ? joinUrl(link.code) : '';

  useEffect(() => {
    if (!visible || !teamId) return;
    setLoading(true);
    setCopied(false);
    // Hand back the one that already exists, or make the first — a coach
    // opening this twice must not end up with two live links.
    teamInviteAPI.create(teamId)
      .then(setLink)
      .catch((e: any) => Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('teamInvite.couldNotCreate')))
      .finally(() => setLoading(false));
  }, [visible, teamId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async () => {
    if (!url) return;
    try {
      if (Platform.OS === 'web' && (navigator as any)?.clipboard) {
        await (navigator as any).clipboard.writeText(url);
      } else {
        (Clipboard as any).setString(url);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const share = async () => {
    if (!url) return;
    const message = tr('teamInvite.shareMessage', { team: teamName ?? link?.team_name ?? '', url });
    try {
      // The browser's share sheet where there is one; otherwise copying is the
      // honest fallback rather than a button that silently does nothing.
      if (Platform.OS === 'web') {
        const nav: any = navigator;
        if (nav?.share) { await nav.share({ title: teamName, text: message, url }); return; }
        await copy();
        return;
      }
      await Share.share({ message });
    } catch {}
  };

  /** Save the QR as an image to print. Web only — a phone can screenshot. */
  const download = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const svg = document.querySelector('[data-bloomprint-qr] svg');
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const a = document.createElement('a');
    a.href = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    a.download = `${(teamName || 'team').replace(/[^\w.-]+/g, '-')}-invite.svg`;
    a.click();
  };

  const revoke = () => {
    if (!link?.id) return;
    Alert.alert(tr('teamInvite.revokeTitle'), tr('teamInvite.revokeMessage'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('teamInvite.revoke'), style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await teamInviteAPI.revoke(link.id);
            const fresh = await teamInviteAPI.create(teamId!);
            setLink(fresh);
          } catch (e: any) {
            Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('teamInvite.couldNotRevoke'));
          } finally { setBusy(false); }
        },
      },
    ]);
  };

  const joined: any[] = link?.joined ?? [];

  return (
    <Sheet visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.box}>
          <View style={s.header}>
            <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
              <Text style={s.title} numberOfLines={1}>{tr('teamInvite.title')}</Text>
              <Text style={s.sub} numberOfLines={2}>{tr('teamInvite.sub', { team: teamName ?? '' })}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={{ flexShrink: 0 }}>
              <Ionicons name="close" size={22} color={t.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
            {loading ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator color={t.accent} />
              </View>
            ) : !url ? (
              <Text style={{ color: t.muted2, paddingVertical: 20 }}>{tr('teamInvite.couldNotCreate')}</Text>
            ) : (
              <>
                <View style={s.qrWrap} {...({ 'data-bloomprint-qr': 'true' } as any)}>
                  <QRCode value={url} size={200} backgroundColor="#FFFFFF" color="#111111" />
                </View>

                <TouchableOpacity style={s.linkBox} onPress={copy} activeOpacity={0.7}>
                  <Text style={s.linkText} numberOfLines={1}>{url}</Text>
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16}
                            color={copied ? t.positive : t.muted} />
                </TouchableOpacity>
                {copied && <Text style={s.copied}>{tr('teamInvite.copied')}</Text>}

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <TouchableOpacity style={s.action} onPress={share}>
                    <Ionicons name="share-outline" size={16} color={t.ink} />
                    <Text style={s.actionText} numberOfLines={1}>{tr('teamInvite.share')}</Text>
                  </TouchableOpacity>
                  {Platform.OS === 'web' && (
                    <TouchableOpacity style={s.action} onPress={download}>
                      <Ionicons name="download-outline" size={16} color={t.ink} />
                      <Text style={s.actionText} numberOfLines={1}>{tr('teamInvite.download')}</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <Text style={s.hint}>{tr('teamInvite.hint')}</Text>

                {joined.length > 0 && (
                  <View style={{ marginTop: 18 }}>
                    <Text style={s.sectionLabel}>{tr('teamInvite.joinedLabel', { count: joined.length })}</Text>
                    {joined.map((j, i) => (
                      <View key={i} style={s.joinRow}>
                        <Ionicons
                          name={j.kind === 'player' ? 'person-outline' : 'people-outline'}
                          size={14} color={t.muted}
                        />
                        <Text style={s.joinName} numberOfLines={1}>{j.name}</Text>
                        <Text style={s.joinKind}>
                          {j.kind === 'player' ? tr('teamInvite.asPlayer') : tr('teamInvite.asStaff')}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                <TouchableOpacity style={s.revoke} onPress={revoke} disabled={busy}>
                  {busy ? <ActivityIndicator color={t.negative} size="small" /> : (
                    <>
                      <Ionicons name="close-circle-outline" size={16} color={t.negative} />
                      <Text style={s.revokeText} numberOfLines={1}>{tr('teamInvite.revokeAndNew')}</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Sheet>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  box: { backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 30, maxHeight: '92%', ...sheetCap(560) },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  title: { color: t.ink, fontSize: 18, fontFamily: fonts[800] },
  sub: { color: t.muted2, fontSize: 12, marginTop: 3 },
  qrWrap: { alignSelf: 'center', backgroundColor: '#FFFFFF', padding: 16, borderRadius: 16, marginBottom: 14 },
  linkBox: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.chip, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderColor: t.line },
  linkText: { flex: 1, color: t.inkSoft, fontSize: 12.5 },
  copied: { color: t.positive, fontSize: 11, marginTop: 6 },
  action: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: 12, borderWidth: 1, borderColor: t.line, backgroundColor: t.card },
  actionText: { color: t.ink, fontSize: 13, fontFamily: fonts[700], flexShrink: 1 },
  hint: { color: t.muted2, fontSize: 11.5, lineHeight: 17, marginTop: 12 },
  sectionLabel: { color: t.label, fontSize: 11, fontFamily: fonts[700], textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  joinRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.chip },
  joinName: { flex: 1, color: t.ink, fontSize: 13.5, flexShrink: 1 },
  joinKind: { color: t.muted2, fontSize: 11 },
  revoke: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: 12, marginTop: 18, borderWidth: 1, borderColor: t.negative },
  revokeText: { color: t.negative, fontSize: 13, fontFamily: fonts[700], flexShrink: 1 },
});
