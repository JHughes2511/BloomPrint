import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReportTranslation } from '../hooks/useReportTranslation';
import TranslationToggle from '../components/TranslationToggle';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert, Modal, Switch, KeyboardAvoidingView, Platform, SafeAreaView,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { evalsAPI, playersAPI, playerAPI, staffSharingAPI, coachesAPI } from '../api/client';
import ShareModal from '../components/ShareModal';
import { outputTypeLabel, parseOutputTypes } from '../utils/reportType';
import { extractBrief, getFixedSections, recruitGrade, recruitGradeScale } from '../utils/reportSections';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import PageContainer, { READING_MAX_WIDTH } from '../responsive/PageContainer';
import { Evaluation, Correction, Player } from '../types';
import { GradeBadge } from '../components/GradeBadge';
import { PillarCard } from '../components/PillarCard';
import { mdToHtml, safeFileName, splitReportSections, joinReportSections } from '../utils/mdToHtml';
import { renderReport } from '../utils/renderReport';
import { GeneratingOverlay } from '../components/GeneratingBasketball';

const PILLARS = [
  'offensive_skills', 'defensive_capabilities', 'physical_attributes',
  'intangibles', 'advanced_analysis', 'strategic_fit',
];

// Export section keys — labels resolved at render via i18n (evalReport.exportCats.*).
const EXPORT_CATEGORIES = ['grades', 'flags', 'questions', 'report', 'corrections'];

export default function EvalReportScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { evalId, openShare } = route.params;
  const { t, mode } = useTheme();
  const { t: tr } = useTranslation();
  const styles = makeStyles(t);
  // Display label for a pillar key (API keys stay untouched).
  const pillarLabel = (k: string) =>
    tr(`evalReport.pillars.${k}`, { defaultValue: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) });
  // Solid surface for the sticky bottom bar — matches the app tab bar so it
  // reads as themed (not a floating white card) in both light and dark.
  const barBg = mode === 'dark' ? '#0C2331' : '#EFE7DA';

  const [ev, setEv] = useState<Evaluation | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);

  // Correction modal
  const [showCorrect, setShowCorrect] = useState(false);
  const [selectedPillar, setSelectedPillar] = useState('');
  const [correctionText, setCorrectionText] = useState('');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Player detail popup
  const [showPlayerDetail, setShowPlayerDetail] = useState(false);

  // Redesigned scouting layout: score/recruit detail popups, full-report dropdown
  const [history, setHistory] = useState<Evaluation[]>([]);
  const [showBim, setShowBim] = useState(false);
  const [showRecruit, setShowRecruit] = useState(false);
  const [showFull, setShowFull] = useState(false);

  // Export modal
  const [showExport, setShowExport] = useState(false);
  const [exportCats, setExportCats] = useState<Record<string, boolean>>({
    grades: true, flags: true, questions: true, report: true, corrections: false,
  });
  const [exporting, setExporting] = useState(false);

  // The Full Report broken into its real headings, so the export picker mirrors
  // the report's actual sections (same as the sharing toggles).
  const reportSections = useMemo(() => splitReportSections(ev?.report_text ?? ''), [ev?.report_text]);
  const reportToggleSections = reportSections.filter(sec => !sec.pinned);
  const [reportToggles, setReportToggles] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setReportToggles(Object.fromEntries(reportSections.map(sec => [sec.heading, true])));
  }, [ev?.report_text]);

  // Unified share modal (player / team / staff)
  const [showShareModal, setShowShareModal] = useState(false);
  // When navigated here with an openShare param (e.g. from the Copilot), open the
  // matching share flow once the report has loaded: 'player' = Send to Player,
  // anything else = Share w/ Staff (recipient search + toggles).
  const didAutoShare = useRef(false);
  useEffect(() => {
    if (didAutoShare.current || !ev || !openShare) return;
    didAutoShare.current = true;
    if (openShare === 'player') setShowShare(true);
    else setShowShareModal(true);
  }, [ev, openShare]);

  // Share with staff modal
  const [showStaffShare, setShowStaffShare] = useState(false);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffResults, setStaffResults] = useState<any[]>([]);
  const [staffSearchLoading, setStaffSearchLoading] = useState(false);
  const [allowRegen, setAllowRegen] = useState(false);
  const [sendingStaff, setSendingStaff] = useState(false);

  // Share with player modal
  const [showShare, setShowShare] = useState(false);
  const [shareSearch, setShareSearch] = useState('');
  const [shareResults, setShareResults] = useState<any[]>([]);
  const [selectedPlayerUser, setSelectedPlayerUser] = useState<any | null>(null);
  const [shareMessage, setShareMessage] = useState('');
  const [shareCats, setShareCats] = useState({
    share_report_text: true, share_grades: false,
    share_flags: false, share_questions: false,
  });
  const [sharing, setSharing] = useState(false);
  const [shareSearchLoading, setShareSearchLoading] = useState(false);

  useEffect(() => {
    Promise.all([evalsAPI.get(evalId), evalsAPI.corrections(evalId)])
      .then(async ([e, c]) => {
        setEv(e);
        setCorrections(c);
        try { setPlayer(await playersAPI.get(e.player_id)); } catch {}
        try { setHistory(await playersAPI.evaluations(e.player_id)); } catch {}
      })
      .finally(() => setLoading(false));
  }, [evalId]);

  const searchStaff = async () => {
    if (!staffSearch.trim()) return;
    setStaffSearchLoading(true);
    try {
      const results = await coachesAPI.search(staffSearch.trim());
      setStaffResults(results);
    } catch {}
    setStaffSearchLoading(false);
  };

  const sendToStaff = async (target: any) => {
    setSendingStaff(true);
    try {
      await staffSharingAPI.share({
        report_type: 'eval',
        report_id: evalId,
        recipient_id: target.id,
        allow_regenerate: allowRegen,
      });
      Alert.alert(tr('evalReport.sharedTitle'), tr('evalReport.sharedWithMsg', { name: target.name }));
      setShowStaffShare(false);
      setStaffSearch('');
      setStaffResults([]);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('evalReport.couldNotShareReport'));
    } finally {
      setSendingStaff(false);
    }
  };

  const searchPlayerUsers = async () => {
    if (!shareSearch.trim()) return;
    setShareSearchLoading(true);
    try {
      const results = await playerAPI.searchPlayerUsers(shareSearch.trim());
      setShareResults(results);
    } catch {}
    setShareSearchLoading(false);
  };

  // Surface the report's subject player first when the share sheet opens.
  useEffect(() => {
    if (showShare && player?.name) {
      setSelectedPlayerUser(null);
      setShareSearch(player.name);
      setShareSearchLoading(true);
      playerAPI.searchPlayerUsers(player.name)
        .then((r: any[]) => setShareResults(r ?? []))
        .catch(() => setShareResults([]))
        .finally(() => setShareSearchLoading(false));
    }
  }, [showShare]);

  const submitShare = async (consentOverride = false) => {
    if (!selectedPlayerUser) return;
    setSharing(true);
    try {
      const res = await playerAPI.share(evalId, {
        player_user_id: selectedPlayerUser.id,
        share_report_text: shareCats.share_report_text,
        share_grades: shareCats.share_grades,
        share_flags: shareCats.share_flags,
        share_questions: shareCats.share_questions,
        message: shareMessage.trim() || null,
        consent_override: consentOverride,
      });
      if (res?.status === 'pending_approval') {
        setSharing(false);
        Alert.alert(tr('evalReport.pendingApprovalTitle'),
          tr('evalReport.pendingApprovalMsg', { subject: res.subject_name, recipient: res.recipient_name }));
        setShowShare(false); setSelectedPlayerUser(null); setShareSearch(''); setShareResults([]); setShareMessage('');
        return;
      }
      if (res?.status === 'needs_override') {
        setSharing(false);
        Alert.alert(tr('evalReport.noAccountTitle'),
          tr('evalReport.noAccountMsg', { subject: res.subject_name, recipient: res.recipient_name }),
          [{ text: tr('common.cancel'), style: 'cancel' }, { text: tr('evalReport.sendAnyway'), style: 'destructive', onPress: () => submitShare(true) }]);
        return;
      }
      Alert.alert(tr('evalReport.sharedTitle'), tr('evalReport.sharedWithMsg', { name: selectedPlayerUser.name }));
      setShowShare(false);
      setSelectedPlayerUser(null);
      setShareSearch('');
      setShareResults([]);
      setShareMessage('');
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('evalReport.couldNotShareReport'));
    } finally {
      setSharing(false);
    }
  };

  const buildFileName = () => {
    if (!ev) return tr('evalReport.evalReportFileName');
    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9 \-]/g, '').trim();
    const type = outputTypeLabel(ev.output_type);
    const name = sanitize(player?.name ?? tr('evalReport.playerFallbackName'));
    const team = sanitize(player?.team_name ?? player?.program_name ?? '');
    const pos  = sanitize(player?.position ?? '');
    return [tr('evalReport.evalReportFileName'), name, team, pos, type].filter(Boolean).join(' - ');
  };

  const submitCorrection = async (generateNew: boolean) => {
    if (!correctionText.trim()) return;
    setSaving(true);
    try {
      const c = await evalsAPI.addCorrection(evalId, {
        pillar: selectedPillar || undefined,
        correction: correctionText,
      });
      setCorrections(prev => [...prev, c]);
      setShowCorrect(false);
      setCorrectionText(''); setSelectedPillar('');

      if (generateNew) {
        // Regenerate the full eval via AI using all unapplied corrections
        setRegenerating(true);
        try {
          const updated = await evalsAPI.regenerate(evalId);
          setEv(updated);
          // Reload corrections to reflect applied=true
          const updatedCorrs = await evalsAPI.corrections(evalId);
          setCorrections(updatedCorrs);
          Alert.alert(tr('evalReport.regeneratedTitle'), tr('evalReport.regeneratedMsg'));
        } catch (e: any) {
          Alert.alert(tr('evalReport.regenFailedTitle'), e?.response?.data?.detail ?? tr('evalReport.regenFailedMsg'));
        } finally {
          setRegenerating(false);
        }
      } else {
        Alert.alert(tr('evalReport.savedTitle'), tr('evalReport.correctionSavedMsg'));
      }
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('evalReport.couldNotSaveCorrection'));
    } finally {
      setSaving(false);
    }
  };

  const generateNewEval = async () => {
    if (corrections.filter((c: any) => !c.applied).length === 0) {
      Alert.alert(tr('evalReport.noPendingCorrectionsTitle'), tr('evalReport.noPendingCorrectionsMsg'));
      return;
    }
    setRegenerating(true);
    try {
      const updated = await evalsAPI.regenerate(evalId);
      setEv(updated);
      const updatedCorrs = await evalsAPI.corrections(evalId);
      setCorrections(updatedCorrs);
      Alert.alert(tr('evalReport.regeneratedTitle'), tr('evalReport.regeneratedMsg'));
    } catch (e: any) {
      Alert.alert(tr('evalReport.regenFailedTitle'), e?.response?.data?.detail ?? tr('evalReport.regenFailedMsg'));
    } finally {
      setRegenerating(false);
    }
  };

  const buildHtml = (cats: Record<string, boolean>, rToggles: Record<string, boolean> = reportToggles) => {
    if (!ev) return `<html><body><p>${tr('evalReport.pdfNoData')}</p></body></html>`;
    const date = new Date(ev.created_at).toLocaleDateString();
    const type = outputTypeLabel(ev.output_type).toUpperCase();
    const sanitize = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let body = `<h1>BloomPrint &mdash; ${type}</h1>
      <p style="color:#555;margin-top:0">${sanitize(ev.competition_level ?? '')} &bull; ${date}</p>`;

    if (cats.grades && ev.overall_grade != null) {
      body += `<h3>${tr('evalReport.overallGrade')}</h3><div class="grade">${ev.overall_grade.toFixed(1)} / 10</div>`;
      if (ev.pillar_grades) {
        body += `<h3>${tr('evalReport.pillarGrades')}</h3>`;
        PILLARS.filter(k => ev.pillar_grades![k] != null).forEach(k => {
          const g = ev.pillar_grades![k];
          const pct = Math.round((g / 10) * 100);
          body += `<table width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0">
            <tr><td style="font-size:13px">${pillarLabel(k)}</td><td align="right" style="font-size:13px"><strong>${g.toFixed(1)}</strong></td></tr>
            <tr><td colspan="2"><div style="background:#eee;border-radius:4px;height:8px;margin-top:3px">
              <div style="background:#2563eb;border-radius:4px;height:8px;width:${pct}%"></div></div></td></tr>
          </table>`;
        });
      }
    }

    if (cats.flags) {
      if (ev.green_flags?.length) {
        body += `<h3>${tr('evalReport.greenFlags')}</h3>`;
        ev.green_flags.forEach(f => { body += `<p style="color:#16a34a;margin:3px 0">&#10003; ${sanitize(f)}</p>`; });
      }
      if (ev.watch_flags?.length) {
        body += `<h3>${tr('evalReport.watchFlags')}</h3>`;
        ev.watch_flags.forEach(f => { body += `<p style="color:#dc2626;margin:3px 0">&#9888; ${sanitize(f)}</p>`; });
      }
    }

    if (cats.questions && ev.key_questions?.length) {
      body += `<h3>${tr('evalReport.keyQuestions')}</h3><ol>`;
      ev.key_questions.forEach(q => { body += `<li style="font-size:13px;margin:4px 0">${sanitize(q)}</li>`; });
      body += `</ol>`;
    }

    if (cats.report && ev.report_text) {
      // Only include the report sections the coach left enabled. If the report
      // has no detectable sections, fall back to the whole thing.
      const secs = splitReportSections(ev.report_text);
      const toggleable = secs.filter(sec => !sec.pinned);
      const anyEnabled = toggleable.length === 0 || toggleable.some(sec => rToggles[sec.heading] !== false);
      if (anyEnabled) {
        const joined = joinReportSections(secs, rToggles) || ev.report_text;
        body += `<h3>${tr('evalReport.fullReport')}</h3><div style="margin-top:8px">${mdToHtml(joined)}</div>`;
      }
    }

    if (cats.corrections && corrections.length) {
      body += `<h3>${tr('evalReport.corrections')}</h3>`;
      corrections.forEach(c => {
        const pillarHead = c.pillar ? `<strong>${pillarLabel(c.pillar).toUpperCase()}</strong><br/>` : '';
        body += `<div style="background:#f9fafb;border-left:3px solid #2563eb;padding:8px 12px;margin:6px 0;font-size:12px">${pillarHead}${sanitize(c.correction)}</div>`;
      });
    }

    // Ensure body has content
    if (!body.includes('<h3>') && !body.includes('<div class="grade">')) {
      body += `<p style="color:#555">${tr('evalReport.noSectionsSelected')}</p>`;
    }

    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
      @page { margin: 18mm 16mm; }
      * { box-sizing: border-box; }
      body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1f2937; font-size: 12px; line-height: 1.6; -webkit-print-color-adjust: exact; }
      h1 { font-size: 22px; font-weight: 900; margin-bottom: 4px; color: #0f172a; }
      h3 { font-size: 16px; font-weight: 800; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 4px; margin-top: 24px; color: #111; page-break-after: avoid; }
      h4 { font-size: 14px; font-weight: 800; color: #222; page-break-after: avoid; }
      .grade { font-size: 48px; font-weight: 900; color: #2563eb; }
      p, li, table { page-break-inside: avoid; }
      p { margin: 6px 0; }
      ol, ul { padding-left: 20px; }
    </style></head><body>${body}
      <div style="margin-top:40px;font-size:11px;color:#999;border-top:1px solid #eee;padding-top:12px">
        ${tr('evalReport.generatedBy')}
      </div>
    </body></html>`;
  };

  const exportReport = async () => {
    setExporting(true);
    try {
      const html = buildHtml(exportCats);
      const { uri } = await Print.printToFileAsync({ html });
      const dest = FileSystem.cacheDirectory + safeFileName(buildFileName()) + '.pdf';
      await FileSystem.copyAsync({ from: uri, to: dest });
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: tr('evalReport.shareBimReport') });
    } catch (e: any) {
      Alert.alert(tr('evalReport.exportErrorTitle'), e?.message ?? tr('evalReport.couldNotGenerateReport'));
    } finally {
      setExporting(false);
      setShowExport(false);
    }
  };

  // Top-bar quick share — generate the full PDF and open the share sheet
  // directly, no section-picker modal.
  const quickSharePdf = async () => {
    setExporting(true);
    try {
      const allCats = { grades: true, flags: true, questions: true, report: true, corrections: corrections.length > 0 };
      const allReport = Object.fromEntries(reportSections.map(sec => [sec.heading, true]));
      const html = buildHtml(allCats, allReport);
      const { uri } = await Print.printToFileAsync({ html });
      const dest = FileSystem.cacheDirectory + safeFileName(buildFileName()) + '.pdf';
      await FileSystem.copyAsync({ from: uri, to: dest });
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: tr('evalReport.shareBimReport') });
    } catch (e: any) {
      Alert.alert(tr('evalReport.shareErrorTitle'), e?.message ?? tr('evalReport.couldNotGenerateReport'));
    } finally {
      setExporting(false);
    }
  };

  const printPdf = async () => {
    try {
      await Print.printAsync({ html: buildHtml(exportCats) });
    } catch (e: any) {
      Alert.alert(tr('evalReport.printErrorTitle'), e?.message ?? tr('evalReport.couldNotPrintReport'));
    } finally {
      setShowExport(false);
    }
  };

  // MUST be above the early returns below: a hook that only runs once `ev` has
  // loaded changes the hook count between renders and crashes with "Rendered
  // more hooks than during the previous render".
  // Reports keep the language they were written in; when the reader's language
  // differs both the full body AND the broken-out sections are shown
  // translated, with a toggle back to the original.
  const rt = useReportTranslation('eval', ev?.id, ev?.report_text ?? undefined);

  if (loading) return <ScreenBackground><View style={styles.center}><ActivityIndicator color={t.accent} size="large" /></View></ScreenBackground>;
  if (!ev) return null;

  const hasPillars = ev.pillar_grades && Object.keys(ev.pillar_grades).length > 0;

  // Redesigned report layout — applied to any single (non-combo) player report.
  const singleType = parseOutputTypes(ev.output_type)[0] ?? '';
  const isSingle = parseOutputTypes(ev.output_type).length === 1;
  // Recruit grade only makes sense for player-evaluation report types.
  const showsRecruit = ['scouting_report', 'player_eval', 'recruitment_profile'].includes(singleType);
  const brief = extractBrief(rt.showOriginal ? ev.report_text : rt.text) || extractBrief(ev.report_text);
  // Sections are bucketed from the original headings but rendered from the
  // translation, so the view follows the reader's language without the
  // English matchers coming back empty. "View original" reverts both.
  const fixedSections = isSingle
    ? getFixedSections(ev.output_type, ev.report_text, rt.showOriginal ? null : rt.text)
    : null;
  const recruit = recruitGrade(ev.overall_grade);
  const gradeTrend = history
    .filter(h => h.overall_grade != null)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-8);

  return (
    <ScreenBackground>
    <PageContainer maxWidth={READING_MAX_WIDTH}>
    <KeyboardAwareScrollView style={styles.container} contentContainerStyle={{ paddingBottom: isSingle ? 24 : 100 }}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={t.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.title}>{outputTypeLabel(ev.output_type).toUpperCase()}</Text>
          <Text style={styles.sub}>{new Date(ev.created_at).toLocaleDateString()}</Text>
        </View>
        {isSingle ? (
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.circleBtn} onPress={printPdf}>
              <Ionicons name="print-outline" size={17} color={t.muted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.circleBtn} onPress={quickSharePdf} disabled={exporting}>
              <Ionicons name="share-social-outline" size={17} color={t.muted} />
            </TouchableOpacity>
          </View>
        ) : (
          <GradeBadge grade={ev.overall_grade} size="lg" />
        )}
      </View>

      {/* Player name — tap to see profile popup (kept at the top) */}
      {player && (
        <TouchableOpacity
          style={styles.playerNameRow}
          onPress={() => setShowPlayerDetail(true)}
        >
          <Ionicons name="person-circle-outline" size={18} color={t.accent} />
          <Text style={styles.playerNameLink}>{player.name}</Text>
          {player.position ? <Text style={styles.playerPos}>{player.position}</Text> : null}
          <Ionicons name="chevron-forward" size={13} color={t.accent} />
        </TouchableOpacity>
      )}

      {/* BIM Score + Recruit Grade pills — tap to see how each is derived */}
      {isSingle && ev.overall_grade != null && (
        <View style={styles.pillRow}>
          <TouchableOpacity style={styles.bimPill} onPress={() => setShowBim(true)}>
            <Text style={styles.bimPillText}>{tr('evalReport.bimScore', { score: ev.overall_grade.toFixed(1) })}</Text>
            <Ionicons name="chevron-forward" size={12} color={t.badgeText} />
          </TouchableOpacity>
          {showsRecruit && recruit && (
            <TouchableOpacity style={styles.recruitPill} onPress={() => setShowRecruit(true)}>
              <Text style={styles.recruitPillText}>{tr('evalReport.recruitGrade', { letter: recruit.letter })}</Text>
              <Ionicons name="chevron-forward" size={12} color={t.accent} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Brief (AI TL;DR) */}
      {isSingle && brief && (
        <View style={styles.briefBox}>
          <Text style={styles.briefLabel}>{tr('evalReport.brief')}</Text>
          <Text style={styles.briefText}>{brief}</Text>
        </View>
      )}

      {/* Broken-out fixed sections + full-report dropdown */}
      {isSingle && fixedSections && (
        <View style={styles.section}>
          {fixedSections.filter(s => s.body.trim()).map((s, i, arr) => (
            <View key={s.key}>
              <View style={styles.fixedHead}>
                <Ionicons name={s.icon as any} size={17} color={s.tone === 'brown' ? t.brown : t.label} />
                <Text style={[styles.fixedHeadLabel, { color: s.tone === 'brown' ? t.brown : t.label }]}>{tr(s.labelKey)}</Text>
              </View>
              <View>{renderReport(s.body, { heading: t.ink, body: t.inkSoft })}</View>
              {i < arr.length - 1 && <View style={styles.fixedDivider} />}
            </View>
          ))}

          <TouchableOpacity style={styles.fullToggle} onPress={() => setShowFull(v => !v)}>
            <Text style={styles.fullToggleText}>{showFull ? tr('evalReport.hideFullReport') : tr('evalReport.seeFullReport')}</Text>
            <Ionicons name={showFull ? 'chevron-up' : 'chevron-down'} size={16} color={t.accent} />
          </TouchableOpacity>
          {showFull && ev.report_text && (
            <View style={styles.reportBox}>
              <TranslationToggle
                canToggle={rt.canToggle} isTranslated={rt.isTranslated}
                showOriginal={rt.showOriginal} loading={rt.loading} onToggle={rt.toggle}
              />
              {renderReport(rt.text, { heading: t.ink, body: t.inkSoft })}
            </View>
          )}
        </View>
      )}

      {/* BIM Score detail — pillar breakdown + grade trend */}
      <Modal visible={showBim} animationType="slide" transparent onRequestClose={() => setShowBim(false)}>
        <View style={styles.pdOverlay}>
          <View style={styles.pdBox}>
            <View style={styles.pdHeader}>
              <Text style={styles.pdName}>{tr('evalReport.bimScore', { score: ev.overall_grade?.toFixed(1) })}</Text>
              <TouchableOpacity onPress={() => setShowBim(false)}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>{tr('evalReport.bimScoreDesc')}</Text>
            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
            {hasPillars && (
              <View style={{ marginTop: 4 }}>
                <Text style={styles.sectionLabel}>{tr('evalReport.pillarBreakdown')}</Text>
                {PILLARS.filter(k => ev.pillar_grades![k] !== undefined).map(k => (
                  <PillarCard key={k} pillarKey={k} grade={ev.pillar_grades![k]} />
                ))}
              </View>
            )}
            {gradeTrend.length > 1 && (
              <View style={{ marginTop: 16 }}>
                <Text style={styles.sectionLabel}>{tr('evalReport.gradeTrend')}</Text>
                <View style={styles.trendRow}>
                  {gradeTrend.map((h, i) => {
                    const g = h.overall_grade ?? 0;
                    const tone = g >= 7 ? t.positive : g >= 5 ? t.accent : t.brown;
                    return (
                      <View key={h.id ?? i} style={styles.trendCol}>
                        <Text style={[styles.trendVal, { color: tone }]}>{g.toFixed(1)}</Text>
                        <View style={[styles.trendBar, { height: Math.max(6, (g / 10) * 70), backgroundColor: tone }]} />
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Recruit Grade detail — how the letter maps from the BIM score */}
      <Modal visible={showRecruit} animationType="slide" transparent onRequestClose={() => setShowRecruit(false)}>
        <View style={styles.pdOverlay}>
          <View style={styles.pdBox}>
            <View style={styles.pdHeader}>
              <Text style={styles.pdName}>{tr('evalReport.recruitGrade', { letter: recruit?.letter })}</Text>
              <TouchableOpacity onPress={() => setShowRecruit(false)}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
            </View>
            {recruit && <Text style={styles.recruitTier}>{recruit.tier}</Text>}
            {recruit && <Text style={styles.modalSub}>{recruit.blurb}</Text>}
            <Text style={[styles.sectionLabel, { marginTop: 16 }]}>{tr('evalReport.howItMaps')}</Text>
            {recruitGradeScale.map(r => {
              const active = recruit?.letter === r.letter;
              return (
                <View key={r.letter} style={[styles.ladderRow, active && { backgroundColor: t.accentSoft, borderRadius: 8 }]}>
                  <Text style={[styles.ladderLetter, active && { color: t.accent }]}>{r.letter}</Text>
                  <Text style={styles.ladderTier}>{r.tier}</Text>
                  <Text style={styles.ladderRange}>{r.range}</Text>
                </View>
              );
            })}
          </View>
        </View>
      </Modal>

      {/* Player detail modal */}
      <Modal visible={showPlayerDetail} animationType="slide" transparent>
        <View style={styles.pdOverlay}>
          <View style={styles.pdBox}>
            <View style={styles.pdHeader}>
              <Text style={styles.pdName}>{player?.name}</Text>
              <TouchableOpacity onPress={() => setShowPlayerDetail(false)}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>

            <View style={styles.pdRow}>
              {player?.position ? (
                <View style={styles.pdChip}><Text style={styles.pdChipText}>{player.position}</Text></View>
              ) : null}
              {player?.competition_level ? (
                <View style={styles.pdChip}><Text style={styles.pdChipText}>{player.competition_level}</Text></View>
              ) : null}
            </View>

            {(player?.height || player?.wingspan) ? (
              <View style={styles.pdMeasurements}>
                {player.height ? (
                  <View style={styles.pdStat}>
                    <Text style={styles.pdStatVal}>{player.height}</Text>
                    <Text style={styles.pdStatLabel}>{tr('evalReport.height')}</Text>
                  </View>
                ) : null}
                {player.wingspan ? (
                  <View style={styles.pdStat}>
                    <Text style={styles.pdStatVal}>{player.wingspan}</Text>
                    <Text style={styles.pdStatLabel}>{tr('evalReport.wingspan')}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {(player as any)?.school_name ? (
              <View style={styles.pdLocationRow}>
                <Ionicons name="school-outline" size={13} color={t.muted} />
                <Text style={styles.pdLocationText}>{(player as any).school_name}</Text>
              </View>
            ) : null}
            {((player as any)?.city || (player as any)?.state || (player as any)?.country) ? (
              <View style={styles.pdLocationRow}>
                <Ionicons name="location-outline" size={13} color={t.muted} />
                <Text style={styles.pdLocationText}>
                  {[(player as any).city, (player as any).state, (player as any).country].filter(Boolean).join(', ')}
                </Text>
              </View>
            ) : null}

            {(player?.program_name) ? (
              <Text style={styles.pdProgram}>{player.program_name}</Text>
            ) : null}

            <TouchableOpacity
              style={styles.pdProfileBtn}
              onPress={() => { setShowPlayerDetail(false); navigation.navigate('PlayerProfile', { playerId: ev!.player_id }); }}
            >
              <Ionicons name="person" size={15} color={t.ctaText} />
              <Text style={styles.pdProfileBtnText}>{tr('evalReport.viewFullProfile')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Pillar grades */}
      {hasPillars && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{tr('evalReport.pillarGrades')}</Text>
          {PILLARS.filter(k => ev.pillar_grades![k] !== undefined).map(k => (
            <PillarCard key={k} pillarKey={k} grade={ev.pillar_grades![k]} />
          ))}
        </View>
      )}

      {/* Flags — vertical list layout */}
      {(ev.green_flags?.length || ev.watch_flags?.length) ? (
        <View style={styles.flagSection}>
          {ev.green_flags && ev.green_flags.length > 0 && (
            <View style={{ marginBottom: 12 }}>
              <Text style={[styles.flagTitle, { color: t.positive }]}>{tr('evalReport.greenFlags')}</Text>
              {ev.green_flags.map((f, i) => (
                <View key={i} style={styles.flagListItem}>
                  <View style={styles.flagDotGreen} />
                  <Text style={styles.flagListText}>{f.replace(/\*\*/g, '').trim()}</Text>
                </View>
              ))}
            </View>
          )}
          {ev.watch_flags && ev.watch_flags.length > 0 && (
            <View>
              <Text style={[styles.flagTitle, { color: t.brown }]}>{tr('evalReport.watchFlags')}</Text>
              {ev.watch_flags.map((f, i) => (
                <View key={i} style={styles.flagListItem}>
                  <View style={styles.flagDotWatch} />
                  <Text style={styles.flagListText}>{f.replace(/\*\*/g, '').trim()}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}

      {/* Key questions */}
      {ev.key_questions && ev.key_questions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{tr('evalReport.keyQuestions')}</Text>
          {ev.key_questions.map((q, i) => (
            <View key={i} style={styles.questionRow}>
              <Text style={styles.questionNum}>{i + 1}</Text>
              <Text style={styles.questionText}>{q}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Full report — shown inline for combos and for single reports that have
          no broken-out section map (those use the dropdown above instead). */}
      {(!isSingle || !fixedSections) && ev.report_text && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{tr('evalReport.fullReport')}</Text>
          <View style={styles.reportBox}>
            <TranslationToggle
              canToggle={rt.canToggle} isTranslated={rt.isTranslated}
              showOriginal={rt.showOriginal} loading={rt.loading} onToggle={rt.toggle}
            />
            {renderReport(rt.text, { heading: t.ink, body: t.inkSoft })}
          </View>
        </View>
      )}

      {/* Corrections */}
      {corrections.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{tr('evalReport.correctionsCount', { count: corrections.length })}</Text>
          {corrections.map((c: any) => (
            <View key={c.id} style={[styles.correctionCard, c.applied && { opacity: 0.55 }]}>
              {c.pillar && <Text style={styles.correctionPillar}>{pillarLabel(c.pillar).toUpperCase()}</Text>}
              <Text style={styles.correctionText}>{c.correction}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <Text style={styles.correctionMeta}>{new Date(c.created_at).toLocaleDateString()}</Text>
                {c.applied && (
                  <View style={{ backgroundColor: t.positiveSoft, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: t.positive }}>
                    <Text style={{ color: t.positive, fontSize: 10, fontFamily: fonts[700] }}>{tr('evalReport.applied')}</Text>
                  </View>
                )}
              </View>
            </View>
          ))}
          {/* Generate New Evaluation button — shown when there are unapplied corrections */}
          {corrections.some((c: any) => !c.applied) && (
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: t.accent, marginTop: 12 }]}
              onPress={generateNewEval}
              disabled={regenerating}
            >
              {regenerating
                ? <ActivityIndicator color={t.ctaText} />
                : <Text style={styles.saveText}>{tr('evalReport.generateNewEval')}</Text>}
            </TouchableOpacity>
          )}
          <GeneratingOverlay visible={regenerating} label={tr('evalReport.regeneratingLabel')} />
        </View>
      )}

      {/* Action buttons — scouting reports use the sticky bottom bar instead */}
      {!isSingle && (
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowCorrect(true)}>
          <Ionicons name="create-outline" size={18} color={t.muted} />
          <Text style={styles.actionText}>{tr('evalReport.correct')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => setShowExport(true)}>
          <Ionicons name="share-outline" size={18} color={t.muted} />
          <Text style={styles.actionText}>{tr('common.export')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { borderColor: t.positive }]} onPress={() => setShowShare(true)}>
          <Ionicons name="person-add-outline" size={18} color={t.positive} />
          <Text style={[styles.actionText, { color: t.positive }]}>{tr('evalReport.playerAction')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, { borderColor: t.accent }]} onPress={() => setShowShareModal(true)}>
          <Ionicons name="share-social-outline" size={18} color={t.accent} />
          <Text style={[styles.actionText, { color: t.accent }]}>{tr('common.share')}</Text>
        </TouchableOpacity>
      </View>
      )}

      {/* Unified Share modal — player / team / staff */}
      {ev && showShareModal && (
        <ShareModal
          visible={showShareModal}
          onClose={() => setShowShareModal(false)}
          reportType="eval"
          reportId={evalId}
          outputType={ev.output_type ?? 'player_eval'}
          reportText={ev.report_text ?? ''}
          title={ev.output_type ? outputTypeLabel(ev.output_type) : tr('reportTypes.player_eval')}
          subjectPlayerId={player?.id}
          subjectPlayerName={player?.name}
        />
      )}

      {/* Share with Staff modal */}
      <Modal visible={showStaffShare} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{tr('evalReport.shareWithStaff')}</Text>
            <Text style={styles.modalSub}>{tr('evalReport.shareWithStaffSub')}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, backgroundColor: t.chip, borderRadius: 8, padding: 12 }}>
              <Text style={{ color: t.inkSoft, fontSize: 13 }}>{tr('evalReport.allowRegen')}</Text>
              <Switch value={allowRegen} onValueChange={setAllowRegen} trackColor={{ true: t.accent, false: t.line }} thumbColor="#fff" />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
              <VoiceTextInput
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
                placeholder={tr('evalReport.searchCoachPlaceholder')}
                placeholderTextColor={t.muted2}
                value={staffSearch}
                onChangeText={setStaffSearch}
              />
              <TouchableOpacity
                style={{ backgroundColor: t.accent, borderRadius: 10, padding: 14, alignItems: 'center', justifyContent: 'center' }}
                onPress={searchStaff}
                disabled={staffSearchLoading}
              >
                {staffSearchLoading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="search" size={18} color="#fff" />}
              </TouchableOpacity>
            </View>
            {staffResults.map((r: any) => (
              <TouchableOpacity
                key={r.id}
                style={{ backgroundColor: t.chip, borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: t.line }}
                onPress={() => sendToStaff(r)}
                disabled={sendingStaff}
              >
                <Text style={{ color: t.ink, fontFamily: fonts[600] }}>{r.name}</Text>
                <Text style={{ color: t.muted, fontSize: 11 }}>{r.role} · {r.program_name}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowStaffShare(false)}>
                <Text style={styles.cancelText}>{tr('common.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Export modal */}
      <Modal visible={showExport} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{tr('evalReport.exportReportTitle')}</Text>
            <Text style={styles.modalSub}>{tr('evalReport.chooseInclude')}</Text>
            <ScrollView style={{ maxHeight: 360 }}>
            {EXPORT_CATEGORIES.filter(key => {
              // Only show toggles for sections that actually exist in THIS report
              if (key === 'grades') return ev?.overall_grade != null || ev?.pillar_grades != null;
              if (key === 'flags') return (ev?.green_flags?.length ?? 0) > 0 || (ev?.watch_flags?.length ?? 0) > 0;
              if (key === 'questions') return (ev?.key_questions?.length ?? 0) > 0;
              // The report is broken into its own per-section toggles below.
              if (key === 'report') return !!ev?.report_text && reportToggleSections.length <= 1;
              if (key === 'corrections') return corrections.length > 0;
              return true;
            }).map(key => (
              <View key={key} style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>{tr(`evalReport.exportCats.${key}`)}</Text>
                <Switch
                  value={exportCats[key]}
                  onValueChange={v => setExportCats(prev => ({ ...prev, [key]: v }))}
                  trackColor={{ true: t.accent }}
                  thumbColor="#fff"
                />
              </View>
            ))}
            {/* Report broken into its real sections, mirroring the share toggles. */}
            {!!ev?.report_text && reportToggleSections.length > 1 && (
              <>
                <Text style={[styles.modalSub, { marginTop: 12, marginBottom: 2 }]}>{tr('evalReport.reportSections')}</Text>
                {reportToggleSections.map((sec, i) => (
                  <View key={`report-${sec.heading}-${i}`} style={styles.toggleRow}>
                    <Text style={[styles.toggleLabel, { flex: 1, marginRight: 8 }]} numberOfLines={1}>{sec.heading}</Text>
                    <Switch
                      value={reportToggles[sec.heading] !== false}
                      onValueChange={v => setReportToggles(prev => ({ ...prev, [sec.heading]: v }))}
                      trackColor={{ true: t.accent }}
                      thumbColor="#fff"
                    />
                  </View>
                ))}
              </>
            )}
            </ScrollView>
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowExport(false)}>
                <Text style={styles.cancelText}>{tr('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: t.line }]} onPress={printPdf} disabled={exporting}>
                <Text style={styles.saveText}>{tr('common.print')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={exportReport} disabled={exporting}>
                {exporting
                  ? <ActivityIndicator color={t.ctaText} />
                  : <Text style={styles.saveText}>{tr('evalReport.sharePdf')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Share with Player modal */}
      <Modal visible={showShare} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{tr('evalReport.shareWithPlayer')}</Text>
            <Text style={styles.modalSub}>{tr('evalReport.shareWithPlayerSub')}</Text>

            {selectedPlayerUser ? (
              <View style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#16a34a22', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: t.positive }}>
                  <View>
                    <Text style={{ color: t.ink, fontFamily: fonts[700] }}>{selectedPlayerUser.name}</Text>
                    {selectedPlayerUser.linked_player && <Text style={{ color: t.positive, fontSize: 11 }}>→ {selectedPlayerUser.linked_player}</Text>}
                  </View>
                  <TouchableOpacity onPress={() => setSelectedPlayerUser(null)}>
                    <Ionicons name="close-circle" size={20} color={t.muted} />
                  </TouchableOpacity>
                </View>
                <Text style={[styles.label, { marginTop: 12 }]}>{tr('evalReport.includeInShare')}</Text>
                {[
                  { key: 'share_report_text', label: tr('evalReport.fullReport'), has: !!ev?.report_text },
                  { key: 'share_grades', label: tr('evalReport.grades'), has: ev?.overall_grade != null || ev?.pillar_grades != null },
                  { key: 'share_flags', label: tr('evalReport.flags'), has: (ev?.green_flags?.length ?? 0) > 0 || (ev?.watch_flags?.length ?? 0) > 0 },
                  { key: 'share_questions', label: tr('evalReport.keyQuestions'), has: (ev?.key_questions?.length ?? 0) > 0 },
                ].filter(cat => cat.has).map(cat => (
                  <View key={cat.key} style={styles.toggleRow}>
                    <Text style={styles.toggleLabel}>{cat.label}</Text>
                    <Switch
                      value={shareCats[cat.key as keyof typeof shareCats]}
                      onValueChange={v => setShareCats(prev => ({ ...prev, [cat.key]: v }))}
                      trackColor={{ true: t.positive }}
                      thumbColor="#fff"
                    />
                  </View>
                ))}
                <Text style={styles.label}>{tr('evalReport.messageOptional')}</Text>
                <VoiceTextInput
                  style={styles.input}
                  placeholder={tr('evalReport.messagePlaceholder')}
                  placeholderTextColor={t.muted2}
                  value={shareMessage}
                  onChangeText={setShareMessage}
                  multiline
                />
              </View>
            ) : (
              <View style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
                  <VoiceTextInput
                    style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder={tr('evalReport.searchPlayerPlaceholder')}
                    placeholderTextColor={t.muted2}
                    value={shareSearch}
                    onChangeText={setShareSearch}
                  />
                  <TouchableOpacity
                    style={{ backgroundColor: t.accent, borderRadius: 10, padding: 14, alignItems: 'center', justifyContent: 'center' }}
                    onPress={searchPlayerUsers}
                    disabled={shareSearchLoading}
                  >
                    {shareSearchLoading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="search" size={18} color="#fff" />}
                  </TouchableOpacity>
                </View>
                {shareResults.map((pu: any) => (
                  <TouchableOpacity
                    key={pu.id}
                    style={{ backgroundColor: t.chip, borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: t.line }}
                    onPress={() => { setSelectedPlayerUser(pu); setShareResults([]); }}
                  >
                    <Text style={{ color: t.ink, fontFamily: fonts[600] }}>{pu.name}</Text>
                    <Text style={{ color: t.muted, fontSize: 11 }}>{pu.email}{pu.linked_player ? ` · ${pu.linked_player}` : ''}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowShare(false); setSelectedPlayerUser(null); setShareResults([]); }}>
                <Text style={styles.cancelText}>{tr('common.cancel')}</Text>
              </TouchableOpacity>
              {selectedPlayerUser && (
                <TouchableOpacity style={[styles.saveBtn, { backgroundColor: t.positive }]} onPress={() => submitShare()} disabled={sharing}>
                  {sharing ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.saveText}>{tr('common.share')}</Text>}
                </TouchableOpacity>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Correction modal */}
      <Modal visible={showCorrect} transparent animationType="slide">
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{tr('evalReport.addCorrection')}</Text>
            <Text style={styles.modalSub}>{tr('evalReport.addCorrectionSub')}</Text>
            <Text style={styles.label}>{tr('evalReport.pillarOptional')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {['', ...PILLARS].map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.pillarChip, selectedPillar === p && styles.pillarChipActive]}
                  onPress={() => setSelectedPillar(p)}
                >
                  <Text style={[styles.pillarChipText, selectedPillar === p && { color: t.ctaText, fontFamily: fonts[700] }]}>
                    {p ? pillarLabel(p) : tr('evalReport.general')}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <Text style={styles.label}>{tr('evalReport.yourCorrection')}</Text>
            <VoiceTextInput
              style={[styles.input, { height: 100 }]}
              placeholder={tr('evalReport.correctionPlaceholder')}
              placeholderTextColor={t.muted2}
              value={correctionText}
              onChangeText={setCorrectionText}
              multiline
              textAlignVertical="top"
              autoFocus
            />
            <View style={{ gap: 8, marginTop: 8 }}>
              <TouchableOpacity
                style={[styles.saveBtn, { flex: undefined, alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'center', backgroundColor: t.ctaBg }]}
                onPress={() => submitCorrection(true)}
                disabled={saving || regenerating}
              >
                {saving || regenerating
                  ? <ActivityIndicator color={t.ctaText} />
                  : <>
                      <Ionicons name="refresh" size={16} color={t.ctaText} />
                      <Text style={[styles.saveText, { color: t.ctaText, marginLeft: 8 }]}>{tr('evalReport.applyRegenerate')}</Text>
                    </>}
              </TouchableOpacity>
              <View style={styles.modalRow}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCorrect(false)}>
                  <Text style={styles.cancelText}>{tr('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: t.chip }]}
                  onPress={() => submitCorrection(false)}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator color={t.ink} /> : <Text style={[styles.saveText, { color: t.ink }]}>{tr('evalReport.saveForLater')}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAwareScrollView>

    {/* Sticky bottom action bar — Correct · Export · Send to Player · Share w/ Staff */}
    {isSingle && (
      <View style={[styles.bottomBar, { backgroundColor: barBg }]}>
        <View style={styles.bottomRow}>
          <TouchableOpacity style={[styles.bbBtn, { backgroundColor: t.ctaBg }]} onPress={() => setShowCorrect(true)}>
            <Ionicons name="create-outline" size={16} color={t.ctaText} />
            <Text style={[styles.bbText, { color: t.ctaText }]}>{tr('evalReport.correct')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.bbBtn, { backgroundColor: t.chip, borderColor: t.cta2Border }]} onPress={() => setShowExport(true)} disabled={exporting}>
            <Ionicons name="document-text-outline" size={16} color={t.ink} />
            <Text style={[styles.bbText, { color: t.ink }]}>{tr('common.export')}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.bottomRow}>
          <TouchableOpacity style={[styles.bbBtn, { backgroundColor: t.pistachio }]} onPress={() => setShowShare(true)}>
            <Ionicons name="send" size={15} color="#16201A" />
            <Text style={[styles.bbText, { color: '#16201A' }]}>{tr('evalReport.sendToPlayer')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.bbBtn, { backgroundColor: t.brown }]} onPress={() => setShowShareModal(true)}>
            <Ionicons name="people" size={15} color={t.brownInk} />
            <Text style={[styles.bbText, { color: t.brownInk }]}>{tr('evalReport.shareWithStaffShort')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    )}
    </PageContainer>
    </ScreenBackground>
  );
}


const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 56 },
  playerNameRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, marginBottom: 12, backgroundColor: t.card,
    borderRadius: 14, padding: 12, borderWidth: 1, borderColor: t.cardBorder,
  },
  playerNameLink: { color: t.accent, fontFamily: fonts[700], fontSize: 15, flex: 1 },
  playerPos: { color: t.muted, fontSize: 12 },
  // Player detail modal
  pdOverlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  pdBox: { backgroundColor: t.sheet, borderRadius: 20, padding: 24, margin: 8, paddingBottom: 36, borderWidth: 1, borderColor: t.cardBorder, width: '100%', maxWidth: 560, alignSelf: 'center'},
  pdHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  pdName: { color: t.ink, fontSize: 22, fontFamily: fonts[900], flex: 1 },
  pdRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  pdChip: { backgroundColor: t.chip, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  pdChipText: { color: t.inkSoft, fontSize: 13, fontFamily: fonts[600] },
  pdMeasurements: { flexDirection: 'row', gap: 16, marginBottom: 16 },
  pdStat: { alignItems: 'center', backgroundColor: t.chip, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20 },
  pdStatVal: { color: t.ink, fontSize: 20, fontFamily: fonts[800] },
  pdStatLabel: { color: t.muted, fontSize: 11, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  pdLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  pdLocationText: { color: t.muted, fontSize: 13 },
  pdProgram: { color: t.muted2, fontSize: 13, marginBottom: 16 },
  pdProfileBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.ctaBg, borderRadius: 999, padding: 14, marginTop: 4,
  },
  pdProfileBtnText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 15 },
  title: { color: t.ink, fontSize: 16, fontFamily: fonts[900] },
  sub: { color: t.muted, fontSize: 11, marginTop: 2 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionLabel: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 },
  flagSection: { paddingHorizontal: 20, marginTop: 20 },
  flagTitle: { fontSize: 11.5, fontFamily: fonts[700], marginBottom: 8, textTransform: 'uppercase', letterSpacing: 2 },
  flagListItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8, paddingRight: 8 },
  flagDotGreen: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.positive, marginTop: 4, flexShrink: 0 },
  flagDotWatch: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.brown, marginTop: 4, flexShrink: 0 },
  flagListText: { color: t.inkSoft, fontSize: 13, flex: 1, lineHeight: 20 },
  questionRow: { flexDirection: 'row', marginBottom: 10, gap: 10 },
  questionNum: { color: t.accent, fontFamily: fonts[800], fontSize: 14, width: 20 },
  questionText: { color: t.inkSoft, fontSize: 13, flex: 1, lineHeight: 20 },
  reportBox: { backgroundColor: t.card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: t.cardBorder },

  // ── Redesigned scouting layout ──
  headerActions: { flexDirection: 'row', gap: 8 },
  circleBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' },
  pillRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginTop: 4 },
  bimPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: t.badgeBg },
  bimPillText: { color: t.badgeText, fontSize: 11.5, fontFamily: fonts[800], letterSpacing: 0.4 },
  recruitPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: t.accentSoft },
  recruitPillText: { color: t.accent, fontSize: 11.5, fontFamily: fonts[800] },
  briefBox: { marginHorizontal: 20, marginTop: 16, backgroundColor: t.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: t.cardBorder },
  briefLabel: { color: t.label, fontSize: 10.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 },
  briefText: { color: t.inkSoft, fontSize: 15, lineHeight: 23 },
  fixedHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 4 },
  fixedHeadLabel: { fontSize: 13.5, fontFamily: fonts[800], letterSpacing: 1.4, textTransform: 'uppercase' },
  fixedBody: { color: t.inkSoft, fontSize: 14.5, lineHeight: 23 },
  fixedDivider: { height: 1, backgroundColor: t.divider, marginVertical: 18 },
  fullToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: t.line },
  fullToggleText: { color: t.accent, fontSize: 13, fontFamily: fonts[700] },
  trendRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 96, paddingTop: 6 },
  trendCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  trendVal: { fontSize: 10, fontFamily: fonts[700] },
  trendBar: { width: '70%', borderRadius: 4 },
  recruitTier: { color: t.ink, fontSize: 14, fontFamily: fonts[800], marginBottom: 8 },
  ladderRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8, gap: 10 },
  ladderLetter: { color: t.ink, fontSize: 13, fontFamily: fonts[800], width: 32 },
  ladderTier: { color: t.inkSoft, fontSize: 12.5, flex: 1 },
  ladderRange: { color: t.muted, fontSize: 11.5 },
  bottomBar: { gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14, backgroundColor: t.sheet, borderTopWidth: 1, borderTopColor: t.divider, width: '100%', maxWidth: 560, alignSelf: 'center'},
  bottomRow: { flexDirection: 'row', gap: 10 },
  bbBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, paddingVertical: 14, borderWidth: 1, borderColor: 'transparent' },
  bbText: { fontFamily: fonts[800], fontSize: 14 },

  correctionCard: { backgroundColor: t.card, borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: t.cardBorder },
  correctionPillar: { color: t.accent, fontSize: 10, fontFamily: fonts[700], letterSpacing: 1, marginBottom: 4 },
  correctionText: { color: t.ink, fontSize: 13 },
  correctionMeta: { color: t.muted2, fontSize: 11, marginTop: 6 },
  actionRow: { flexDirection: 'row', margin: 20, gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, padding: 13, borderRadius: 999, borderWidth: 1, borderColor: t.cta2Border,
  },
  actionText: { color: t.cta2Text, fontFamily: fonts[700], fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  modal: { backgroundColor: t.sheet, borderRadius: 20, padding: 24, margin: 12, borderWidth: 1, borderColor: t.cardBorder, width: '100%', maxWidth: 560, alignSelf: 'center'},
  modalTitle: { color: t.ink, fontSize: 20, fontFamily: fonts[800], marginBottom: 4 },
  modalSub: { color: t.muted, fontSize: 12, marginBottom: 16 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.divider },
  toggleLabel: { color: t.inkSoft, fontSize: 14 },
  label: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 },
  pillarChip: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, marginRight: 6 },
  pillarChipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  pillarChipText: { color: t.inkSoft, fontSize: 12 },
  input: { backgroundColor: t.chip, borderRadius: 14, padding: 14, color: t.ink, fontSize: 14, marginBottom: 12, borderWidth: 1, borderColor: t.line },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 999, borderWidth: 1, borderColor: t.cta2Border, alignItems: 'center' },
  cancelText: { color: t.cta2Text, fontFamily: fonts[700] },
  saveBtn: { flex: 1, padding: 14, borderRadius: 999, backgroundColor: t.ctaBg, alignItems: 'center' },
  saveText: { color: t.ctaText, fontFamily: fonts[700] },
});
