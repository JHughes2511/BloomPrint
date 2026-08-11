/**
 * Tells the coach when a long job has finished, wherever they are in the app.
 *
 * A film analysis or a game packet takes minutes, and the coach is not meant
 * to sit and watch it — they start it and go and do something else. Until now
 * that meant leaving the screen and losing the thread entirely: the report was
 * there when they next thought to look, and nothing had said so.
 *
 * Deliberately quiet while the coach is still on the screen that started the
 * job. That screen has a progress bar and will show the result itself; a
 * banner over the top of it is telling someone what they are already looking
 * at. See jobRoutes.
 *
 * Mounted once, inside the navigator so it can take the coach to the report.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { evalsAPI, ActiveJob } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { watchingJob } from './jobRoutes';

/** How often to ask. A finished report is not urgent to the second. */
const POLL_MS = 8000;

type Finished = { id: number; kind: string; label: string; ok: boolean; resultId: number | null };

/**
 * Which jobs this device has already announced.
 *
 * On the device, not the server: two devices should each get told once, and a
 * page refresh should not replay this morning's work. localStorage on web,
 * memory on native — a native app is not reloaded the way a tab is.
 */
const SEEN_KEY = 'bloomprint.jobsAnnounced';
const memorySeen = new Set<number>();

function loadSeen(): Set<number> {
  if (Platform.OS !== 'web') return memorySeen;
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return new Set<number>(raw ? JSON.parse(raw) : []);
  } catch {
    return memorySeen;
  }
}

function saveSeen(seen: Set<number>) {
  if (Platform.OS !== 'web') return;
  try {
    // Only the recent tail: this list is a guard against announcing twice, and
    // a job old enough to have fallen out of the server's window can never come
    // back to be announced again.
    window.localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
  } catch {
    /* a full or blocked store is not worth failing over */
  }
}

export default function JobWatcher() {
  const { coach } = useAuth();
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const navigation = useNavigation<any>();
  const styles = makeStyles(t);
  const [banners, setBanners] = useState<Finished[]>([]);
  const seen = useRef<Set<number>>(loadSeen());

  useEffect(() => {
    if (!coach) return;
    let live = true;

    const tick = async () => {
      let jobs: ActiveJob[] = [];
      try {
        jobs = await evalsAPI.activeJobs();
      } catch {
        return;   // offline, or signed out mid-poll: try again next time
      }
      if (!live) return;
      const fresh: Finished[] = [];
      for (const job of jobs) {
        if (job.status === 'processing') continue;
        if (seen.current.has(job.id)) continue;
        seen.current.add(job.id);
        // Still standing on the screen that started it — that screen is
        // already showing this, and says it better.
        if (watchingJob(job.id)) continue;
        fresh.push({ id: job.id, kind: job.kind, label: job.label,
                     ok: job.status === 'done', resultId: job.result_id });
      }
      if (fresh.length) {
        saveSeen(seen.current);
        setBanners(prev => [...prev, ...fresh]);
      }
    };

    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [coach]);

  if (!banners.length) return null;

  /** The job's own name, in the coach's language, falling back to the server's. */
  const nameOf = (job: Finished) =>
    tr(`jobs.kinds.${job.kind}`, { defaultValue: job.label });

  const open = (job: Finished) => {
    setBanners(prev => prev.filter(b => b.id !== job.id));
    if (!job.ok) { navigation.navigate('HomeTab', { screen: 'CoachNotifications' }); return; }
    // Where the finished thing actually lives. A kind with a screen of its own
    // goes there; everything else goes to Recent, which lists all of them.
    if (job.kind === 'packet' && job.resultId) {
      navigation.navigate('TeamTab', { screen: 'GameReportBuilder', params: { reportId: job.resultId } });
    } else if ((job.kind === 'eval' || job.kind === 'eval_text') && job.resultId) {
      navigation.navigate('RecentTab', { screen: 'EvalReport', params: { evalId: job.resultId } });
    } else if (job.kind === 'training' && job.resultId) {
      navigation.navigate('HomeTab', { screen: 'CoachTrainingDetail', params: { trainingId: job.resultId } });
    } else {
      navigation.navigate('RecentTab', { screen: 'Recent' });
    }
  };

  const dismissAll = () => setBanners([]);

  // More than two at once stops being a list and becomes a wall. Past that it
  // is one line saying how many, which is all a coach needs to go and look.
  const collapsed = banners.length > 2;

  return (
    <View style={styles.host} pointerEvents="box-none">
      {collapsed ? (
        <TouchableOpacity style={styles.banner} onPress={() => open(banners[banners.length - 1])}
                          activeOpacity={0.85}>
          <Ionicons name="checkmark-circle" size={18} color={t.positive} />
          <Text style={styles.title} numberOfLines={1}>
            {tr('jobs.nReady', { count: banners.length })}
          </Text>
          <TouchableOpacity onPress={dismissAll} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={16} color={t.muted} />
          </TouchableOpacity>
        </TouchableOpacity>
      ) : (
        banners.map(job => (
          <TouchableOpacity key={job.id} style={styles.banner} onPress={() => open(job)}
                            activeOpacity={0.85}>
            <Ionicons name={job.ok ? 'checkmark-circle' : 'alert-circle'} size={18}
                      color={job.ok ? t.positive : t.negative} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title} numberOfLines={1}>
                {job.ok ? tr('jobs.ready', { label: nameOf(job) })
                        : tr('jobs.failed', { label: nameOf(job) })}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                {job.ok ? tr('jobs.tapToOpen') : tr('jobs.tapForDetails')}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setBanners(prev => prev.filter(b => b.id !== job.id))}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={16} color={t.muted} />
            </TouchableOpacity>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  // Fixed to the top, over everything, and box-none so the page underneath is
  // still usable while a banner is up — this is an interruption, not a modal.
  host: {
    position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center',
    paddingTop: 10, gap: 8, zIndex: 9000,
  },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.card, borderRadius: 12, borderWidth: 1, borderColor: t.line,
    paddingVertical: 10, paddingHorizontal: 14,
    width: '92%', maxWidth: 420,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  title: { color: t.ink, fontSize: 13.5, fontFamily: fonts[700], flexShrink: 1 },
  sub: { color: t.muted, fontSize: 11.5, fontFamily: fonts[600], marginTop: 1 },
});
