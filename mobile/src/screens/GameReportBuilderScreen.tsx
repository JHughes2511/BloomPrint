import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert, KeyboardAvoidingView, Platform, Modal,
  findNodeHandle, RefreshControl,
} from 'react-native';
import Sheet from '../components/Sheet';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useGoUp } from '../navigation/goUp';
import { Ionicons } from '@expo/vector-icons';
import { renderReport } from '../utils/renderReport';
import { useReportSearch, usePrimedSearch, ReportSearchBar, ReportSearchButton } from '../components/ReportSearch';
import { GeneratingOverlay, parseGenProgress, jobProgressLabel, uploadProgressCode } from '../components/GeneratingBasketball';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { exportHtmlPdf, printRawHtml } from '../utils/exportDoc';
import { gameReportsAPI, teamsAPI, playerAPI, staffSharingAPI, coachesAPI, uploadFileStreamed, evalsAPI, gameEvalAPI } from '../api/client';
import { directUploadAvailable, uploadFilmDirect } from '../api/directUpload';
import ShareModal from '../components/ShareModal';
import ExportSectionsModal from '../components/ExportSectionsModal';
import { outputTypeLabel, outputTypeNames } from '../utils/reportType';
import { useTheme } from '../theme/ThemeProvider';
import { topPad } from '../responsive/screenPadding';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import PageContainer from '../responsive/PageContainer';
import { mdToHtml, safeFileName, wrapPrintDocument } from '../utils/mdToHtml';
import { useAuth } from '../context/AuthContext';
import { CONTENT_MAX_WIDTH, sheetCap, REPORT_MODAL_WIDTH } from '../responsive/modalSizes';
import ChipRow from '../responsive/ChipRow';
import { parseGameDate, displayGameDate } from '../utils/gameDate';
import { useSheetScrollHeight } from '../responsive/modalSizes';

// Labels come from `reportTypes.*` translation keys at render time.
// KEY values are API values — never translate them.
const OUTPUT_TYPES = [
  { key: 'coaching_report' },
  { key: 'game_analysis' },
  { key: 'scouting_report' },
  { key: 'film_breakdown' },
  { key: 'box_score' },
  { key: 'team_training' },
  { key: 'game_situational' },
  { key: 'matchup' },
];

// Labels come from `gameBuilder.modes.*` translation keys at render time.
// KEY values are API values — never translate them.
const MODES = [
  { key: 'vs_opponent' },
  { key: 'my_program' },
  { key: 'opponent_only' },
  { key: 'opp_vs_opp' },
];

/** Strip markdown for plain-text clip preview snippets */
function stripMarkdownForPreview(text: string): string {
  return text
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/^\s*[-=—─]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The two lines under a finished film: what the report is, and when the film
 * was added.
 *
 * This used to be the report's first 120 characters with an ellipsis stuck on
 * the end. Since every report opens with its own title line, the second line
 * was always just "..." — a truncation mark with nothing after it. The title is
 * worth keeping; the date is what a coach with several films actually needs to
 * tell them apart.
 */
function clipSummaryLine(clip: any): string {
  const title = stripMarkdownForPreview(clip.analysis_text || '')
    .split('\n')[0].trim().slice(0, 120);
  const when = clip.created_at
    ? new Date(clip.created_at).toLocaleDateString(undefined,
        { month: 'long', day: 'numeric', year: 'numeric' })
    : '';
  return when ? `${title}\n${when}` : title;
}

export default function GameReportBuilderScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  // Back means up a level — see navigation/goUp.ts.
  const goUp = useGoUp();
  const { coach } = useAuth();
  const { t } = useTheme();
  // Scales with the window on desktop; unchanged on phones.
  const sheetScroll280 = useSheetScrollHeight(280);
  const sheetScroll260 = useSheetScrollHeight(260);
  const { t: tr } = useTranslation();
  const styles = makeStyles(t);

  const existingId: number | undefined = route.params?.reportId;

  const [report, setReport] = useState<any>(null);
  const [reportId, setReportId] = useState<number | null>(existingId ?? null);
  const [versions, setVersions] = useState<any[]>([]);
  const [versionView, setVersionView] = useState<any>(null);
  const loadVersions = (id: number | null) => {
    if (!id) return;
    gameReportsAPI.versions(id).then(setVersions).catch(() => setVersions([]));
  };
  const [teams, setTeams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  // How far into writing the report the server is. Blank until the job reports.
  const [genProgress, setGenProgress] = useState('');
  const [uploadingClip, setUploadingClip] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState<'box_score' | 'scouting_notes' | null>(null);
  // Importing a box score from a game already recorded in Games, rather than
  // from a file. The numbers are already in BloomPrint; exporting them and
  // importing the export back is work nobody should have to do.
  const [gamePickerOpen, setGamePickerOpen] = useState(false);
  const [recordedGames, setRecordedGames] = useState<any[]>([]);
  const [importingGameId, setImportingGameId] = useState<number | null>(null);

  const [title, setTitle] = useState('');
  const [mode, setMode] = useState('vs_opponent');
  const [myTeamId, setMyTeamId] = useState<number | null>(null);
  const [oppTeamId, setOppTeamId] = useState<number | null>(null);
  const [oppName, setOppName] = useState('');
  const [oppAName, setOppAName] = useState(''); // free-text Opponent A (opp-vs-opp)
  /**
   * When the game on this film was played, as YYYY-MM-DD.
   *
   * Asked, because it cannot be worked out. A packet is built days or weeks
   * after the game, so its own date says nothing about the fixture — and this
   * is the only thing that can tell two meetings with the same opponent apart.
   * Left blank, no tracked game is ever suggested for the film.
   */
  const [gameDate, setGameDate] = useState('');
  // Additional teams for a 3+ team match-up. Tokens: "t<id>" (saved team) or a name.
  const [extraTeams, setExtraTeams] = useState<string[]>([]);
  const [extraTeamText, setExtraTeamText] = useState('');
  const [outputType, setOutputType] = useState('coaching_report');
  const [focusPrompt, setFocusPrompt] = useState('');
  const [boxScore, setBoxScore] = useState('');
  const [scoutingNotes, setScoutingNotes] = useState('');

  const [showMyTeamPicker, setShowMyTeamPicker] = useState(false);
  const [showOppTeamPicker, setShowOppTeamPicker] = useState(false);

  // Correction for main report
  const [correctionText, setCorrectionText] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const [savingCorrection, setSavingCorrection] = useState(false);
  const [gameCorrections, setGameCorrections] = useState<any[]>([]);

  const loadGameCorrections = async (id: number | null) => {
    if (!id) { setGameCorrections([]); return; }
    try { setGameCorrections(await gameReportsAPI.corrections(id)); } catch { setGameCorrections([]); }
  };

  useEffect(() => { loadGameCorrections(reportId); }, [reportId, report?.report_text]);

  const saveCorrectionForLater = async () => {
    if (!reportId || !correctionText.trim()) return;
    setSavingCorrection(true);
    try {
      await gameReportsAPI.addCorrection(reportId, correctionText.trim());
      setCorrectionText('');
      await loadGameCorrections(reportId);
      Alert.alert(tr('gameBuilder.correctionSavedTitle'), tr('gameBuilder.correctionSavedMessage'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('gameBuilder.couldNotSaveCorrection'));
    } finally {
      setSavingCorrection(false);
    }
  };

  // Clip modal
  const [clipModal, setClipModal] = useState<any | null>(null);
  /**
   * Which tracked game this packet's film is of.
   *
   * Asked once per packet rather than once per clip — a packet's films are of
   * one game — and only when there is something to ask about: film present, a
   * game it could plausibly be, and no answer yet. Suggested from the teams
   * and the date and always confirmed, because a squad can play the same
   * opponent twice and a night game logged after midnight is a day out.
   */
  const [linkAsk, setLinkAsk] = useState<any | null>(null);
  const [linking, setLinking] = useState(false);
  const [gameQuery, setGameQuery] = useState('');
  const [searchingGames, setSearchingGames] = useState(false);

  /**
   * Ask the server what this film could be of.
   *
   * `manual` is the coach pressing Search: the sheet opens whatever comes
   * back, including nothing, because they asked a question and deserve an
   * answer. Left alone it only opens when the server says there is something
   * worth interrupting for.
   */
  const refreshLinkAsk = async (id: number, opts?: { manual?: boolean; q?: string }) => {
    if (opts?.manual) setSearchingGames(true);
    try {
      const sug = await gameReportsAPI.gameSuggestions(id, opts?.q?.trim() || undefined);
      setLinkAsk(opts?.manual ? { ...sug, manual: true } : (sug?.ask ? sug : null));
    } catch {
      if (!opts?.manual) setLinkAsk(null);   // nothing to ask is the safe answer
    } finally {
      setSearchingGames(false);
    }
  };

  /**
   * Tie this packet's film to a game, or untie it.
   *
   * The screen moves first. Linking is three round trips — the link, the
   * packet's date and name, then re-reading the packet — and waiting for all
   * three before anything changes made a tap feel like it had missed. What the
   * coach sees is decided entirely by what they just pressed, so it is applied
   * immediately and put back only if the server refuses.
   */
  const answerLink = async (gameId: number | null) => {
    if (!reportId) return;
    const picked = (linkAsk?.games ?? []).find((g: any) => g.id === gameId) ?? null;
    const before = { report, title, gameDate };

    // On screen now: the sheet closes, the row appears or goes, and the date
    // and name are filled from the game that was chosen.
    setLinkAsk(null);
    setGameQuery('');
    setReport((prev: any) => prev && ({
      ...prev,
      clips: (prev.clips ?? []).map((c: any) => ({
        ...c, game_id: gameId, game_label: picked?.label ?? null,
      })),
    }));
    const patch: any = {};
    if (picked) {
      const iso = (picked.date || '').slice(0, 10);
      if (iso) { setGameDate(displayGameDate(iso)); patch.game_date = `${iso}T12:00:00`; }
      // The name only when there is not one. A packet the coach has already
      // named is not improved by replacing it with the fixture.
      if (!title.trim()) {
        const named = String(picked.label || '').split(' · ')[0].trim();
        if (named) { setTitle(named); patch.title = named; }
      }
    }

    setLinking(true);
    try {
      await gameReportsAPI.linkGame(reportId, gameId == null
        ? { game_id: null, declined: true }
        : { game_id: gameId });
      if (Object.keys(patch).length) await gameReportsAPI.update(reportId, patch);
      // Re-read quietly, to pick up anything the server decided differently.
      setReport(await gameReportsAPI.get(reportId));
    } catch (e: any) {
      setReport(before.report); setTitle(before.title); setGameDate(before.gameDate);
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('gameBuilder.linkFailed'));
    } finally {
      setLinking(false);
    }
  };

  /** The game this packet's film is tied to, once one is confirmed. */
  const linkedGame = (report?.clips ?? []).find((c: any) => c.game_id)?.game_label ?? null;
  const [clipCorrectionText, setClipCorrectionText] = useState('');
  const [clipCorrecting, setClipCorrecting] = useState(false);
  // Progress label for the film breakdown ("Analyzing segment i of N").
  const [clipProgress, setClipProgress] = useState('');
  const [showExport, setShowExport] = useState(false);

  // Unified share modal (player / team / staff)
  const [showShareModal, setShowShareModal] = useState(false);

  // Share modal
  const [showShare, setShowShare] = useState(false);
  const [shareMode, setShareMode] = useState<'player' | 'staff'>('player');
  const [shareSearch, setShareSearch] = useState('');
  const [shareResults, setShareResults] = useState<any[]>([]);
  const [shareSearchLoading, setShareSearchLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [allowRegenerate, setAllowRegenerate] = useState(false);
  const shareDebounce = useRef<any>(null);

  const scrollRef = useRef<ScrollView>(null);
  // Finding a name in a generated report, which runs to several pages.
  const find = useReportSearch(report?.report_text ?? '', scrollRef);
  // The two sheets that also hold a report: an older version of it, and one
  // film's analysis. Each has its own scroll view, so each gets its own search.
  const findVersion = useReportSearch(versionView?.report_text ?? '');
  const findClip = useReportSearch(clipModal?.analysis_text ?? '');

  // Arriving from the app-wide search: open the film it found, and start both
  // searches on the phrase that found it. A coach who searched for a sentence
  // should not have to search for it again once they are looking at the page
  // it is on.
  const wanted: string | undefined = route.params?.find;
  const openClipId: number | undefined = route.params?.openClipId
    ? Number(route.params.openClipId) : undefined;
  const openedClip = useRef(false);
  useEffect(() => {
    if (!openClipId || openedClip.current) return;
    const clip = (report?.clips ?? []).find((c: any) => c.id === openClipId);
    if (!clip) return;
    openedClip.current = true;
    setClipModal(clip);
    setClipCorrectionText('');
  }, [openClipId, report?.clips]);
  usePrimedSearch(find, wanted, !!report?.report_text);
  usePrimedSearch(findClip, wanted, !!clipModal?.analysis_text);
  // Y positions captured via onLayout (direct ScrollView children only)
  const boxScoreY = useRef(0);
  const scoutingY = useRef(0);
  const focusPromptY = useRef(0);

  const scrollTo = (y: number) =>
    setTimeout(() => scrollRef.current?.scrollTo({ y: y - 80, animated: true }), 200);

  useEffect(() => {
    teamsAPI.list().then(setTeams).catch(() => {});
    if (existingId) {
      gameReportsAPI.get(existingId).then(r => {
        setReport(r);
        populateFromReport(r);
        loadVersions(existingId);
        setLoading(false);
      }).catch(() => setLoading(false));
    } else {
      gameReportsAPI.create({ mode: 'vs_opponent', output_type: 'coaching_report' }).then(r => {
        setReport(r);
        setReportId(r.id);
        populateFromReport(r);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, []);

  /**
   * Keep a film's status live while it is being analyzed.
   *
   * The packet loaded once, so a breakdown that finished — or a scan counting
   * up — only appeared if the coach left the screen and came back. Watching a
   * three-hour film is exactly when you want the number to move in front of
   * you. Polls only while something is actually pending, and stops the moment
   * every clip has its analysis.
   */
  const [refreshing, setRefreshing] = useState(false);
  /** Re-read the packet. Keeps the form the coach is editing; only the parts
   *  the server owns — the films and their analysis — are replaced. */
  const refreshPacket = async () => {
    if (!reportId) return;
    setRefreshing(true);
    try {
      const fresh = await gameReportsAPI.get(reportId);
      void refreshLinkAsk(reportId);
      setReport((prev: any) => (prev ? { ...prev, clips: fresh.clips, report_text: fresh.report_text } : fresh));
      loadVersions(reportId);
    } catch {}
    setRefreshing(false);
  };

  const pendingClips = (report?.clips ?? []).filter((c: any) => !c.analysis_text).length;
  useEffect(() => {
    if (!reportId || pendingClips === 0) return;
    let cancelled = false;
    const tick = setInterval(async () => {
      try {
        const fresh = await gameReportsAPI.get(reportId);
        if (!cancelled) setReport((prev: any) => (prev ? { ...prev, clips: fresh.clips } : fresh));
      } catch {}
    }, 5000);
    return () => { cancelled = true; clearInterval(tick); };
  }, [reportId, pendingClips]);

  // Share search debounce
  useEffect(() => {
    if (!showShare) return;
    clearTimeout(shareDebounce.current);
    if (!shareSearch.trim()) { setShareResults([]); return; }
    setShareSearchLoading(true);
    shareDebounce.current = setTimeout(async () => {
      try {
        const results = shareMode === 'staff'
          ? await coachesAPI.search(shareSearch.trim())
          : await playerAPI.searchPlayerUsers(shareSearch.trim());
        setShareResults(results);
      } catch {}
      setShareSearchLoading(false);
    }, 400);
  }, [shareSearch, showShare, shareMode]);

  const populateFromReport = (r: any) => {
    setTitle(r.title ?? '');
    setMode(r.mode ?? 'vs_opponent');
    setMyTeamId(r.my_team_id ?? null);
    setOppAName(r.opponent_a_name ?? '');
    setOppTeamId(r.opponent_team_id ?? null);
    setOppName(r.opponent_name ?? '');
    setExtraTeams((r.extra_teams ?? '').split(',').map((s: string) => s.trim()).filter(Boolean));
    setOutputType(r.output_type ?? 'coaching_report');
    setFocusPrompt(r.focus_prompt ?? '');
    setBoxScore(r.box_score ?? '');
    setScoutingNotes(r.scouting_notes ?? '');
    setGameDate(displayGameDate(r.game_date));
  };

  const save = async (patch: any) => {
    if (!reportId) return;
    try {
      const updated = await gameReportsAPI.update(reportId, patch);
      setReport(updated);
    } catch {}
  };

  // Multi-team match-up: additional teams (beyond the two primary sides).
  const isMatchup = outputType.split(',').includes('matchup');
  const extraTeamLabel = (tok: string) => {
    if (tok.startsWith('t') && /^\d+$/.test(tok.slice(1))) {
      return teams.find((tm: any) => tm.id === Number(tok.slice(1)))?.name ?? tr('gameBuilder.teamFallback');
    }
    return tok;
  };
  const toggleExtraTeam = (tok: string) => {
    setExtraTeams(prev => {
      const next = prev.includes(tok) ? prev.filter(x => x !== tok) : [...prev, tok];
      save({ extra_teams: next.join(',') });
      return next;
    });
  };
  const addExtraTeamName = () => {
    const name = extraTeamText.trim();
    if (!name) return;
    setExtraTeams(prev => {
      if (prev.includes(name)) return prev;
      const next = [...prev, name];
      save({ extra_teams: next.join(',') });
      return next;
    });
    setExtraTeamText('');
  };

  /** Resolve an extra-team token ("t<id>" for a saved team, else a typed name). */
  const extraTeamName = (tok: string) =>
    (tok.startsWith('t') && teams.find(tm => `t${tm.id}` === tok)?.name) || tok;

  /**
   * Who a film could be of, for THIS packet.
   *
   * The two fixed buttons ("My Team" / "Opponent") were wrong in three of the
   * four modes: an opponent-only packet has no my-team film, opponent-vs-opponent
   * has no my-team side at all, and in every mode the coach has already named
   * the teams above — so the buttons should say those names.
   */
  const filmSides = (): { name: string; label: string }[] => {
    const myName = teams.find(tm => tm.id === myTeamId)?.name ?? coach?.program_name ?? tr('gameBuilder.myTeam');
    const oppLabel = (teams.find(tm => tm.id === oppTeamId)?.name ?? oppName.trim()) || tr('gameBuilder.opponent');
    if (mode === 'my_program') return [{ name: myName, label: 'my_team' }];
    if (mode === 'opponent_only') return [{ name: oppLabel, label: 'opponent' }];
    if (mode === 'opp_vs_opp') {
      // Both sides are opponents here; the name is what tells them apart.
      const a = teams.find(tm => tm.id === myTeamId)?.name ?? (oppAName.trim() || tr('gameBuilder.opponentA'));
      return [
        { name: a, label: 'opponent' },
        { name: oppLabel, label: 'opponent' },
        ...extraTeams.map(tok => ({ name: extraTeamName(tok), label: 'opponent' })),
      ];
    }
    return [{ name: myName, label: 'my_team' }, { name: oppLabel, label: 'opponent' }];
  };

  /**
   * The sides plus "Both", because most game film IS both teams playing each
   * other — one clip that belongs to neither side on its own. It carries every
   * team's name so the breakdown knows which two teams it is watching.
   */
  const filmChoices = () => {
    const sides = filmSides();
    if (sides.length < 2) return sides;
    return [...sides, { name: tr('gameBuilder.bothTeams'), label: 'both',
                        teamName: sides.map(s => s.name).join(' vs ') }];
  };

  const pickClip = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const choices = filmChoices();
    // One possible team means there is nothing to ask.
    if (choices.length === 1) { uploadClip(asset, choices[0].label, choices[0].name); return; }
    Alert.alert(tr('gameBuilder.whoseFilm'), '', [
      ...choices.map(c => ({
        text: c.name,
        onPress: () => uploadClip(asset, c.label, (c as any).teamName ?? c.name),
      })),
      { text: tr('common.cancel'), style: 'cancel' as const },
    ]);
  };

  const uploadClip = async (asset: any, label: string, teamName = '') => {
    if (!reportId) return;
    setUploadingClip(true);
    setClipProgress(tr('gameBuilder.uploadingFilm'));
    try {
      // Stream the file straight from disk (native), NOT via FormData in JS
      // memory — that's what throws "Failed to grow buffer" on long film. The
      // breakdown runs as a background job that reports per-segment progress,
      // shown on the same overlay as the player-eval flow.
      // Report bytes actually sent. A two-hour film is gigabytes; without this
      // the coach watches an invented curve for the better part of an hour and
      // cannot tell an upload in progress from one that has stalled.
      // A three-hour game is gigabytes. Where storage allows it, the browser
      // sends the film there itself in retryable pieces and hands us a ref —
      // one dropped connection then costs a 32 MB part instead of the hour.
      // See api/directUpload.ts.
      const { direct } = await directUploadAvailable();
      const onProg = (p: any) => setClipProgress(uploadProgressCode(p.sent, p.total));
      let created: any;
      if (direct && asset.file) {
        const { ref } = await uploadFilmDirect(asset.file, {
          purpose: `gr${reportId}clip`, onProgress: onProg,
        });
        created = await gameReportsAPI.addClipRef(reportId, {
          label, team_name: teamName, video_ref: ref,
        });
      } else {
        created = await uploadFileStreamed(
          // On web the picker hands back the File itself; upload that rather than
          // asking the browser to rebuild it from the blob: URL.
          `/game-reports/${reportId}/clips`, asset.file ?? asset.uri, { label, team_name: teamName }, 'video', 'video/mp4',
          onProg,
        );
      }
      if (created?.job_id) {
        setClipProgress(tr('gameBuilder.analyzingFilm'));
        await evalsAPI.awaitJob(created.job_id, setClipProgress);
      }
      const refreshed = await gameReportsAPI.get(reportId);
      setReport(refreshed);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? e?.message ?? tr('gameBuilder.couldNotUploadClip'));
    } finally {
      setUploadingClip(false);
      setClipProgress('');
    }
  };

  const deleteClip = async (clipId: number) => {
    if (!reportId) return;
    try {
      await gameReportsAPI.deleteClip(reportId, clipId, true);
      const refreshed = await gameReportsAPI.get(reportId);
      setReport(refreshed);
    } catch {}
  };

  const applyClipCorrection = async () => {
    if (!reportId || !clipModal || !clipCorrectionText.trim()) return;
    setClipCorrecting(true);
    setClipProgress(tr('gameBuilder.rewatchingFilm'));
    try {
      // Correcting a clip re-analyzes the actual film focused on the correction,
      // so it runs as a background job the client polls.
      const res = await gameReportsAPI.correctClip(reportId, clipModal.id, clipCorrectionText.trim());
      if (res?.job_id) await evalsAPI.awaitJob(res.job_id, setClipProgress);
      setClipCorrectionText('');
      const refreshed = await gameReportsAPI.get(reportId);
      setReport(refreshed);
      const updatedClip = (refreshed.clips ?? []).find((c: any) => c.id === clipModal.id);
      if (updatedClip) setClipModal(updatedClip);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('gameBuilder.couldNotApplyCorrection'));
    } finally {
      setClipCorrecting(false);
      setClipProgress('');
    }
  };

  /**
   * Games to offer, newest first — with any game involving a team named on this
   * packet lifted to the top. An opponent-vs-opponent packet names two teams
   * that are not ours, so none of our games will match and the list is simply
   * chronological; that is the common case and it still has to work.
   */
  const gamesForPicker = (games: any[]) => {
    const named = [report?.my_team_name, report?.opponent_team_name, report?.opponent_name]
      .filter(Boolean).map((n: string) => n.toLowerCase());
    const involves = (g: any) => named.includes(String(g.opponent_name ?? '').toLowerCase());
    const byDate = [...games].sort((a, b) =>
      new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
    return [...byDate.filter(involves), ...byDate.filter(g => !involves(g))];
  };

  const openGamePicker = async () => {
    setGamePickerOpen(true);
    try { setRecordedGames(gamesForPicker(await gameEvalAPI.listSessions())); }
    catch { setRecordedGames([]); }
  };

  const importGame = async (gameId: number) => {
    if (!reportId) return;
    setImportingGameId(gameId);
    try {
      const updated = await gameReportsAPI.importGame(reportId, gameId);
      setReport(updated);
      setBoxScore(updated.box_score ?? '');
      setGamePickerOpen(false);
    } catch (e: any) {
      Alert.alert(tr('common.error'),
        e?.response?.data?.detail ?? e?.message ?? tr('gameBuilder.couldNotReadDocument'));
    } finally {
      setImportingGameId(null);
    }
  };

  /** Box score can come from a file, or from a game already recorded in Games. */
  const importBoxScore = () => {
    Alert.alert(
      tr('gameBuilder.importBoxScoreTitle'),
      tr('gameBuilder.importBoxScoreMessage'),
      [
        { text: tr('gameBuilder.importFromGame'), onPress: openGamePicker },
        { text: tr('gameBuilder.importFromFile'), onPress: () => pickDoc('box_score') },
        { text: tr('common.cancel'), style: 'cancel' },
      ],
    );
  };

  const pickDoc = async (docType: 'box_score' | 'scouting_notes') => {
    const res = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets[0]) return;
    const file = res.assets[0];
    if (!reportId) return;
    setUploadingDoc(docType);
    try {
      const form = new FormData();
      form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'text/plain' } as any);
      form.append('doc_type', docType);
      const updated = await gameReportsAPI.uploadDoc(reportId, form);
      setReport(updated);
      if (docType === 'box_score') setBoxScore(updated.box_score ?? '');
      else setScoutingNotes(updated.scouting_notes ?? '');
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('gameBuilder.couldNotReadDocument'));
    } finally {
      setUploadingDoc(null);
    }
  };

  const generate = async () => {
    if (!reportId) return;
    setGenerating(true);
    setGenProgress('');
    try {
      // Write what is on screen before asking the server to read it. The three
      // text boxes save on blur, fire-and-forget — so typing a scouting note and
      // going straight to this button raced its own PATCH, and the report could
      // be written from the previous contents of the box the coach was looking
      // at. Awaiting one save makes the report use what they can see.
      await gameReportsAPI.update(reportId, {
        // Empty string, not null: the server ignores nulls (exclude_none), so
        // sending null for a box the coach just emptied left the old text in
        // the database — still feeding the report, and reappearing on reload.
        box_score: boxScore.trim(),
        scouting_notes: scoutingNotes.trim(),
        focus_prompt: focusPrompt.trim(),
      });
      let updated;
      if (outputType === 'team_training') {
        updated = await gameReportsAPI.teamTraining(reportId, focusPrompt || undefined);
      } else {
        updated = await gameReportsAPI.generate(reportId, setGenProgress);
      }
      setReport(updated);
      loadVersions(reportId);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
    } catch (e: any) {
      // A failed job reports why it failed as a plain Error, which has no
      // `response` — reading only that is how "Could not generate report" came
      // to stand in for "your credit balance is too low" and for a request that
      // had merely outlived its timeout.
      Alert.alert(tr('common.error'),
        e?.response?.data?.detail ?? e?.message ?? tr('gameBuilder.couldNotGenerate'));
    } finally {
      setGenerating(false);
      setGenProgress('');
    }
  };

  const applyCorrection = async () => {
    if (!reportId) return;
    const pending = correctionText.trim();
    if (!pending && gameCorrections.filter(c => !c.applied).length === 0) {
      Alert.alert(tr('gameBuilder.nothingToApplyTitle'), tr('gameBuilder.nothingToApplyMessage'));
      return;
    }
    setCorrecting(true);
    try {
      if (pending) await gameReportsAPI.addCorrection(reportId, pending);
      const updated = await gameReportsAPI.regenerate(reportId);
      setReport(updated);
      loadVersions(reportId);
      setCorrectionText('');
      await loadGameCorrections(reportId);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('gameBuilder.couldNotApplyCorrection'));
    } finally {
      setCorrecting(false);
    }
  };

  const sendReport = async (target: any) => {
    if (!report?.report_text) return;
    setSharing(true);
    try {
      if (shareMode === 'staff' && reportId) {
        await staffSharingAPI.share({
          report_type: 'game',
          report_id: reportId,
          recipient_id: target.id,
          allow_regenerate: allowRegenerate,
        });
      } else {
        await playerAPI.shareTeamReport({
          output_type: report.output_type ?? 'coaching_report',
          report_text: report.report_text,
          target_type: 'player',
          player_user_id: target.id,
        });
      }
      setShowShare(false);
      setShareSearch('');
      setShareResults([]);
      Alert.alert(tr('gameBuilder.sentTitle'), tr('gameBuilder.sentMessage', { name: target.name }));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('gameBuilder.couldNotSendReport'));
    } finally {
      setSharing(false);
    }
  };

  const reportTypeLabel = () =>
    report?.output_type ? outputTypeLabel(report.output_type) : tr('reportTypes.game_report');

  // Display title for a saved version: one translated name per selected type.
  const versionTitle = (ot: any) =>
    String(ot || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)
      .map((s: string) => tr(`reportTypes.${s}`, { defaultValue: s.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) }))
      .join(' · ') || tr('reportTypes.report');

  const exportPdf = async () => {
    if (!report?.report_text) return;
    try {
      const now = new Date();
      const title_label = report.title || matchupLabel();
      const html = wrapPrintDocument({
        title: title_label,
        subtitle: coach?.program_name ?? '',
        date: now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        bodyHtml: mdToHtml(report.report_text),
      });
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const fileName = `${safeFileName(reportTypeLabel())} - ${safeFileName(title_label)} - ${stamp}`;
      await exportHtmlPdf(html, fileName);
    } catch (e: any) {
      Alert.alert(tr('gameBuilder.exportErrorTitle'), e?.message ?? tr('gameBuilder.couldNotExport'));
    }
  };

  const matchupLabel = () => {
    const myName = teams.find(t => t.id === myTeamId)?.name ?? coach?.program_name ?? tr('gameBuilder.myProgramFallback');
    const oppLabel = (teams.find(t => t.id === oppTeamId)?.name ?? oppName) || tr('gameBuilder.opponentFallback');
    if (mode === 'opp_vs_opp') {
      const a = teams.find(t => t.id === myTeamId)?.name ?? (oppAName || tr('gameBuilder.opponentA'));
      return tr('gameBuilder.vs', { a, b: oppLabel });
    }
    if (mode === 'vs_opponent') return tr('gameBuilder.vs', { a: myName, b: oppLabel });
    if (mode === 'my_program') return myName;
    return oppLabel;
  };

  if (loading) {
    return (
      <ScreenBackground>
        <View style={styles.center}>
          <ActivityIndicator color={t.accent} size="large" />
        </View>
      </ScreenBackground>
    );
  }

  const clips: any[] = report?.clips ?? [];

  return (
    <ScreenBackground>
    {/* Same shell as the team page and the other detail screens: full pane,
        no outer gutter, header inset 20, and the same 1280 cap Staff Hub and
        the team page use. A 900px centred column put this page's title 180px
        right of where every other title starts and left the right third of
        the window empty, which is what made it read as belonging to a
        different app. */}
    <PageContainer padded={false} maxWidth={1280}>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <KeyboardAwareScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refreshPacket} tintColor={t.accent} colors={[t.accent]} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => goUp()}>
            <Ionicons name="chevron-back" size={24} color={t.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{tr('gameBuilder.headerTitle')}</Text>
        </View>

        {/* Packet name — prominent so it isn't skipped */}
        <Text style={styles.label}>{tr('gameBuilder.packetName')}</Text>
        <VoiceTextInput
          style={[styles.nameInput, !title.trim() && { borderColor: t.accent }]}
          value={title}
          onChangeText={setTitle}
          onBlur={() => save({ title: title.trim() || null })}
          placeholder={tr('gameBuilder.packetNamePlaceholder')}
          placeholderTextColor={t.muted2}
        />
        {!title.trim() && (
          <Text style={styles.nameHint}>{tr('gameBuilder.packetNameHint')}</Text>
        )}

        {/* Mode selector */}
        <Text style={styles.label}>{tr('gameBuilder.reportContext')}</Text>
        <View style={styles.modeRow}>
          {MODES.map(m => (
            <TouchableOpacity
              key={m.key}
              style={[styles.modeChip, mode === m.key && styles.modeChipActive]}
              onPress={() => { setMode(m.key); save({ mode: m.key }); }}
            >
              <Text style={[styles.modeChipText, mode === m.key && styles.modeChipTextActive]}>{tr(`gameBuilder.modes.${m.key}`)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Team selectors */}
        {mode !== 'opponent_only' && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>{mode === 'opp_vs_opp' ? tr('gameBuilder.opponentA') : tr('gameBuilder.myTeam')}</Text>
            <TouchableOpacity style={styles.teamPicker} onPress={() => { setShowMyTeamPicker(v => !v); setShowOppTeamPicker(false); }}>
              <Text style={styles.teamPickerText}>
                {teams.find(t => t.id === myTeamId)?.name
                  ?? (mode === 'opp_vs_opp' ? (oppAName || tr('gameBuilder.selectOrTypeOpponent')) : tr('gameBuilder.selectTeam'))}
              </Text>
              <Ionicons name={showMyTeamPicker ? 'chevron-up' : 'chevron-down'} size={14} color={t.muted} />
            </TouchableOpacity>
            {showMyTeamPicker && (
              <View style={styles.pickerList}>
                {mode === 'opp_vs_opp' && (
                  <VoiceTextInput
                    style={styles.oppNameInput}
                    placeholder={tr('gameBuilder.typeOpponentPlaceholder')}
                    placeholderTextColor={t.muted2}
                    value={oppAName}
                    onChangeText={txt => { setOppAName(txt); setMyTeamId(null); }}
                    onBlur={() => save({ opponent_a_name: oppAName.trim() || null, my_team_id: null })}
                  />
                )}
                {teams.filter((tm: any) => !tm.parent_team_id).map(t => (
                  <TouchableOpacity key={t.id} style={[styles.pickerItem, myTeamId === t.id && styles.pickerItemActive]}
                    onPress={() => { setMyTeamId(t.id); setOppAName(''); setShowMyTeamPicker(false); save({ my_team_id: t.id, opponent_a_name: null }); }}>
                    <Text style={[styles.pickerItemText, myTeamId === t.id && { color: t.ink }]}>{t.name}</Text>
                    {myTeamId === t.id && <Ionicons name="checkmark" size={14} color={t.accent} />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {mode !== 'my_program' && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>{mode === 'opp_vs_opp' ? tr('gameBuilder.opponentB') : tr('gameBuilder.opponent')}</Text>
            <TouchableOpacity style={styles.teamPicker} onPress={() => { setShowOppTeamPicker(v => !v); setShowMyTeamPicker(false); }}>
              <Text style={styles.teamPickerText}>
                {teams.find(t => t.id === oppTeamId)?.name ?? (oppName || tr('gameBuilder.selectOrTypeOpponent'))}
              </Text>
              <Ionicons name={showOppTeamPicker ? 'chevron-up' : 'chevron-down'} size={14} color={t.muted} />
            </TouchableOpacity>
            {showOppTeamPicker && (
              <View style={styles.pickerList}>
                <VoiceTextInput
                  style={styles.oppNameInput}
                  placeholder={tr('gameBuilder.typeOpponentPlaceholder')}
                  placeholderTextColor={t.muted2}
                  value={oppName}
                  onChangeText={txt => { setOppName(txt); setOppTeamId(null); }}
                  onBlur={() => save({ opponent_name: oppName.trim() || null, opponent_team_id: null })}
                />
                {teams.filter((tm: any) => !tm.parent_team_id).map(tm => (
                  <TouchableOpacity key={tm.id} style={[styles.pickerItem, oppTeamId === tm.id && styles.pickerItemActive]}
                    onPress={() => { setOppTeamId(tm.id); setOppName(''); setShowOppTeamPicker(false); save({ opponent_team_id: tm.id, opponent_name: null }); }}>
                    <Text style={[styles.pickerItemText, oppTeamId === tm.id && { color: t.ink }]}>{tm.name}</Text>
                    {oppTeamId === tm.id && <Ionicons name="checkmark" size={14} color={t.accent} />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* When the game was. The one field that makes a film linkable to a
            tracked game: the packet is built long after the night in question,
            so nothing else in it knows the date. */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>{tr('gameBuilder.gameDate')}</Text>
          <Text style={{ color: t.muted, fontSize: 11, marginBottom: 8 }}>
            {tr('gameBuilder.gameDateHint')}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <VoiceTextInput
              style={[styles.oppNameInput, { flex: 1, marginBottom: 0 }]}
              placeholder="MM-DD-YY"
              placeholderTextColor={t.muted2}
              value={gameDate}
              onChangeText={setGameDate}
              onBlur={() => {
                // Typed however the coach types. Only a WHOLE date is saved —
                // a half-finished one is somebody still going, and storing it
                // would start suggesting games for a date they have not
                // finished entering. See utils/gameDate.
                const clean = gameDate.trim();
                if (!clean) { void save({ game_date: null }); return; }
                const parsed = parseGameDate(clean);
                if (!parsed) return;
                setGameDate(parsed.display);
                void save({ game_date: `${parsed.iso}T12:00:00` });
              }}
            />
            <TouchableOpacity
              style={[styles.dateSearchBtn, searchingGames && { opacity: 0.6 }]}
              onPress={() => {
                const parsed = parseGameDate(gameDate.trim());
                if (parsed) {
                  setGameDate(parsed.display);
                  void save({ game_date: `${parsed.iso}T12:00:00` })
                    .then(() => { if (reportId) void refreshLinkAsk(reportId, { manual: true }); });
                } else if (reportId) {
                  // No usable date is not a dead end: the sheet can still be
                  // searched by team, which is the other way in.
                  //
                  // And a team name typed here IS that search. It used to be
                  // thrown away — the sheet opened with an empty box and the
                  // coach typed the same name a second time to see any games
                  // at all. Letters mean a name, not a half-typed date, so it
                  // is carried through and searched on straight away.
                  const typed = gameDate.trim();
                  const isName = /\p{L}/u.test(typed);
                  if (isName) { setGameQuery(typed); setGameDate(''); }
                  void refreshLinkAsk(reportId, {
                    manual: true, q: isName ? typed : undefined,
                  });
                }
              }}
              disabled={searchingGames}
            >
              {searchingGames
                ? <ActivityIndicator color={t.ctaText} size="small" />
                : <><Ionicons name="search" size={15} color={t.ctaText} />
                    <Text style={styles.dateSearchText}>{tr('gameBuilder.searchAction')}</Text></>}
            </TouchableOpacity>
          </View>

          {/* Tied, and said so. A link that only exists in the database is a
              link the coach has to take on trust — and this is the row that
              tells them the breakdown is now working from real numbers. */}
          {!!linkedGame && (
            <View style={styles.tiedRow}>
              <Ionicons name="link" size={15} color={t.positive} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.tiedLabel}>{tr('gameBuilder.tiedTo')}</Text>
                <Text style={styles.tiedGame} numberOfLines={1}>{linkedGame}</Text>
              </View>
              <TouchableOpacity onPress={() => answerLink(null)} disabled={linking}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.tiedUntie}>{tr('gameBuilder.untie')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Multi-team match-up: add a 3rd+ team to compare (only for Match Up) */}
        {isMatchup && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>{tr('gameBuilder.additionalTeams')}</Text>
            <Text style={{ color: t.muted, fontSize: 11, marginBottom: 8 }}>
              {tr('gameBuilder.additionalTeamsHint')}
            </Text>
            {extraTeams.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {extraTeams.map(tok => (
                  <TouchableOpacity key={tok} style={styles.selectedTeamChip} onPress={() => toggleExtraTeam(tok)}>
                    <Text style={styles.selectedTeamChipText}>{extraTeamLabel(tok)}</Text>
                    <Ionicons name="close" size={13} color={t.accent} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {/* Saved teams to add */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {teams.filter((tm: any) => !tm.parent_team_id && !extraTeams.includes(`t${tm.id}`)).map((tm: any) => (
                <TouchableOpacity key={tm.id} style={styles.addTeamChip} onPress={() => toggleExtraTeam(`t${tm.id}`)}>
                  <Ionicons name="add" size={13} color={t.muted} />
                  <Text style={styles.addTeamChipText}>{tm.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* Free-text team name */}
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <VoiceTextInput
                style={[styles.oppNameInput, { flex: 1, marginBottom: 0 }]}
                placeholder={tr('gameBuilder.typeTeamPlaceholder')}
                placeholderTextColor={t.muted2}
                value={extraTeamText}
                onChangeText={setExtraTeamText}
                onSubmitEditing={addExtraTeamName}
                returnKeyType="done"
              />
              <TouchableOpacity style={styles.addTeamBtn} onPress={addExtraTeamName}>
                <Text style={styles.addTeamBtnText}>{tr('gameBuilder.add')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Output type — select one or more to combine into a comprehensive report */}
        <Text style={styles.label}>{tr('gameBuilder.reportType')}</Text>
        <Text style={{ color: t.muted, fontSize: 11, marginBottom: 8, marginLeft: 2 }}>
          {tr('gameBuilder.reportTypeHint')}
        </Text>
        <ChipRow style={{ marginBottom: 20 }} bleed={20}>
          {OUTPUT_TYPES.map(t => {
            const selected = outputType.split(',').filter(Boolean);
            const isOn = selected.includes(t.key);
            return (
              <TouchableOpacity key={t.key}
                style={[styles.chip, isOn && styles.chipActive]}
                onPress={() => {
                  const next = isOn ? selected.filter(k => k !== t.key) : [...selected, t.key];
                  const joined = (next.length ? next : [t.key]).join(',');
                  setOutputType(joined); save({ output_type: joined });
                }}>
                <Text style={[styles.chipText, isOn && styles.chipTextActive]}>{tr(`reportTypes.${t.key}`)}</Text>
              </TouchableOpacity>
            );
          })}
        </ChipRow>

        {/* Film clips */}
        <View style={styles.sectionHeader}>
          <Text style={styles.label}>{tr('gameBuilder.film')}</Text>
          <TouchableOpacity style={styles.addBtn} onPress={pickClip} disabled={uploadingClip}>
            {uploadingClip
              ? <ActivityIndicator color={t.ctaText} size="small" />
              : <><Ionicons name="add" size={14} color={t.ctaText} /><Text style={styles.addBtnText}>{tr('gameBuilder.addFilm')}</Text></>
            }
          </TouchableOpacity>
        </View>
        {clips.length === 0 ? (
          <Text style={styles.emptyHint}>{tr('gameBuilder.noFilmYet')}</Text>
        ) : (
          clips.map((clip: any) => (
            <TouchableOpacity
              key={clip.id}
              style={styles.clipCard}
              onPress={() => { setClipModal(clip); setClipCorrectionText(''); }}
              onLongPress={() => Alert.alert(tr('gameBuilder.deleteClipTitle'), '', [
                { text: tr('common.cancel'), style: 'cancel' },
                { text: tr('common.delete'), style: 'destructive', onPress: () => deleteClip(clip.id) },
              ])}
            >
              {/* A film of both teams belongs to neither side, so it gets its
                  own neutral badge rather than being coloured as the opponent. */}
              <View style={[styles.clipLabel, clip.label === 'both' ? styles.clipLabelBoth
                : clip.label === 'my_team' ? styles.clipLabelMy : styles.clipLabelOpp]}>
                {/* The team the coach picked, when there is one — in an
                    opponent-vs-opponent packet "Opponent" describes both films. */}
                <Text style={styles.clipLabelText}>{clip.team_name || (clip.label === 'my_team' ? tr('gameBuilder.myTeam') : tr('gameBuilder.opponent'))}</Text>
              </View>
              {/* "Analyzing…" said the same thing whether the film was being
                  watched right now or the job had died hours ago. The job's own
                  progress and errors travel with the clip, so the row can say
                  which — "Analyzing segment 3 of 12", or why it stopped. */}
              <Text style={[styles.clipAnalysis, clip.job_status === 'error' && { color: t.negative }]} numberOfLines={2}>
                {clip.analysis_text
                  ? clipSummaryLine(clip)
                  : clip.job_status === 'error'
                    ? (clip.job_error || tr('gameBuilder.analysisStopped'))
                    : (jobProgressLabel(clip.job_progress, tr) || tr('gameBuilder.analyzing'))}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={t.muted2} />
            </TouchableOpacity>
          ))
        )}

        {/* Film analysis progress — under the film area, above box score. */}
        <GeneratingOverlay
          visible={uploadingClip}
          label={jobProgressLabel(clipProgress, tr) || tr('gameBuilder.analyzingFilm')}
          realProgress={parseGenProgress(clipProgress)}
        />

        {/* Box Score */}
        <View onLayout={e => { boxScoreY.current = e.nativeEvent.layout.y; }}>
          <View style={styles.sectionHeader}>
            <Text style={styles.label}>{tr('gameBuilder.boxScoreStats')}</Text>
            <TouchableOpacity style={styles.importBtn} onPress={importBoxScore} disabled={uploadingDoc === 'box_score'}>
              {uploadingDoc === 'box_score'
                ? <ActivityIndicator color={t.muted} size="small" />
                : <><Ionicons name="document-outline" size={14} color={t.muted} /><Text style={styles.importBtnText}>{tr('gameBuilder.import')}</Text></>
              }
            </TouchableOpacity>
          </View>
          <VoiceTextInput
            style={styles.textArea}
            placeholder={tr('gameBuilder.boxScorePlaceholder')}
            placeholderTextColor={t.muted2}
            value={boxScore}
            onChangeText={setBoxScore}

            onBlur={() => save({ box_score: boxScore.trim() })}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Scouting Notes */}
        <View onLayout={e => { scoutingY.current = e.nativeEvent.layout.y; }}>
          <View style={styles.sectionHeader}>
            <Text style={styles.label}>{tr('gameBuilder.scoutingNotes')}</Text>
            <TouchableOpacity style={styles.importBtn} onPress={() => pickDoc('scouting_notes')} disabled={uploadingDoc === 'scouting_notes'}>
              {uploadingDoc === 'scouting_notes'
                ? <ActivityIndicator color={t.muted} size="small" />
                : <><Ionicons name="document-outline" size={14} color={t.muted} /><Text style={styles.importBtnText}>{tr('gameBuilder.import')}</Text></>
              }
            </TouchableOpacity>
          </View>
          <VoiceTextInput
            style={styles.textArea}
            placeholder={tr('gameBuilder.scoutingNotesPlaceholder')}
            placeholderTextColor={t.muted2}
            value={scoutingNotes}
            onChangeText={setScoutingNotes}

            onBlur={() => save({ scouting_notes: scoutingNotes.trim() })}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Focus */}
        <View onLayout={e => { focusPromptY.current = e.nativeEvent.layout.y; }}>
          <Text style={styles.label}>{tr('gameBuilder.focusOptional')}</Text>
          <VoiceTextInput
            style={[styles.textArea, { minHeight: 60 }]}
            placeholder={tr('gameBuilder.focusPlaceholder')}
            placeholderTextColor={t.muted2}
            value={focusPrompt}
            onChangeText={setFocusPrompt}

            onBlur={() => save({ focus_prompt: focusPrompt.trim() })}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* Generate */}
        <TouchableOpacity style={styles.generateBtn} onPress={generate} disabled={generating}>
          {generating
            ? <><ActivityIndicator color={t.ctaText} /><Text style={styles.generateText}>  {tr('gameBuilder.generating')}</Text></>
            : <><Ionicons name="sparkles" size={18} color={t.ctaText} /><Text style={styles.generateText}>  {tr('gameBuilder.generateReport')}</Text></>
          }
        </TouchableOpacity>
        {generating && (
          <Text style={styles.hint}>{tr('gameBuilder.generatingHint')}</Text>
        )}
        <GeneratingOverlay
          visible={generating}
          label={jobProgressLabel(genProgress, tr) || tr('gameBuilder.generatingOverlay')}
          realProgress={parseGenProgress(genProgress)}
        />
        <GeneratingOverlay
          visible={uploadingClip}
          realProgress={parseGenProgress(clipProgress)}
          label={jobProgressLabel(clipProgress, tr) || tr('gameBuilder.uploadingOverlay')}
        />

        {/* Saved reports — one per report-type selection, kept in the packet */}
        {versions.length > 0 && (
          <View style={{ marginTop: 28 }}>
            <Text style={styles.label}>{tr('gameBuilder.savedReports', { count: versions.length })}</Text>
            <View style={{ marginTop: 10, gap: 8 }}>
              {versions.map((v: any) => (
                <TouchableOpacity
                  key={v.id}
                  style={{ backgroundColor: t.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: t.chip, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                  onPress={() => setVersionView(v)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontSize: 13, fontFamily: fonts[700] }} numberOfLines={1}>
                      {versionTitle(v.output_type)}
                    </Text>
                    <Text style={{ color: t.muted2, fontSize: 11, marginTop: 2 }}>
                      {tr('gameBuilder.updated', { date: new Date(v.updated_at || v.created_at).toLocaleDateString() })}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={t.muted2} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Report output */}
        {report?.report_text ? (
          <View style={{ marginTop: 28 }}>
            {/* The row keeps the label's own bottom margin, so the search
                button does not end up sitting on the report box. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Text style={[styles.label, { flex: 1, marginBottom: 0 }]}>{tr('gameBuilder.generatedReport')}</Text>
              <ReportSearchButton ctl={find} />
            </View>
            {/* Shorter than the bar a report SHEET opens with. That sheet
                fills the screen, so its full-width bar is the screen's width
                and reads right; this section sits in the page, so the same
                width reads as a band across it. */}
            <ReportSearchBar ctl={find} phoneMaxWidth={320} />
            <View style={styles.reportBox}>
              {renderReport(report.report_text, { heading: t.ink, body: t.inkSoft }, find.search)}
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => setShowExport(true)}>
                <Ionicons name="download-outline" size={16} color={t.muted} />
                <Text style={styles.actionText}>{tr('gameBuilder.exportPrint')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => setShowShareModal(true)}>
                <Ionicons name="share-social-outline" size={16} color={t.muted} />
                <Text style={styles.actionText}>{tr('common.share')}</Text>
              </TouchableOpacity>
            </View>

            {/* Correction section */}
            <View style={styles.correctionSection}>
              <Text style={styles.correctionLabel}>{tr('gameBuilder.makeCorrection')}</Text>
              <VoiceTextInput
                style={styles.correctionInput}
                placeholder="e.g. The point guard is actually a better defender than scorer..."
                placeholderTextColor={t.muted2}
                value={correctionText}
                onChangeText={setCorrectionText}

                multiline
                textAlignVertical="top"
              />
              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={[styles.correctionBtn, styles.btnInRow, { backgroundColor: t.chip }, (!correctionText.trim() || savingCorrection) && { opacity: 0.5 }]}
                  onPress={saveCorrectionForLater}
                  disabled={!correctionText.trim() || savingCorrection}
                >
                  {savingCorrection
                    ? <ActivityIndicator color={t.ink} size="small" />
                    : <Text style={[styles.correctionBtnText, { color: t.ink }]}>{tr('gameBuilder.saveForLater')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.correctionBtn, styles.btnInRow, correcting && { opacity: 0.5 }]}
                  onPress={applyCorrection}
                  disabled={correcting}
                >
                  {correcting
                    ? <><ActivityIndicator color={t.ctaText} size="small" /><Text style={styles.correctionBtnText}>  {tr('gameBuilder.updating')}</Text></>
                    : <><Ionicons name="refresh" size={15} color={t.ctaText} /><Text style={styles.correctionBtnText}>  {tr('gameBuilder.applyRegenerate')}</Text></>
                  }
                </TouchableOpacity>
              </View>
              <GeneratingOverlay visible={correcting} label={tr('gameBuilder.regeneratingLabel')} />

              {gameCorrections.length > 0 && (
                <View style={{ marginTop: 14 }}>
                  {gameCorrections.map((c: any) => (
                    <View key={c.id} style={{ backgroundColor: t.card, borderRadius: 10, padding: 11, marginBottom: 6, borderWidth: 1, borderColor: t.cardBorder, opacity: c.applied ? 0.55 : 1 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                        {c.applied
                          ? <View style={{ backgroundColor: t.positiveSoft, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}>
                              <Text style={{ color: t.positive, fontSize: 9, fontFamily: fonts[700] }}>{tr('gameBuilder.applied')}</Text>
                            </View>
                          : <View style={{ backgroundColor: t.chip, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}>
                              <Text style={{ color: t.muted, fontSize: 9, fontFamily: fonts[700] }}>{tr('gameBuilder.pending')}</Text>
                            </View>}
                        <Text style={{ color: t.muted2, fontSize: 10 }}>{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</Text>
                      </View>
                      <Text style={{ color: t.inkSoft, fontSize: 12.5 }}>{c.correction}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        ) : null}
      </KeyboardAwareScrollView>

      {/* Clip analysis modal */}
      {/* Saved report version viewer */}
      {/* Games already recorded in BloomPrint, offered as a box-score source. */}
      <Sheet visible={gamePickerOpen} animationType="slide" transparent onRequestClose={() => setGamePickerOpen(false)}>
        <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, flex: 1, marginTop: 60, ...sheetCap(560) }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ color: t.ink, fontSize: 17, fontFamily: fonts[800] }}>
                {tr('gameBuilder.importFromGame')}
              </Text>
              <TouchableOpacity onPress={() => setGamePickerOpen(false)}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView>
              {recordedGames.length === 0 && (
                <Text style={{ color: t.muted2, fontSize: 13 }}>{tr('gameBuilder.noRecordedGames')}</Text>
              )}
              {recordedGames.map((g: any) => (
                <TouchableOpacity
                  key={g.id}
                  style={styles.clipCard}
                  onPress={() => importGame(g.id)}
                  disabled={importingGameId != null}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontSize: 14, fontFamily: fonts[600] }} numberOfLines={1}>
                      vs {g.opponent_name}
                    </Text>
                    <Text style={{ color: t.muted, fontSize: 11 }} numberOfLines={1}>
                      {g.date ? new Date(g.date).toLocaleDateString() : ''}
                      {g.our_score != null && g.opponent_score != null
                        ? `  ·  ${g.our_score}-${g.opponent_score}` : ''}
                    </Text>
                  </View>
                  {importingGameId === g.id
                    ? <ActivityIndicator size="small" color={t.muted} />
                    : <Ionicons name="chevron-forward" size={14} color={t.muted2} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Sheet>

      <Sheet visible={!!versionView} animationType="slide" transparent onRequestClose={() => setVersionView(null)}>
        <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }}>
          {/* A saved report is read, not filled in — the same width as every
              other place a report is read. 560 is the form/picker cap, and it
              made the same text a much narrower column here than on Recent. */}
          <View style={{ backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, flex: 1, marginTop: 60, ...sheetCap(REPORT_MODAL_WIDTH) }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontSize: 17, fontFamily: fonts[800] }} numberOfLines={2}>
                  {String(versionView?.output_type || '').split(',').map((s: string) => s.replace(/_/g, ' ').trim()).filter(Boolean).map((s: string) => s.replace(/\b\w/g, (c: string) => c.toUpperCase())).join(' · ') || 'Report'}
                </Text>
                <Text style={{ color: t.muted, fontSize: 11, marginTop: 2 }}>
                  {versionView ? `Updated ${new Date(versionView.updated_at || versionView.created_at).toLocaleDateString()}` : ''}
                </Text>
              </View>
              <ReportSearchButton ctl={findVersion} />
              <TouchableOpacity onPress={() => setVersionView(null)} style={{ marginLeft: 10 }}><Ionicons name="close" size={22} color={t.muted} /></TouchableOpacity>
            </View>
            <ReportSearchBar ctl={findVersion} />
            <KeyboardAwareScrollView ref={findVersion.scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
              {versionView?.report_text
                ? renderReport(versionView.report_text, { heading: t.ink, body: t.inkSoft }, findVersion.search)
                : <Text style={{ color: t.muted }}>{tr('gameBuilder.noContent')}</Text>}
            </KeyboardAwareScrollView>
          </View>
        </View>
      </Sheet>

      {/* Which tracked game this film is of. Same shape as the picker that
          asks who is IN the film, and asked right after it: a suggestion the
          coach confirms, a way to say none of them, and a way to go and import
          the game if it is not in the app yet. */}
      <Sheet visible={!!linkAsk} animationType="slide" transparent onRequestClose={() => setLinkAsk(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{tr('gameBuilder.linkGameTitle')}</Text>
              <TouchableOpacity onPress={() => setLinkAsk(null)} style={{ marginLeft: 'auto' }}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>{tr('gameBuilder.linkGameHint')}</Text>
            {/* Searching by team is the way out of "it is not in that list".
                A name overrides the date entirely — every game that team
                played — because the coach typing one means the automatic
                match did not find what they were after. */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              <VoiceTextInput
                style={[styles.oppNameInput, { flex: 1, marginBottom: 0 }]}
                placeholder={tr('gameBuilder.linkSearchTeam')}
                placeholderTextColor={t.muted2}
                value={gameQuery}
                onChangeText={setGameQuery}
                returnKeyType="search"
                // Enter searches. Typing a name and pressing return is what a
                // search box does everywhere else, and it was doing nothing.
                onSubmitEditing={() =>
                  reportId && refreshLinkAsk(reportId, { manual: true, q: gameQuery })}
              />
              <TouchableOpacity
                style={styles.dateSearchBtn}
                onPress={() => reportId && refreshLinkAsk(reportId, { manual: true, q: gameQuery })}
                disabled={searchingGames}
              >
                {searchingGames
                  ? <ActivityIndicator color={t.ctaText} size="small" />
                  : <><Ionicons name="search" size={15} color={t.ctaText} />
                      <Text style={styles.dateSearchText}>{tr('gameBuilder.searchAction')}</Text></>}
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 260 }}>
              {/* An empty result is an answer, not a blank sheet. */}
              {(linkAsk?.games ?? []).length === 0 && (
                <Text style={{ color: t.muted2, fontSize: 12.5, paddingVertical: 12 }}>
                  {tr('gameBuilder.linkNoGames')}
                </Text>
              )}
              {(linkAsk?.games ?? []).map((g: any) => (
                <TouchableOpacity
                  key={g.id}
                  style={styles.linkRow}
                  onPress={() => answerLink(g.id)}
                  disabled={linking}
                >
                  <Ionicons name="clipboard-outline" size={16} color={t.accent} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.linkRowText} numberOfLines={1}>{g.label}</Text>
                    {/* A near miss says so rather than being offered as though
                        it were certain — a game logged after midnight is a day
                        out, and so is a date typed from memory. */}
                    {!g.exact_date && (
                      <Text style={styles.linkRowNote}>{tr('gameBuilder.linkNearDate')}</Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={t.muted2} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                style={[styles.modalBtn, { flex: 1, backgroundColor: t.chip }]}
                onPress={() => answerLink(null)}
                disabled={linking}
              >
                <Text style={{ color: t.muted, fontFamily: fonts[700] }}>{tr('gameBuilder.linkNone')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { flex: 1.2, backgroundColor: t.ctaBg }]}
                onPress={() => {
                  setLinkAsk(null);
                  navigation.navigate('Import' as never);
                }}
                disabled={linking}
              >
                <Text style={{ color: t.ctaText, fontFamily: fonts[700] }}>{tr('gameBuilder.linkImport')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Sheet>

      {/* Which tracked game this film is of. Asked right after who is IN the
          film, and only when the coach has given a game date — without one
          there is nothing to match on, because a packet is built long after
          the night it is about. A suggestion, always confirmed. */}

      <Sheet visible={!!clipModal} animationType="slide" transparent onRequestClose={() => setClipModal(null)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View style={[styles.clipLabel, clipModal?.label === 'both' ? styles.clipLabelBoth
                : clipModal?.label === 'my_team' ? styles.clipLabelMy : styles.clipLabelOpp]}>
                <Text style={styles.clipLabelText}>{clipModal?.team_name
                  ? tr('gameBuilder.teamFilm', { team: clipModal.team_name })
                  : (clipModal?.label === 'my_team' ? tr('gameBuilder.myTeamFilm') : tr('gameBuilder.opponentFilm'))}</Text>
              </View>
              <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ReportSearchButton ctl={findClip} />
                <TouchableOpacity onPress={() => setClipModal(null)}>
                  <Ionicons name="close" size={22} color={t.muted} />
                </TouchableOpacity>
              </View>
            </View>
            <ReportSearchBar ctl={findClip} />
            <KeyboardAwareScrollView ref={findClip.scrollRef} style={{ maxHeight: sheetScroll280 }} contentContainerStyle={{ paddingBottom: 8 }}>
              {clipModal?.analysis_text
                ? renderReport(clipModal.analysis_text, { heading: t.ink, body: t.inkSoft }, findClip.search)
                : (() => {
                    // "No analysis yet" is true of a film being watched right
                    // now and of one whose job died an hour ago, and a coach
                    // opening this while it runs wants to see it moving. The
                    // live clip carries the job's progress, so show the same
                    // bar the packet does — or why it stopped.
                    const live = (report?.clips ?? []).find((c: any) => c.id === clipModal?.id) ?? clipModal;
                    if (live?.job_status === 'error') {
                      return <Text style={{ color: t.negative }}>{live.job_error || tr('gameBuilder.analysisStopped')}</Text>;
                    }
                    if (live?.job_progress || live?.job_status === 'processing') {
                      return (
                        <GeneratingOverlay
                          visible
                          label={jobProgressLabel(live.job_progress, tr) || tr('gameBuilder.analyzing')}
                          realProgress={parseGenProgress(live.job_progress)}
                        />
                      );
                    }
                    return <Text style={{ color: t.muted }}>{tr('gameBuilder.noAnalysisYet')}</Text>;
                  })()
              }
            </KeyboardAwareScrollView>
            <Text style={[styles.correctionLabel, { marginTop: 16 }]}>{tr('gameBuilder.correctThisAnalysis')}</Text>
            <VoiceTextInput
              style={styles.correctionInput}
              placeholder={tr('gameBuilder.filmCorrectionPlaceholder')}
              placeholderTextColor={t.muted2}
              value={clipCorrectionText}
              onChangeText={setClipCorrectionText}
              multiline
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[styles.correctionBtn, (!clipCorrectionText.trim() || clipCorrecting) && { opacity: 0.5 }]}
              onPress={applyClipCorrection}
              disabled={!clipCorrectionText.trim() || clipCorrecting}
            >
              {clipCorrecting
                ? <><ActivityIndicator color={t.ctaText} size="small" /><Text style={styles.correctionBtnText}>  {tr('gameBuilder.updating')}</Text></>
                : <><Ionicons name="checkmark-circle" size={16} color={t.ctaText} /><Text style={styles.correctionBtnText}>  {tr('gameBuilder.applyCorrection')}</Text></>
              }
            </TouchableOpacity>
            <GeneratingOverlay
              visible={clipCorrecting}
              label={jobProgressLabel(clipProgress, tr) || tr('gameBuilder.rewatchingFilm')}
              realProgress={parseGenProgress(clipProgress)}
            />
          </View>
        </KeyboardAvoidingView>
      </Sheet>

      {/* Share modal */}
      <Sheet visible={showShare} animationType="slide" transparent onRequestClose={() => setShowShare(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{tr('gameBuilder.sendReport')}</Text>
              <TouchableOpacity onPress={() => setShowShare(false)}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>
            {/* Mode selector */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              <TouchableOpacity
                style={[styles.chip, shareMode === 'player' && styles.chipActive, { flex: 1 }]}
                onPress={() => { setShareMode('player'); setShareSearch(''); setShareResults([]); }}
              >
                <Text style={[styles.chipText, shareMode === 'player' && styles.chipTextActive]}>{tr('gameBuilder.player')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, shareMode === 'staff' && styles.chipActive, { flex: 1 }]}
                onPress={() => { setShareMode('staff'); setShareSearch(''); setShareResults([]); }}
              >
                <Text style={[styles.chipText, shareMode === 'staff' && styles.chipTextActive]}>{tr('gameBuilder.staff')}</Text>
              </TouchableOpacity>
            </View>
            {shareMode === 'staff' && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, backgroundColor: t.chip, borderRadius: 8, padding: 12 }}>
                <Text style={{ color: t.inkSoft, fontSize: 13 }}>{tr('gameBuilder.allowRegenerate')}</Text>
                <TouchableOpacity
                  onPress={() => setAllowRegenerate(v => !v)}
                  style={{ width: 40, height: 22, borderRadius: 11, backgroundColor: allowRegenerate ? t.accent : t.line, justifyContent: 'center', paddingHorizontal: 2 }}
                >
                  <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: t.ink, alignSelf: allowRegenerate ? 'flex-end' : 'flex-start' }} />
                </TouchableOpacity>
              </View>
            )}
            <Text style={{ color: t.muted, fontSize: 12, marginBottom: 10 }}>
              {shareMode === 'staff' ? 'Search for a coach, trainer, or scout to share this report.' : 'Search for a player to send this report to their inbox.'}
            </Text>
            <VoiceTextInput
              style={styles.searchInput}
              placeholder={tr('gameBuilder.typeNameToSearch')}
              placeholderTextColor={t.muted}
              value={shareSearch}
              onChangeText={setShareSearch}
              autoFocus
            />
            {shareSearchLoading && <ActivityIndicator color={t.muted} size="small" style={{ marginTop: 8 }} />}
            <ScrollView style={{ maxHeight: sheetScroll260, marginTop: 8 }} keyboardShouldPersistTaps="handled">
              {shareResults.map(r => (
                <TouchableOpacity key={r.id} style={styles.searchResult} onPress={() => sendReport(r)} disabled={sharing}>
                  <View style={styles.searchAvatar}>
                    <Text style={{ color: t.ink, fontFamily: fonts[700] }}>{r.name?.[0] ?? '?'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.ink, fontFamily: fonts[600] }}>{r.name}</Text>
                    <Text style={{ color: t.muted, fontSize: 12 }}>{r.email}</Text>
                  </View>
                  {sharing ? <ActivityIndicator color={t.accent} size="small" /> : <Ionicons name="paper-plane-outline" size={18} color={t.accent} />}
                </TouchableOpacity>
              ))}
              {shareResults.length === 0 && shareSearch.trim().length > 0 && !shareSearchLoading && (
                <Text style={{ color: t.muted2, textAlign: 'center', paddingVertical: 20 }}>{tr('gameBuilder.noPlayersFound')}</Text>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Sheet>
    </KeyboardAvoidingView>

    {/* Last in the tree on purpose: a modal stacks in tree order on web, so
        anything that opens OVER a sheet has to be rendered after it. */}
    {report && showShareModal && (
      <ShareModal
        visible={showShareModal}
        onClose={() => setShowShareModal(false)}
        reportType="game"
        reportId={reportId ?? 0}
        outputType={report.output_type ?? 'coaching_report'}
        reportText={report.report_text ?? ''}
        title={outputTypeNames(report.output_type)}
        subject={report.title || matchupLabel()}
      />
    )}
    <ExportSectionsModal
      visible={showExport && !!report}
      title={report?.title || matchupLabel()}
      subject={coach?.program_name ?? undefined}
      reportText={report?.report_text ?? ''}
      onClose={() => setShowExport(false)}
    />
    </PageContainer>
    </ScreenBackground>
  );
}


const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  // The page's inset, matching the other detail screens: the header adds its
  // own 8 on top of the 56, and the body keeps the 20 either side.
  //
  // It lives on the CONTENT, not on the scroller. react-native-web renders a
  // scroll view that has a refreshControl by cloning the control with the
  // scroller's own style wrapped around it — so any padding written here would
  // be applied twice, once by the wrapper and again by the scroller inside it.
  // Adding pull-to-refresh to this page silently turned its 20pt gutter into
  // 40 and its 56 of head room into 112, which is why it stopped matching
  // every other screen on a phone.
  content: { paddingHorizontal: 20, paddingTop: topPad(56), paddingBottom: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // titleTopPad and a 20px inset, the same as Roster, Recent, Team Eval and
  // Team Grade. This page used the plain topPad, which is 12px lower on web —
  // enough that opening a packet from one of those screens visibly dropped the
  // title, and the page read as belonging to a different app.
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8, marginBottom: 12 },
  titleInput: { flex: 1, color: t.ink, fontSize: 18, fontFamily: fonts[800], borderBottomWidth: 1, borderBottomColor: t.line, paddingBottom: 4 },
  headerTitle: { flex: 1, color: t.ink, fontSize: 22, fontFamily: fonts[900] },
  nameInput: { backgroundColor: t.card, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: t.ink, fontSize: 16, fontFamily: fonts[700], borderWidth: 1.5, borderColor: t.line, marginBottom: 4 },
  nameHint: { color: t.accent, fontSize: 11, fontFamily: fonts[600], marginBottom: 8 },
  label: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 },
  modeRow: { gap: 8, marginBottom: 20 },
  modeChip: { borderWidth: 1, borderColor: t.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  modeChipActive: { backgroundColor: t.accentSoft, borderColor: t.accent },
  modeChipText: { color: t.muted, fontSize: 13, fontFamily: fonts[600] },
  modeChipTextActive: { color: t.accent },
  card: { backgroundColor: t.card, borderRadius: 18, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: t.cardBorder },
  cardLabel: { color: t.muted, fontSize: 11, fontFamily: fonts[700], textTransform: 'uppercase', marginBottom: 8 },
  teamPicker: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  teamPickerText: { color: t.ink, fontSize: 14 },
  pickerList: { marginTop: 12, borderTopWidth: 1, borderTopColor: t.divider, paddingTop: 10 },
  oppNameInput: { backgroundColor: t.chip, borderRadius: 10, padding: 10, color: t.ink, fontSize: 13, borderWidth: 1, borderColor: t.line, marginBottom: 8 },
  pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: t.divider },
  pickerItemActive: { backgroundColor: t.accentSoft, borderRadius: 8 },
  pickerItemText: { color: t.inkSoft, fontSize: 14 },
  selectedTeamChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: t.accentSoft, borderColor: t.accent, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  selectedTeamChipText: { color: t.accent, fontSize: 13, fontFamily: fonts[600] },
  addTeamChip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderColor: t.line, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  addTeamChipText: { color: t.muted, fontSize: 13 },
  addTeamBtn: { backgroundColor: t.ctaBg, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11 },
  addTeamBtnText: { color: t.ctaText, fontSize: 13, fontFamily: fonts[700] },
  // The roster's team chip and Team Grade's view chip, which are the pills that
  // look right: a fixed 34 high with the label centred in it, rather than a
  // height that follows the text and grows out of a scroller that clips it.
  chip: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 16, height: 34, justifyContent: 'center', marginRight: 8 },
  chipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  chipText: { color: t.muted, fontSize: 13, fontFamily: fonts[700] },
  chipTextActive: { color: t.ctaText },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 4 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.ctaBg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  addBtnText: { color: t.ctaText, fontSize: 12, fontFamily: fonts[700] },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: t.cta2Border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  importBtnText: { color: t.cta2Text, fontSize: 12, fontFamily: fonts[700] },
  emptyHint: { color: t.muted2, fontSize: 12, marginBottom: 14, fontStyle: 'italic' },
  clipCard: { backgroundColor: t.card, borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: t.cardBorder, flexDirection: 'row', alignItems: 'center', gap: 10 },
  tiedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12,
             backgroundColor: t.positiveSoft, borderRadius: 10, padding: 10,
             borderWidth: 1, borderColor: t.positive },
  tiedLabel: { color: t.positive, fontSize: 10.5, fontFamily: fonts[700],
               textTransform: 'uppercase', letterSpacing: 0.8 },
  tiedGame: { color: t.ink, fontSize: 13.5, fontFamily: fonts[600], marginTop: 1 },
  tiedUntie: { color: t.muted, fontSize: 12, fontFamily: fonts[700] },
  dateSearchBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.ctaBg,
                   borderRadius: 10, paddingHorizontal: 14, height: 44, justifyContent: 'center' },
  dateSearchText: { color: t.ctaText, fontSize: 13, fontFamily: fonts[700] },
  modalSub: { color: t.muted, fontSize: 12, marginBottom: 10, lineHeight: 17 },
  modalBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12,
             borderBottomWidth: 1, borderBottomColor: t.divider },
  linkRowText: { color: t.ink, fontSize: 14, fontFamily: fonts[600] },
  linkRowNote: { color: t.brown, fontSize: 11, marginTop: 2 },
  clipLabel: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  clipLabelMy: { backgroundColor: t.accentSoft },
  clipLabelOpp: { backgroundColor: t.negativeSoft },
  clipLabelBoth: { backgroundColor: t.chip },
  clipLabelText: { color: t.inkSoft, fontSize: 10, fontFamily: fonts[700] },
  clipAnalysis: { flex: 1, color: t.muted, fontSize: 11, lineHeight: 16 },
  textArea: { backgroundColor: t.card, borderRadius: 14, padding: 14, color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line, minHeight: 100, marginBottom: 16 },
  generateBtn: { backgroundColor: t.ctaBg, borderRadius: 999, padding: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  generateText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 15, marginLeft: 8 },
  hint: { color: t.muted2, fontSize: 12, textAlign: 'center', marginTop: 10 },
  reportBox: { backgroundColor: t.card, borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: t.cardBorder },
  actionRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 999, borderWidth: 1, borderColor: t.cta2Border },
  actionText: { color: t.cta2Text, fontFamily: fonts[700], fontSize: 12 },
  correctionSection: { backgroundColor: t.card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: t.cardBorder },
  correctionLabel: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 },
  correctionInput: { backgroundColor: t.chip, borderRadius: 14, padding: 12, color: t.ink, fontSize: 14, borderWidth: 1, borderColor: t.line, minHeight: 80, marginBottom: 12, textAlignVertical: 'top' },
  /**
   * A row of buttons that becomes a column when its labels stop fitting.
   *
   * Two equal halves of a phone screen is 166px each, and "Apply & Regenerate"
   * needs about 176 — so the label wrapped onto a second line and both pills
   * grew to 64px tall, which is what a broken button looks like. flexBasis is
   * the width each button asks for; when two of them plus the gap no longer fit,
   * they wrap to full width instead of squeezing. Measured, not guessed: 176
   * stacks at 390px and stays side by side from 430px up.
   */
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  btnInRow: { flexGrow: 1, flexBasis: 176, minWidth: 176 },
  correctionBtn: { backgroundColor: t.ctaBg, borderRadius: 999, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  correctionBtnText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 14 },
  // Modals
  modalOverlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  modalBox: { backgroundColor: t.sheet, borderRadius: 20, padding: 20, maxHeight: '88%', margin: 8, borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(REPORT_MODAL_WIDTH)},
  modalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  modalTitle: { color: t.ink, fontSize: 18, fontFamily: fonts[800], flex: 1 },
  searchInput: { backgroundColor: t.chip, borderRadius: 14, padding: 14, color: t.ink, fontSize: 15, borderWidth: 1, borderColor: t.line },
  searchResult: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: t.chip, marginBottom: 8 },
  searchAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' },
});
