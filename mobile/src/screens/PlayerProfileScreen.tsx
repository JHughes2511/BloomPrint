import React, { useEffect, useState, useRef } from 'react';
import VoiceTextInput from '../components/VoiceTextInput';
import KeyboardAwareScrollView from '../components/KeyboardAwareScrollView';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, Alert, KeyboardAvoidingView, Platform, TextInput, RefreshControl, useWindowDimensions } from 'react-native';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Video, ResizeMode } from 'expo-av';
import { playersAPI, teamsAPI, playerAPI, trainingAPI, staffSharingAPI, coachesAPI, gameEvalAPI, authedVideoSource } from '../api/client';
import { Player, Evaluation, Team } from '../types';
import { GradeBadge } from '../components/GradeBadge';
import { PillarCard } from '../components/PillarCard';
import { renderReport } from '../utils/renderReport';
import { buildReportHtml, buildPdfFileName } from '../utils/buildReportPdf';
import { splitReportSections, joinReportSections } from '../utils/mdToHtml';
import ShareModal from '../components/ShareModal';
import { outputTypeLabel } from '../utils/reportType';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { useBreakpoint } from '../responsive/useBreakpoint';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import PageContainer from '../responsive/PageContainer';
import { GeneratingOverlay } from '../components/GeneratingBasketball';

import { COMPETITION_LEVELS as CANON_LEVELS } from '../constants/levels';
import { sheetCap, desktopOnly, useSheetScrollHeight } from '../responsive/modalSizes';
import ActionGrid from '../responsive/ActionGrid';
const COMPETITION_LEVELS = [...CANON_LEVELS];

const OUTPUT_TYPES = [
  { key: 'player_eval', labelKey: 'reportTypes.player_eval' },
  { key: 'film_breakdown', labelKey: 'reportTypes.film_breakdown' },
  { key: 'scouting_report', labelKey: 'reportTypes.scouting_report' },
  { key: 'coaching_report', labelKey: 'reportTypes.coaching_report' },
  { key: 'recruitment_profile', labelKey: 'playerProfile.recruitmentShort' },
  { key: 'position_analysis', labelKey: 'reportTypes.position_analysis' },
  { key: 'box_score', labelKey: 'reportTypes.box_score' },
];

export default function PlayerProfileScreen() {
  // Tablet and up. Not Platform: a phone browser is web too, and gating the
  // desktop layout on platform put it on every phone that opened the site.
  const { isWide } = useBreakpoint();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { playerId } = route.params;
  const { t } = useTheme();
  const win = useWindowDimensions();
  // Definite height for a sheet body on web; ignored on native.
  const sheetBody = useSheetScrollHeight(420);
  const { t: tr } = useTranslation();
  const { coach } = useAuth();
  const styles = makeStyles(t);

  const scrollRef = useRef<ScrollView>(null);
  const trainingFeedbackY = useRef(0);
  const modalScrollRef = useRef<ScrollView>(null);
  const correctionInputY = useRef(0);

  const [player, setPlayer] = useState<Player | null>(null);
  const [evals, setEvals] = useState<Evaluation[]>([]);
  const [videos, setVideos] = useState<any[]>([]);
  const [videoSource, setVideoSource] = useState<{ uri: string; headers?: any } | null>(null);
  const [videoBox, setVideoBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [videoMeta, setVideoMeta] = useState<any | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [latestTraining, setLatestTraining] = useState<any | null>(null);
  const [allTraining, setAllTraining] = useState<any[]>([]);
  const [trainingModalItem, setTrainingModalItem] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingTraining, setSendingTraining] = useState(false);
  // Training picker for send flows
  const [showTrainingPicker, setShowTrainingPicker] = useState(false);
  const [trainingPickerAction, setTrainingPickerAction] = useState<'player' | 'staff' | 'regen' | null>(null);

  // Edit state
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPos, setEditPos] = useState('');
  const [editJersey, setEditJersey] = useState('');
  const [editHeight, setEditHeight] = useState('');
  const [editWingspan, setEditWingspan] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editStandingReach, setEditStandingReach] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [editState, setEditState] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editSchool, setEditSchool] = useState('');
  const [editLevel, setEditLevel] = useState('');
  const [editTeamId, setEditTeamId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [showLevelPicker, setShowLevelPicker] = useState(false);
  const [showTeamPicker, setShowTeamPicker] = useState(false);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);

  // Game history state
  const [gameHistory, setGameHistory] = useState<any[]>([]);
  const [gameHistoryLoading, setGameHistoryLoading] = useState(false);
  const [expandedGame, setExpandedGame] = useState<number | null>(null);

  // Summary state
  const [showSummary, setShowSummary] = useState(false);
  const [summaryType, setSummaryType] = useState('player_eval');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [selectedGameIds, setSelectedGameIds] = useState<number[]>([]);
  const [sumSeasonYear, setSumSeasonYear] = useState<string>('all');
  const [sumSeasonPhase, setSumSeasonPhase] = useState<string>('all');

  const loadAll = React.useCallback(() =>
    Promise.all([
      playersAPI.get(playerId),
      playersAPI.evaluations(playerId),
      teamsAPI.list(),
      trainingAPI.forPlayer(playerId).catch(() => []),
      playersAPI.videos(playerId).catch(() => []),
    ])
      .then(([p, e, t, tr, vids]) => {
        setPlayer(p);
        setEvals(e);
        setTeams(t);
        setVideos(Array.isArray(vids) ? vids : []);
        if (Array.isArray(tr) && tr.length > 0) {
          setLatestTraining(tr[tr.length - 1]);
          setAllTraining(tr);
        }
        // Load game history by player name once we have the player
        if (p?.name) {
          setGameHistoryLoading(true);
          gameEvalAPI.playerGameHistory(p.name)
            .then(setGameHistory)
            .catch(() => {})
            .finally(() => setGameHistoryLoading(false));
        }
      }), [playerId]);

  // Reload whenever the screen regains focus so newly created evals (and their
  // green/watch flags + BIM composite) show without a manual pull-to-refresh.
  useFocusEffect(
    React.useCallback(() => { loadAll().finally(() => setLoading(false)); }, [loadAll]),
  );

  const [refreshingProfile, setRefreshingProfile] = useState(false);
  const onRefreshProfile = React.useCallback(() => {
    setRefreshingProfile(true);
    loadAll().finally(() => setRefreshingProfile(false));
  }, [loadAll]);

  const openEdit = () => {
    if (!player) return;
    setEditName(player.name);
    setEditPos(player.position ?? '');
    setEditJersey((player as any).jersey_number ?? '');
    setEditHeight((player as any).height ?? '');
    setEditWingspan((player as any).wingspan ?? '');
    setEditWeight((player as any).weight ?? '');
    setEditStandingReach((player as any).standing_reach ?? '');
    setEditCountry((player as any).country ?? '');
    setEditState((player as any).state ?? '');
    setEditCity((player as any).city ?? '');
    setEditSchool((player as any).school_name ?? '');
    setEditLevel(player.competition_level ?? (coach as any)?.competition_level ?? 'HS Varsity');
    setEditTeamId(player.team_id ?? null);
    setShowEdit(true);
  };

  const saveEdit = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const updated = await playersAPI.update(playerId, {
        name: editName.trim(),
        position: editPos.trim() || undefined,
        jersey_number: editJersey.trim() || undefined,
        height: editHeight.trim() || undefined,
        wingspan: editWingspan.trim() || undefined,
        weight: editWeight.trim() || undefined,
        standing_reach: editStandingReach.trim() || undefined,
        country: editCountry.trim() || undefined,
        state: editState.trim() || undefined,
        city: editCity.trim() || undefined,
        school_name: editSchool.trim() || undefined,
        competition_level: editLevel,
        team_id: editTeamId ?? 0,
      });
      setPlayer(updated);
      setShowEdit(false);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerProfile.couldNotSaveChanges'));
    } finally {
      setSaving(false);
    }
  };

  const generateSummary = async () => {
    if (!player) return;
    setSummaryLoading(true);
    try {
      const wantsBox = summaryType.split(',').includes('box_score');
      const result = await playersAPI.summary(playerId, {
        output_type: summaryType,
        game_ids: wantsBox && selectedGameIds.length ? selectedGameIds : undefined,
      });
      setShowSummary(false);
      const typeLabel = outputTypeLabel(summaryType);
      const sanitize = (s: string) => (s ?? '').replace(/[^a-zA-Z0-9 \-]/g, '').trim();
      navigation.navigate('Summary', {
        title: tr('playerProfile.summaryTitle', { name: player.name, type: typeLabel }),
        reportText: result.report_text,
        fileName: [
          tr('playerProfile.playerSummaryFileName'),
          sanitize(player.name),
          sanitize(player.team_name ?? player.program_name),
          sanitize(player.position ?? ''),
          typeLabel,
        ].filter(Boolean).join(' - '),
      });
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? e?.message ?? tr('playerProfile.couldNotGenerateSummary');
      Alert.alert(tr('common.error'), String(msg));
    } finally {
      setSummaryLoading(false);
    }
  };

  const [showProfileDetail, setShowProfileDetail] = useState(false);

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [showInviteQR, setShowInviteQR] = useState(false);
  const [generatingInvite, setGeneratingInvite] = useState(false);

  // Training regenerate state (main profile section)
  const [trainingFeedback, setTrainingFeedback] = useState('');
  const [regeneratingTraining, setRegeneratingTraining] = useState(false);

  // Training modal corrections + print/export
  const [modalCorrection, setModalCorrection] = useState('');
  const [regeneratingModal, setRegeneratingModal] = useState(false);
  const [savingModalCorrection, setSavingModalCorrection] = useState(false);
  const [modalCorrections, setModalCorrections] = useState<any[]>([]);
  const [exportingTraining, setExportingTraining] = useState(false);

  const loadModalCorrections = (id?: number) => {
    if (!id) { setModalCorrections([]); return; }
    trainingAPI.corrections(id).then(setModalCorrections).catch(() => setModalCorrections([]));
  };
  useEffect(() => { loadModalCorrections(trainingModalItem?.id); }, [trainingModalItem?.id]);

  const openVideo = async (v: any) => {
    try {
      const src = await authedVideoSource(v.stream_url);
      setVideoMeta(v);
      setVideoSource(src);
    } catch {
      Alert.alert(tr('common.error'), tr('playerProfile.couldNotOpenVideo'));
    }
  };

  const deleteVideo = (v: any) => {
    Alert.alert(tr('playerProfile.deleteFilmTitle'), tr('playerProfile.deleteFilmMsg'), [
      { text: tr('common.cancel'), style: 'cancel' },
      {
        text: tr('common.delete'), style: 'destructive',
        onPress: async () => {
          try {
            await playersAPI.deleteVideo(v.id);
            setVideos(prev => prev.filter((x: any) => x.id !== v.id));
          } catch (e: any) {
            Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerProfile.couldNotDeleteFilm'));
          }
        },
      },
    ]);
  };

  const saveModalCorrectionForLater = async () => {
    if (!modalCorrection.trim() || !trainingModalItem) return;
    setSavingModalCorrection(true);
    try {
      await trainingAPI.addCorrection(trainingModalItem.id, modalCorrection.trim());
      setModalCorrection('');
      loadModalCorrections(trainingModalItem.id);
      Alert.alert(tr('playerProfile.savedTitle'), tr('playerProfile.correctionSavedMsg'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerProfile.couldNotSaveCorrection'));
    } finally {
      setSavingModalCorrection(false);
    }
  };

  // Player-facing version (once sent) — comments thread + feedback update
  const [playerComments, setPlayerComments] = useState<any[]>([]);
  const [playerCommentText, setPlayerCommentText] = useState('');
  const [sendingPlayerComment, setSendingPlayerComment] = useState(false);
  const [playerFeedbackText, setPlayerFeedbackText] = useState('');
  const [updatingPlayerProgram, setUpdatingPlayerProgram] = useState(false);

  useEffect(() => {
    if (trainingModalItem?.sent_to_player) {
      trainingAPI.comments(trainingModalItem.id).then(setPlayerComments).catch(() => setPlayerComments([]));
    } else {
      setPlayerComments([]);
    }
  }, [trainingModalItem?.id, trainingModalItem?.sent_to_player]);

  const sendPlayerComment = async () => {
    if (!playerCommentText.trim() || !trainingModalItem) return;
    setSendingPlayerComment(true);
    try {
      const c = await trainingAPI.addComment(trainingModalItem.id, playerCommentText.trim());
      setPlayerComments(prev => [...prev, c]);
      setPlayerCommentText('');
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerProfile.couldNotSendComment'));
    } finally {
      setSendingPlayerComment(false);
    }
  };

  const updatePlayerProgram = async () => {
    if (!playerFeedbackText.trim() || !trainingModalItem) return;
    setUpdatingPlayerProgram(true);
    try {
      const updated = await trainingAPI.refreshPlayerProgram(trainingModalItem.id, playerFeedbackText.trim());
      setTrainingModalItem((prev: any) => prev ? { ...prev, ...updated } : prev);
      setPlayerFeedbackText('');
      Alert.alert(tr('playerProfile.updatedTitle'), tr('playerProfile.playerProgramUpdatedMsg'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerProfile.couldNotUpdatePlayerProgram'));
    } finally {
      setUpdatingPlayerProgram(false);
    }
  };

  // Unified share modal (player / team / staff)
  const [shareCtx, setShareCtx] = useState<{ reportType: string; reportId: number; outputType: string; reportText: string; title: string } | null>(null);

  // Share with staff
  const [showStaffShare, setShowStaffShare] = useState(false);
  const [staffShareType, setStaffShareType] = useState<'training' | null>(null);
  const [staffShareId, setStaffShareId] = useState<number | null>(null);
  const [staffShareText, setStaffShareText] = useState<string>('');
  const [staffSectionToggles, setStaffSectionToggles] = useState<Record<string, boolean>>({});
  const [staffSearch, setStaffSearch] = useState('');
  const [staffResults, setStaffResults] = useState<any[]>([]);
  const [staffSearchLoading, setStaffSearchLoading] = useState(false);
  const [allowRegen, setAllowRegen] = useState(false);
  const [sendingStaff, setSendingStaff] = useState(false);

  const createTeamFromEdit = async () => {
    if (!newTeamName.trim()) return;
    setCreatingTeam(true);
    try {
      const team = await teamsAPI.create({ name: newTeamName.trim(), competition_level: editLevel });
      setTeams(prev => [...prev, team]);
      setEditTeamId(team.id);
      setNewTeamName('');
      setShowCreateTeam(false);
      setShowTeamPicker(false);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerProfile.couldNotCreateTeam'));
    } finally {
      setCreatingTeam(false);
    }
  };

  const openTrainingPicker = (action: 'player' | 'staff' | 'regen') => {
    if (allTraining.length === 0) {
      Alert.alert(tr('playerProfile.noTrainingTitle'), tr('playerProfile.noTrainingMsg'));
      return;
    }
    setTrainingPickerAction(action);
    setShowTrainingPicker(true);
  };

  const sendTrainingToPlayer = async (trainingId?: number) => {
    const id = trainingId ?? latestTraining?.id;
    if (!id) {
      Alert.alert(tr('playerProfile.noTrainingTitle'), tr('playerProfile.noTrainingMsg'));
      return;
    }
    setSendingTraining(true);
    try {
      const result = await trainingAPI.sendToPlayer(id);
      setAllTraining(prev => prev.map(s => s.id === id ? { ...s, sent_to_player: true, reformatting: true } : s));
      Alert.alert(tr('playerProfile.sentTitle'), tr('playerProfile.trainingSentMsg', { name: result.player_name ?? tr('playerProfile.thePlayer') }));
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? tr('playerProfile.couldNotSendTraining');
      if (msg.includes('not linked')) {
        Alert.alert(tr('playerProfile.notLinkedTitle'), tr('playerProfile.notLinkedMsg'));
      } else {
        Alert.alert(tr('common.error'), msg);
      }
    } finally {
      setSendingTraining(false);
    }
  };

  // NOTE: the backend regenerates from the player's latest program + feedback;
  // the picker's selected training id is accepted but not used by the API yet.
  const regenerateTraining = async (_trainingId?: number) => {
    if (!trainingFeedback.trim()) return;
    setRegeneratingTraining(true);
    try {
      const newSession = await trainingAPI.regenerate(player!.id, trainingFeedback.trim());
      setTrainingFeedback('');
      // Refresh the full training list so the new entry appears in the Training Programs section
      const updated = await trainingAPI.forPlayer(player!.id).catch(() => null);
      if (updated && Array.isArray(updated) && updated.length > 0) {
        setAllTraining(updated);
        setLatestTraining(updated[updated.length - 1]);
      } else if (newSession) {
        setAllTraining(prev => [...prev, newSession]);
        setLatestTraining(newSession);
      }
      Alert.alert(tr('playerProfile.trainingUpdatedTitle'), tr('playerProfile.trainingUpdatedMsg'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerProfile.couldNotRegenerateTraining'));
    } finally {
      setRegeneratingTraining(false);
    }
  };

  const regenerateTrainingFromModal = async () => {
    if (!trainingModalItem) return;
    const pending = modalCorrection.trim();
    if (!pending && modalCorrections.filter(c => !c.applied).length === 0) {
      Alert.alert(tr('playerProfile.nothingToApplyTitle'), tr('playerProfile.nothingToApplyMsg'));
      return;
    }
    setRegeneratingModal(true);
    try {
      if (pending) await trainingAPI.addCorrection(trainingModalItem.id, pending);
      // Regenerate this program in place from all un-applied corrections.
      const updated = await trainingAPI.applyCorrections(trainingModalItem.id);
      setModalCorrection('');
      setTrainingModalItem((prev: any) => prev ? { ...prev, ...updated } : prev);
      loadModalCorrections(trainingModalItem.id);
      // reflect the update in the training lists
      const refreshed = await trainingAPI.forPlayer(playerId).catch(() => [] as any[]);
      if (Array.isArray(refreshed) && refreshed.length > 0) {
        setAllTraining(refreshed);
        setLatestTraining(refreshed[refreshed.length - 1]);
      }
      Alert.alert(tr('playerProfile.regeneratedTitle'), tr('playerProfile.regeneratedMsg'));
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerProfile.couldNotRegenerateTraining'));
    } finally {
      setRegeneratingModal(false);
    }
  };

  const printTraining = async () => {
    if (!trainingModalItem?.program_text) return;
    const html = buildReportHtml({
      title: tr('reportTypes.training_program'),
      subject: player?.name ?? '',
      date: new Date(trainingModalItem.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      body: trainingModalItem.program_text,
    });
    try { await Print.printAsync({ html }); } catch {}
  };

  const exportTraining = async () => {
    if (!trainingModalItem?.program_text) return;
    setExportingTraining(true);
    try {
      const reportDate = new Date(trainingModalItem.created_at);
      const html = buildReportHtml({
        title: tr('reportTypes.training_program'),
        subject: player?.name ?? '',
        date: reportDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        body: trainingModalItem.program_text,
      });
      const fileName = buildPdfFileName(tr('reportTypes.training_program'), player?.name ?? 'Player', reportDate);
      const { uri } = await Print.printToFileAsync({ html });
      // Copy to a properly-named file so the export keeps the standard convention.
      const dest = FileSystem.cacheDirectory + fileName + '.pdf';
      await FileSystem.copyAsync({ from: uri, to: dest });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: fileName });
      }
    } catch {
      Alert.alert(tr('common.error'), tr('playerProfile.couldNotExportTraining'));
    } finally {
      setExportingTraining(false);
    }
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
    if (!staffShareId) return;
    setSendingStaff(true);
    try {
      const staffSections = splitReportSections(staffShareText);
      const frozenText = !allowRegen && staffSections.length > 1
        ? (joinReportSections(staffSections, staffSectionToggles) || staffShareText || undefined)
        : undefined;
      await staffSharingAPI.share({
        report_type: 'training',
        report_id: staffShareId,
        recipient_id: target.id,
        allow_regenerate: allowRegen,
        frozen_text: frozenText,
      });
      Alert.alert(tr('playerProfile.sharedTitle'), tr('playerProfile.sharedWithMsg', { name: target.name }));
      setShowStaffShare(false);
      setStaffSearch('');
      setStaffResults([]);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerProfile.couldNotShare'));
    } finally {
      setSendingStaff(false);
    }
  };

  const copyInviteCode = async () => {
    if (!inviteCode) return;
    await Clipboard.setStringAsync(inviteCode);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 1800);
  };

  const generateInvite = async () => {
    setGeneratingInvite(true);
    setShowInviteQR(false);
    setInviteCopied(false);
    try {
      const result = await playerAPI.generateInvite(player!.id);
      setInviteCode(result.code);
    } catch (e: any) {
      Alert.alert(tr('common.error'), e?.response?.data?.detail ?? tr('playerProfile.couldNotGenerateInvite'));
    } finally {
      setGeneratingInvite(false);
    }
  };

  if (loading) return <ScreenBackground><View style={styles.center}><ActivityIndicator color={t.accent} size="large" /></View></ScreenBackground>;
  if (!player) return null;

  const latest = evals[evals.length - 1] ?? null;
  // Flags come from the most recent eval that actually HAS flags — a newer eval
  // that didn't emit any shouldn't blank out the section.
  const flagSource = [...evals].reverse().find(
    (e: any) => (e.green_flags?.length ?? 0) > 0 || (e.watch_flags?.length ?? 0) > 0,
  ) ?? latest;

  return (
    <ScreenBackground>
    <PageContainer>
    <KeyboardAwareScrollView ref={scrollRef} style={styles.container} contentContainerStyle={{ paddingBottom: 100 }}
      refreshControl={<RefreshControl refreshing={refreshingProfile} onRefresh={onRefreshProfile} tintColor={t.accent} />}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color={t.ink} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerCenter} onPress={() => setShowProfileDetail(true)} activeOpacity={0.75}>
          <Text style={styles.name}>{(player as any).jersey_number ? `#${(player as any).jersey_number} ` : ''}{player.name}</Text>
          <Text style={styles.meta}>{[player.position, player.team_name ?? player.competition_level].filter(Boolean).join(' · ')}</Text>
          <Text style={{ color: t.muted, fontSize: 10, marginTop: 1 }}>tap to view profile</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={openEdit} style={styles.editBtn}>
          <Ionicons name="create-outline" size={20} color={t.muted} />
        </TouchableOpacity>
        <GradeBadge grade={(player as any).bim_grade ?? player.latest_grade} size="lg" />
      </View>

      {/* BIM composite pillar grades — recency-weighted across all reports */}
      {(() => {
        const composite = (player as any).bim_pillars as Record<string, number> | null | undefined;
        const count = (player as any).bim_report_count ?? 0;
        const pillars = composite && Object.keys(composite).length > 0
          ? composite
          : (latest?.pillar_grades ?? null);
        if (!pillars || Object.keys(pillars).length === 0) return null;
        return (
          <View style={styles.section}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.sectionTitle}>{tr('playerProfile.bimScore')}</Text>
              {count > 0 && (
                <Text style={{ color: t.muted2, fontSize: 11 }}>
                  {count === 1 ? tr('playerProfile.fromOneReport') : tr('playerProfile.compositeOfReports', { count })}
                </Text>
              )}
            </View>
            {Object.entries(pillars).map(([key, grade]) => (
              <PillarCard key={key} pillarKey={key} grade={grade as number} />
            ))}
          </View>
        );
      })()}

      {/* Flags */}
      {flagSource && (
        <View style={styles.row}>
          {flagSource.green_flags && flagSource.green_flags.length > 0 && (
            <View style={[styles.flagBox, { borderColor: t.positive }]}>
              <Text style={[styles.flagTitle, { color: t.positive }]}>{tr('playerProfile.greenFlags')}</Text>
              {flagSource.green_flags.map((f, i) => <Text key={i} style={styles.flagItem}>· {f}</Text>)}
            </View>
          )}
          {flagSource.watch_flags && flagSource.watch_flags.length > 0 && (
            <View style={[styles.flagBox, { borderColor: t.negative }]}>
              <Text style={[styles.flagTitle, { color: t.negative }]}>{tr('playerProfile.watchFlags')}</Text>
              {flagSource.watch_flags.map((f, i) => <Text key={i} style={styles.flagItem}>· {f}</Text>)}
            </View>
          )}
        </View>
      )}

      {/* Eval history */}
      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>{tr('playerProfile.evaluationHistory')}</Text>
          <TouchableOpacity
            style={styles.newEvalBtn}
            onPress={() => navigation.navigate('NewEval', { playerId: player.id, playerName: player.name })}
          >
            <Ionicons name="videocam" size={14} color={t.ctaText} />
            <Text style={styles.newEvalText}>{tr('playerProfile.newEval')}</Text>
          </TouchableOpacity>
        </View>

        {evals.length === 0 && <Text style={styles.emptyText}>{tr('playerProfile.noEvalsYet')}</Text>}
        {[...evals].reverse().map(ev => (
          <TouchableOpacity
            key={ev.id}
            style={styles.evalCard}
            onPress={() => navigation.navigate('EvalReport', { evalId: ev.id })}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.evalType}>{ev.output_type.replace(/_/g, ' ').toUpperCase()}</Text>
              <Text style={styles.evalDate}>{new Date(ev.created_at).toLocaleDateString()}</Text>
            </View>
            <GradeBadge grade={ev.overall_grade} size="sm" />
          </TouchableOpacity>
        ))}
      </View>

      {/* Training Programs History */}
      {allTraining.length > 0 && (
        <View style={[styles.section, { marginTop: 20 }]}>
          <Text style={styles.sectionTitle}>{tr('playerProfile.trainingPrograms')}</Text>
          {[...allTraining].reverse().map((ts: any) => (
            <TouchableOpacity
              key={ts.id}
              style={styles.evalCard}
              onPress={() => setTrainingModalItem(ts)}
            >
              <View style={{ flex: 1 }}>
                {/* Subject first: three programs for the same player were
                    previously distinguishable only by date, and the preview
                    line underneath was whatever the text opened with — usually
                    the literal word "BRIEF:". */}
                <Text style={styles.evalType} numberOfLines={1}>
                  {ts.title || tr('reportTypes.training_program')}
                </Text>
                <Text style={styles.evalDate}>
                  {ts.title
                    ? `${tr('reportTypes.training_program')} · ${new Date(ts.created_at).toLocaleDateString()}`
                    : new Date(ts.created_at).toLocaleDateString()}
                </Text>
                {ts.program_text ? (
                  <Text style={{ color: t.muted, fontSize: 11, marginTop: 4 }} numberOfLines={2}>
                    {ts.program_text
                      .replace(/\*\*/g, '')
                      // Drop leading section headers so the preview shows content
                      .replace(/^\s*(?:#{1,6}\s*)?[A-Z][A-Z /&'()-]{2,}:?\s*/m, '')
                      .trim()
                      .slice(0, 120)}
                  </Text>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={16} color={t.line} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Web pairs these into a 2x2; native keeps the stack it always had. */}
      <ActionGrid>
      {/* Summarize history */}
      {evals.length > 0 && (
        <TouchableOpacity style={styles.summaryBtn} onPress={() => setShowSummary(true)}>
          <Ionicons name="bar-chart" size={18} color={t.ctaText} />
          <Text style={styles.summaryText}>{tr('playerProfile.summarizeHistory')}</Text>
        </TouchableOpacity>
      )}

      {/* Training */}
      <TouchableOpacity
        style={styles.trainingBtn}
        onPress={() => navigation.navigate('Training', { playerId: player.id, evalId: latest?.id })}
      >
        <Ionicons name="barbell" size={18} color={t.ink} />
        <Text style={styles.trainingText}>{tr('playerProfile.generateTraining')}</Text>
      </TouchableOpacity>

      {/* Send training to player */}
      <TouchableOpacity
        style={[styles.trainingBtn, { backgroundColor: t.positive, marginTop: 8 }, desktopOnly({ marginTop: 0 })]}
        onPress={() => openTrainingPicker('player')}
        disabled={sendingTraining}
      >
        {sendingTraining
          ? <ActivityIndicator color={t.ctaText} size="small" />
          : <><Ionicons name="paper-plane" size={18} color={t.ink} /><Text style={styles.trainingText}>{tr('playerProfile.sendTrainingToPlayer')}</Text></>}
      </TouchableOpacity>

      {/* Share training with staff */}
      {allTraining.length > 0 && (
        <TouchableOpacity
          style={[styles.trainingBtn, { backgroundColor: t.accent, marginTop: 8 }, desktopOnly({ marginTop: 0 })]}
          onPress={() => openTrainingPicker('staff')}
        >
          <Ionicons name="people-outline" size={18} color={t.ink} />
          <Text style={styles.trainingText}>{tr('playerProfile.shareTrainingWithStaff')}</Text>
        </TouchableOpacity>
      )}
      </ActionGrid>

      {/* Training feedback / regenerate */}
      <View
        style={styles.trainingFeedbackBox}
        onLayout={e => { trainingFeedbackY.current = e.nativeEvent.layout.y; }}
      >
        <Text style={styles.trainingFeedbackLabel}>{tr('playerProfile.regenTrainingFeedback')}</Text>
        <VoiceTextInput
          style={styles.trainingFeedbackInput}
          placeholder="e.g. Focus more on 3-point shooting and off-ball movement..."
          placeholderTextColor={t.muted2}
          value={trainingFeedback}
          onChangeText={setTrainingFeedback}
          multiline
          textAlignVertical="top"

        />
        <TouchableOpacity
          style={[styles.regenBtn, (!trainingFeedback.trim() || regeneratingTraining) && { opacity: 0.5 }]}
          onPress={() => {
            if (!trainingFeedback.trim()) return;
            if (allTraining.length > 1) {
              openTrainingPicker('regen');
            } else {
              regenerateTraining();
            }
          }}
          disabled={!trainingFeedback.trim() || regeneratingTraining}
        >
          {regeneratingTraining
            ? <ActivityIndicator color={t.ctaText} size="small" />
            : <><Ionicons name="refresh" size={16} color={t.ctaText} /><Text style={styles.regenBtnText}> {tr('playerProfile.regenerate')}</Text></>}
        </TouchableOpacity>
      </View>

      {/* Invite Code */}
      <TouchableOpacity style={styles.inviteBtn} onPress={generateInvite} disabled={generatingInvite}>
        {generatingInvite
          ? <ActivityIndicator color={t.ctaText} size="small" />
          : <Ionicons name="link" size={18} color={t.ink} />}
        <Text style={styles.inviteText}>{tr('playerProfile.generateInviteCode')}</Text>
      </TouchableOpacity>

      {inviteCode && (
        <View style={styles.inviteCodeBox}>
          <Text style={styles.inviteCodeLabel}>{tr('playerProfile.inviteCodeLabel')}</Text>
          <TouchableOpacity onPress={copyInviteCode} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={styles.inviteCode}>{inviteCode}</Text>
            <Ionicons name={inviteCopied ? 'checkmark-circle' : 'copy-outline'} size={22} color={inviteCopied ? t.positive : t.accent} />
          </TouchableOpacity>
          <Text style={styles.inviteCodeHint}>{inviteCopied ? 'Copied to clipboard!' : 'Tap the code to copy it'}</Text>

          <TouchableOpacity
            onPress={() => setShowInviteQR(v => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, borderWidth: 1, borderColor: t.cta2Border, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 }}
          >
            <Ionicons name="qr-code-outline" size={16} color={t.cta2Text} />
            <Text style={{ color: t.cta2Text, fontFamily: fonts[700], fontSize: 13 }}>{showInviteQR ? 'Hide QR Code' : 'Show QR Code'}</Text>
          </TouchableOpacity>

          {showInviteQR && (
            <View style={{ marginTop: 14, padding: 16, backgroundColor: '#FFFFFF', borderRadius: 16 }}>
              {/* Fixed white background so the QR scans in either theme */}
              <QRCode value={inviteCode} size={180} backgroundColor="#FFFFFF" color="#111111" />
            </View>
          )}
        </View>
      )}

      {/* Game History */}
      <View style={[styles.section, { marginTop: 8 }]}>
        <Text style={styles.sectionTitle}>{tr('playerProfile.gameHistory')}</Text>
        {gameHistoryLoading && <ActivityIndicator color={t.accent} style={{ marginVertical: 12 }} />}
        {!gameHistoryLoading && gameHistory.length === 0 && (
          <Text style={{ color: t.muted2, fontSize: 13, textAlign: 'center', paddingVertical: 12 }}>
            No game stats recorded for this player yet.
          </Text>
        )}
        {gameHistory.map((game: any) => {
          const isExpanded = expandedGame === game.game_id;
          const won = game.our_score != null && game.our_score > game.opponent_score;
          const lost = game.our_score != null && game.our_score < game.opponent_score;
          const counts: Record<string, number> = {};
          for (const [statName, data] of Object.entries(game.stat_breakdown as Record<string, any>)) {
            counts[statName] = data.count;
          }
          const pts = (counts['2 FG Made'] || 0) * 2 + (counts['3 FG Made'] || 0) * 3 + (counts['FT Made'] || 0);
          const reb = (counts['Off. Reb'] || 0) + (counts['Def. Reb'] || 0);
          const ast = counts['Assists'] || 0;
          const stl = counts['Steal'] || 0;
          const blk = counts['Blocked Shot'] || 0;
          const to = counts['Turnover'] || 0;
          const fgm = (counts['2 FG Made'] || 0) + (counts['3 FG Made'] || 0);
          const fga = fgm + (counts['2 FG Missed'] || 0) + (counts['3 FG Missed'] || 0);
          return (
            <TouchableOpacity
              key={game.game_id}
              style={{ backgroundColor: t.card, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: t.chip }}
              onPress={() => setExpandedGame(isExpanded ? null : game.game_id)}
              activeOpacity={0.8}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink, fontFamily: fonts[700], fontSize: 14 }}>vs {game.opponent_name}</Text>
                  <Text style={{ color: t.muted, fontSize: 11, marginTop: 2 }}>
                    {game.date}{game.season_phase ? ` · ${game.season_phase}` : ''}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {game.our_score != null && (
                    <View style={{ backgroundColor: won ? t.positiveSoft : lost ? t.negativeSoft : t.chip, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: won ? t.positive : lost ? t.negative : t.muted, fontSize: 11, fontFamily: fonts[700] }}>
                        {won ? 'W' : lost ? 'L' : 'T'} {game.our_score}-{game.opponent_score}
                      </Text>
                    </View>
                  )}
                  <View style={{ backgroundColor: t.accentSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: t.accent }}>
                    <Text style={{ color: t.accent, fontSize: 12, fontFamily: fonts[800] }}>{game.game_grade.toFixed(2)}</Text>
                  </View>
                  <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={t.muted2} />
                </View>
              </View>
              {isExpanded && (
                <View style={{ marginTop: 12 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: t.chip }}>
                    {[['PTS', pts], ['REB', reb], ['AST', ast], ['STL', stl], ['BLK', blk], ['TO', to], ['FG', fga > 0 ? `${fgm}/${fga}` : '—']].map(([label, val]) => (
                      <View key={label as string} style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ color: t.muted, fontSize: 10, fontFamily: fonts[700] }}>{label}</Text>
                        <Text style={{ color: t.ink, fontSize: 14, fontFamily: fonts[900] }}>{val}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={{ color: t.muted2, fontSize: 10, fontFamily: fonts[700], letterSpacing: 1, marginBottom: 6 }}>{tr('playerProfile.gradingStats')}</Text>
                  <View style={{ gap: 3 }}>
                    {Object.entries(game.stat_breakdown as Record<string, any>).map(([statName, data]: [string, any]) => (
                      <View key={statName} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ color: t.muted, fontSize: 12 }}>{statName}{data.count > 1 ? ` ×${data.count}` : ''}</Text>
                        <Text style={{ color: data.weighted_points >= 0 ? t.positive : t.negative, fontSize: 12, fontFamily: fonts[600] }}>
                          {data.weighted_points >= 0 ? '+' : ''}{data.weighted_points.toFixed(1)}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: t.chip, flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: t.muted, fontSize: 12 }}>OFF {game.offensive_weighted.toFixed(1)} · DEF {game.defensive_weighted.toFixed(1)} · {game.minutes.toFixed(0)}min</Text>
                  </View>
                  {Object.keys(game.per_quarter).length > 0 && (
                    <View style={{ marginTop: 10 }}>
                      <Text style={{ color: t.muted2, fontSize: 10, fontFamily: fonts[700], letterSpacing: 1, marginBottom: 6 }}>{tr('playerProfile.perQuarter')}</Text>
                      {Object.entries(game.per_quarter as Record<string, any>).sort(([a], [b]) => Number(a) - Number(b)).map(([q, data]: [string, any]) => (
                        <View key={q} style={{ flexDirection: 'row', gap: 12, marginBottom: 3 }}>
                          <Text style={{ color: t.muted, fontSize: 11, width: 28 }}>{Number(q) === 5 ? 'OT' : `Q${q}`}</Text>
                          <Text style={{ color: t.muted, fontSize: 11 }}>OFF {data.offense.toFixed(1)} · DEF {data.defense.toFixed(1)}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Film Catalog — every video used to build a report for this player */}
      <View style={[styles.section, { marginTop: 8 }]}>
        <Text style={styles.sectionTitle}>{tr('playerProfile.filmCatalog')}</Text>
        {videos.length === 0 ? (
          <Text style={{ color: t.muted2, fontSize: 13, textAlign: 'center', paddingVertical: 12 }}>
            No film uploaded for this player yet.
          </Text>
        ) : (
          videos.map((v: any) => (
            <View key={v.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.chip }}>
              <TouchableOpacity onPress={() => openVideo(v)} style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="play" size={20} color={t.accent} />
              </TouchableOpacity>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: t.ink, fontSize: 14, fontFamily: fonts[700] }} numberOfLines={1}>
                  {v.report_label || v.label || 'Film'}
                </Text>
                <Text style={{ color: t.muted2, fontSize: 11, marginTop: 2 }}>
                  {v.created_at ? new Date(v.created_at).toLocaleDateString() : ''}
                </Text>
              </View>
              {v.source_kind === 'eval' && v.source_id && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: t.line }}
                  onPress={() => navigation.navigate('EvalReport' as never, { evalId: v.source_id } as never)}
                >
                  <Ionicons name="document-text-outline" size={13} color={t.muted} />
                  <Text style={{ color: t.muted, fontSize: 11, fontFamily: fonts[600] }}>{tr('reportTypes.report')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => deleteVideo(v)} style={{ padding: 6 }}>
                <Ionicons name="trash-outline" size={16} color={t.negative} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      {/* Video player modal */}
      <Modal visible={!!videoSource} transparent animationType="fade" onRequestClose={() => setVideoSource(null)}>
        <View style={{ flex: 1, backgroundColor: '#000000EE', ...(isWide ? null : { justifyContent: 'center' as const }) }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 48 }}>
            <Text style={{ color: '#fff', fontSize: 15, fontFamily: fonts[700], flex: 1 }} numberOfLines={1}>
              {videoMeta?.report_label || 'Film'}
            </Text>
            <TouchableOpacity onPress={() => setVideoSource(null)}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
          </View>
          {videoSource && (
            // Fills the space between the header and the bottom of the sheet
            // rather than a fixed 260px strip. That height was chosen for a
            // phone; on a desktop it left film playing in a band across the
            // top of an otherwise black screen. CONTAIN means letterboxing,
            // not cropping, so no aspect ratio gets cut off.
            // Measured, then passed in pixels: on web expo-av renders a real
            // <video>, and a percentage height there has no containing block to
            // resolve against, so it falls back to the file's intrinsic size and
            // sits at 360x180 in the corner of a full-screen black sheet.
            <View
              style={Platform.OS === 'web'
                ? { flex: 1, paddingHorizontal: 24, paddingBottom: 32, alignItems: 'center', justifyContent: 'center' }
                : undefined}
            >
              <Video
                source={videoSource as any}
                style={Platform.OS === 'web'
                  ? { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' }
                  : { width: '100%', height: 260, backgroundColor: '#000' }}
                useNativeControls
                resizeMode={ResizeMode.CONTAIN}
                shouldPlay
              />
            </View>
          )}
        </View>
      </Modal>

      {/* Training picker modal — choose which training to send */}
      <Modal visible={showTrainingPicker} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(560) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: t.chip }}>
              <Text style={{ color: t.ink, fontSize: 15, fontFamily: fonts[800] }}>
                {trainingPickerAction === 'player' ? 'Send Training to Player' :
                 trainingPickerAction === 'regen' ? 'Choose Training to Regenerate' :
                 'Share Training with Staff'}
              </Text>
              <TouchableOpacity onPress={() => setShowTrainingPicker(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: t.muted, fontSize: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 }}>
              {trainingPickerAction === 'regen'
                ? 'Select which training program to regenerate with your feedback:'
                : 'Select which training program to send:'}
            </Text>
            <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
              {[...allTraining].reverse().map((ts: any, idx: number) => (
                <TouchableOpacity
                  key={ts.id}
                  style={{ backgroundColor: t.chip, borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: t.line }}
                  onPress={() => {
                    setShowTrainingPicker(false);
                    if (trainingPickerAction === 'player') {
                      sendTrainingToPlayer(ts.id);
                    } else if (trainingPickerAction === 'regen') {
                      regenerateTraining(ts.id);
                    } else {
                      setShareCtx({
                        reportType: 'training',
                        reportId: ts.id,
                        outputType: 'training_program',
                        reportText: ts.program_text ?? '',
                        title: ts.title || 'Training Program',
                      });
                    }
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: t.ink, fontFamily: fonts[700], fontSize: 13 }}>
                      {idx === allTraining.length - 1 ? 'Latest — ' : ''}{new Date(ts.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </Text>
                    {idx === allTraining.length - 1 && (
                      <View style={{ backgroundColor: t.accent, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ color: t.ink, fontSize: 10, fontFamily: fonts[700] }}>{tr('playerProfile.latest')}</Text>
                      </View>
                    )}
                  </View>
                  {ts.program_text ? (
                    <Text style={{ color: t.muted, fontSize: 12, marginTop: 4 }} numberOfLines={2}>
                      {ts.program_text.replace(/[#*_\-=]/g, '').trim().slice(0, 100)}...
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Player profile detail modal */}
      <Modal visible={showProfileDetail} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(560) }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: t.chip }}>
              <Text style={{ color: t.ink, fontSize: 16, fontFamily: fonts[800] }}>{tr('playerProfile.playerProfile')}</Text>
              <TouchableOpacity onPress={() => setShowProfileDetail(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
              {/* Name + grade */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.ink, fontSize: 22, fontFamily: fonts[900] }}>{player.name}</Text>
                  {player.position ? <Text style={{ color: t.muted, fontSize: 14, marginTop: 2 }}>{player.position}</Text> : null}
                </View>
                <GradeBadge grade={(player as any).bim_grade ?? player.latest_grade} size="lg" />
              </View>

              {/* Info rows */}
              {[
                { label: 'Age', value: player.age ? `${player.age} yrs` : null },
                { label: 'Jersey', value: (player as any).jersey_number ? `#${(player as any).jersey_number}` : null },
                { label: 'Height', value: (player as any).height },
                { label: 'Wingspan', value: (player as any).wingspan },
                { label: 'Weight', value: (player as any).weight },
                { label: 'Standing Reach', value: (player as any).standing_reach },
                { label: 'School', value: (player as any).school_name },
                { label: 'Program', value: (player as any).program_name },
                { label: 'Team', value: player.team_name },
                { label: 'Level', value: player.competition_level },
                { label: 'City', value: (player as any).city },
                { label: 'State', value: (player as any).state },
                { label: 'Country', value: (player as any).country },
              ].filter(r => r.value).map(r => (
                <View key={r.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.chip }}>
                  <Text style={{ color: t.muted, fontSize: 14, fontFamily: fonts[600] }}>{r.label}</Text>
                  <Text style={{ color: t.ink, fontSize: 14, fontFamily: fonts[500], flexShrink: 1, textAlign: 'right', marginLeft: 12 }}>{r.value}</Text>
                </View>
              ))}

              {/* Notes */}
              {player.notes ? (
                <View style={{ marginTop: 16 }}>
                  <Text style={{ color: t.muted, fontSize: 12, fontFamily: fonts[700], letterSpacing: 1, marginBottom: 6 }}>{tr('playerProfile.notes')}</Text>
                  <Text style={{ color: t.inkSoft, fontSize: 14, lineHeight: 20 }}>{player.notes}</Text>
                </View>
              ) : null}

              {/* Stats summary */}
              <View style={{ marginTop: 20, backgroundColor: t.chip, borderRadius: 12, padding: 14 }}>
                <Text style={{ color: t.muted, fontSize: 12, fontFamily: fonts[700], letterSpacing: 1, marginBottom: 10 }}>{tr('playerProfile.evaluationSummary')}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: t.ink, fontSize: 22, fontFamily: fonts[900] }}>{evals.length}</Text>
                    <Text style={{ color: t.muted, fontSize: 11 }}>{tr('playerProfile.evaluations')}</Text>
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <Text style={{ color: t.ink, fontSize: 22, fontFamily: fonts[900] }}>{allTraining.length}</Text>
                    <Text style={{ color: t.muted, fontSize: 11 }}>{tr('playerProfile.trainingPlans')}</Text>
                  </View>
                  {((player as any).bim_grade ?? player.latest_grade) != null && (
                    <View style={{ alignItems: 'center' }}>
                      <Text style={{ color: t.ink, fontSize: 22, fontFamily: fonts[900] }}>{(((player as any).bim_grade ?? player.latest_grade) as number).toFixed(1)}</Text>
                      <Text style={{ color: t.muted, fontSize: 11 }}>{tr('playerProfile.bimScore')}</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Member since */}
              <Text style={{ color: t.muted2, fontSize: 12, textAlign: 'center', marginTop: 16 }}>
                Member since {new Date(player.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Training detail modal — full-screen so all text is readable */}
      <Modal visible={!!trainingModalItem} transparent animationType="slide">
        <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, flex: 1, marginTop: 60, ...sheetCap(560) }}>
            {/* Compact header — max ~50px tall */}
            <View style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 16, paddingVertical: 10,
              borderBottomWidth: 1, borderBottomColor: t.chip,
              minHeight: 50, maxHeight: 50,
            }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontSize: 15, fontFamily: fonts[800] }}>{tr('reportTypes.training_program')}</Text>
                {trainingModalItem && (
                  <Text style={{ color: t.muted, fontSize: 10 }}>
                    {new Date(trainingModalItem.created_at).toLocaleDateString()}
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setTrainingModalItem(null)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={t.muted} />
              </TouchableOpacity>
            </View>

            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'web' ? undefined : (Platform.OS === 'ios' ? 'padding' : 'height')}>
              <KeyboardAwareScrollView
                ref={modalScrollRef}
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                showsVerticalScrollIndicator={true}
                keyboardShouldPersistTaps="handled"
              >
                {trainingModalItem?.program_text
                  ? renderReport(trainingModalItem.program_text, { heading: t.ink, body: t.inkSoft })
                  : <Text style={{ color: t.muted }}>{tr('playerProfile.noTrainingContent')}</Text>
                }

                {/* Corrections section */}
                <View
                  style={{ marginTop: 24, borderTopWidth: 1, borderTopColor: t.chip, paddingTop: 16 }}
                  onLayout={e => { correctionInputY.current = e.nativeEvent.layout.y; }}
                >
                  <Text style={{ color: t.inkSoft, fontFamily: fonts[700], fontSize: 13, marginBottom: 8 }}>{tr('playerProfile.corrections')}</Text>
                  <VoiceTextInput
                    style={{
                      backgroundColor: t.chip, color: t.ink, borderRadius: 10,
                      padding: 12, fontSize: 14, minHeight: 80, textAlignVertical: 'top',
                      borderWidth: 1, borderColor: t.line,
                    }}
                    placeholder={tr('playerProfile.correctionsPlaceholder')}
                    placeholderTextColor={t.muted2}
                    value={modalCorrection}
                    onChangeText={setModalCorrection}
                    multiline

                  />
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                    <TouchableOpacity
                      style={{
                        flex: 1, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: t.chip, borderRadius: 10, paddingVertical: 12,
                        opacity: (!modalCorrection.trim() || savingModalCorrection) ? 0.5 : 1,
                      }}
                      onPress={saveModalCorrectionForLater}
                      disabled={!modalCorrection.trim() || savingModalCorrection}
                    >
                      {savingModalCorrection
                        ? <ActivityIndicator color={t.ink} size="small" />
                        : <Text style={{ color: t.ink, fontFamily: fonts[700], fontSize: 13 }}>{tr('playerProfile.saveForLater')}</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{
                        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                        gap: 6, backgroundColor: t.ctaBg, borderRadius: 10, paddingVertical: 12,
                        opacity: regeneratingModal ? 0.5 : 1,
                      }}
                      onPress={regenerateTrainingFromModal}
                      disabled={regeneratingModal}
                    >
                      {regeneratingModal
                        ? <ActivityIndicator color={t.ctaText} size="small" />
                        : <><Ionicons name="refresh" size={15} color={t.ctaText} /><Text style={{ color: t.ctaText, fontFamily: fonts[700], fontSize: 13 }}>{tr('playerProfile.applyRegenerate')}</Text></>}
                    </TouchableOpacity>
                  </View>

                  <GeneratingOverlay visible={regeneratingModal} label={tr('playerProfile.regeneratingOverlay')} />

                  {modalCorrections.length > 0 && (
                    <View style={{ marginTop: 12 }}>
                      {modalCorrections.map((c: any) => (
                        <View key={c.id} style={{ backgroundColor: t.chip, borderRadius: 10, padding: 10, marginBottom: 6, opacity: c.applied ? 0.55 : 1 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                            {c.applied
                              ? <View style={{ backgroundColor: t.positiveSoft, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ color: t.positive, fontSize: 9, fontFamily: fonts[700] }}>{tr('playerProfile.applied')}</Text></View>
                              : <View style={{ backgroundColor: t.card, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ color: t.muted, fontSize: 9, fontFamily: fonts[700] }}>{tr('playerProfile.pending')}</Text></View>}
                            <Text style={{ color: t.muted2, fontSize: 10 }}>{c.created_at ? new Date(c.created_at).toLocaleDateString() : ''}</Text>
                          </View>
                          <Text style={{ color: t.inkSoft, fontSize: 12.5 }}>{c.correction}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Player-facing version — only once this program has been sent */}
                {trainingModalItem?.sent_to_player && (
                  <View style={{ marginTop: 24, borderTopWidth: 1, borderTopColor: t.chip, paddingTop: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <Text style={{ color: t.inkSoft, fontFamily: fonts[700], fontSize: 13 }}>{tr('playerProfile.playersVersion')}</Text>
                      <View style={{ backgroundColor: t.accentSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                        <Text style={{ color: t.accent, fontSize: 9.5, fontFamily: fonts[700] }}>{tr('playerProfile.sentBadge')}</Text>
                      </View>
                    </View>

                    {trainingModalItem.reformatting ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}>
                        <ActivityIndicator color={t.accent} size="small" />
                        <Text style={{ color: t.muted, fontSize: 12.5 }}>AI is preparing the player's checklist version...</Text>
                      </View>
                    ) : (
                      <>
                        <Text style={{ color: t.inkSoft, fontFamily: fonts[700], fontSize: 12, marginBottom: 8 }}>Comments ({playerComments.length})</Text>
                        {playerComments.map(c => (
                          <View key={c.id} style={{ backgroundColor: t.card, borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: t.cardBorder }}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                              <Text style={{ fontSize: 11.5, fontFamily: fonts[700], color: c.coach_id ? t.accent : t.positive }}>
                                {c.author_name || 'Unknown'}{c.coach_id ? ' (You)' : ''}
                              </Text>
                              <Text style={{ color: t.muted2, fontSize: 10.5 }}>{new Date(c.created_at).toLocaleDateString()}</Text>
                            </View>
                            <Text style={{ color: t.inkSoft, fontSize: 12.5 }}>{c.text}</Text>
                          </View>
                        ))}
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, alignItems: 'flex-end' }}>
                          <VoiceTextInput
                            style={{ flex: 1, backgroundColor: t.chip, color: t.ink, borderRadius: 10, padding: 10, fontSize: 13, minHeight: 40, borderWidth: 1, borderColor: t.line }}
                            placeholder={tr('playerProfile.replyToPlayer')}
                            placeholderTextColor={t.muted2}
                            value={playerCommentText}
                            onChangeText={setPlayerCommentText}
                            multiline
                          />
                          <TouchableOpacity
                            style={{ backgroundColor: t.positive, borderRadius: 10, padding: 10, opacity: (!playerCommentText.trim() || sendingPlayerComment) ? 0.5 : 1 }}
                            onPress={sendPlayerComment}
                            disabled={!playerCommentText.trim() || sendingPlayerComment}
                          >
                            {sendingPlayerComment ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={16} color="#fff" />}
                          </TouchableOpacity>
                        </View>

                        <Text style={{ color: t.inkSoft, fontFamily: fonts[700], fontSize: 12, marginTop: 18, marginBottom: 8 }}>{tr('playerProfile.updatePlayerProgram')}</Text>
                        <VoiceTextInput
                          style={{ backgroundColor: t.chip, color: t.ink, borderRadius: 10, padding: 12, fontSize: 13, minHeight: 60, borderWidth: 1, borderColor: t.line }}
                          placeholder={tr('playerProfile.checklistFeedback')}
                          placeholderTextColor={t.muted2}
                          value={playerFeedbackText}
                          onChangeText={setPlayerFeedbackText}
                          multiline
                        />
                        <TouchableOpacity
                          style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.accentSoft, borderRadius: 10, paddingVertical: 11, opacity: (!playerFeedbackText.trim() || updatingPlayerProgram) ? 0.5 : 1 }}
                          onPress={updatePlayerProgram}
                          disabled={!playerFeedbackText.trim() || updatingPlayerProgram}
                        >
                          {updatingPlayerProgram
                            ? <ActivityIndicator color={t.accent} size="small" />
                            : <><Ionicons name="refresh" size={14} color={t.accent} /><Text style={{ color: t.accent, fontFamily: fonts[700], fontSize: 12.5 }}>{tr('playerProfile.updatePlayerProgram')}</Text></>}
                        </TouchableOpacity>
                        <GeneratingOverlay visible={updatingPlayerProgram} label={tr('playerProfile.updatingPlayerOverlay')} />
                      </>
                    )}
                  </View>
                )}
              </KeyboardAwareScrollView>
            </KeyboardAvoidingView>

            {/* Action row: Send to Player, Send to Staff, Print, Export */}
            <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: t.chip, gap: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.positive, borderRadius: 10, paddingVertical: 12 }}
                  onPress={() => { setTrainingModalItem(null); sendTrainingToPlayer(); }}
                  disabled={sendingTraining}
                >
                  {sendingTraining
                    ? <ActivityIndicator color={t.ctaText} size="small" />
                    : <><Ionicons name="person-outline" size={15} color={t.ink} /><Text style={{ color: t.ink, fontFamily: fonts[700], fontSize: 13 }}>{tr('playerProfile.sendToPlayer')}</Text></>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.accent, borderRadius: 10, paddingVertical: 12 }}
                  onPress={() => {
                    if (!trainingModalItem) return;
                    setShareCtx({
                      reportType: 'training',
                      reportId: trainingModalItem.id,
                      outputType: 'training_program',
                      reportText: trainingModalItem.program_text ?? '',
                      title: 'Training Program',
                    });
                    setTrainingModalItem(null);
                  }}
                >
                  <Ionicons name="share-social-outline" size={15} color={t.ink} />
                  <Text style={{ color: t.ink, fontFamily: fonts[700], fontSize: 13 }}>{tr('common.share')}</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.chip, borderRadius: 10, paddingVertical: 12, borderWidth: 1, borderColor: t.line }}
                  onPress={printTraining}
                >
                  <Ionicons name="print-outline" size={15} color={t.inkSoft} />
                  <Text style={{ color: t.inkSoft, fontFamily: fonts[700], fontSize: 13 }}>{tr('common.print')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: t.chip, borderRadius: 10, paddingVertical: 12, borderWidth: 1, borderColor: t.line }}
                  onPress={exportTraining}
                  disabled={exportingTraining}
                >
                  {exportingTraining
                    ? <ActivityIndicator color={t.inkSoft} size="small" />
                    : <><Ionicons name="share-outline" size={15} color={t.inkSoft} /><Text style={{ color: t.inkSoft, fontFamily: fonts[700], fontSize: 13 }}>{tr('playerProfile.exportPdf')}</Text></>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Player Modal — compact floating card */}
      <Modal visible={showEdit} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'web' ? undefined : (Platform.OS === 'ios' ? 'padding' : 'height')}>
          <View style={[styles.modal, { maxHeight: '90%', flex: 0 },
                       // flex: 0 compiles to flex-basis: 0%, and in a column that wins
                       // over height — which is why the sheet collapsed to ~50px no
                       // matter what height it was given. Restoring an auto basis on
                       // web lets the height apply.
                       desktopOnly({ flexBasis: 'auto', height: sheetBody + 96 })]}>
          <KeyboardAwareScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={true} style={desktopOnly({ height: sheetBody })} contentContainerStyle={{ paddingBottom: 16 }}>
            <Text style={styles.modalTitle}>{tr('playerProfile.editPlayer')}</Text>
            <VoiceTextInput
              style={styles.input}
              placeholder={tr('playerProfile.fullNameRequired')}
              placeholderTextColor={t.muted}
              value={editName}
              onChangeText={setEditName}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={tr('playerProfile.positionPlaceholder')}
                placeholderTextColor={t.muted}
                value={editPos}
                onChangeText={setEditPos}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={tr('playerProfile.jerseyPlaceholder')}
                placeholderTextColor={t.muted}
                keyboardType="number-pad"
                value={editJersey}
                onChangeText={setEditJersey}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={`Height (e.g. 6'2")`}
                placeholderTextColor={t.muted}
                value={editHeight}
                onChangeText={setEditHeight}
              />
              <VoiceTextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={`Wingspan (e.g. 6'5")`}
                placeholderTextColor={t.muted}
                value={editWingspan}
                onChangeText={setEditWingspan}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={tr('playerProfile.weightPlaceholder')}
                placeholderTextColor={t.muted}
                value={editWeight}
                onChangeText={setEditWeight}
              />
              <VoiceTextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={`Standing Reach (e.g. 8'2")`}
                placeholderTextColor={t.muted}
                value={editStandingReach}
                onChangeText={setEditStandingReach}
              />
            </View>
            <VoiceTextInput
              style={styles.input}
              placeholder={tr('playerProfile.schoolPlaceholder')}
              placeholderTextColor={t.muted}
              value={editSchool}
              onChangeText={setEditSchool}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <VoiceTextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={tr('playerProfile.cityPlaceholder')}
                placeholderTextColor={t.muted}
                value={editCity}
                onChangeText={setEditCity}
              />
              <VoiceTextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={tr('playerProfile.statePlaceholder')}
                placeholderTextColor={t.muted}
                value={editState}
                onChangeText={setEditState}
              />
            </View>
            <VoiceTextInput
              style={styles.input}
              placeholder={tr('playerProfile.countryPlaceholder')}
              placeholderTextColor={t.muted}
              value={editCountry}
              onChangeText={setEditCountry}
            />

            {/* Inline level picker */}
            <Text style={styles.inputLabel}>{tr('auth.competitionLevel')}</Text>
            <TouchableOpacity
              style={styles.dropdownTrigger}
              onPress={() => { setShowLevelPicker(v => !v); setShowTeamPicker(false); setShowCreateTeam(false); }}
            >
              <Text style={styles.dropdownText}>{editLevel}</Text>
              <Text style={{ color: t.muted }}>{showLevelPicker ? '▴' : '▾'}</Text>
            </TouchableOpacity>
            {showLevelPicker && (
              <View style={styles.inlineList}>
                {COMPETITION_LEVELS.map(lvl => (
                  <TouchableOpacity
                    key={lvl}
                    style={[styles.inlineOption, editLevel === lvl && styles.inlineOptionActive]}
                    onPress={() => { setEditLevel(lvl); setShowLevelPicker(false); }}
                  >
                    <Text style={[styles.inlineOptionText, editLevel === lvl && { color: t.ink, fontFamily: fonts[700] }]}>{lvl}</Text>
                    {editLevel === lvl && <Ionicons name="checkmark" size={16} color={t.accent} />}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Inline team picker */}
            <Text style={[styles.inputLabel, { marginTop: 8 }]}>{tr('playerProfile.team')}</Text>
            <TouchableOpacity
              style={styles.dropdownTrigger}
              onPress={() => { setShowTeamPicker(v => !v); setShowLevelPicker(false); setShowCreateTeam(false); }}
            >
              <Text style={styles.dropdownText}>
                {editTeamId ? (teams.find(t => t.id === editTeamId)?.name ?? 'Unknown') : 'No Team'}
              </Text>
              <Text style={{ color: t.muted }}>{showTeamPicker ? '▴' : '▾'}</Text>
            </TouchableOpacity>
            {showTeamPicker && (
              <View style={styles.inlineList}>
                <TouchableOpacity
                  style={[styles.inlineOption, !editTeamId && styles.inlineOptionActive]}
                  onPress={() => { setEditTeamId(null); setShowTeamPicker(false); }}
                >
                  <Text style={[styles.inlineOptionText, !editTeamId && { color: t.ink, fontFamily: fonts[700] }]}>{tr('playerProfile.noTeam')}</Text>
                  {!editTeamId && <Ionicons name="checkmark" size={16} color={t.accent} />}
                </TouchableOpacity>
                {teams.map(tm => (
                  <TouchableOpacity
                    key={tm.id}
                    style={[styles.inlineOption, editTeamId === tm.id && styles.inlineOptionActive]}
                    onPress={() => { setEditTeamId(tm.id); setShowTeamPicker(false); }}
                  >
                    <Text style={[styles.inlineOptionText, editTeamId === tm.id && { color: t.ink, fontFamily: fonts[700] }]}>{tm.name}</Text>
                    {editTeamId === tm.id && <Ionicons name="checkmark" size={16} color={t.accent} />}
                  </TouchableOpacity>
                ))}
                {/* Create new team inline */}
                <TouchableOpacity
                  style={[styles.inlineOption, { borderTopColor: t.accent }]}
                  onPress={() => { setShowCreateTeam(v => !v); }}
                >
                  <Ionicons name="add-circle-outline" size={16} color={t.accent} />
                  <Text style={[styles.inlineOptionText, { color: t.accent, marginLeft: 8 }]}>{tr('playerProfile.createNewTeam')}</Text>
                </TouchableOpacity>
                {showCreateTeam && (
                  <View style={{ padding: 8, gap: 8 }}>
                    <VoiceTextInput
                      style={styles.input}
                      placeholder={tr('playerProfile.teamNamePlaceholder')}
                      placeholderTextColor={t.muted}
                      value={newTeamName}
                      onChangeText={setNewTeamName}
                      autoFocus
                    />
                    <TouchableOpacity
                      style={[styles.saveBtn, { flex: undefined, alignSelf: 'stretch', marginTop: 0 }]}
                      onPress={createTeamFromEdit}
                      disabled={creatingTeam || !newTeamName.trim()}
                    >
                      {creatingTeam ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.saveText}>{tr('playerProfile.createAssign')}</Text>}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            <View style={[styles.modalRow, { marginTop: 16 }]}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowEdit(false); setShowLevelPicker(false); setShowTeamPicker(false); setShowCreateTeam(false); }}>
                <Text style={styles.cancelText}>{tr('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveEdit} disabled={saving}>
                {saving ? <ActivityIndicator color={t.ctaText} /> : <Text style={styles.saveText}>{tr('common.save')}</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAwareScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Share with Staff modal */}
      <Modal visible={showStaffShare} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'web' ? undefined : (Platform.OS === 'ios' ? 'padding' : 'height')} keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{tr('playerProfile.shareWithStaff')}</Text>
            <Text style={styles.modalSub}>Search for a coach, scout, or trainer to share this training program.</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, backgroundColor: t.chip, borderRadius: 8, padding: 12 }}>
              <Text style={{ color: t.inkSoft, fontSize: 13 }}>{tr('playerProfile.allowRegenerate')}</Text>
              <TouchableOpacity
                onPress={() => setAllowRegen(v => !v)}
                style={{ width: 40, height: 22, borderRadius: 11, backgroundColor: allowRegen ? t.accent : t.line, justifyContent: 'center', paddingHorizontal: 2 }}
              >
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: t.ink, alignSelf: allowRegen ? 'flex-end' : 'flex-start' }} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: t.muted, fontSize: 11, marginBottom: 12, marginLeft: 2 }}>
              {allowRegen
                ? 'Sends a live, regenerable copy — recipient sees the full report.'
                : 'Sends a frozen snapshot — choose which sections to include below.'}
            </Text>
            {(() => {
              const secs = splitReportSections(staffShareText);
              return !allowRegen && secs.length > 1 ? (
                <>
                  <Text style={{ color: t.muted, fontSize: 12, fontFamily: fonts[600], marginBottom: 6 }}>{tr('playerProfile.includeSections')}</Text>
                  {secs.map(sec => (
                    <View key={sec.heading} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, backgroundColor: t.chip, borderRadius: 8, padding: 10 }}>
                      <Text style={{ color: t.inkSoft, fontSize: 13, flex: 1, marginRight: 8 }} numberOfLines={1}>{sec.heading}</Text>
                      <TouchableOpacity
                        onPress={() => setStaffSectionToggles(p => ({ ...p, [sec.heading]: !(p[sec.heading] !== false) }))}
                        style={{ width: 40, height: 22, borderRadius: 11, backgroundColor: staffSectionToggles[sec.heading] !== false ? t.accent : t.line, justifyContent: 'center', paddingHorizontal: 2 }}
                      >
                        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: t.ink, alignSelf: staffSectionToggles[sec.heading] !== false ? 'flex-end' : 'flex-start' }} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </>
              ) : null;
            })()}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
              <VoiceTextInput
                style={[styles.input, { flex: 1 }]}
                placeholder={tr('playerProfile.searchCoachPlaceholder')}
                placeholderTextColor={t.muted}
                value={staffSearch}
                onChangeText={setStaffSearch}
              />
              <TouchableOpacity
                style={{ backgroundColor: t.accent, borderRadius: 10, padding: 12, alignItems: 'center', justifyContent: 'center' }}
                onPress={searchStaff}
                disabled={staffSearchLoading}
              >
                {staffSearchLoading ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="search" size={18} color={t.ctaText} />}
              </TouchableOpacity>
            </View>
            {staffResults.map((r: any) => (
              <TouchableOpacity
                key={r.id}
                style={{ backgroundColor: t.chip, borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: t.line }}
                onPress={() => sendToStaff(r)}
                disabled={sendingStaff}
              >
                {sendingStaff ? <ActivityIndicator color={t.accent} /> : <>
                  <Text style={{ color: t.ink, fontFamily: fonts[600] }}>{r.name}</Text>
                  <Text style={{ color: t.muted, fontSize: 11 }}>{r.role} · {r.program_name}</Text>
                </>}
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

      {/* Summary modal */}
      <Modal visible={showSummary} transparent animationType="slide">
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'web' ? undefined : (Platform.OS === 'ios' ? 'padding' : 'height')}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{tr('playerProfile.summarizeHistoryTitle')}</Text>
            <Text style={styles.modalSub}>{tr('playerProfile.summarizeHistorySub', { count: evals.length })}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
              {OUTPUT_TYPES.map(ot => {
                const selected = summaryType.split(',').filter(Boolean);
                const isOn = selected.includes(ot.key);
                return (
                <TouchableOpacity
                  key={ot.key}
                  style={[styles.chip, isOn && styles.chipActive]}
                  onPress={() => {
                    const next = isOn ? selected.filter(k => k !== ot.key) : [...selected, ot.key];
                    setSummaryType((next.length ? next : [ot.key]).join(','));
                  }}
                >
                  <Text style={[styles.chipText, isOn && { color: t.ctaText }]}>{tr(ot.labelKey)}</Text>
                </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Tracked game selector — only for Box Score */}
            {summaryType.split(',').includes('box_score') && (() => {
              const seasonOf = (g: any) => (g.season_year || (g.year != null ? String(g.year) : '')) || '';
              const years = ['all', ...Array.from(new Set(gameHistory.map(seasonOf).filter(Boolean)))];
              const phases = ['all', ...Array.from(new Set(gameHistory.map((g: any) => g.season_phase).filter(Boolean)))];
              const filtered = gameHistory.filter((g: any) =>
                (sumSeasonYear === 'all' || seasonOf(g) === sumSeasonYear) &&
                (sumSeasonPhase === 'all' || g.season_phase === sumSeasonPhase));
              const allSel = filtered.length > 0 && filtered.every((g: any) => selectedGameIds.includes(g.game_id));
              return (
              <View style={{ marginBottom: 18 }}>
                <Text style={[styles.modalSub, { marginBottom: 8 }]}>
                  {gameHistory.length
                    ? 'Pick a season/type, then select games — their real stats build the box score:'
                    : 'No tracked games for this player yet (track games in Team Grade).'}
                </Text>
                {gameHistory.length > 0 && (
                  <>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
                      {years.map(y => (
                        <TouchableOpacity key={y} style={[styles.chip, sumSeasonYear === y && styles.chipActive]} onPress={() => setSumSeasonYear(y)}>
                          <Text style={[styles.chipText, sumSeasonYear === y && { color: t.ctaText }]}>{y === 'all' ? 'All Seasons' : y}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                      {phases.map(p => (
                        <TouchableOpacity key={p} style={[styles.chip, sumSeasonPhase === p && styles.chipActive]} onPress={() => setSumSeasonPhase(p)}>
                          <Text style={[styles.chipText, sumSeasonPhase === p && { color: t.ctaText }]}>{p === 'all' ? 'All Types' : p.charAt(0).toUpperCase() + p.slice(1)}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    {filtered.length > 0 && (
                      <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}
                        onPress={() => {
                          const ids = filtered.map((g: any) => g.game_id);
                          setSelectedGameIds(prev => allSel ? prev.filter(id => !ids.includes(id)) : Array.from(new Set([...prev, ...ids])));
                        }}>
                        <Ionicons name={allSel ? 'checkbox' : 'square-outline'} size={20} color={allSel ? t.accent : t.muted2} />
                        <Text style={{ color: t.inkSoft, fontSize: 13, fontFamily: fonts[700] }}>Select all shown ({filtered.length})</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
                <ScrollView style={{ maxHeight: 180 }}>
                  {filtered.map((g: any) => {
                    const on = selectedGameIds.includes(g.game_id);
                    return (
                      <TouchableOpacity key={g.game_id}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.divider }}
                        onPress={() => setSelectedGameIds(prev => on ? prev.filter(id => id !== g.game_id) : [...prev, g.game_id])}
                      >
                        <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? t.accent : t.muted2} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: t.ink, fontSize: 14, fontFamily: fonts[600] }}>vs {g.opponent_name}</Text>
                          <Text style={{ color: t.muted2, fontSize: 11 }}>{g.date ?? ''}{g.season_phase ? ` · ${g.season_phase}` : ''}{g.game_grade != null ? ` · Grade ${g.game_grade}` : ''}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
              );
            })()}

            <GeneratingOverlay visible={summaryLoading} label={tr('playerProfile.synthesizingOverlay')} />
            <View style={styles.modalRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowSummary(false)}>
                <Text style={styles.cancelText}>{tr('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={generateSummary} disabled={summaryLoading}>
                {summaryLoading
                  ? <ActivityIndicator color={t.ctaText} />
                  : <Text style={styles.saveText}>{tr('common.generate')}</Text>}
              </TouchableOpacity>
            </View>
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
          subjectPlayerId={player?.id}
          subjectPlayerName={player?.name}
        />
      )}
    </KeyboardAwareScrollView>
    </PageContainer>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingTop: 56, gap: 12 },
  headerCenter: { flex: 1 },
  name: { color: t.ink, fontSize: 22, fontFamily: fonts[900] },
  meta: { color: t.muted, fontSize: 12, marginTop: 2 },
  section: { paddingHorizontal: 20, marginTop: 24 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 },
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 20 },
  flagBox: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 12 },
  flagTitle: { fontSize: 11, fontFamily: fonts[700], marginBottom: 6, textTransform: 'uppercase' },
  flagItem: { color: t.inkSoft, fontSize: 12, marginBottom: 3 },
  evalCard: {
    backgroundColor: t.card, borderRadius: 14, padding: 14,
    flexDirection: 'row', alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: t.cardBorder,
  },
  evalType: { color: t.ink, fontSize: 13, fontFamily: fonts[700] },
  evalDate: { color: t.muted, fontSize: 11, marginTop: 2 },
  emptyText: { color: t.muted2, fontSize: 13 },
  newEvalBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: t.ctaBg, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
  },
  newEvalText: { color: t.ctaText, fontSize: 12, fontFamily: fonts[700] },
  // Same width as the other page actions so the stack reads as one group.
  summaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.ctaBg, margin: 20, marginBottom: 8, padding: 15, borderRadius: 999,
    ...desktopOnly({ margin: 0, width: '100%' }),
  },
  summaryText: { color: t.ctaText, fontFamily: fonts[800], fontSize: 15 },
  trainingBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.chip, marginHorizontal: 20, marginTop: 0, marginBottom: 0, padding: 15, borderRadius: 999,
    // In the web grid the cell sets the width, so the button fills its cell —
    // a 380 cap here made three of the four narrower than the fourth.
    ...desktopOnly({ marginHorizontal: 0, width: '100%' }),
  },
  trainingText: { color: t.ink, fontFamily: fonts[700], fontSize: 15 },
  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' },
  modal: { backgroundColor: t.sheet, borderRadius: 20, padding: 24, margin: 12, borderWidth: 1, borderColor: t.cardBorder, ...sheetCap(560)},
  modalTitle: { color: t.ink, fontSize: 20, fontFamily: fonts[800], marginBottom: 4 },
  modalSub: { color: t.muted, fontSize: 12, marginBottom: 16, lineHeight: 18 },
  chip: { borderWidth: 1, borderColor: t.line, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9, marginRight: 8 },
  chipActive: { backgroundColor: t.ctaBg, borderColor: t.ctaBg },
  chipText: { color: t.muted, fontSize: 13, fontFamily: fonts[700] },
  modalRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 999, borderWidth: 1, borderColor: t.cta2Border, alignItems: 'center' },
  cancelText: { color: t.cta2Text, fontFamily: fonts[700] },
  saveBtn: { flex: 1, padding: 14, borderRadius: 999, backgroundColor: t.ctaBg, alignItems: 'center' },
  saveText: { color: t.ctaText, fontFamily: fonts[700] },
  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.chip, marginHorizontal: 20, marginTop: 10, padding: 14, borderRadius: 999,
  },
  inviteText: { color: t.ink, fontFamily: fonts[700], fontSize: 14 },
  inviteCodeBox: {
    backgroundColor: t.card, marginHorizontal: 20, marginTop: 10, padding: 16,
    borderRadius: 18, borderWidth: 1, borderColor: t.accent, alignItems: 'center',
  },
  inviteCodeLabel: { color: t.muted, fontSize: 10, fontFamily: fonts[700], letterSpacing: 2, marginBottom: 8 },
  inviteCode: { color: t.accent, fontSize: 28, fontFamily: fonts[900], letterSpacing: 4, marginBottom: 8 },
  editBtn: { padding: 4 },
  input: {
    backgroundColor: t.chip, borderRadius: 14, padding: 12, color: t.ink,
    fontSize: 14, borderWidth: 1, borderColor: t.line, marginBottom: 12,
  },
  inputLabel: { color: t.muted, fontSize: 12, fontFamily: fonts[600], marginBottom: 6 },
  dropdownTrigger: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: t.chip, borderRadius: 14, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: t.line,
  },
  dropdownText: { color: t.ink, fontSize: 14 },
  pickerOption: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 13, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: t.divider,
  },
  pickerOptionActive: { backgroundColor: t.accentSoft, marginHorizontal: -4, paddingHorizontal: 4, borderRadius: 8 },
  pickerOptionText: { color: t.inkSoft, fontSize: 14 },
  inlineList: { backgroundColor: t.chip, borderRadius: 14, marginBottom: 8, overflow: 'hidden', borderWidth: 1, borderColor: t.line },
  inlineOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.divider },
  inlineOptionActive: { backgroundColor: t.accentSoft },
  inlineOptionText: { color: t.inkSoft, fontSize: 14 },
  inviteCodeHint: { color: t.muted, fontSize: 11, textAlign: 'center' },
  trainingFeedbackBox: {
    backgroundColor: t.card, marginHorizontal: 20, marginTop: 10,
    padding: 14, borderRadius: 18, borderWidth: 1, borderColor: t.cardBorder,
  },
  trainingFeedbackLabel: { color: t.label, fontSize: 11.5, fontFamily: fonts[700], letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 },
  trainingFeedbackInput: {
    backgroundColor: t.chip, borderRadius: 12, padding: 10, color: t.ink,
    fontSize: 13, borderWidth: 1, borderColor: t.line, minHeight: 70, marginBottom: 10,
  },
  regenBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.ctaBg, borderRadius: 999, padding: 12,
    // Full width of the feedback card it lives in — it acts on that card's
    // input, not on the page, so it should read as part of it.
    ...desktopOnly({ width: '100%', alignSelf: 'stretch' }),
  },
  regenBtnText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 14 },
});
