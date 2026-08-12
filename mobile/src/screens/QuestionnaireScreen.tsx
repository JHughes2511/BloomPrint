import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput, ScrollView,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { questionnaireAPI, QuestionnaireForm } from '../api/client';
import { currentLanguage } from '../i18n';
import LanguagePicker from '../components/LanguagePicker';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { ScreenBackground } from '../theme/components';
import PageContainer from '../responsive/PageContainer';
import { topPad } from '../responsive/screenPadding';

/**
 * The public questionnaire.
 *
 * Reachable with no account, which is the whole point — the people being asked
 * have never seen BloomPrint and are not going to sign up to answer seven
 * questions about their week. So there is no auth on this screen, nothing here
 * reads a coach or a player, and the only thing it needs from the server is the
 * list of questions.
 *
 * The questions come from the API rather than living here. They are the
 * instrument, and an instrument only works if every respondent answered the
 * same one; a stale web build serving last week's wording while the results
 * count this week's is exactly the failure that would never announce itself.
 *
 * Answers are recorded as INDEXES. That is what lets somebody answer in Spanish
 * and be counted beside somebody who answered in English — the translated form
 * keeps the same questions in the same order with the same options in the same
 * positions, so position is the answer and language is only presentation.
 */
type Step = 'about' | 'questions' | 'done';

export default function QuestionnaireScreen() {
  const route = useRoute<any>();
  const { t, mode, toggle: toggleTheme } = useTheme();
  const s = makeStyles(t);

  const [form, setForm] = useState<QuestionnaireForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Switching language mid-form is a different thing from opening the page:
  // the first language a person has ever asked for has to be translated, which
  // takes real time. Blanking the screen for it left them looking at a spinner
  // with their answers apparently gone, so a re-translation keeps the form on
  // screen and says what it is doing in the corner.
  const [translating, setTranslating] = useState(false);

  const [step, setStep] = useState<Step>('about');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [age, setAge] = useState<string>('');
  const [role, setRole] = useState<string>('');
  const [answers, setAnswers] = useState<Record<number, number | number[]>>({});
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const scroller = useRef<ScrollView | null>(null);

  // Where the link was shared, if it said. Recorded so a response can be traced
  // back to the channel it came from without asking the respondent.
  const source: string | undefined = route.params?.from;

  const load = useCallback(async (lang: string, replacing: boolean) => {
    if (replacing) setTranslating(true); else setLoading(true);
    setFailed(false);
    try {
      setForm(await questionnaireAPI.form(lang));
    } catch {
      // Only a first load has nothing to fall back to. A failed switch keeps
      // the language they already had rather than throwing the page away.
      if (!replacing) setFailed(true);
    } finally {
      setLoading(false);
      setTranslating(false);
    }
  }, []);

  useEffect(() => { load(currentLanguage(), false); }, [load]);

  // Every visible word comes from the form, so the screen is in the same
  // language as the questions rather than English chrome around translated
  // content. The fallbacks keep it readable if the payload is ever older.
  const ui = form?.ui ?? {};
  const u = (k: string, fb: string, vars?: Record<string, string | number>) => {
    let out = ui[k] ?? fb;
    if (vars) Object.entries(vars).forEach(([n, v]) => { out = out.split(`{${n}}`).join(String(v)); });
    return out;
  };

  const questions = form && role ? (form.questions[role] ?? []) : [];
  const canStart = name.trim().length > 0 && role !== '';
  const answeredCount = questions.reduce((n, _q, i) => {
    const a = answers[i];
    return n + (Array.isArray(a) ? (a.length ? 1 : 0) : a !== undefined ? 1 : 0);
  }, 0);

  const toggle = (qi: number, oi: number, multi: boolean) => {
    setAnswers(prev => {
      if (!multi) {
        const next = { ...prev };
        if (next[qi] === oi) delete next[qi]; else next[qi] = oi;
        return next;
      }
      const cur = Array.isArray(prev[qi]) ? (prev[qi] as number[]) : [];
      const at = cur.indexOf(oi);
      const list = at > -1 ? cur.filter(x => x !== oi) : [...cur, oi];
      const next = { ...prev };
      if (list.length) next[qi] = list; else delete next[qi];
      return next;
    });
  };

  const submit = async () => {
    if (sending) return;
    setSending(true);
    setError('');
    try {
      const payload: Record<string, number | number[]> = {};
      Object.entries(answers).forEach(([k, v]) => { payload[k] = v; });
      await questionnaireAPI.submit({
        role, name: name.trim(), email: email.trim() || null, age_range: age || null,
        answers: payload, comment: comment.trim() || null, source: source || null,
      });
      setStep('done');
      scroller.current?.scrollTo({ y: 0, animated: false });
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? u('send_failed', 'That did not send. Try again.'));
    } finally {
      setSending(false);
    }
  };

  const startOver = () => {
    setStep('about'); setName(''); setEmail(''); setAge(''); setRole('');
    setAnswers({}); setComment(''); setError('');
    scroller.current?.scrollTo({ y: 0, animated: false });
  };

  if (loading) {
    return (
      <ScreenBackground>
        <View style={s.center}><ActivityIndicator color={t.accent} /></View>
      </ScreenBackground>
    );
  }

  if (failed || !form) {
    return (
      <ScreenBackground>
        <View style={s.center}>
          <Text style={s.title}>{u('load_failed', "We can't load the questions right now.")}</Text>
          <TouchableOpacity style={s.cta} onPress={() => load(currentLanguage(), false)}>
            <Text style={s.ctaText}>{u('retry', 'Try again')}</Text>
          </TouchableOpacity>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <ScrollView
        ref={scroller}
        contentContainerStyle={{ paddingTop: topPad(28), paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        <PageContainer maxWidth={720}>
          <View style={s.brandbar}>
            <Text style={s.brand}>BLOOMPRINT</Text>
            <View style={s.tools}>
              {translating && (
                <View style={s.translating}>
                  <ActivityIndicator color={t.muted} size="small" />
                  <Text style={s.translatingText}>{u('translating', 'Translating…')}</Text>
                </View>
              )}
              <TouchableOpacity
                style={s.themeBtn}
                onPress={toggleTheme}
                accessibilityRole="button"
                accessibilityLabel={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                <Ionicons name={mode === 'dark' ? 'sunny-outline' : 'moon-outline'}
                          size={16} color={t.muted} />
              </TouchableOpacity>
              {step !== 'done' && (
                <LanguagePicker compact onChanged={(code) => { load(code, true); }} />
              )}
            </View>
          </View>

          {step === 'about' && (
            <View style={{ gap: 22 }}>
              <View>
                <Text style={s.eyebrow}>{u('eyebrow', 'Seven questions · about five minutes')}</Text>
                <Text style={s.h1}>{u('title', 'Where does your basketball week actually go?')}</Text>
                <Text style={s.lede}>{u('lede', '')}</Text>
              </View>

              <View style={s.panel}>
                <View style={s.field}>
                  <Text style={s.fieldLabel}>{u('name_label', 'Your name')} <Text style={s.req}>*</Text></Text>
                  <TextInput
                    style={s.input}
                    value={name}
                    onChangeText={setName}
                    placeholder={u('name_placeholder', 'First and last')}
                    placeholderTextColor={t.muted2}
                    autoCapitalize="words"
                  />
                </View>

                <View style={s.field}>
                  <Text style={s.fieldLabel}>{u('email_label', 'Email')}</Text>
                  <TextInput
                    style={s.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder={u('email_placeholder', 'you@example.com')}
                    placeholderTextColor={t.muted2}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                  />
                </View>

                <View style={s.field}>
                  <Text style={s.fieldLabel}>{u('age_label', 'Age')}</Text>
                  <View style={s.chips}>
                    {form.age_ranges.map(a => (
                      <TouchableOpacity
                        key={a}
                        style={[s.chip, age === a && s.chipOn]}
                        onPress={() => setAge(age === a ? '' : a)}
                      >
                        <Text style={[s.chipText, age === a && s.chipTextOn]}>{a}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                <View style={s.field}>
                  <Text style={s.fieldLabel}>{u('role_label', 'Which one are you?')} <Text style={s.req}>*</Text></Text>
                  <View style={{ gap: 8 }}>
                    {form.roles.map(r => (
                      <TouchableOpacity
                        key={r.id}
                        style={[s.roleCard, role === r.id && s.roleCardOn]}
                        onPress={() => { setRole(r.id); setAnswers({}); }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={s.roleName}>{r.name}</Text>
                          <Text style={s.roleBlurb}>{r.blurb}</Text>
                        </View>
                        {role === r.id && <Ionicons name="checkmark-circle" size={20} color={t.accent} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              <View style={s.actions}>
                <TouchableOpacity
                  style={[s.cta, !canStart && s.ctaOff]}
                  disabled={!canStart}
                  onPress={() => { setStep('questions'); scroller.current?.scrollTo({ y: 0, animated: false }); }}
                >
                  <Text style={s.ctaText}>{u('start', 'Start')}</Text>
                </TouchableOpacity>
                <Text style={s.hint}>{u('required_hint', '')}</Text>
              </View>
            </View>
          )}

          {step === 'questions' && (
            <View style={{ gap: 18 }}>
              <View>
                <Text style={s.eyebrow}>
                  {(form.roles.find(r => r.id === role)?.name ?? '').toUpperCase()} · SEVEN QUESTIONS
                </Text>
                <Text style={s.h1}>{u('questions_title', 'Your week')}</Text>
                <Text style={s.lede}>{u('questions_lede', '')}</Text>
              </View>

              {questions.map((q, qi) => (
                <View key={qi} style={s.qcard}>
                  <View style={s.qtop}>
                    <Text style={s.qnum}>
                      {u('question_of', 'QUESTION {n} OF {total}', { n: qi + 1, total: questions.length })}
                    </Text>
                    {q.multi && <Text style={s.qmulti}>{u('select_all', 'SELECT ALL')}</Text>}
                  </View>
                  <Text style={s.qtext}>{q.text}</Text>
                  <View style={{ gap: 8 }}>
                    {q.options.map((opt, oi) => {
                      const a = answers[qi];
                      const on = Array.isArray(a) ? a.indexOf(oi) > -1 : a === oi;
                      return (
                        <TouchableOpacity
                          key={oi}
                          style={[s.answer, on && s.answerOn]}
                          onPress={() => toggle(qi, oi, q.multi)}
                        >
                          <View style={[s.tick, q.multi && s.tickBox, on && s.tickOn]}>
                            {on && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
                          </View>
                          <Text style={[s.answerText, on && s.answerTextOn]}>{opt}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}

              <View style={s.qcard}>
                <Text style={s.qtext}>{u('comment_label', 'Anything else?')}</Text>
                <TextInput
                  style={[s.input, s.textarea]}
                  value={comment}
                  onChangeText={setComment}
                  placeholder={u('comment_placeholder', '')}
                  placeholderTextColor={t.muted2}
                  multiline
                />
              </View>

              {!!error && <Text style={s.error}>{error}</Text>}

              <View style={s.actions}>
                <TouchableOpacity
                  style={s.ghost}
                  onPress={() => { setStep('about'); scroller.current?.scrollTo({ y: 0, animated: false }); }}
                >
                  <Text style={s.ghostText}>{u('back', 'Back')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.cta, sending && s.ctaOff]} disabled={sending} onPress={submit}>
                  {sending
                    ? <ActivityIndicator color={t.ctaText} size="small" />
                    : <Text style={s.ctaText}>{u('submit', 'Submit')}</Text>}
                </TouchableOpacity>
                <Text style={s.hint}>
                  {u('answered', '{n} of {total} answered', { n: answeredCount, total: questions.length })}
                </Text>
              </View>
            </View>
          )}

          {step === 'done' && (
            <View style={s.doneWrap}>
              <View style={s.mark}><Ionicons name="checkmark" size={30} color={t.positive} /></View>
              <Text style={s.h1}>{u('thanks', 'Thanks, {name}.', { name: name.trim().split(' ')[0] })}</Text>
              <Text style={[s.lede, { textAlign: 'center' }]}>{u('thanks_body', '')}</Text>
              <TouchableOpacity style={s.ghost} onPress={startOver}>
                <Text style={s.ghostText}>{u('again', 'Fill in another')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </PageContainer>
      </ScrollView>
    </ScreenBackground>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  brandbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 12 },
  brand: { color: t.label, fontFamily: fonts[800], fontSize: 13, letterSpacing: 2.6 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  themeBtn: {
    width: 34, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: t.cta2Border,
  },
  translating: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 2 },
  translatingText: { color: t.muted, fontFamily: fonts[600], fontSize: 12.5 },

  eyebrow: { color: t.label, fontFamily: fonts[700], fontSize: 11.5, letterSpacing: 2, marginBottom: 8 },
  h1: { color: t.ink, fontFamily: fonts[800], fontSize: 30, letterSpacing: -0.6, lineHeight: 36 },
  lede: { color: t.inkSoft, fontFamily: fonts[400], fontSize: 15.5, lineHeight: 23, marginTop: 10 },
  title: { color: t.ink, fontFamily: fonts[700], fontSize: 17, textAlign: 'center' },

  panel: {
    backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder,
    borderRadius: 18, padding: 20, gap: 18,
  },
  field: { gap: 9 },
  fieldLabel: { color: t.ink, fontFamily: fonts[700], fontSize: 13 },
  req: { color: t.accent },
  input: {
    backgroundColor: t.chip, borderWidth: 1, borderColor: t.line, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, color: t.ink,
    fontFamily: fonts[500], fontSize: 15.5,
  },
  // A multiline TextInput on the web is a textarea, and its intrinsic height
  // wins over minHeight — the height has to be stated or the box is one line.
  textarea: { height: 110, textAlignVertical: 'top', paddingTop: 12 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: t.chip, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: 'transparent' },
  chipOn: { backgroundColor: t.accent, borderColor: t.accent },
  chipText: { color: t.inkSoft, fontFamily: fonts[600], fontSize: 13.5 },
  chipTextOn: { color: '#FFFFFF' },

  roleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: t.chip, borderRadius: 14, padding: 15,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  roleCardOn: { borderColor: t.accent, backgroundColor: t.accentSoft },
  roleName: { color: t.ink, fontFamily: fonts[800], fontSize: 15.5 },
  roleBlurb: { color: t.muted, fontFamily: fonts[400], fontSize: 13, marginTop: 2 },

  qcard: {
    backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder,
    borderRadius: 18, padding: 20, gap: 13,
  },
  qtop: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  qnum: { color: t.label, fontFamily: fonts[800], fontSize: 11, letterSpacing: 1.6 },
  qmulti: {
    color: t.accent, backgroundColor: t.accentSoft, fontFamily: fonts[700],
    fontSize: 10, letterSpacing: 1.2, paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999,
    overflow: 'hidden',
  },
  qtext: { color: t.ink, fontFamily: fonts[700], fontSize: 16.5, lineHeight: 23 },

  answer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 11,
    borderWidth: 1.5, borderColor: t.line, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 13,
  },
  answerOn: { borderColor: t.accent, backgroundColor: t.accentSoft },
  answerText: { color: t.inkSoft, fontFamily: fonts[500], fontSize: 14.5, lineHeight: 21, flex: 1 },
  answerTextOn: { color: t.ink },
  tick: {
    width: 20, height: 20, borderRadius: 999, borderWidth: 1.5, borderColor: t.line,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  tickBox: { borderRadius: 6 },
  tickOn: { borderColor: t.accent, backgroundColor: t.accent },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  cta: {
    backgroundColor: t.ctaBg, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 28,
    alignItems: 'center', justifyContent: 'center', minWidth: 120,
  },
  ctaOff: { opacity: 0.4 },
  ctaText: { color: t.ctaText, fontFamily: fonts[700], fontSize: 15 },
  ghost: {
    borderWidth: 1, borderColor: t.cta2Border, borderRadius: 999,
    paddingVertical: 13, paddingHorizontal: 24,
  },
  ghostText: { color: t.cta2Text, fontFamily: fonts[700], fontSize: 15 },
  hint: { color: t.muted, fontFamily: fonts[400], fontSize: 13 },
  error: { color: t.negative, fontFamily: fonts[600], fontSize: 14 },

  doneWrap: { alignItems: 'center', gap: 16, paddingVertical: 40 },
  mark: {
    width: 62, height: 62, borderRadius: 999, backgroundColor: t.positiveSoft,
    alignItems: 'center', justifyContent: 'center',
  },
});
