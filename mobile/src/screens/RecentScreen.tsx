import React, { useCallback, useState, useEffect, useRef } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, Modal, TextInput, KeyboardAvoidingView, Platform, Switch, RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { evalsAPI, playerAPI, gameReportsAPI, trainingAPI, staffSharingAPI, coachesAPI, gameEvalAPI } from '../api/client';
import { GradeBadge } from '../components/GradeBadge';
import { mdToHtml, safeFileName, splitReportSections, joinReportSections } from '../utils/mdToHtml';
import ShareModal from '../components/ShareModal';
import { outputTypeLabel } from '../utils/reportType';
import { renderReport } from '../utils/renderReport';
import { GeneratingOverlay } from '../components/GeneratingBasketball';
import SharedReportViewer from '../components/SharedReportViewer';
import ScoutContextPanel from '../components/ScoutContextPanel';
import ExportSectionsModal from '../components/ExportSectionsModal';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';

const TYPE_LABELS: Record<string, string> = {
  player_eval: 'Player Eval',
  film_breakdown: 'Film Breakdown',
  scouting_report: 'Scouting Report',
  coaching_report: 'Coaching Report',
  game_analysis: 'Game Analysis',
  training_program: 'Training Program',
  recruitment_profile: 'Recruitment',
  position_analysis: 'Position Analysis',
  box_score: 'Box Score',
  team_training: 'Team Training',
  game_situational: 'Game Situational',
};

type ReportItem = {
  id: number | string;
  report_id?: number;   // for packet report versions: the owning packet id
  kind: 'eval' | 'team' | 'game' | 'training' | 'scout' | 'gamereport';
  player_name?: string;
  output_type: string;
  overall_grade?: number | null;
  created_at: string;
  program_text?: string;
  report_text?: string;
  // Set when this row is a report another coach SHARED with me (surfaced in
  // Recent alongside my own). It keeps full share functions; regenerate shows
  // only if the sharer allowed it.
  shared?: boolean;
  shared_id?: number;         // StaffSharedReport id (for regenerate)
  allow_regenerate?: boolean;
  sender_name?: string;
  share_report_type?: string; // underlying staff-share report_type
  raw?: any;                  // full StaffSharedReportOut, for the viewer
  updated_from?: string;      // set on MY copy that was regenerated from X's share
};

type ModalReport = {
  id: number;
  kind: 'eval' | 'team' | 'training';
  text: string;
  outputType: string;
  playerName?: string;
  evalId?: number;
};

const FILTER_CATS = [
  { key: 'all', label: 'All' },
  { key: 'eval', label: 'Player Evals' },
  { key: 'team', label: 'Team Reports' },
  { key: 'game', label: 'Game Reports' },
  { key: 'scout', label: 'Scout' },
  { key: 'training', label: 'Training' },
];

type StaffShareContext = {
  report_type: string;
  report_id: number;
  label: string;
};

export default function RecentScreen() {
  const { coach } = useAuth();
  const { t } = useTheme();
  const styles = makeStyles(t);
  const sendStyles = makeSendStyles(t);
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeModal, setActiveModal] = useState<ModalReport | null>(null);
  // 'report' = main view, 'send' = send flow, 'correct' = correction input
  const [modalView, setModalView] = useState<'report' | 'send' | 'correct'>('report');
  const [teamReportTexts, setTeamReportTexts] = useState<Record<number, string>>({});
  const [evalCache, setEvalCache] = useState<Record<number, any>>({});
  const [loadingEval, setLoadingEval] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Send state (inline in modal)
  const [sendSearch, setSendSearch] = useState('');
  const [sendResults, setSendResults] = useState<any[]>([]);
  const [sendSearchLoading, setSendSearchLoading] = useState(false);
  const [sending, setSending] = useState(false);

  // Game report view modal
  const [gameReportModal, setGameReportModal] = useState<{ title: string; text: string; reportType?: string; reportId?: number; outputType?: string; subject?: string } | null>(null);
  // Scout-report context/corrections panel (opens over the report)
  const [scoutCorrectMode, setScoutCorrectMode] = useState(false);
  // Section-selectable export/print
  const [exportCtx, setExportCtx] = useState<{ title: string; subject?: string; text: string } | null>(null);

  // Correct state (inline in modal)
  const [teamCorrectText, setTeamCorrectText] = useState('');
  const [applyingCorrect, setApplyingCorrect] = useState(false);
  const [savingCorrect, setSavingCorrect] = useState(false);
  const [corrections, setCorrections] = useState<any[]>([]);

  const supportsCorrections = (m: ModalReport | null) =>
    !!m && (m.kind === 'eval' ? !!m.evalId : (m.kind === 'team' || m.kind === 'training'));

  const loadCorrections = async (m: ModalReport | null) => {
    if (!m) { setCorrections([]); return; }
    try {
      if (m.kind === 'eval' && m.evalId) {
        setCorrections(await evalsAPI.corrections(m.evalId));
      } else if (m.kind === 'team') {
        setCorrections(await evalsAPI.teamReportCorrections(m.id));
      } else if (m.kind === 'training') {
        setCorrections(await trainingAPI.corrections(m.id));
      } else {
        setCorrections([]);
      }
    } catch { setCorrections([]); }
  };

  // Save a correction without regenerating (save for later).
  const saveCorrectionForLater = async () => {
    if (!teamCorrectText.trim() || !activeModal) return;
    setSavingCorrect(true);
    try {
      if (activeModal.kind === 'eval' && activeModal.evalId) {
        await evalsAPI.addCorrection(activeModal.evalId, { correction: teamCorrectText.trim() });
      } else if (activeModal.kind === 'team') {
        await evalsAPI.addTeamReportCorrection(activeModal.id, teamCorrectText.trim());
      } else if (activeModal.kind === 'training') {
        await trainingAPI.addCorrection(activeModal.id, teamCorrectText.trim());
      }
      setTeamCorrectText('');
      await loadCorrections(activeModal);
      Alert.alert('Saved', 'Correction saved. Apply & Regenerate when ready.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not save correction');
    } finally {
      setSavingCorrect(false);
    }
  };

  // Unified share modal (player / team / staff)
  const [shareCtx, setShareCtx] = useState<{ reportType: string; reportId: number; outputType: string; reportText: string; title: string } | null>(null);

  // Unified shared-report viewer (correct / regenerate / comment / notes)
  const [viewerShared, setViewerShared] = useState<any | null>(null);

  // Generic Send to Staff modal
  const [staffShareCtx, setStaffShareCtx] = useState<StaffShareContext | null>(null);
  const [showStaffShareModal, setShowStaffShareModal] = useState(false);
  const [staffSearch, setStaffSearch] = useState('');
  const [staffResults, setStaffResults] = useState<any[]>([]);
  const [staffSearchLoading, setStaffSearchLoading] = useState(false);
  const [sendingToStaff, setSendingToStaff] = useState(false);
  const [staffAllowRegen, setStaffAllowRegen] = useState(false);
  const [staffMessage, setStaffMessage] = useState('');
  // Staff share content toggles
  const [staffShareToggles, setStaffShareToggles] = useState({
    share_report_text: true, share_grades: false, share_flags: false,
    share_questions: false, share_overall_grade: false, share_pillar_grades: false,
  });
  // Staff share preview text (first 150 chars of report)
  const [staffSharePreview, setStaffSharePreview] = useState<string | null>(null);
  // Full report text + per-section toggles for frozen (non-regenerable) shares
  const [staffShareFullText, setStaffShareFullText] = useState<string>('');
  const [staffSectionToggles, setStaffSectionToggles] = useState<Record<string, boolean>>({});

  // Send-to-player content toggles (for modal send view)
  const [playerShareToggles, setPlayerShareToggles] = useState({
    share_report_text: true, share_overall_grade: false, share_pillar_grades: false,
    share_green_flags: false, share_watch_flags: false, share_key_questions: false,
  });

  const openStaffShareModal = (ctx: StaffShareContext, previewText?: string, fullText?: string) => {
    setStaffShareCtx(ctx);
    setStaffSearch('');
    setStaffResults([]);
    setStaffAllowRegen(false);
    setStaffMessage('');
    setStaffShareToggles({ share_report_text: true, share_grades: false, share_flags: false, share_questions: false, share_overall_grade: false, share_pillar_grades: false });
    setStaffSharePreview(previewText ?? null);
    const txt = fullText ?? '';
    setStaffShareFullText(txt);
    setStaffSectionToggles(Object.fromEntries(splitReportSections(txt).map(s => [s.heading, true])));
    setShowStaffShareModal(true);
  };

  const closeStaffShareModal = () => {
    setShowStaffShareModal(false);
    setStaffShareCtx(null);
    setStaffSearch('');
    setStaffResults([]);
  };

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
    if (!staffShareCtx) return;
    setSendingToStaff(true);
    try {
      const secs = splitReportSections(staffShareFullText);
      const frozenText = !staffAllowRegen && secs.length > 1
        ? (joinReportSections(secs, staffSectionToggles) || staffShareFullText || undefined)
        : undefined;
      await staffSharingAPI.share({
        report_type: staffShareCtx.report_type,
        report_id: staffShareCtx.report_id,
        recipient_id: target.id,
        allow_regenerate: staffAllowRegen,
        frozen_text: frozenText,
      });
      Alert.alert('Shared!', `${staffShareCtx.label} shared with ${target.name}.`);
      closeStaffShareModal();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not share');
    } finally {
      setSendingToStaff(false);
    }
  };

  const [refreshing, setRefreshing] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const [evals, teamReports, gameReports, trainingSessions, gameSessions, sharedInbox] = await Promise.all([
        evalsAPI.recent(),
        evalsAPI.teamReports(),
        gameReportsAPI.allVersions().catch(() => []),
        trainingAPI.recent().catch(() => []),
        gameEvalAPI.listSessions().catch(() => []),
        staffSharingAPI.inbox().catch(() => []),
      ]);
      const evalItems: ReportItem[] = evals.map((e: any) => ({
        id: e.id,
        kind: 'eval',
        player_name: e.player_name,
        output_type: e.output_type,
        overall_grade: e.overall_grade,
        created_at: e.created_at,
      }));
      const teamItems: ReportItem[] = teamReports.map((tr: any) => ({
        id: tr.id,
        kind: 'team',
        player_name: 'Team Report',
        output_type: tr.output_type,
        overall_grade: null,
        created_at: tr.created_at,
      }));
      // Each saved packet report VERSION (one per report-type selection).
      const gameItems: ReportItem[] = (gameReports ?? []).map((v: any) => ({
        id: `gv-${v.id}`,
        report_id: v.report_id,
        kind: 'game',
        player_name: v.title || 'Game Report',
        output_type: v.output_type,
        overall_grade: null,
        created_at: v.updated_at || v.created_at,
        report_text: v.report_text,
      }));
      const trainingItems: ReportItem[] = trainingSessions.map((ts: any) => ({
        id: ts.id,
        kind: 'training' as const,
        player_name: ts.player_name || `Player #${ts.player_id}`,
        output_type: 'training_program',
        overall_grade: null,
        created_at: ts.created_at,
        program_text: ts.program_text,
      }));
      // Scout reports: games where I have MY OWN scouting report. The backend
      // scopes ai_scouting_report to the requesting coach's own report (per
      // coach), so a non-null value here is always mine — including my scouting
      // of a team game I don't own. Reports another coach shared with me arrive
      // separately via the staff inbox below.
      const scoutItems: ReportItem[] = (gameSessions ?? [])
        .filter((g: any) => g.ai_scouting_report)
        .map((g: any) => ({
          id: g.id,
          kind: 'scout' as const,
          player_name: g.opponent_name ? `vs ${g.opponent_name}` : (g.title || 'Scout Report'),
          output_type: 'scouting_report',
          overall_grade: null,
          // Sort by when the scout was generated/updated so a freshly created
          // one lands at the top, not buried under the (old) game date.
          created_at: g.scouting_updated_at || g.date || g.created_at,
          report_text: String(g.ai_scouting_report).replace(/\s*END OF REPORT\.?\s*$/i, '').trimEnd(),
        }));
      // Full game reports: games where I have MY OWN persisted game report
      // (our team + opponent). Per-coach scoped by the backend like scouting.
      const gameReportItems: ReportItem[] = (gameSessions ?? [])
        .filter((g: any) => g.ai_game_report)
        .map((g: any) => ({
          id: g.id,
          kind: 'gamereport' as const,
          player_name: g.opponent_name ? `vs ${g.opponent_name}` : (g.title || 'Game Report'),
          output_type: 'game_report',
          overall_grade: null,
          created_at: g.game_report_updated_at || g.date || g.created_at,
          report_text: String(g.ai_game_report).replace(/\s*END OF REPORT\.?\s*$/i, '').trimEnd(),
        }));
      const texts: Record<number, string> = {};
      teamReports.forEach((tr: any) => { if (tr.report_text) texts[tr.id] = tr.report_text; });
      setTeamReportTexts(texts);
      const ec: Record<number, any> = {};
      evals.forEach((e: any) => { ec[e.id] = e; });
      setEvalCache(ec);

      // Reports another coach SHARED with me — surfaced in Recent with full
      // share functions. Regenerate shows only when the sharer allowed it.
      const SHARE_KIND: Record<string, ReportItem['kind']> = {
        eval: 'eval', team_report: 'team', team_training: 'team',
        game: 'game', game_session: 'scout', game_report: 'gamereport', training: 'training',
      };
      const sharedItems: ReportItem[] = (sharedInbox ?? []).map((sr: any) => {
        const kind = SHARE_KIND[sr.report_type] ?? 'eval';
        const text = sr.report_text || '';
        return {
          id: sr.report_id,
          kind,
          player_name: sr.subject_name || 'Shared report',
          output_type: sr.output_type ?? 'coaching_report',
          overall_grade: sr.overall_grade ?? null,
          created_at: sr.created_at,
          report_text: text,
          program_text: kind === 'training' ? text : undefined,
          shared: true,
          shared_id: sr.id,
          allow_regenerate: !!sr.allow_regenerate,
          sender_name: sr.sender_name || 'A coach',
          share_report_type: sr.report_type,
          raw: sr,
        } as ReportItem;
      });

      // Map my OWN records that were regenerated from a shared report back to
      // that share, so I can label them "Updated · from X" AND let their
      // "Correct" button reopen the same viewer.
      const updatedFrom: Record<string, any> = {};
      (sharedInbox ?? []).forEach((sr: any) => {
        if (sr.updated_report_id) {
          const k = SHARE_KIND[sr.report_type] ?? 'eval';
          updatedFrom[`${k}:${sr.updated_report_id}`] = sr;
        }
      });
      [...evalItems, ...teamItems, ...gameItems, ...trainingItems, ...scoutItems, ...gameReportItems].forEach((it: ReportItem) => {
        const sr = updatedFrom[`${it.kind}:${it.id}`];
        if (sr) {
          it.updated_from = sr.sender_name || 'a coach';
          it.raw = sr;
          it.shared_id = sr.id;
          it.allow_regenerate = !!sr.allow_regenerate;
        }
      });

      const combined = [...evalItems, ...teamItems, ...gameItems, ...trainingItems, ...scoutItems, ...gameReportItems, ...sharedItems].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setItems(combined);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const searchTerm = searchQuery.trim().toLowerCase();
  const filtered = items.filter(item => {
    // The "Game Reports" tab groups packet game reports and per-game reports.
    const matchesFilter = item.kind === filter || (filter === 'game' && item.kind === 'gamereport');
    if (filter !== 'all' && !matchesFilter) return false;
    if (!searchTerm) return true;
    const kindLabel =
      item.kind === 'game' ? 'Game Report Packet' :
      item.kind === 'scout' ? 'Scout Report' :
      item.kind === 'training' ? 'Training Program' :
      (TYPE_LABELS[item.output_type] ?? outputTypeLabel(item.output_type));
    const haystack = [
      item.player_name ?? '',
      kindLabel,
      item.output_type ?? '',
    ].join(' ').toLowerCase();
    return haystack.includes(searchTerm);
  });

  const openModal = (report: ModalReport) => {
    setActiveModal(report);
    setModalView('report');
    setSendSearch('');
    setSendResults([]);
    setTeamCorrectText('');
    setPlayerShareToggles({ share_report_text: true, share_overall_grade: false, share_pillar_grades: false, share_green_flags: false, share_watch_flags: false, share_key_questions: false });
  };

  const handlePress = async (item: ReportItem) => {
    // A shared report opens in the unified viewer (correct / regenerate /
    // comment / notes), always scrollable.
    if (item.shared) {
      openViewer(item);
      return;
    }
    if (item.kind === 'game') {
      navigation.navigate('GameReportBuilder', { reportId: item.report_id ?? item.id });
      return;
    }
    if (item.kind === 'scout') {
      setGameReportModal({
        title: 'Scouting Report', subject: item.player_name, text: item.report_text ?? '',
        reportType: 'game_session', reportId: item.id, outputType: 'scouting_report',
      });
      return;
    }
    if (item.kind === 'gamereport') {
      setGameReportModal({
        title: 'Game Report', subject: item.player_name, text: item.report_text ?? '',
        reportType: 'game_report', reportId: item.id, outputType: 'game_report',
      });
      return;
    }
    if (item.kind === 'training') {
      openModal({ id: item.id, kind: 'training', text: item.program_text ?? '', outputType: 'training_program', playerName: item.player_name });
      return;
    }
    if (item.kind === 'team') {
      const text = teamReportTexts[item.id] ?? '';
      openModal({ id: item.id, kind: 'team', text, outputType: item.output_type, playerName: item.player_name });
    } else {
      let evalData = evalCache[item.id];
      if (!evalData?.report_text) {
        setLoadingEval(true);
        try {
          evalData = await evalsAPI.get(item.id);
          setEvalCache(prev => ({ ...prev, [item.id]: evalData }));
        } catch {}
        setLoadingEval(false);
      }
      openModal({
        id: item.id, kind: 'eval',
        text: evalData?.report_text ?? '',
        outputType: item.output_type,
        playerName: item.player_name,
        evalId: item.id,
      });
    }
  };

  const openViewer = (item: ReportItem) => {
    // Prefer the full shared payload; fall back to a minimal shape.
    setViewerShared(item.raw ?? {
      id: item.shared_id, report_type: item.share_report_type, report_text: item.report_text,
      allow_regenerate: item.allow_regenerate, sender_name: item.sender_name, subject_name: item.player_name,
    });
  };

  const handleDelete = (item: ReportItem) => {
    if (item.shared) return; // a report shared with me isn't mine to delete
    // Packet reports (and versions) are managed from Team Eval, not deletable here.
    if (item.kind === 'training' || item.kind === 'scout' || item.kind === 'gamereport' || item.kind === 'game') return;
    Alert.alert('Delete Report', 'Permanently delete this report?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          if (item.kind === 'eval') {
            await evalsAPI.delete(item.id as number);
          } else if (item.kind === 'team') {
            await evalsAPI.deleteTeamReport(item.id as number);
          } else {
            await gameReportsAPI.delete(item.id as number);
          }
          load();
        } catch (e: any) {
          Alert.alert('Error', e?.response?.data?.detail ?? 'Could not delete');
        }
      }},
    ]);
  };

  const exportModalReport = async () => {
    if (!activeModal?.text) return;
    setExporting(true);
    try {
      const title = TYPE_LABELS[activeModal.outputType] ?? outputTypeLabel(activeModal.outputType);
      const html = `<html><head><style>
        body{font-family:Georgia,serif;padding:40px;color:#111;max-width:800px;margin:auto}
        h1{font-size:22px;border-bottom:2px solid #2563eb;padding-bottom:8px}
        h2{font-size:17px;color:#1e40af;margin-top:24px}
        h3{font-size:14px;color:#374151;margin-top:16px}
        p{line-height:1.7;font-size:13px}
        li{line-height:1.7;font-size:13px}
      </style></head><body>
        <h1>BloomPrint — ${title}</h1>
        ${activeModal.playerName ? `<p>${activeModal.playerName}</p>` : ''}
        ${mdToHtml(activeModal.text)}
      </body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      const fileName = `${safeFileName(title)}.pdf`;
      const dest = FileSystem.cacheDirectory + fileName;
      await FileSystem.copyAsync({ from: uri, to: dest });
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: 'Share Report' });
    } catch (e: any) {
      Alert.alert('Export Error', e?.message ?? 'Could not export');
    } finally {
      setExporting(false);
    }
  };

  const printModalReport = async () => {
    if (!activeModal?.text) return;
    try {
      const title = TYPE_LABELS[activeModal.outputType] ?? outputTypeLabel(activeModal.outputType);
      const html = `<html><head><style>
        body{font-family:Georgia,serif;padding:40px;color:#111}
        h1{font-size:22px}h2{font-size:17px;color:#1e40af}
        p,li{line-height:1.7;font-size:13px}
      </style></head><body>
        <h1>BloomPrint — ${title}</h1>
        ${mdToHtml(activeModal.text)}
      </body></html>`;
      await Print.printAsync({ html });
    } catch (e: any) {
      Alert.alert('Print Error', e?.message ?? 'Could not print');
    }
  };

  // Generic export/print (used by the scout/game report modal).
  const buildReportHtmlDoc = (title: string, text: string, subject?: string) => `<html><head><style>
      body{font-family:Georgia,serif;padding:40px;color:#111;max-width:800px;margin:auto}
      h1{font-size:22px;border-bottom:2px solid #2563eb;padding-bottom:8px}
      h2{font-size:17px;color:#1e40af;margin-top:24px}
      p,li{line-height:1.7;font-size:13px}
    </style></head><body>
      <h1>BloomPrint — ${title}</h1>
      ${subject ? `<p>${subject}</p>` : ''}
      ${mdToHtml(text)}
    </body></html>`;

  const exportText = async (title: string, text: string, subject?: string) => {
    if (!text) return;
    setExporting(true);
    try {
      const { uri } = await Print.printToFileAsync({ html: buildReportHtmlDoc(title, text, subject) });
      const dest = FileSystem.cacheDirectory + `${safeFileName(title)}.pdf`;
      await FileSystem.copyAsync({ from: uri, to: dest });
      await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: 'Share Report' });
    } catch (e: any) {
      Alert.alert('Export Error', e?.message ?? 'Could not export');
    } finally { setExporting(false); }
  };

  const printText = async (title: string, text: string, subject?: string) => {
    if (!text) return;
    try {
      await Print.printAsync({ html: buildReportHtmlDoc(title, text, subject) });
    } catch (e: any) {
      Alert.alert('Print Error', e?.message ?? 'Could not print');
    }
  };

  const searchDebounce = useRef<any>(null);
  useEffect(() => {
    if (modalView !== 'send') return;
    clearTimeout(searchDebounce.current);
    if (!sendSearch.trim()) { setSendResults([]); return; }
    setSendSearchLoading(true);
    searchDebounce.current = setTimeout(async () => {
      try {
        const results = await playerAPI.searchPlayerUsers(sendSearch.trim());
        setSendResults(results);
      } catch {}
      setSendSearchLoading(false);
    }, 400);
  }, [sendSearch, modalView]);

  const sendReport = async (target: any) => {
    if (!activeModal) return;
    setSending(true);
    try {
      if (activeModal.kind === 'eval' && activeModal.evalId) {
        await playerAPI.share(activeModal.evalId, {
          player_user_id: target.id,
          share_report_text: playerShareToggles.share_report_text,
          share_grades: playerShareToggles.share_overall_grade || playerShareToggles.share_pillar_grades,
          share_flags: playerShareToggles.share_green_flags || playerShareToggles.share_watch_flags,
          share_questions: playerShareToggles.share_key_questions,
        });
      } else if (activeModal.kind === 'training') {
        await playerAPI.shareTeamReport({
          output_type: activeModal.outputType,
          report_text: playerShareToggles.share_report_text ? activeModal.text : '',
          target_type: 'player',
          player_user_id: target.id,
        });
      } else {
        await playerAPI.shareTeamReport({
          output_type: activeModal.outputType,
          report_text: playerShareToggles.share_report_text ? activeModal.text : '',
          target_type: 'player',
          player_user_id: target.id,
        });
      }
      setSendSearch('');
      setSendResults([]);
      setModalView('report');
      Alert.alert('Sent!', `Report sent to ${target.name}.`);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not send report');
    } finally {
      setSending(false);
    }
  };

  // Apply & regenerate: persist any pending text, then regenerate from all
  // un-applied corrections (the backend marks those applied afterward).
  const applyCorrection = async () => {
    if (!activeModal) return;
    if (activeModal.kind === 'training') {
      Alert.alert('Info', 'To regenerate training with feedback, use the Player Profile screen.');
      return;
    }
    const pending = teamCorrectText.trim();
    if (!pending && corrections.filter(c => !c.applied).length === 0) {
      Alert.alert('Nothing to apply', 'Add a correction first.');
      return;
    }
    setApplyingCorrect(true);
    try {
      let updatedText = '';
      if (activeModal.kind === 'eval' && activeModal.evalId) {
        if (pending) await evalsAPI.addCorrection(activeModal.evalId, { correction: pending });
        const updated = await evalsAPI.regenerate(activeModal.evalId);
        updatedText = updated.report_text;
        setEvalCache(prev => ({ ...prev, [activeModal.evalId!]: updated }));
      } else if (activeModal.kind === 'training') {
        if (pending) await trainingAPI.addCorrection(activeModal.id, pending);
        const updated = await trainingAPI.applyCorrections(activeModal.id);
        updatedText = updated.program_text ?? updated.report_text ?? '';
      } else {
        if (pending) await evalsAPI.addTeamReportCorrection(activeModal.id, pending);
        const updated = await evalsAPI.regenerateTeamReport(activeModal.id);
        updatedText = updated.report_text;
        setTeamReportTexts(prev => ({ ...prev, [activeModal.id]: updatedText }));
      }
      setActiveModal(prev => prev ? { ...prev, text: updatedText } : prev);
      setTeamCorrectText('');
      await loadCorrections(activeModal);
      setModalView('report');
      Alert.alert('Updated', 'Report regenerated with your corrections.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not apply correction');
    } finally {
      setApplyingCorrect(false);
    }
  };

  if (loading) return <ScreenBackground><View style={styles.center}><ActivityIndicator color={t.accent} size="large" /></View></ScreenBackground>;

  let lastDate = '';

  return (
    <ScreenBackground>
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Recent Reports</Text>
        <TouchableOpacity
          style={styles.searchIconBtn}
          onPress={() => {
            setSearchVisible(v => {
              if (v) setSearchQuery('');
              return !v;
            });
          }}
        >
          <Ionicons name={searchVisible ? 'close' : 'search'} size={22} color={t.ink} />
        </TouchableOpacity>
      </View>

      {searchVisible && (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={t.muted2} />
          <TextInput
            style={styles.searchBarInput}
            placeholder="Search reports..."
            placeholderTextColor={t.muted2}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close" size={18} color={t.muted2} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Category filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ paddingHorizontal: 16, paddingRight: 24, gap: 8, alignItems: 'center' }}>
        {FILTER_CATS.map(cat => (
          <TouchableOpacity
            key={cat.key}
            style={[styles.filterChip, filter === cat.key && styles.filterChipActive]}
            onPress={() => setFilter(cat.key)}
          >
            <Text style={[styles.filterChipText, filter === cat.key && styles.filterChipTextActive]}>
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={t.accent} />}
        data={filtered}
        keyExtractor={e => e.shared ? `shared-${e.shared_id}` : `${e.kind}-${e.id}`}
        contentContainerStyle={{ paddingBottom: 100 }}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="document-text-outline" size={48} color={t.muted2} />
            <Text style={styles.emptyText}>No reports yet.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const dateStr = new Date(item.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
          const showDate = dateStr !== lastDate;
          lastDate = dateStr;
          return (
            <>
              {showDate && (
                <Text style={styles.dateHeader}>{dateStr}</Text>
              )}
              <View
                style={[
                  styles.card,
                  item.kind === 'team' && styles.cardTeam,
                  item.kind === 'game' && styles.cardGame,
                  item.kind === 'training' && styles.cardTraining,
                  { flexDirection: 'column', alignItems: 'flex-start' },
                ]}
              >
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' }}
                  onPress={() => handlePress(item)}
                  onLongPress={() => handleDelete(item)}
                >
                  <View style={styles.kindBadge}>
                    <Ionicons
                      name={
                        item.kind === 'game' ? 'clipboard' :
                        item.kind === 'gamereport' ? 'sparkles' :
                        item.kind === 'team' ? 'people' :
                        item.kind === 'training' ? 'barbell' :
                        'person'
                      }
                      size={12}
                      color={
                        item.kind === 'game' ? t.accent :
                        item.kind === 'team' ? t.brown :
                        item.kind === 'training' ? t.positive :
                        t.accent
                      }
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={styles.playerName}>{item.player_name}</Text>
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      style={[
                        styles.typeName,
                        item.kind === 'team' && { color: t.brown },
                        item.kind === 'game' && { color: t.accent },
                        item.kind === 'scout' && { color: t.accent },
                        item.kind === 'gamereport' && { color: t.accent },
                        item.kind === 'training' && { color: t.positive },
                      ]}
                    >
                      {item.kind === 'game' ? 'Game Report Packet' :
                       item.kind === 'scout' ? 'Scout Report' :
                       item.kind === 'gamereport' ? 'Game Report' :
                       item.kind === 'training' ? 'Training Program' :
                       (TYPE_LABELS[item.output_type] ?? outputTypeLabel(item.output_type))}
                    </Text>
                    {item.shared && (
                      <Text numberOfLines={1} style={styles.sharedByLabel}>
                        Shared by {item.sender_name}
                      </Text>
                    )}
                    {!item.shared && item.updated_from && (
                      <Text numberOfLines={1} style={[styles.sharedByLabel, { color: t.accent }]}>
                        Updated · from {item.updated_from}
                      </Text>
                    )}
                  </View>
                  {item.overall_grade != null && <GradeBadge grade={item.overall_grade} size="md" />}
                  {item.kind === 'game' && <Ionicons name="chevron-forward" size={14} color={t.muted2} />}
                </TouchableOpacity>
                {/* Action buttons row — shown for all card types */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, width: '100%' }}>
                  {/* Game-specific buttons */}
                  {(item.kind === 'game' || item.kind === 'scout' || item.kind === 'gamereport') && item.report_text ? (
                    <TouchableOpacity
                      style={styles.gameActionBtn}
                      onPress={() => setGameReportModal({
                        title: item.kind === 'scout' ? 'Scouting Report' : 'Game Report',
                        subject: item.player_name, text: item.report_text!,
                        reportType: item.kind === 'scout' ? 'game_session' : item.kind === 'gamereport' ? 'game_report' : 'game',
                        reportId: (item.kind === 'game' ? (item.report_id ?? item.id) : item.id) as number, outputType: item.kind === 'scout' ? 'scouting_report' : item.kind === 'gamereport' ? 'game_report' : (item.output_type ?? 'coaching_report'),
                      })}
                    >
                      <Ionicons name="document-text-outline" size={13} color={t.accent} />
                      <Text style={[styles.gameActionText, { color: t.accent }]}>View Report</Text>
                    </TouchableOpacity>
                  ) : null}
                  {item.kind === 'game' && !item.shared && (
                    <TouchableOpacity
                      style={styles.gameActionBtn}
                      onPress={() => navigation.navigate('GameReportBuilder', { reportId: item.report_id ?? item.id })}
                    >
                      <Ionicons name="create-outline" size={13} color={t.muted} />
                      <Text style={styles.gameActionText}>Edit Packet</Text>
                    </TouchableOpacity>
                  )}

                  {/* Send to Player — available for eval, team, training; hidden for game/scout/gamereport */}
                  {item.kind !== 'game' && item.kind !== 'scout' && item.kind !== 'gamereport' && (
                    <TouchableOpacity
                      style={[styles.gameActionBtn, { borderColor: t.positiveSoft }]}
                      onPress={() => {
                        openModal({
                          id: item.id,
                          kind: item.kind as any,
                          text: item.program_text ?? item.report_text ?? (teamReportTexts[item.id] ?? (evalCache[item.id]?.report_text ?? '')),
                          outputType: item.output_type,
                          playerName: item.player_name,
                          evalId: item.kind === 'eval' ? item.id : undefined,
                        });
                        setTimeout(() => setModalView('send'), 50);
                      }}
                    >
                      <Ionicons name="person-outline" size={13} color={t.positive} />
                      <Text style={[styles.gameActionText, { color: t.positive }]}>Send to Player</Text>
                    </TouchableOpacity>
                  )}

                  {/* Correct — opens the shared-report viewer's edit flow.
                      On the shared original AND on my Updated copy of it. */}
                  {(item.shared || item.updated_from) && item.allow_regenerate && (
                    <TouchableOpacity
                      style={[styles.gameActionBtn, { borderColor: t.accentSoft }]}
                      onPress={() => openViewer(item)}
                    >
                      <Ionicons name="create-outline" size={13} color={t.accent} />
                      <Text style={[styles.gameActionText, { color: t.accent }]}>Correct</Text>
                    </TouchableOpacity>
                  )}

                  {/* Share — player / team / staff, available for all types */}
                  <TouchableOpacity
                    style={[styles.gameActionBtn, { borderColor: t.brownSoft }]}
                    onPress={() => {
                      // A shared report forwards under its ORIGINAL type/id so
                      // the recipient (or player) gets the author's report.
                      const reportType = item.shared ? (item.share_report_type ?? 'eval') :
                                         item.kind === 'eval' ? 'eval' :
                                         item.kind === 'team' ? 'team_report' :
                                         item.kind === 'scout' ? 'game_session' :
                                         item.kind === 'gamereport' ? 'game_report' :
                                         item.kind === 'game' ? 'game' :
                                         'training';
                      const label = item.kind === 'training' ? 'Training Program' :
                                    item.kind === 'scout' ? 'Scout Report' :
                                    item.kind === 'gamereport' ? 'Game Report' :
                                    item.kind === 'game' ? 'Game Report' :
                                    item.kind === 'team' ? 'Team Report' : 'Player Eval';
                      const fullText = item.program_text ?? item.report_text ?? (teamReportTexts[item.id as number] ?? '');
                      setShareCtx({
                        reportType,
                        reportId: (item.kind === 'game' ? (item.report_id ?? item.id) : item.id) as number,
                        outputType: item.output_type ?? (item.kind === 'training' ? 'training_program' : 'coaching_report'),
                        reportText: fullText,
                        title: label,
                      });
                    }}
                  >
                    <Ionicons name="share-social-outline" size={13} color={t.brown} />
                    <Text style={[styles.gameActionText, { color: t.brown }]}>Share</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          );
        }}
      />

      {/* Loading overlay while fetching eval detail */}
      {loadingEval && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={t.accent} size="large" />
        </View>
      )}

      {/* Game Report View Modal */}
      <Modal visible={!!gameReportModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{gameReportModal?.title ?? 'Report'}</Text>
                {!!gameReportModal?.subject && <Text style={styles.modalSub}>{gameReportModal.subject}</Text>}
              </View>
              <TouchableOpacity onPress={() => { setGameReportModal(null); setScoutCorrectMode(false); }}>
                <Ionicons name="close" size={24} color={t.muted} />
              </TouchableOpacity>
            </View>
            {scoutCorrectMode && gameReportModal?.reportId != null ? (
              <ScoutContextPanel
                gameId={gameReportModal.reportId}
                opponentName={(gameReportModal.subject ?? '').replace(/^vs\s+/i, '').trim() || undefined}
                onBack={() => setScoutCorrectMode(false)}
                onRegenerated={(newText) => {
                  setGameReportModal(prev => prev ? { ...prev, text: newText || prev.text } : prev);
                  setScoutCorrectMode(false);
                  load();
                }}
              />
            ) : (
              <>
                <KeyboardAwareScrollView contentContainerStyle={{ paddingBottom: 16 }}>
                  {gameReportModal?.text
                    ? renderReport(gameReportModal.text, { heading: t.ink, body: t.inkSoft })
                    : <Text style={{ color: t.muted2 }}>No report content available.</Text>
                  }
                </KeyboardAwareScrollView>
                {gameReportModal && (
                  <View style={styles.actionRow}>
                    {gameReportModal.reportType === 'game_session' && gameReportModal.reportId != null && (
                      <TouchableOpacity style={styles.actionBtn} onPress={() => setScoutCorrectMode(true)}>
                        <Ionicons name="create-outline" size={18} color={t.ink} />
                        <Text style={styles.actionText}>Correct</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.actionBtn} onPress={() => setExportCtx({ title: gameReportModal.title, subject: gameReportModal.subject, text: gameReportModal.text })}>
                      <Ionicons name="download-outline" size={18} color={t.ink} />
                      <Text style={styles.actionText}>Export / Print</Text>
                    </TouchableOpacity>
                    {gameReportModal.reportType && gameReportModal.reportId != null && (
                      <>
                        <TouchableOpacity
                          style={[styles.actionBtn, { borderColor: t.positiveSoft }]}
                          onPress={() => {
                            const g = gameReportModal;
                            setGameReportModal(null);
                            setShareCtx({ reportType: g.reportType!, reportId: g.reportId!, outputType: g.outputType ?? 'scouting_report', reportText: g.text, title: g.title });
                          }}
                        >
                          <Ionicons name="person-outline" size={18} color={t.positive} />
                          <Text style={[styles.actionText, { color: t.positive }]}>Player</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionBtn, { borderColor: t.brownSoft }]}
                          onPress={() => {
                            const g = gameReportModal;
                            setGameReportModal(null);
                            setShareCtx({ reportType: g.reportType!, reportId: g.reportId!, outputType: g.outputType ?? 'scouting_report', reportText: g.text, title: g.title });
                          }}
                        >
                          <Ionicons name="share-social-outline" size={18} color={t.brown} />
                          <Text style={[styles.actionText, { color: t.brown }]}>Share</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Unified shared-report viewer (correct / regenerate / comment / notes) */}
      <SharedReportViewer
        shared={viewerShared}
        visible={!!viewerShared}
        onClose={() => setViewerShared(null)}
        onChanged={load}
      />

      {/* Section-selectable export / print */}
      <ExportSectionsModal
        visible={!!exportCtx}
        title={exportCtx?.title ?? 'Report'}
        subject={exportCtx?.subject}
        reportText={exportCtx?.text ?? ''}
        onClose={() => setExportCtx(null)}
      />

      {/* Generic Send to Staff Modal */}
      <Modal visible={showStaffShareModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Send to Staff</Text>
                <Text style={styles.modalSub}>
                  Share {staffShareCtx?.label ?? 'this report'} with a coach, scout, or trainer.
                </Text>
              </View>
              <TouchableOpacity onPress={closeStaffShareModal}>
                <Ionicons name="close" size={24} color={t.muted} />
              </TouchableOpacity>
            </View>

            <KeyboardAwareScrollView style={{ maxHeight: '80%' }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {/* Report preview */}
              {staffSharePreview && (
                <View style={[sendStyles.reportPreview, { marginBottom: 12 }]}>
                  <Text style={sendStyles.reportPreviewTitle}>Report Preview</Text>
                  <Text style={sendStyles.reportPreviewText} numberOfLines={3}>{staffSharePreview}</Text>
                </View>
              )}

              {/* Content toggles */}
              {staffShareCtx?.report_type === 'training' ? (
                <>
                  {[
                    { key: 'share_report_text', label: 'Share Program Text' },
                  ].map(tog => (
                    <View key={tog.key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.divider }}>
                      <Text style={{ color: t.inkSoft, fontSize: 13 }}>{tog.label}</Text>
                      <Switch value={staffShareToggles[tog.key as keyof typeof staffShareToggles]} onValueChange={v => setStaffShareToggles(prev => ({ ...prev, [tog.key]: v }))} trackColor={{ false: t.line, true: t.brown }} thumbColor="#fff" />
                    </View>
                  ))}
                </>
              ) : (
                <>
                  {[
                    { key: 'share_report_text', label: 'Share Report Text' },
                    { key: 'share_overall_grade', label: 'Share Overall Grade' },
                    { key: 'share_pillar_grades', label: 'Share Pillar Grades' },
                    { key: 'share_grades', label: 'Share Green Flags' },
                    { key: 'share_flags', label: 'Share Watch Flags' },
                    { key: 'share_questions', label: 'Share Key Questions' },
                  ].map(tog => (
                    <View key={tog.key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.divider }}>
                      <Text style={{ color: t.inkSoft, fontSize: 13 }}>{tog.label}</Text>
                      <Switch value={staffShareToggles[tog.key as keyof typeof staffShareToggles]} onValueChange={v => setStaffShareToggles(prev => ({ ...prev, [tog.key]: v }))} trackColor={{ false: t.line, true: t.brown }} thumbColor="#fff" />
                    </View>
                  ))}
                </>
              )}

              {/* Allow regenerate toggle */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 4, backgroundColor: t.chip, borderRadius: 8, padding: 12 }}>
                <Text style={{ color: t.inkSoft, fontSize: 13 }}>Allow recipient to regenerate</Text>
                <Switch
                  value={staffAllowRegen}
                  onValueChange={setStaffAllowRegen}
                  trackColor={{ false: t.line, true: t.brown }}
                  thumbColor="#fff"
                />
              </View>
              <Text style={{ color: t.muted2, fontSize: 11, marginBottom: 12, marginLeft: 2 }}>
                {staffAllowRegen
                  ? 'Sends a live, regenerable copy — recipient sees the full report.'
                  : 'Sends a frozen snapshot — choose which sections to include below.'}
              </Text>

              {/* Section toggles — only in frozen mode (regenerate OFF) */}
              {(() => {
                const secs = splitReportSections(staffShareFullText);
                return !staffAllowRegen && secs.length > 1 ? (
                  <>
                    <Text style={{ color: t.muted, fontSize: 12, fontFamily: fonts[600], marginBottom: 6 }}>Include Sections</Text>
                    {secs.map(sec => (
                      <View key={sec.heading} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, backgroundColor: t.chip, borderRadius: 8, padding: 10 }}>
                        <Text style={{ color: t.inkSoft, fontSize: 13, flex: 1, marginRight: 8 }} numberOfLines={1}>{sec.heading}</Text>
                        <Switch
                          value={staffSectionToggles[sec.heading] !== false}
                          onValueChange={v => setStaffSectionToggles(prev => ({ ...prev, [sec.heading]: v }))}
                          trackColor={{ false: t.line, true: t.brown }}
                          thumbColor="#fff"
                        />
                      </View>
                    ))}
                  </>
                ) : null;
              })()}

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <VoiceTextInput
                  style={[sendStyles.searchInput, { flex: 1 }]}
                  placeholder="Search coach/program name..."
                  placeholderTextColor={t.muted2}
                  value={staffSearch}
                  onChangeText={setStaffSearch}
                />
                <TouchableOpacity
                  style={{ backgroundColor: t.brown, borderRadius: 10, padding: 12, alignItems: 'center', justifyContent: 'center' }}
                  onPress={searchStaff}
                  disabled={staffSearchLoading}
                >
                  {staffSearchLoading ? <ActivityIndicator color={t.brownInk} size="small" /> : <Ionicons name="search" size={18} color={t.brownInk} />}
                </TouchableOpacity>
              </View>
              {staffResults.map((r: any) => (
                <TouchableOpacity
                  key={r.id}
                  style={sendStyles.resultRow}
                  onPress={() => sendToStaff(r)}
                  disabled={sendingToStaff}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontFamily: fonts[600] }}>{r.name}</Text>
                    <Text style={{ color: t.muted2, fontSize: 12 }}>{r.role} · {r.program_name}</Text>
                  </View>
                  {sendingToStaff ? <ActivityIndicator color={t.brown} size="small" /> : <Ionicons name="paper-plane-outline" size={18} color={t.brown} />}
                </TouchableOpacity>
              ))}
              {staffResults.length === 0 && staffSearch.trim().length > 0 && !staffSearchLoading && (
                <Text style={{ color: t.muted2, textAlign: 'center', paddingVertical: 20 }}>No staff found.</Text>
              )}
            </KeyboardAwareScrollView>
            <TouchableOpacity
              style={[sendStyles.cancelBtn, { marginTop: 12, flex: 0 }]}
              onPress={closeStaffShareModal}
            >
              <Text style={{ color: t.muted, fontFamily: fonts[600] }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Single modal — swaps between report / send / correct views */}
      <Modal visible={!!activeModal} animationType="slide" transparent>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>

            {/* Header — back arrow when in sub-view */}
            <View style={styles.modalHeader}>
              {modalView !== 'report' ? (
                <TouchableOpacity onPress={() => setModalView('report')} style={{ marginRight: 10 }}>
                  <Ionicons name="arrow-back" size={22} color={t.muted} />
                </TouchableOpacity>
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>
                  {modalView === 'send' ? 'Send Report' :
                   modalView === 'correct' ? 'Correct Report' :
                   (TYPE_LABELS[activeModal?.outputType ?? ''] ?? outputTypeLabel(activeModal?.outputType) ?? 'Report')}
                </Text>
                {modalView === 'report' && activeModal?.playerName && (
                  <Text style={styles.modalSub}>{activeModal.playerName}</Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setActiveModal(null)}>
                <Ionicons name="close" size={24} color={t.muted} />
              </TouchableOpacity>
            </View>

            {/* REPORT VIEW */}
            {modalView === 'report' && (
              <>
                <KeyboardAwareScrollView contentContainerStyle={{ paddingBottom: 16 }}>
                  {activeModal?.text
                    ? renderReport(activeModal.text, { heading: t.ink, body: t.inkSoft })
                    : <Text style={{ color: t.muted2 }}>No report content</Text>
                  }
                </KeyboardAwareScrollView>
                <View style={styles.actionRow}>
                  {supportsCorrections(activeModal) && (
                    <TouchableOpacity style={styles.actionBtn} onPress={() => { setTeamCorrectText(''); loadCorrections(activeModal); setModalView('correct'); }}>
                      <Ionicons name="create-outline" size={18} color={t.ink} />
                      <Text style={styles.actionText}>Correct</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => activeModal && setExportCtx({ title: TYPE_LABELS[activeModal.outputType] ?? outputTypeLabel(activeModal.outputType), subject: activeModal.playerName, text: activeModal.text })}
                  >
                    <Ionicons name="download-outline" size={18} color={t.ink} />
                    <Text style={styles.actionText}>Export / Print</Text>
                  </TouchableOpacity>
                  {/* Send to Player */}
                  <TouchableOpacity style={[styles.actionBtn, { borderColor: t.positiveSoft }]} onPress={() => { setSendSearch(''); setSendResults([]); setModalView('send'); }}>
                    <Ionicons name="person-outline" size={18} color={t.positive} />
                    <Text style={[styles.actionText, { color: t.positive }]}>Player</Text>
                  </TouchableOpacity>
                  {/* Share — player / team / staff */}
                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: t.brownSoft }]}
                    onPress={() => {
                      if (!activeModal) return;
                      const reportType = activeModal.kind === 'eval' ? 'eval' :
                                          activeModal.kind === 'team' ? 'team_report' : 'training';
                      const label = activeModal.kind === 'training' ? 'Training Program' :
                                    activeModal.kind === 'team' ? 'Team Report' : 'Player Eval';
                      const fullText = activeModal.text ?? '';
                      const reportId = activeModal.id;
                      const outputType = activeModal.outputType ?? (activeModal.kind === 'training' ? 'training_program' : 'coaching_report');
                      setActiveModal(null);
                      setShareCtx({ reportType, reportId, outputType, reportText: fullText, title: label });
                    }}
                  >
                    <Ionicons name="share-social-outline" size={18} color={t.brown} />
                    <Text style={[styles.actionText, { color: t.brown }]}>Share</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* SEND VIEW */}
            {modalView === 'send' && (
              <>
                {/* Report preview */}
                <View style={sendStyles.reportPreview}>
                  <Text style={sendStyles.reportPreviewTitle}>{TYPE_LABELS[activeModal?.outputType ?? ''] ?? outputTypeLabel(activeModal?.outputType)}</Text>
                  <Text style={sendStyles.reportPreviewText} numberOfLines={2}>{activeModal?.text?.replace(/[#*_]/g, '').trim().slice(0, 120)}...</Text>
                </View>

                {/* Content toggles */}
                {activeModal?.kind === 'training' ? (
                  <View style={{ marginBottom: 10 }}>
                    {[
                      { key: 'share_report_text', label: 'Share Program Text' },
                    ].map(tog => (
                      <View key={tog.key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: t.divider }}>
                        <Text style={{ color: t.inkSoft, fontSize: 13 }}>{tog.label}</Text>
                        <Switch value={playerShareToggles[tog.key as keyof typeof playerShareToggles]} onValueChange={v => setPlayerShareToggles(prev => ({ ...prev, [tog.key]: v }))} trackColor={{ false: t.line, true: t.positive }} thumbColor="#fff" />
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={{ marginBottom: 10 }}>
                    {[
                      { key: 'share_report_text', label: 'Share Report Text' },
                      { key: 'share_overall_grade', label: 'Share Overall Grade' },
                      { key: 'share_pillar_grades', label: 'Share Pillar Grades' },
                      { key: 'share_green_flags', label: 'Share Green Flags' },
                      { key: 'share_watch_flags', label: 'Share Watch Flags' },
                      { key: 'share_key_questions', label: 'Share Key Questions' },
                    ].map(tog => (
                      <View key={tog.key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: t.divider }}>
                        <Text style={{ color: t.inkSoft, fontSize: 13 }}>{tog.label}</Text>
                        <Switch value={playerShareToggles[tog.key as keyof typeof playerShareToggles]} onValueChange={v => setPlayerShareToggles(prev => ({ ...prev, [tog.key]: v }))} trackColor={{ false: t.line, true: t.positive }} thumbColor="#fff" />
                      </View>
                    ))}
                  </View>
                )}

                <Text style={{ color: t.muted2, fontSize: 12, marginBottom: 10 }}>Search for a player to send this report to their inbox.</Text>
                <View style={{ marginBottom: 12 }}>
                  <VoiceTextInput
                    style={sendStyles.searchInput}
                    placeholder="Type a name to search..."
                    placeholderTextColor={t.muted2}
                    value={sendSearch}
                    onChangeText={setSendSearch}
                  />
                  {sendSearchLoading && (
                    <ActivityIndicator color={t.muted2} size="small" style={{ marginTop: 8, alignSelf: 'center' }} />
                  )}
                </View>
                <KeyboardAwareScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled">
                  {sendResults.map(r => (
                    <TouchableOpacity key={r.id} style={sendStyles.resultRow} onPress={() => sendReport(r)} disabled={sending}>
                      <View style={sendStyles.avatar}>
                        <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>{r.name?.[0] ?? '?'}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: t.ink, fontFamily: fonts[600] }}>{r.name}</Text>
                        <Text style={{ color: t.muted2, fontSize: 12 }}>{r.email}</Text>
                      </View>
                      {sending ? <ActivityIndicator color={t.accent} size="small" /> : <Ionicons name="paper-plane-outline" size={18} color={t.accent} />}
                    </TouchableOpacity>
                  ))}
                  {sendResults.length === 0 && sendSearch.trim().length > 0 && !sendSearchLoading && (
                    <Text style={{ color: t.muted2, textAlign: 'center', paddingVertical: 20 }}>No players found. Make sure they've registered on the player portal.</Text>
                  )}
                </KeyboardAwareScrollView>
              </>
            )}

            {/* CORRECT VIEW */}
            {modalView === 'correct' && (
              <>
                <View style={sendStyles.reportPreview}>
                  <Text style={sendStyles.reportPreviewTitle}>{TYPE_LABELS[activeModal?.outputType ?? ''] ?? outputTypeLabel(activeModal?.outputType)}</Text>
                  <Text style={sendStyles.reportPreviewText} numberOfLines={2}>{activeModal?.text?.replace(/[#*_]/g, '').trim().slice(0, 120)}...</Text>
                </View>
                <Text style={{ color: t.muted2, fontSize: 12, marginBottom: 10 }}>Save corrections for later, then Apply & Regenerate to update the report using all un-applied corrections.</Text>
                <VoiceTextInput
                  style={sendStyles.correctInput}
                  placeholder="What needs to be corrected in this report?"
                  placeholderTextColor={t.muted2}
                  value={teamCorrectText}
                  onChangeText={setTeamCorrectText}
                  multiline
                  textAlignVertical="top"
                />
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <TouchableOpacity style={sendStyles.cancelBtn} onPress={saveCorrectionForLater} disabled={savingCorrect || !teamCorrectText.trim()}>
                    {savingCorrect ? <ActivityIndicator color={t.muted} size="small" /> : <Text style={{ color: t.ink, fontFamily: fonts[700] }}>Save for Later</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={sendStyles.applyBtn} onPress={applyCorrection} disabled={applyingCorrect}>
                    {applyingCorrect ? <ActivityIndicator color={t.ctaText} size="small" /> : <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>Apply & Regenerate</Text>}
                  </TouchableOpacity>
                </View>
                <GeneratingOverlay visible={applyingCorrect} label="Regenerating the report…" />

                {corrections.length > 0 && (
                  <View style={{ marginTop: 18 }}>
                    <Text style={{ color: t.label, fontSize: 11, fontFamily: fonts[700], letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                      Corrections ({corrections.length})
                    </Text>
                    {corrections.map((c: any) => (
                      <View key={c.id} style={{ backgroundColor: t.card, borderRadius: 10, padding: 11, marginBottom: 6, borderWidth: 1, borderColor: t.cardBorder, opacity: c.applied ? 0.55 : 1 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                          {c.applied
                            ? <View style={{ backgroundColor: t.positiveSoft, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}>
                                <Text style={{ color: t.positive, fontSize: 9, fontFamily: fonts[700] }}>APPLIED</Text>
                              </View>
                            : <View style={{ backgroundColor: t.chip, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}>
                                <Text style={{ color: t.muted, fontSize: 9, fontFamily: fonts[700] }}>PENDING</Text>
                              </View>}
                          <Text style={{ color: t.muted2, fontSize: 10 }}>{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</Text>
                        </View>
                        <Text style={{ color: t.inkSoft, fontSize: 12.5 }}>{c.correction}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}

          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Unified Share modal — player / team / staff */}
      {shareCtx && (
        <ShareModal
          visible={!!shareCtx}
          onClose={() => setShareCtx(null)}
          reportType={shareCtx.reportType}
          reportId={shareCtx.reportId}
          outputType={shareCtx.outputType}
          reportText={shareCtx.reportText}
          title={shareCtx.title}
        />
      )}
    </View>
    </ScreenBackground>
  );
}

const makeSendStyles = (t: ThemeTokens) => StyleSheet.create({
  searchInput: {
    backgroundColor: t.card, borderRadius: 10, padding: 14,
    color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line,
    minHeight: 48,
  },
  searchBtn: { backgroundColor: t.ctaBg, borderRadius: 10, padding: 12, alignItems: 'center', justifyContent: 'center' },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
    borderRadius: 10, backgroundColor: t.chip, marginBottom: 8,
  },
  avatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: t.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  correctInput: {
    backgroundColor: t.card, borderRadius: 10, padding: 14, color: t.ink,
    fontSize: 15, borderWidth: 1, borderColor: t.line, minHeight: 120,
  },
  reportPreview: {
    backgroundColor: t.chip, borderRadius: 10, padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: t.line,
  },
  reportPreviewTitle: { color: t.label, fontSize: 11, fontFamily: fonts[700], textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  reportPreviewText: { color: t.muted2, fontSize: 12, lineHeight: 18 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: t.line, alignItems: 'center' },
  applyBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: t.ctaBg, alignItems: 'center' },
});


const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', paddingTop: 56 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  title: { fontSize: 28, fontFamily: fonts[900], color: t.ink, marginHorizontal: 20, marginBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 },
  searchIconBtn: {
    width: 40, height: 40, borderRadius: 20, marginBottom: 12,
    alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.card, borderRadius: 10, borderWidth: 1, borderColor: t.line,
    marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, height: 44,
  },
  searchBarInput: { flex: 1, color: t.ink, fontSize: 15, paddingVertical: 0 },
  filterRow: { marginBottom: 12, flexGrow: 0, height: 52 },
  filterChip: { borderWidth: 1, borderColor: t.line, borderRadius: 18, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center', height: 34 },
  filterChipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  filterChipText: { color: t.muted, fontSize: 13, fontFamily: fonts[600] },
  filterChipTextActive: { color: t.ctaText },
  dateHeader: { color: t.label, fontSize: 11, fontFamily: fonts[700], marginHorizontal: 20, marginTop: 16, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 },
  emptyText: { color: t.muted2, marginTop: 12, fontSize: 14 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.card, marginHorizontal: 16, marginBottom: 8,
    borderRadius: 12, padding: 14, gap: 10,
    borderWidth: 1, borderColor: t.cardBorder,
  },
  cardTeam: { borderWidth: 1, borderColor: t.brownSoft },
  cardGame: { borderWidth: 1, borderColor: t.accentSoft },
  cardTraining: { borderWidth: 1, borderColor: t.positiveSoft },
  kindBadge: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center',
  },
  typeName: { color: t.accent, fontSize: 12, fontFamily: fonts[600], marginTop: 2, lineHeight: 20, paddingBottom: 2 },
  playerName: { color: t.ink, fontSize: 15, fontFamily: fonts[700], lineHeight: 22 },
  sharedByLabel: { color: t.muted2, fontSize: 11, fontFamily: fonts[600], marginTop: 1, fontStyle: 'italic' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: t.scrim,
    alignItems: 'center', justifyContent: 'center',
  },
  modalOverlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  modalBox: { backgroundColor: t.sheet, borderRadius: 20, padding: 20, maxHeight: '90%', margin: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  modalTitle: { color: t.ink, fontSize: 18, fontFamily: fonts[800] },
  modalSub: { color: t.muted2, fontSize: 12, marginTop: 4, lineHeight: 18 },
  actionRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.divider,
  },
  actionBtn: {
    flex: 1, minWidth: '45%', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6, backgroundColor: t.chip,
    borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12,
  },
  actionText: { color: t.ink, fontSize: 13, fontFamily: fonts[600] },
  gameActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: t.chip, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10,
    borderWidth: 1, borderColor: t.line,
  },
  gameActionText: { color: t.muted, fontSize: 12, fontFamily: fonts[600] },
  input: {
    backgroundColor: t.card, borderRadius: 10, padding: 12, color: t.ink,
    fontSize: 14, borderWidth: 1, borderColor: t.line, minHeight: 44, marginBottom: 8,
  },
  editArea: {
    backgroundColor: t.card, borderRadius: 10, padding: 12, color: t.ink,
    fontSize: 14, borderWidth: 1, borderColor: t.line, minHeight: 220, textAlignVertical: 'top',
  },
  primaryBtn: { backgroundColor: t.ctaBg, borderRadius: 12, padding: 15, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: t.ctaText, fontSize: 15, fontFamily: fonts[800] },
});
