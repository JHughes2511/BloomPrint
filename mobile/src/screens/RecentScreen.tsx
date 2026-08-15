import React, { useCallback, useState, useEffect, useRef } from 'react';
import { roleLabel } from '../utils/roleLabel';
import { useTranslation } from 'react-i18next';
import { useReportTranslation } from '../hooks/useReportTranslation';
import TranslationToggle from '../components/TranslationToggle';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, Modal, TextInput, KeyboardAvoidingView, Platform, Switch, RefreshControl,
} from 'react-native';
import Sheet from '../components/Sheet';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { exportHtmlPdf, printRawHtml } from '../utils/exportDoc';
import { evalsAPI, playerAPI, gameReportsAPI, trainingAPI, staffSharingAPI, coachesAPI, gameEvalAPI } from '../api/client';
import { readPage, writePage } from '../storage/pageCache';
import { GradeBadge } from '../components/GradeBadge';
import { mdToHtml, safeFileName, splitReportSections, joinReportSections } from '../utils/mdToHtml';
import ShareModal from '../components/ShareModal';
import { outputTypeLabel, outputTypeNames } from '../utils/reportType';
import { renderReport } from '../utils/renderReport';
import { useReportSearch, ReportSearchBar, ReportSearchButton } from '../components/ReportSearch';
import { GeneratingOverlay } from '../components/GeneratingBasketball';
import SharedReportViewer from '../components/SharedReportViewer';
import ScoutContextPanel from '../components/ScoutContextPanel';
import ExportSectionsModal from '../components/ExportSectionsModal';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { titleTopPad } from '../responsive/screenPadding';
import { useBreakpoint } from '../responsive/useBreakpoint';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import PageContainer from '../responsive/PageContainer';
import { sheetCap, REPORT_MODAL_WIDTH } from '../responsive/modalSizes';
import ChipRow from '../responsive/ChipRow';
import { desktopOnly } from '../responsive/modalSizes';
import { useGridColumns } from '../responsive/useGridColumns';

type ReportItem = {
  id: number;
  report_id?: number;   // for packet report versions: the owning packet id
  kind: 'eval' | 'team' | 'game' | 'training' | 'scout' | 'gamereport' | 'film';
  player_name?: string;
  output_type: string;
  overall_grade?: number | null;
  created_at: string;
  /** The report's own name, when it has one (training programs, evals). */
  title?: string;
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

/**
 * A one-line stand-in for a report with no title of its own.
 *
 * Drops the document's opening heading when it only repeats the report type —
 * "TRAINING PROGRAM: MAJOR CASH" under a card already labelled TRAINING
 * PROGRAM says the same thing twice.
 */
function previewLine(text?: string, outputType?: string): string {
  const lines = (text ?? '').replace(/[#*_]/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  const kind = (outputType ?? '').replace(/_/g, ' ').toLowerCase();
  const first = lines[0] ?? '';
  const repeatsType = kind && first.toLowerCase().startsWith(kind);
  const line = (repeatsType ? (lines[1] ?? first) : first);
  return line.length > 90 ? line.slice(0, 90) + '…' : line;
}

type ModalReport = {
  id: number;
  kind: 'eval' | 'team' | 'training';
  text: string;
  outputType: string;
  playerName?: string;
  evalId?: number;
  /** The report's own title, so the preview can lead with it. */
  title?: string;
  createdAt?: string;
};

const FILTER_CATS = ['all', 'eval', 'matchup', 'team', 'game', 'scout', 'training'];

type StaffShareContext = {
  report_type: string;
  report_id: number;
  label: string;
};

export default function RecentScreen() {
  // Tablet and up. Not Platform: a phone browser is web too, and gating the
  // desktop layout on platform put it on every phone that opened the site.
  const { isWide } = useBreakpoint();
  // 3 across at ~1900px. Date headers span a full row, so they still break the
  // grid into days rather than landing mid-row.
  const recentGrid = useGridColumns({ columns: 3, inset: 32 });
  /**
   * Too narrow for an icon AND the whole label.
   *
   * An iPad runs the same three columns a desktop does, at roughly 265px each
   * rather than 545. Measured at that width, three buttons need about 248px
   * for their icons, padding and full text and have 237 — so something has to
   * give, and it is the icon: "View Rep…" tells a coach less than the icon
   * costs. Above this width both fit and both are kept.
   */
  const tightBtns = !!recentGrid.cardWidth && recentGrid.cardWidth < 400;
  const { coach } = useAuth();
  const { t: tr } = useTranslation();
  const { t } = useTheme();
  const styles = makeStyles(t);
  const sendStyles = makeSendStyles(t);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [items, setItems] = useState<ReportItem[]>([]);
  // True only until something has arrived. A reload with a list already on
  // screen keeps the list — see useStaleWhileRefreshing for the reasoning.
  const [loading, setLoading] = useState(true);
  const loadedOnce = useRef(false);
  const cacheKey = `recent.${coach?.id ?? 0}`;
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

  // Reports keep the language they were written in; show them in the reader's
  // language with a toggle back to the original. `kind` maps to the server's
  // report_type vocabulary.
  const modalReportType = activeModal?.kind === 'eval' ? 'eval'
    : activeModal?.kind === 'team' ? 'team_report'
    : activeModal?.kind === 'training' ? 'training' : undefined;
  const rt = useReportTranslation(modalReportType, activeModal?.id as number | undefined, activeModal?.text);
  // A saved report and a game report each get their own search: two sheets,
  // two scroll views, and a query typed into one has nothing to do with the
  // other.
  const find = useReportSearch(rt.text ?? '');
  const findGame = useReportSearch(gameReportModal?.text ?? '');

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
      Alert.alert(tr('recent.correctionSavedTitle'), tr('recent.correctionSavedMsg'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('recent.saveCorrectionError'));
    } finally {
      setSavingCorrect(false);
    }
  };

  // Unified share modal (player / team / staff)
  const [shareCtx, setShareCtx] = useState<{ reportType: string; reportId: number; outputType: string; reportText: string; title: string; subject?: string } | null>(null);

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
  // Which of the report's own sections go to the player. Keyed by heading;
  // absent means on, so a report opened for sending starts with everything
  // included, exactly as before this was switchable.
  const [sectionToggles, setSectionToggles] = useState<Record<string, boolean>>({});
  const sendSections = splitReportSections(activeModal?.text ?? '');
  const sendToggleSections = sendSections.filter(sec => !sec.pinned);
  const hiddenSendSections = () =>
    sendToggleSections.filter(sec => sectionToggles[sec.heading] === false).map(sec => sec.heading);
  /** The report text with the coach's withheld sections removed. */
  const sendTextFiltered = () =>
    (hiddenSendSections().length ? joinReportSections(sendSections, sectionToggles) : activeModal?.text) || '';

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
      Alert.alert(tr('recent.sharedTitle'), tr('recent.sharedMsg', { label: staffShareCtx.label, name: target.name }));
      closeStaffShareModal();
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('recent.shareError'));
    } finally {
      setSendingToStaff(false);
    }
  };

  const [refreshing, setRefreshing] = useState(false);
  const load = async () => {
    if (!loadedOnce.current) setLoading(true);
    try {
      const [evals, teamReports, gameReports, filmAnalyses, trainingSessions, gameSessions, sharedInbox] = await Promise.all([
        evalsAPI.recent(),
        evalsAPI.teamReports(),
        gameReportsAPI.allVersions().catch(() => []),
        gameReportsAPI.allFilmAnalyses().catch(() => []),
        trainingAPI.recent().catch(() => []),
        gameEvalAPI.listSessions().catch(() => []),
        staffSharingAPI.inbox().catch(() => []),
      ]);
      const evalItems: ReportItem[] = evals.map((e: any) => ({
        id: e.id,
        kind: 'eval',
        // Match-ups carry a display title ("A vs B"); fall back to the player name.
        player_name: e.title || e.player_name,
        output_type: e.output_type,
        overall_grade: e.overall_grade,
        created_at: e.created_at,
      }));
      // 'rep', not 'tr': naming this parameter tr shadowed the translator, so
      // tr('recent.teamReport') called a team-report object as a function and
      // threw. Everything built after this line — game reports, training,
      // shared inbox — was lost with it, and the catch below turned the whole
      // failure into an empty list. It only fired once a coach had at least
      // one team report, which is why it looked like missing data rather than
      // a crash.
      const teamItems: ReportItem[] = teamReports.map((rep: any) => ({
        id: rep.id,
        kind: 'team',
        player_name: tr('recent.teamReport'),
        output_type: rep.output_type,
        overall_grade: null,
        created_at: rep.created_at,
      }));
      // Each saved packet report VERSION (one per report-type selection).
      const gameItems: ReportItem[] = (gameReports ?? []).map((v: any) => ({
        // The version's own id. It used to be prefixed "gv-" for list-key
        // uniqueness, which keyExtractor already gets from kind + id — and the
        // prefix broke the updated-from lookup below, which keys on kind:id
        // with a numeric id, so a packet version regenerated from someone
        // else's share never got its "Updated · from X" label.
        id: v.id,
        report_id: v.report_id,
        kind: 'game',
        player_name: v.title || tr('recent.gameReport'),
        output_type: v.output_type,
        overall_grade: null,
        created_at: v.updated_at || v.created_at,
        report_text: v.report_text,
      }));
      const trainingItems: ReportItem[] = trainingSessions.map((ts: any) => ({
        id: ts.id,
        kind: 'training' as const,
        player_name: ts.player_name || tr('recent.playerNumber', { id: ts.player_id }),
        output_type: 'training_program',
        overall_grade: null,
        created_at: ts.created_at,
        program_text: ts.program_text,
        // The program's own name — the same one the player's profile shows.
        title: ts.title,
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
          player_name: g.opponent_name ? tr('recent.vsOpponent', { name: g.opponent_name }) : (g.title || tr('recent.scoutReport')),
          output_type: 'scouting_report',
          overall_grade: null,
          // Sort by when the scout was generated/updated so a freshly created
          // one lands at the top, not buried under the (old) game date.
          created_at: g.scouting_updated_at || g.date || g.created_at,
          report_text: String(g.ai_scouting_report).replace(/\s*END OF REPORT\.?\s*$/i, '').trimEnd(),
        }));
      // Full game reports: games where I have MY OWN persisted game report
      // (our team + opponent). Per-coach scoped by the backend like scouting.
      // A film's breakdown, as its own card. It says which packet it came from
      // so two packets analysing the same team are not two identical rows.
      const filmItems: ReportItem[] = (filmAnalyses ?? []).map((f: any) => {
        // The film is often OF the matchup the packet is about, in which case
        // "Angola vs Egypt · from Angola vs Egypt" says the same thing twice.
        const same = (a?: string, b?: string) =>
          (a ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase() ===
          (b ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
        return {
          id: f.id,
          report_id: f.report_id,
          kind: 'film' as const,
          player_name: f.team_name && !same(f.team_name, f.packet_title)
            ? tr('recent.filmFromPacket', { team: f.team_name, packet: f.packet_title })
            : f.packet_title,
          output_type: f.output_type,
          overall_grade: null,
          created_at: f.created_at,
          report_text: f.report_text,
        };
      });

      const gameReportItems: ReportItem[] = (gameSessions ?? [])
        .filter((g: any) => g.ai_game_report)
        .map((g: any) => ({
          id: g.id,
          kind: 'gamereport' as const,
          player_name: g.opponent_name ? tr('recent.vsOpponent', { name: g.opponent_name }) : (g.title || tr('recent.gameReport')),
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
      // Not the ones the coach sent. The shared list now holds both ends of a
      // conversation so the sender can read the replies — but Recent already
      // lists the coach's own reports, and a second card saying "shared" would
      // be the same report twice with two different names on it. Those belong
      // in Staff Hub, where the conversation is.
      const sharedItems: ReportItem[] = (sharedInbox ?? []).filter((sr: any) => !sr.is_sender).map((sr: any) => {
        const kind = SHARE_KIND[sr.report_type] ?? 'eval';
        const text = sr.report_text || '';
        return {
          id: sr.report_id,
          kind,
          player_name: sr.subject_name || tr('recent.sharedReportFallback'),
          output_type: sr.output_type ?? 'coaching_report',
          overall_grade: sr.overall_grade ?? null,
          created_at: sr.created_at,
          report_text: text,
          program_text: kind === 'training' ? text : undefined,
          shared: true,
          shared_id: sr.id,
          allow_regenerate: !!sr.allow_regenerate,
          sender_name: sr.sender_name || tr('recent.senderFallback'),
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
      [...evalItems, ...teamItems, ...gameItems, ...filmItems, ...trainingItems, ...scoutItems, ...gameReportItems].forEach((it: ReportItem) => {
        const sr = updatedFrom[`${it.kind}:${it.id}`];
        if (sr) {
          it.updated_from = sr.sender_name || tr('recent.senderFallbackLower');
          it.raw = sr;
          it.shared_id = sr.id;
          it.allow_regenerate = !!sr.allow_regenerate;
        }
      });

      const combined = [...evalItems, ...teamItems, ...gameItems, ...filmItems, ...trainingItems, ...scoutItems, ...gameReportItems, ...sharedItems].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setItems(combined);
      // Kept for the next cold open. Recent merges six sources into one sorted
      // list, so unlike other screens there is nothing to show early — the
      // whole list is the unit, and last session's copy of it is what makes
      // opening this tab instant.
      void writePage(cacheKey, { items: combined });
    } finally {
      setLoading(false);
      loadedOnce.current = true;
    }
  };

  // Fills empty state only: a cache that loses the race to the network must
  // never replace fresher data with older.
  useEffect(() => {
    let live = true;
    readPage<any>(cacheKey).then(kept => {
      if (!live || !kept?.items?.length) return;
      setItems(prev => (prev.length ? prev : kept.items));
      setLoading(false);
    });
    return () => { live = false; };
  }, [cacheKey]);

  useFocusEffect(useCallback(() => { load(); }, []));

  const searchTerm = searchQuery.trim().toLowerCase();
  const filtered = items.filter(item => {
    // The "Game Reports" tab groups packet game reports and per-game reports.
    // "Match Ups" spans any report whose type includes matchup (player or team).
    // "Team Reports" gathers everything written ABOUT a team: roster-wide
    // reports, anything generated in a game packet, and a film's breakdown.
    // "Game Reports" stays what it says — the report built from a tracked
    // game's own stats.
    const matchesFilter = filter === 'matchup'
      ? (item.output_type ?? '').split(',').map(s => s.trim()).includes('matchup')
      : filter === 'team' ? ['team', 'game', 'film'].includes(item.kind)
      : filter === 'game' ? item.kind === 'gamereport'
      : item.kind === filter;
    if (filter !== 'all' && !matchesFilter) return false;
    if (!searchTerm) return true;
    const kindLabel =
      item.kind === 'game' ? tr('recent.gameReportPacket') :
      item.kind === 'film' ? tr('recent.fromFilm', { types: outputTypeNames(item.output_type) }) :
      item.kind === 'scout' ? tr('recent.scoutReport') :
      item.kind === 'training' ? tr('reportTypes.training_program') :
      outputTypeLabel(item.output_type);
    const haystack = [
      item.player_name ?? '',
      kindLabel,
      item.output_type ?? '',
    ].join(' ').toLowerCase();
    return haystack.includes(searchTerm);
  });

  // On web the day headers are separate list entries so each can occupy a full
  // grid row; on a phone the list is one column and the header stays inline.
  const listData: any[] = Platform.OS !== 'web' ? filtered : (() => {
    const out: any[] = [];
    let last = '';
    for (const it of filtered) {
      const d = new Date(it.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      if (d !== last) { out.push({ __dayHeader: d, created_at: it.created_at }); last = d; }
      out.push(it);
    }
    return out;
  })();

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
      navigation.push('GameReportBuilder', { reportId: item.report_id ?? item.id });
      return;
    }
    if (item.kind === 'scout') {
      setGameReportModal({
        title: tr('reportTypes.scouting_report'), subject: item.player_name, text: item.report_text ?? '',
        reportType: 'game_session', reportId: item.id, outputType: 'scouting_report',
      });
      return;
    }
    if (item.kind === 'gamereport') {
      setGameReportModal({
        title: tr('reportTypes.game_report'), subject: item.player_name, text: item.report_text ?? '',
        reportType: 'game_report', reportId: item.id, outputType: 'game_report',
      });
      return;
    }
    if (item.kind === 'film') {
      setGameReportModal({
        title: tr('recent.fromFilm', { types: outputTypeNames(item.output_type) }),
        subject: item.player_name, text: item.report_text ?? '',
        // The CLIP's id: sharing resolves a film breakdown from the clip,
        // since one packet can hold several films.
        reportType: 'film', reportId: item.id,
        outputType: item.output_type,
      });
      return;
    }
    if (item.kind === 'training') {
      openModal({ id: item.id, kind: 'training', text: item.program_text ?? '', outputType: 'training_program',
                  playerName: item.player_name, title: item.title, createdAt: item.created_at });
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

  // Arriving from search with a specific report in mind. Team reports and
  // scouting reports have no screen of their own — they open in a sheet on this
  // screen — so a search hit lands here and opens itself, rather than dropping
  // the coach on a list and making them find the row again.
  const openedFromSearch = useRef('');
  useEffect(() => {
    const kind = route.params?.openKind;
    const id = Number(route.params?.openId);
    if (!kind || !id || !items.length) return;
    const key = `${kind}:${id}`;
    if (openedFromSearch.current === key) return;
    const hit = items.find(i => i.kind === kind && i.id === id);
    if (!hit) return;
    openedFromSearch.current = key;
    handlePress(hit);
  }, [route.params?.openKind, route.params?.openId, items]);   // eslint-disable-line react-hooks/exhaustive-deps

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
    Alert.alert(tr('recent.deleteReportTitle'), tr('recent.deleteReportMsg'), [
      { text: tr('common.cancel'), style: 'cancel' },
      { text: tr('common.delete'), style: 'destructive', onPress: async () => {
        try {
          if (item.kind === 'eval') {
            await evalsAPI.delete(item.id);
          } else if (item.kind === 'team') {
            await evalsAPI.deleteTeamReport(item.id);
          } else {
            await gameReportsAPI.delete(item.id);
          }
          load();
        } catch (e: any) {
          Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('recent.deleteError'));
        }
      }},
    ]);
  };

  const exportModalReport = async () => {
    if (!activeModal?.text) return;
    setExporting(true);
    try {
      const title = outputTypeLabel(activeModal.outputType);
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
      await exportHtmlPdf(html, title);
    } catch (e: any) {
      Alert.alert(tr('recent.exportErrorTitle'), e?.message ?? tr('recent.exportErrorMsg'));
    } finally {
      setExporting(false);
    }
  };

  const printModalReport = async () => {
    if (!activeModal?.text) return;
    try {
      const title = outputTypeLabel(activeModal.outputType);
      const html = `<html><head><style>
        body{font-family:Georgia,serif;padding:40px;color:#111}
        h1{font-size:22px}h2{font-size:17px;color:#1e40af}
        p,li{line-height:1.7;font-size:13px}
      </style></head><body>
        <h1>BloomPrint — ${title}</h1>
        ${mdToHtml(activeModal.text)}
      </body></html>`;
      await printRawHtml(html);
    } catch (e: any) {
      Alert.alert(tr('recent.printErrorTitle'), e?.message ?? tr('recent.printErrorMsg'));
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
      await exportHtmlPdf(buildReportHtmlDoc(title, text, subject), title);
    } catch (e: any) {
      Alert.alert(tr('recent.exportErrorTitle'), e?.message ?? tr('recent.exportErrorMsg'));
    } finally { setExporting(false); }
  };

  const printText = async (title: string, text: string, subject?: string) => {
    if (!text) return;
    try {
      await printRawHtml(buildReportHtmlDoc(title, text, subject));
    } catch (e: any) {
      Alert.alert(tr('recent.printErrorTitle'), e?.message ?? tr('recent.printErrorMsg'));
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
          // An eval is shared by reference, so the withheld headings travel with
          // the share and the server filters the text when the player reads it.
          hide_sections: hiddenSendSections(),
          share_report_text: playerShareToggles.share_report_text,
          share_grades: playerShareToggles.share_overall_grade || playerShareToggles.share_pillar_grades,
          share_flags: playerShareToggles.share_green_flags || playerShareToggles.share_watch_flags,
          share_questions: playerShareToggles.share_key_questions,
        });
      } else {
        // Training and team reports send their text outright, so the sections
        // are filtered here — the player is never sent what was switched off.
        await playerAPI.shareTeamReport({
          output_type: activeModal.outputType,
          report_text: playerShareToggles.share_report_text ? sendTextFiltered() : '',
          target_type: 'player',
          player_user_id: target.id,
        });
      }
      setSendSearch('');
      setSendResults([]);
      setModalView('report');
      Alert.alert(tr('recent.sentTitle'), tr('recent.sentMsg', { name: target.name }));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('recent.sendError'));
    } finally {
      setSending(false);
    }
  };

  // Apply & regenerate: persist any pending text, then regenerate from all
  // un-applied corrections (the backend marks those applied afterward).
  const applyCorrection = async () => {
    if (!activeModal) return;
    if (activeModal.kind === 'training') {
      Alert.alert(tr('recent.infoTitle'), tr('recent.trainingRegenInfoMsg'));
      return;
    }
    const pending = teamCorrectText.trim();
    if (!pending && corrections.filter(c => !c.applied).length === 0) {
      Alert.alert(tr('recent.nothingToApplyTitle'), tr('recent.nothingToApplyMsg'));
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
      Alert.alert(tr('recent.updatedTitle'), tr('recent.regeneratedMsg'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('recent.applyCorrectionError'));
    } finally {
      setApplyingCorrect(false);
    }
  };

  if (loading) return <ScreenBackground><View style={styles.center}><ActivityIndicator color={t.accent} size="large" /></View></ScreenBackground>;

  let lastDate = '';

  return (
    <ScreenBackground>
    <PageContainer padded={false} maxWidth={1600}>
    <View style={styles.container}>
      <View style={styles.headerRow}>
        {/* Translated titles run 20-40% longer than English. Wrap to a second
            line rather than clipping — a truncated heading tells the coach
            less than a taller one costs them. */}
        <Text style={styles.title} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>{tr('recent.title')}</Text>
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
            placeholder={tr('recent.searchPlaceholder')}
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
      <ChipRow
        style={styles.filterRow}
        gap={8}
        contentContainerStyle={{ paddingHorizontal: 16, paddingRight: 24, gap: 8, alignItems: 'center' }}
      >
        {FILTER_CATS.map(cat => (
          <TouchableOpacity
            key={cat}
            style={[styles.filterChip, filter === cat && styles.filterChipActive]}
            onPress={() => setFilter(cat)}
          >
            <Text style={[styles.filterChipText, filter === cat && styles.filterChipTextActive]} numberOfLines={1}>
              {tr(`recent.filters.${cat}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </ChipRow>

      <FlatList
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={t.accent} />}
        data={listData}
        keyExtractor={(e: any) => e.__dayHeader ? `day-${e.__dayHeader}` : (e.shared ? `shared-${e.shared_id}` : `${e.kind}-${e.id}`)}
        ref={recentGrid.ref} onLayout={recentGrid.onLayout}
        CellRendererComponent={isWide ? ({ children, index, style, ...rest }: any) => (
          <View
            {...rest}
            style={[style, listData[index]?.__dayHeader
              ? { flexBasis: '100%', width: '100%' }
              : (recentGrid.cardWidth ? { width: recentGrid.cardWidth } : null)]}
          >
            {children}
          </View>
        ) : undefined}
        contentContainerStyle={{ paddingBottom: 100,
          ...(isWide ? { flexDirection: 'row', flexWrap: 'wrap', gap: recentGrid.gap, alignContent: 'flex-start', paddingHorizontal: 16 } : null) }}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="document-text-outline" size={48} color={t.muted2} />
            <Text style={styles.emptyText}>{tr('recent.noReportsYet')}</Text>
          </View>
        }
        renderItem={({ item }: any) => {
          if (item.__dayHeader) return <Text style={styles.dateHeader}>{item.__dayHeader}</Text>;
          const dateStr = new Date(item.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
          const showDate = dateStr !== lastDate;
          lastDate = dateStr;
          return (
            <>
              {showDate && Platform.OS !== 'web' && (
                <Text style={styles.dateHeader}>{dateStr}</Text>
              )}
              {/* The whole card opens the report. It used to be only the line
                  of text, so most of a card the size of a business card did
                  nothing when pressed — and the part that worked was the part
                  that looks least like a button. */}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => handlePress(item)}
                onLongPress={() => handleDelete(item)}
                style={[
                  styles.card,
                  item.kind === 'team' && styles.cardTeam,
                  item.kind === 'game' && styles.cardGame,
                  item.kind === 'training' && styles.cardTraining,
                  { flexDirection: 'column', alignItems: 'flex-start' },
                  recentGrid.cardWidth ? { width: recentGrid.cardWidth, marginHorizontal: 0 } : null,
                ]}
              >
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%' }}
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
                        item.kind === 'film' && { color: t.accent },
                        item.kind === 'scout' && { color: t.accent },
                        item.kind === 'gamereport' && { color: t.accent },
                        item.kind === 'training' && { color: t.positive },
                      ]}
                    >
                      {/* What the report IS, not where it is stored. A packet
                          version said "Game Report Packet" whatever had been
                          ticked, so a Coaching + Scouting report and a Box
                          Score were the same line. */}
                      {item.kind === 'game' ? tr('recent.gameReportPacket') :
                       item.kind === 'film' ? tr('recent.fromFilm', { types: outputTypeNames(item.output_type) }) :
                       item.kind === 'scout' ? tr('recent.scoutReport') :
                       item.kind === 'gamereport' ? tr('recent.gameReport') :
                       item.kind === 'training' ? tr('reportTypes.training_program') :
                       outputTypeLabel(item.output_type)}
                    </Text>
                    {/* What is actually inside the packet. "Game Report
                        Packet" is the right name for the card — it is what the
                        three buttons act on — but on its own it never said
                        whether this was the coaching report or the box score. */}
                    {item.kind === 'game' && (
                      <Text numberOfLines={1} style={styles.sharedByLabel}>
                        {outputTypeNames(item.output_type)}
                      </Text>
                    )}
                    {/* The program's own name, in the same slot and the same
                        style the packet uses for its contents — the profile
                        names a training program by its title, and a list of
                        "Training Program" rows under the same player never
                        said which one. No date: the card already sits under a
                        day header. Programs saved before titles existed simply
                        don't get the line. */}
                    {item.kind === 'training' && !!item.title && (
                      <Text numberOfLines={1} style={styles.sharedByLabel}>
                        {item.title}
                      </Text>
                    )}
                    {item.shared && (
                      <Text numberOfLines={1} style={styles.sharedByLabel}>
                        {tr('recent.sharedBy', { name: item.sender_name })}
                      </Text>
                    )}
                    {!item.shared && item.updated_from && (
                      <Text numberOfLines={1} style={[styles.sharedByLabel, { color: t.accent }]}>
                        {tr('recent.updatedFrom', { name: item.updated_from })}
                      </Text>
                    )}
                  </View>
                  {item.overall_grade != null && <GradeBadge grade={item.overall_grade} size="md" />}
                  {item.kind === 'game' && <Ionicons name="chevron-forward" size={14} color={t.muted2} />}
                </View>
                {/* Action buttons row — shown for all card types.
                    On the grid the card has a FIXED height, so a row that
                    wraps is a row that gets cut off — which is what an iPad
                    does at roughly 265px a column: three buttons do not fit,
                    flexbox wraps the third onto a second line, and the card
                    clips it. Wrapping is what has to go, not the height:
                    without it the buttons shrink to share the row and a long
                    label ellipsizes, which is legible at any width and in
                    every language. The phone keeps wrapping — one card per
                    row there, and its height is not fixed. */}
                <View style={{ flexDirection: 'row', flexWrap: recentGrid.cardWidth ? 'nowrap' : 'wrap',
                               // On the grid the buttons sit at the BOTTOM of
                               // the card, so every card's row of buttons is on
                               // one line however many lines of text is above
                               // it — a film's sat 15px higher than the packet
                               // beside it. Off the grid, 2 on top of the 10
                               // the card already puts here: at 10 the pair
                               // came to 20px of air mid-card.
                               gap: 6, marginTop: recentGrid.cardWidth ? 'auto' : 2,
                               width: '100%' }}>
                  {/* Game-specific buttons */}
                  {(item.kind === 'game' || item.kind === 'scout' || item.kind === 'gamereport') && item.report_text ? (
                    <TouchableOpacity
                      style={[styles.gameActionBtn, tightBtns && styles.gameActionBtnTight]}
                      onPress={() => setGameReportModal({
                        title: item.kind === 'scout' ? tr('reportTypes.scouting_report') : tr('reportTypes.game_report'),
                        subject: item.player_name, text: item.report_text!,
                        reportType: item.kind === 'scout' ? 'game_session' : item.kind === 'gamereport' ? 'game_report' : 'game',
                        reportId: item.kind === 'game' ? (item.report_id ?? item.id) : item.id, outputType: item.kind === 'scout' ? 'scouting_report' : item.kind === 'gamereport' ? 'game_report' : (item.output_type ?? 'coaching_report'),
                      })}
                    >
                      {!tightBtns && <Ionicons name="document-text-outline" size={13} color={t.accent} />}
                      <Text style={[styles.gameActionText, tightBtns && styles.gameActionTextTight, { color: t.accent }]} numberOfLines={1}>{tr('recent.viewReport')}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {item.kind === 'game' && !item.shared && (
                    <TouchableOpacity
                      style={[styles.gameActionBtn, tightBtns && styles.gameActionBtnTight]}
                      onPress={() => navigation.push('GameReportBuilder', { reportId: item.report_id ?? item.id })}
                    >
                      {!tightBtns && <Ionicons name="create-outline" size={13} color={t.muted} />}
                      <Text style={[styles.gameActionText, tightBtns && styles.gameActionTextTight]} numberOfLines={1}>{tr('recent.editPacket')}</Text>
                    </TouchableOpacity>
                  )}

                  {/* Send to Player is for reports ABOUT a player: an
                      evaluation or a training program. A team report, a packet,
                      a film breakdown or a scouting write-up is about a team,
                      and Share already reaches a player for those. */}
                  {(item.kind === 'eval' || item.kind === 'training') && (
                    <TouchableOpacity
                      style={[styles.gameActionBtn, tightBtns && styles.gameActionBtnTight, { borderColor: t.positiveSoft }]}
                      onPress={() => {
                        openModal({
                          id: item.id,
                          kind: item.kind as any,
                          text: item.program_text ?? item.report_text ?? (teamReportTexts[item.id] ?? (evalCache[item.id]?.report_text ?? '')),
                          outputType: item.output_type,
                          playerName: item.player_name,
                          evalId: item.kind === 'eval' ? item.id : undefined,
                          title: item.title,
                          createdAt: item.created_at,
                        });
                        setSectionToggles({});
                        setTimeout(() => setModalView('send'), 50);
                      }}
                    >
                      {!tightBtns && <Ionicons name="person-outline" size={13} color={t.positive} />}
                      <Text style={[styles.gameActionText, tightBtns && styles.gameActionTextTight, { color: t.positive }]} numberOfLines={1}>{tr('recent.sendToPlayer')}</Text>
                    </TouchableOpacity>
                  )}

                  {/* Correct — opens the shared-report viewer's edit flow.
                      On the shared original AND on my Updated copy of it. */}
                  {(item.shared || item.updated_from) && item.allow_regenerate && (
                    <TouchableOpacity
                      style={[styles.gameActionBtn, tightBtns && styles.gameActionBtnTight, { borderColor: t.accentSoft }]}
                      onPress={() => openViewer(item)}
                    >
                      {!tightBtns && <Ionicons name="create-outline" size={13} color={t.accent} />}
                      <Text style={[styles.gameActionText, tightBtns && styles.gameActionTextTight, { color: t.accent }]} numberOfLines={1}>{tr('recent.correct')}</Text>
                    </TouchableOpacity>
                  )}

                  {/* Share — player / team / staff, available for all types */}
                  <TouchableOpacity
                    style={[styles.gameActionBtn, tightBtns && styles.gameActionBtnTight, { borderColor: t.brownSoft }]}
                    onPress={() => {
                      // A shared report forwards under its ORIGINAL type/id so
                      // the recipient (or player) gets the author's report.
                      const reportType = item.shared ? (item.share_report_type ?? 'eval') :
                                         item.kind === 'eval' ? 'eval' :
                                         item.kind === 'team' ? 'team_report' :
                                         item.kind === 'scout' ? 'game_session' :
                                         item.kind === 'gamereport' ? 'game_report' :
                                         item.kind === 'game' ? 'game' :
                                         item.kind === 'film' ? 'film' :
                                         'training';
                      const label = item.kind === 'training' ? tr('reportTypes.training_program') :
                                    item.kind === 'scout' ? tr('recent.scoutReport') :
                                    item.kind === 'gamereport' ? tr('recent.gameReport') :
                                    item.kind === 'game' ? tr('recent.gameReport') :
                                    item.kind === 'film' ? tr('recent.fromFilm', { types: outputTypeNames(item.output_type) }) :
                                    item.kind === 'team' ? tr('recent.teamReport') : tr('reportTypes.player_eval');
                      const fullText = item.program_text ?? item.report_text ?? (teamReportTexts[item.id as number] ?? '');
                      setShareCtx({
                        reportType,
                        reportId: item.kind === 'game' ? (item.report_id ?? item.id) : item.id,
                        outputType: item.output_type ?? (item.kind === 'training' ? 'training_program' : 'coaching_report'),
                        reportText: fullText,
                        title: label,
                        // What it is ABOUT, beside what kind it is.
                        subject: item.player_name,
                      });
                    }}
                  >
                    {!tightBtns && <Ionicons name="share-social-outline" size={13} color={t.brown} />}
                    <Text style={[styles.gameActionText, tightBtns && styles.gameActionTextTight, { color: t.brown }]} numberOfLines={1}>{tr('common.share')}</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
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
      <Sheet visible={!!gameReportModal} animationType="slide" transparent onRequestClose={() => setGameReportModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
                <Text style={styles.modalTitle} numberOfLines={1}>{gameReportModal?.title ?? tr('reportTypes.report')}</Text>
                {!!gameReportModal?.subject && <Text style={styles.modalSub} numberOfLines={1}>{gameReportModal.subject}</Text>}
              </View>
              <ReportSearchButton ctl={findGame} />
              <TouchableOpacity style={{ flexShrink: 0, marginLeft: 10 }} onPress={() => { setGameReportModal(null); setScoutCorrectMode(false); }}>
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
                <KeyboardAwareScrollView ref={findGame.scrollRef} contentContainerStyle={{ paddingBottom: 16 }}>
                  <ReportSearchBar ctl={findGame} />
                  {gameReportModal?.text
                    ? renderReport(gameReportModal.text, { heading: t.ink, body: t.inkSoft }, findGame.search)
                    : <Text style={{ color: t.muted2 }}>{tr('recent.noReportContentAvailable')}</Text>
                  }
                </KeyboardAwareScrollView>
                {gameReportModal && (
                  <View style={styles.actionRow}>
                    {gameReportModal.reportType === 'game_session' && gameReportModal.reportId != null && (
                      <TouchableOpacity style={styles.actionBtn} onPress={() => setScoutCorrectMode(true)}>
                        <Ionicons name="create-outline" size={18} color={t.ink} />
                        <Text style={styles.actionText} numberOfLines={1}>{tr('recent.correct')}</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.actionBtn} onPress={() => setExportCtx({ title: gameReportModal.title, subject: gameReportModal.subject, text: gameReportModal.text })}>
                      <Ionicons name="download-outline" size={18} color={t.ink} />
                      <Text style={styles.actionText} numberOfLines={1}>{tr('recent.exportPrint')}</Text>
                    </TouchableOpacity>
                    {gameReportModal.reportType && gameReportModal.reportId != null && (
                      <>
                        <TouchableOpacity
                          style={[styles.actionBtn, { borderColor: t.positiveSoft }]}
                          onPress={() => {
                            // The report stays open behind the share sheet.
                            // Closing it meant coming back from a cancelled
                            // share to the list, having lost your place.
                            const g = gameReportModal;
                            setShareCtx({ reportType: g.reportType!, reportId: g.reportId!, outputType: g.outputType ?? 'scouting_report', reportText: g.text, title: g.title, subject: g.subject });
                          }}
                        >
                          <Ionicons name="person-outline" size={18} color={t.positive} />
                          <Text style={[styles.actionText, { color: t.positive }]} numberOfLines={1}>{tr('recent.playerBtn')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionBtn, { borderColor: t.brownSoft }]}
                          onPress={() => {
                            // The report stays open behind the share sheet.
                            // Closing it meant coming back from a cancelled
                            // share to the list, having lost your place.
                            const g = gameReportModal;
                            setShareCtx({ reportType: g.reportType!, reportId: g.reportId!, outputType: g.outputType ?? 'scouting_report', reportText: g.text, title: g.title, subject: g.subject });
                          }}
                        >
                          <Ionicons name="share-social-outline" size={18} color={t.brown} />
                          <Text style={[styles.actionText, { color: t.brown }]} numberOfLines={1}>{tr('common.share')}</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </Sheet>

      {/* Unified shared-report viewer (correct / regenerate / comment / notes) */}
      <SharedReportViewer
        shared={viewerShared}
        visible={!!viewerShared}
        onClose={() => setViewerShared(null)}
        onChanged={load}
      />

      {/* Generic Send to Staff Modal */}
      <Sheet visible={showStaffShareModal} animationType="slide" transparent onRequestClose={() => setShowStaffShareModal(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
                <Text style={styles.modalTitle} numberOfLines={1}>{tr('recent.sendToStaffTitle')}</Text>
                <Text style={styles.modalSub} numberOfLines={2}>
                  {tr('recent.sendToStaffSub', { label: staffShareCtx?.label ?? tr('recent.thisReport') })}
                </Text>
              </View>
              <TouchableOpacity style={{ flexShrink: 0 }} onPress={closeStaffShareModal}>
                <Ionicons name="close" size={24} color={t.muted} />
              </TouchableOpacity>
            </View>

            <KeyboardAwareScrollView style={{ maxHeight: '80%' }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {/* Report preview */}
              {staffSharePreview && (
                <View style={[sendStyles.reportPreview, { marginBottom: 12 }]}>
                  <Text style={sendStyles.reportPreviewTitle}>{tr('recent.reportPreview')}</Text>
                  <Text style={sendStyles.reportPreviewText} numberOfLines={3}>{staffSharePreview}</Text>
                </View>
              )}

              {/* A training program's text IS what is being sent — the section
                  switches decide how much of it goes. See the player send sheet. */}
              {staffShareCtx?.report_type === 'training' ? null : (
                <>
                  {[
                    { key: 'share_report_text', label: tr('recent.toggles.reportText') },
                    { key: 'share_overall_grade', label: tr('recent.toggles.overallGrade') },
                    { key: 'share_pillar_grades', label: tr('recent.toggles.pillarGrades') },
                    { key: 'share_grades', label: tr('recent.toggles.greenFlags') },
                    { key: 'share_flags', label: tr('recent.toggles.watchFlags') },
                    { key: 'share_questions', label: tr('recent.toggles.keyQuestions') },
                  ].map(tog => (
                    <View key={tog.key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.divider }}>
                      <Text style={{ color: t.inkSoft, fontSize: 13, flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }} numberOfLines={2}>{tog.label}</Text>
                      <Switch value={staffShareToggles[tog.key as keyof typeof staffShareToggles]} onValueChange={v => setStaffShareToggles(prev => ({ ...prev, [tog.key]: v }))} trackColor={{ false: t.line, true: t.brown }} thumbColor="#fff" />
                    </View>
                  ))}
                </>
              )}

              {/* Allow regenerate toggle */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 4, backgroundColor: t.chip, borderRadius: 8, padding: 12 }}>
                <Text style={{ color: t.inkSoft, fontSize: 13, flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }} numberOfLines={2}>{tr('recent.allowRegenerate')}</Text>
                <Switch
                  value={staffAllowRegen}
                  onValueChange={setStaffAllowRegen}
                  trackColor={{ false: t.line, true: t.brown }}
                  thumbColor="#fff"
                />
              </View>
              <Text style={{ color: t.muted2, fontSize: 11, marginBottom: 12, marginLeft: 2 }}>
                {staffAllowRegen
                  ? tr('recent.regenOnHint')
                  : tr('recent.regenOffHint')}
              </Text>

              {/* Section toggles — only in frozen mode (regenerate OFF) */}
              {(() => {
                const secs = splitReportSections(staffShareFullText);
                return !staffAllowRegen && secs.length > 1 ? (
                  <>
                    <Text style={{ color: t.muted, fontSize: 12, fontFamily: fonts[600], marginBottom: 6 }}>{tr('recent.includeSections')}</Text>
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
                  placeholder={tr('recent.searchStaffPlaceholder')}
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
                  <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
                    <Text style={{ color: t.ink, fontFamily: fonts[600] }} numberOfLines={1}>{r.name}</Text>
                    <Text style={{ color: t.muted2, fontSize: 12 }} numberOfLines={1}>{roleLabel(r.role, tr)} · {r.program_name}</Text>
                  </View>
                  {sendingToStaff ? <ActivityIndicator color={t.brown} size="small" /> : <Ionicons name="paper-plane-outline" size={18} color={t.brown} />}
                </TouchableOpacity>
              ))}
              {staffResults.length === 0 && staffSearch.trim().length > 0 && !staffSearchLoading && (
                <Text style={{ color: t.muted2, textAlign: 'center', paddingVertical: 20 }}>{tr('recent.noStaffFound')}</Text>
              )}
            </KeyboardAwareScrollView>
            <TouchableOpacity
              style={[sendStyles.cancelBtn, { marginTop: 12, flex: 0 }]}
              onPress={closeStaffShareModal}
            >
              <Text style={{ color: t.muted, fontFamily: fonts[600] }}>{tr('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Sheet>

      {/* Single modal — swaps between report / send / correct views */}
      {/* The report. It stays on screen while Send or Correct opens OVER
          it — those used to replace this view inside the same sheet, so
          pressing Send to Player looked exactly like the report closing. */}
      <Sheet visible={!!activeModal} animationType="slide" transparent onRequestClose={() => setActiveModal(null)}>
        {/* Matches ShareModal exactly. behavior="height" asks this container to
            resize with the viewport, and on web that pushed the report sheet
            down the page as soon as a second sheet opened over it. */}
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'android' ? 'height' : undefined}>
          <View style={styles.modalBox}>

            <View style={styles.modalHeader}>
              <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
                <Text style={styles.modalTitle} numberOfLines={1}>
                  {outputTypeLabel(activeModal?.outputType) ?? tr('reportTypes.report')}
                </Text>
                {!!activeModal?.playerName && (
                  <Text style={styles.modalSub} numberOfLines={1}>{activeModal.playerName}</Text>
                )}
              </View>
              <ReportSearchButton ctl={find} />
              <TouchableOpacity style={{ flexShrink: 0, marginLeft: 10 }} onPress={() => setActiveModal(null)}>
                <Ionicons name="close" size={24} color={t.muted} />
              </TouchableOpacity>
            </View>

            {/* The report itself. Always rendered while this sheet is open: the
                sub-views live in their own sheet on top now, and gating this on
                modalView collapsed the card to its header bar when one opened. */}
            <>
                <KeyboardAwareScrollView ref={find.scrollRef} contentContainerStyle={{ paddingBottom: 16 }}>
                  {activeModal?.text
                    ? (
                      <>
                        <ReportSearchBar ctl={find} />
                        <TranslationToggle
                          canToggle={rt.canToggle} isTranslated={rt.isTranslated}
                          showOriginal={rt.showOriginal} loading={rt.loading} onToggle={rt.toggle}
                        />
                        {renderReport(rt.text, { heading: t.ink, body: t.inkSoft }, find.search)}
                      </>
                    )
                    : <Text style={{ color: t.muted2 }}>{tr('recent.noReportContent')}</Text>
                  }
                </KeyboardAwareScrollView>
                <View style={styles.actionRow}>
                  {supportsCorrections(activeModal) && (
                    <TouchableOpacity style={styles.actionBtn} onPress={() => { setTeamCorrectText(''); loadCorrections(activeModal); setModalView('correct'); }}>
                      <Ionicons name="create-outline" size={18} color={t.ink} />
                      <Text style={styles.actionText} numberOfLines={1}>{tr('recent.correct')}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => activeModal && setExportCtx({ title: outputTypeLabel(activeModal.outputType), subject: activeModal.playerName, text: activeModal.text })}
                  >
                    <Ionicons name="download-outline" size={18} color={t.ink} />
                    <Text style={styles.actionText} numberOfLines={1}>{tr('recent.exportPrint')}</Text>
                  </TouchableOpacity>
                  {/* Send to Player — reports ABOUT a player only, as on the
                      cards. Share reaches a player for everything else. */}
                  {(activeModal?.kind === 'eval' || activeModal?.kind === 'training') && (
                    <TouchableOpacity style={[styles.actionBtn, { borderColor: t.positiveSoft }]} onPress={() => { setSendSearch(''); setSendResults([]); setSectionToggles({}); setModalView('send'); }}>
                      <Ionicons name="person-outline" size={18} color={t.positive} />
                      <Text style={[styles.actionText, { color: t.positive }]} numberOfLines={1}>{tr('recent.playerBtn')}</Text>
                    </TouchableOpacity>
                  )}
                  {/* Share — player / team / staff */}
                  <TouchableOpacity
                    style={[styles.actionBtn, { borderColor: t.brownSoft }]}
                    onPress={() => {
                      if (!activeModal) return;
                      const reportType = activeModal.kind === 'eval' ? 'eval' :
                                          activeModal.kind === 'team' ? 'team_report' : 'training';
                      const label = activeModal.kind === 'training' ? tr('reportTypes.training_program') :
                                    activeModal.kind === 'team' ? tr('recent.teamReport') : tr('reportTypes.player_eval');
                      const fullText = activeModal.text ?? '';
                      const reportId = activeModal.id;
                      const outputType = activeModal.outputType ?? (activeModal.kind === 'training' ? 'training_program' : 'coaching_report');
                      // The report stays open behind the share sheet.
                      setShareCtx({ reportType, reportId, outputType, reportText: fullText,
                                    title: label, subject: activeModal.playerName });
                    }}
                  >
                    <Ionicons name="share-social-outline" size={18} color={t.brown} />
                    <Text style={[styles.actionText, { color: t.brown }]} numberOfLines={1}>{tr('common.share')}</Text>
                  </TouchableOpacity>
                </View>
            </>

          </View>
        </KeyboardAvoidingView>
      </Sheet>

      {/* Send / Correct, in their own sheet ON TOP of the report. Rendered
          after it, because a modal stacks in tree order on web. */}
      <Sheet visible={!!activeModal && modalView !== 'report'} animationType="slide" transparent
             onRequestClose={() => setModalView('report')}>
        {/* Matches ShareModal exactly. behavior="height" asks this container to
            resize with the viewport, and on web that pushed the report sheet
            down the page as soon as a second sheet opened over it. */}
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'android' ? 'height' : undefined}>
          <View style={styles.subSheet}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setModalView('report')} style={{ marginRight: 10 }}>
                <Ionicons name="arrow-back" size={22} color={t.muted} />
              </TouchableOpacity>
              <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
                <Text style={styles.modalTitle} numberOfLines={1}>
                  {modalView === 'send' ? tr('recent.sendReport') : tr('recent.correctReport')}
                </Text>
              </View>
              <TouchableOpacity style={{ flexShrink: 0 }} onPress={() => setModalView('report')}>
                <Ionicons name="close" size={24} color={t.muted} />
              </TouchableOpacity>
            </View>
            {/* SEND VIEW */}
            {modalView === 'send' && (
              <>
                {/* Report preview */}
                {/* Title, then type and date. The old card led with the type
                    and then quoted the document, whose first line is the type
                    again — "TRAINING PROGRAM" over "TRAINING PROGRAM: MAJOR
                    CASH". A report with no title of its own still falls back to
                    its opening line, minus that repeated heading. */}
                <View style={sendStyles.reportPreview}>
                  <Text style={sendStyles.reportPreviewName} numberOfLines={2}>
                    {activeModal?.title || previewLine(activeModal?.text, activeModal?.outputType)}
                  </Text>
                  <Text style={sendStyles.reportPreviewMeta} numberOfLines={1}>
                    {[outputTypeLabel(activeModal?.outputType),
                      activeModal?.playerName,
                      activeModal?.createdAt ? new Date(activeModal.createdAt).toLocaleDateString() : null,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>

                {/* Content toggles */}
                {/* A training program has no separate payloads to pick from —
                    the program text is the thing being sent, and the section
                    switches below decide how much of it goes. A master "Share
                    Program Text" row could only ever send nothing. */}
                {activeModal?.kind === 'training' ? null : (
                  <View style={{ marginBottom: 10 }}>
                    {[
                      { key: 'share_report_text', label: tr('recent.toggles.reportText') },
                      { key: 'share_overall_grade', label: tr('recent.toggles.overallGrade') },
                      { key: 'share_pillar_grades', label: tr('recent.toggles.pillarGrades') },
                      { key: 'share_green_flags', label: tr('recent.toggles.greenFlags') },
                      { key: 'share_watch_flags', label: tr('recent.toggles.watchFlags') },
                      { key: 'share_key_questions', label: tr('recent.toggles.keyQuestions') },
                    ].map(tog => (
                      <View key={tog.key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: t.divider }}>
                        <Text style={{ color: t.inkSoft, fontSize: 13, flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }} numberOfLines={2}>{tog.label}</Text>
                        <Switch value={playerShareToggles[tog.key as keyof typeof playerShareToggles]} onValueChange={v => setPlayerShareToggles(prev => ({ ...prev, [tog.key]: v }))} trackColor={{ false: t.line, true: t.positive }} thumbColor="#fff" />
                      </View>
                    ))}
                  </View>
                )}

                {/* The report's own sections. Toggling the text off above hides
                    the whole document, so the per-section list only applies
                    while the text is being sent at all. */}
                {playerShareToggles.share_report_text && sendToggleSections.length > 1 && (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ color: t.muted2, fontSize: 11, fontFamily: fonts[700], letterSpacing: 0.5, marginBottom: 4 }}>
                      {tr('recent.sectionsLabel')}
                    </Text>
                    {sendToggleSections.map((sec, i) => (
                      <View key={`${sec.heading}-${i}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: t.divider }}>
                        <Text style={{ color: t.inkSoft, fontSize: 13, flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }} numberOfLines={2}>{sec.heading}</Text>
                        <Switch
                          value={sectionToggles[sec.heading] !== false}
                          onValueChange={v => setSectionToggles(prev => ({ ...prev, [sec.heading]: v }))}
                          trackColor={{ false: t.line, true: t.positive }} thumbColor="#fff"
                        />
                      </View>
                    ))}
                  </View>
                )}

                <Text style={{ color: t.muted2, fontSize: 12, marginBottom: 10 }}>{tr('recent.sendToPlayerHint')}</Text>
                <View style={{ marginBottom: 12 }}>
                  <VoiceTextInput
                    style={sendStyles.searchInput}
                    placeholder={tr('recent.typeNamePlaceholder')}
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
                      <View style={{ flex: 1, flexShrink: 1, minWidth: 0, marginRight: 8 }}>
                        <Text style={{ color: t.ink, fontFamily: fonts[600] }} numberOfLines={1}>{r.name}</Text>
                        <Text style={{ color: t.muted2, fontSize: 12 }} numberOfLines={1}>{r.email}</Text>
                      </View>
                      {sending ? <ActivityIndicator color={t.accent} size="small" /> : <Ionicons name="paper-plane-outline" size={18} color={t.accent} />}
                    </TouchableOpacity>
                  ))}
                  {sendResults.length === 0 && sendSearch.trim().length > 0 && !sendSearchLoading && (
                    <Text style={{ color: t.muted2, textAlign: 'center', paddingVertical: 20 }}>{tr('recent.noPlayersFound')}</Text>
                  )}
                </KeyboardAwareScrollView>
              </>
            )}

            {/* CORRECT VIEW */}
            {modalView === 'correct' && (
              <>
                {/* Title, then type and date. The old card led with the type
                    and then quoted the document, whose first line is the type
                    again — "TRAINING PROGRAM" over "TRAINING PROGRAM: MAJOR
                    CASH". A report with no title of its own still falls back to
                    its opening line, minus that repeated heading. */}
                <View style={sendStyles.reportPreview}>
                  <Text style={sendStyles.reportPreviewName} numberOfLines={2}>
                    {activeModal?.title || previewLine(activeModal?.text, activeModal?.outputType)}
                  </Text>
                  <Text style={sendStyles.reportPreviewMeta} numberOfLines={1}>
                    {[outputTypeLabel(activeModal?.outputType),
                      activeModal?.playerName,
                      activeModal?.createdAt ? new Date(activeModal.createdAt).toLocaleDateString() : null,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={{ color: t.muted2, fontSize: 12, marginBottom: 10 }}>{tr('recent.correctHint')}</Text>
                <VoiceTextInput
                  style={sendStyles.correctInput}
                  placeholder={tr('recent.correctPlaceholder')}
                  placeholderTextColor={t.muted2}
                  value={teamCorrectText}
                  onChangeText={setTeamCorrectText}
                  multiline
                  textAlignVertical="top"
                />
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <TouchableOpacity style={sendStyles.cancelBtn} onPress={saveCorrectionForLater} disabled={savingCorrect || !teamCorrectText.trim()}>
                    {savingCorrect ? <ActivityIndicator color={t.muted} size="small" /> : <Text style={{ color: t.ink, fontFamily: fonts[700], flexShrink: 1 }} numberOfLines={1}>{tr('recent.saveForLater')}</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={sendStyles.applyBtn} onPress={applyCorrection} disabled={applyingCorrect}>
                    {applyingCorrect ? <ActivityIndicator color={t.ctaText} size="small" /> : <Text style={{ color: t.ctaText, fontFamily: fonts[700], flexShrink: 1 }} numberOfLines={1}>{tr('recent.applyRegenerate')}</Text>}
                  </TouchableOpacity>
                </View>
                <GeneratingOverlay visible={applyingCorrect} label={tr('recent.regeneratingLabel')} />

                {corrections.length > 0 && (
                  <View style={{ marginTop: 18 }}>
                    <Text style={{ color: t.label, fontSize: 11, fontFamily: fonts[700], letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                      {tr('recent.correctionsCount', { count: corrections.length })}
                    </Text>
                    {corrections.map((c: any) => (
                      <View key={c.id} style={{ backgroundColor: t.card, borderRadius: 10, padding: 11, marginBottom: 6, borderWidth: 1, borderColor: t.cardBorder, opacity: c.applied ? 0.55 : 1 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                          {c.applied
                            ? <View style={{ backgroundColor: t.positiveSoft, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}>
                                <Text style={{ color: t.positive, fontSize: 9, fontFamily: fonts[700] }}>{tr('recent.applied')}</Text>
                              </View>
                            : <View style={{ backgroundColor: t.chip, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}>
                                <Text style={{ color: t.muted, fontSize: 9, fontFamily: fonts[700] }}>{tr('recent.pending')}</Text>
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
      </Sheet>

      {/* Unified Share modal — player / team / staff */}
      {/* These two open FROM a report and must sit on top of it. On web a
          modal stacks in tree order, so rendering the export sheet earlier put
          it behind the very report it was exporting. Everything that opens over
          a report belongs here, last. */}
      <ExportSectionsModal
        visible={!!exportCtx}
        title={exportCtx?.title ?? tr('reportTypes.report')}
        subject={exportCtx?.subject}
        reportText={exportCtx?.text ?? ''}
        onClose={() => setExportCtx(null)}
      />

      {shareCtx && (
        <ShareModal
          visible={!!shareCtx}
          onClose={() => setShareCtx(null)}
          reportType={shareCtx.reportType}
          reportId={shareCtx.reportId}
          outputType={shareCtx.outputType}
          reportText={shareCtx.reportText}
          title={shareCtx.title}
          subject={shareCtx.subject}
        />
      )}
    </View>
    </PageContainer>
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
  // The report's own name leads; the type and date sit under it in the same
  // small caps the training list uses.
  reportPreviewName: { color: t.ink, fontSize: 14, fontFamily: fonts[700], marginBottom: 3 },
  reportPreviewTitle: { color: t.label, fontSize: 11, fontFamily: fonts[700], textTransform: 'uppercase', letterSpacing: 1 },
  // Sentence case, muted, under the name — the same line the player's profile
  // puts under a training program, plus who it is for.
  reportPreviewMeta: { color: t.muted2, fontSize: 12 },
  reportPreviewText: { color: t.muted2, fontSize: 12, lineHeight: 18 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: t.line, alignItems: 'center' },
  applyBtn: { flex: 1, padding: 14, borderRadius: 10, backgroundColor: t.ctaBg, alignItems: 'center' },
});


const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', paddingTop: titleTopPad(56) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  title: { fontSize: 28, fontFamily: fonts[900], color: t.ink, marginHorizontal: 20, marginBottom: 12, flex: 1, flexShrink: 1, minWidth: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 },
  searchIconBtn: {
    width: 40, height: 40, borderRadius: 20, marginBottom: 12,
    alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip,
    flexShrink: 0,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.card, borderRadius: 10, borderWidth: 1, borderColor: t.line,
    marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, height: 44,
  },
  searchBarInput: { flex: 1, color: t.ink, fontSize: 15, paddingVertical: 0 },
  // No height on the row. A horizontal scroller clips whatever is taller than
  // it, so any fixed height here is a guess that slices the top and bottom off
  // the pill the moment it is wrong. The roster's team chips and Team Grade's
  // view chips — the two rows that look right — let the row take its height
  // from the chips, and this is now the same arrangement.
  // 4 below the chips, not 16. The first date header brings its own 16px top
  // margin, and react-native-web lays every View out as a flex column — which
  // does not collapse adjacent margins the way a browser's block flow does. So
  // the row's 12 and the header's 16 stacked instead of overlapping, and with
  // the desktop's extra 4 the gap measured 32px.
  filterRow: { marginBottom: 12, flexGrow: 0,
    ...desktopOnly({ paddingHorizontal: 16, paddingRight: 24, marginBottom: 4 }) },
  // Copied from RosterScreen's teamChip, which is the pill the coach called
  // correct. Fixed 34 high, centred text, no shrinking.
  filterChip: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 16, height: 34, justifyContent: 'center' },
  filterChipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  filterChipText: { color: t.muted, fontSize: 13, fontFamily: fonts[700] },
  filterChipTextActive: { color: t.ctaText },
  dateHeader: { color: t.label, fontSize: 11, fontFamily: fonts[700], marginHorizontal: 20, marginTop: 16, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 },
  emptyText: { color: t.muted2, marginTop: 12, fontSize: 14 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.card, marginHorizontal: 16, marginBottom: 8,
    // A minimum, never a fixed height: a ceiling plus overflow: hidden is what
    // cut the buttons off a card carrying one line more than the rest, and no
    // amount of tightening elsewhere makes that safe.
    //
    // 123 is measured, not chosen: it is exactly what the busiest ordinary card
    // needs — three lines and a row of buttons — so those come out level with
    // nothing spare beneath them. A card with fewer lines sits at the same
    // height because a row of cards at different heights reads as a mistake. A
    // SHARED report carries a fourth line naming who sent it, and is the one
    // card left free to stand taller.
    // height: '100%' so a card fills its cell. The cells in a row already
    // stretch to the tallest of them; without this the card inside sits at
    // its own content height and a card with one line fewer — a film names
    // no report types — comes out visibly shorter than the one beside it.
    ...desktopOnly({ minHeight: 123, marginBottom: 0, height: '100%' }),
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
  typeName: { color: t.accent, fontSize: 12, fontFamily: fonts[600], marginTop: 2, lineHeight: 16, paddingBottom: 0 },
  playerName: { color: t.ink, fontSize: 15, fontFamily: fonts[700], lineHeight: 22 },
  sharedByLabel: { color: t.muted2, fontSize: 11, fontFamily: fonts[600], marginTop: 1, lineHeight: 14, fontStyle: 'italic' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: t.scrim,
    alignItems: 'center', justifyContent: 'center',
  },
  modalOverlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  modalBox: { backgroundColor: t.sheet, borderRadius: 20, padding: 20, maxHeight: '90%', margin: 8, ...sheetCap(REPORT_MODAL_WIDTH)},
  // Send and Correct are forms, not documents: they take the same width as the
  // share sheet rather than the full reading width a report needs.
  subSheet: { backgroundColor: t.sheet, borderRadius: 20, padding: 20, maxHeight: '90%', margin: 8, ...sheetCap(560) },
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
  actionText: { color: t.ink, fontSize: 13, fontFamily: fonts[600], flexShrink: 1 },
  gameActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: t.chip, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10,
    // minWidth: 0 so the button can actually give ground. A flex item's default
    // minimum is its content, so three buttons in a row that cannot wrap would
    // otherwise overflow the card rather than share it — flexShrink alone does
    // not override that floor.
    borderWidth: 1, borderColor: t.line, flexShrink: 1, minWidth: 0, maxWidth: '100%',
  },
  // On a grid card the row cannot wrap, so a button that will not fit steals
  // its own label. Measured at 265px: with these three across, the labels come
  // to 182px and the row has 237, which leaves exactly enough for 6px of
  // padding a side once the icon is gone.
  gameActionBtnTight: { paddingVertical: 4, paddingHorizontal: 6, gap: 0 },
  gameActionText: { color: t.muted, fontSize: 12, fontFamily: fonts[600], flexShrink: 1 },
  gameActionTextTight: { fontSize: 11 },
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
