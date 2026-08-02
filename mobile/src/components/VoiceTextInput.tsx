import React, { useState, useRef, useEffect } from 'react';
import { View, TextInput, TouchableOpacity, Pressable, TextInputProps, Alert, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';
import { transcribeAPI } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';

type Props = TextInputProps & {
  value?: string;
  onChangeText?: (text: string) => void;
};

/**
 * A server error as a sentence, not as "[object Object]".
 *
 * FastAPI answers a validation failure with a LIST of objects under `detail`,
 * so interpolating it into a string produced "[object Object]" — a message that
 * told a coach something broke while hiding the one fact that would explain it.
 */
function describeError(e: any): string {
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d: any) => {
        const where = Array.isArray(d?.loc) ? d.loc.filter((x: any) => x !== 'body').join('.') : '';
        return [where, d?.msg].filter(Boolean).join(': ');
      })
      .filter(Boolean);
    if (parts.length) return parts.join('\n');
  }
  if (detail && typeof detail === 'object') {
    try { return JSON.stringify(detail); } catch { /* fall through */ }
  }
  const status = e?.response?.status;
  return e?.message || (status ? `Request failed (${status})` : 'Unknown error');
}

const CHUNK_MS = 2500; // recording chunk length — shorter = words appear sooner

export default function VoiceTextInput({
  value = '',
  onChangeText,
  style,
  secureTextEntry,
  editable,
  multiline,
  ...rest
}: Props) {
  const { t } = useTheme();
  const { t: tr, i18n } = useTranslation();
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const listeningRef = useRef(false);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  const activeTranscriptions = useRef(0);
  const transcribeChainRef = useRef<Promise<void>>(Promise.resolve());
  // A failed chunk used to be discarded silently, so a server that couldn't
  // transcribe at all looked exactly like a coach who hadn't spoken: the mic
  // animated, nothing appeared, and nothing said why. These track whether the
  // session produced anything so we can tell those two cases apart on stop.
  const gotTextRef = useRef(false);
  const lastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const keyboardType = (rest as any).keyboardType;
  const showMic =
    !secureTextEntry &&
    editable !== false &&
    keyboardType !== 'email-address';

  const flatStyle = StyleSheet.flatten(style) as any || {};
  const textColor = flatStyle.color ?? t.ink;
  const fontSize = flatStyle.fontSize;
  const fontWeight = flatStyle.fontWeight;

  const appendText = (chunk: string) => {
    if (!chunk || !onChangeText) return;
    const current = valueRef.current ?? '';
    const sep = current.length > 0 && !current.endsWith(' ') ? ' ' : '';
    const next = current + sep + chunk;
    valueRef.current = next;
    onChangeText(next);
  };

  // Last ~50 words of current text as context for Whisper continuity
  const getContext = () => {
    const words = (valueRef.current ?? '').trim().split(/\s+/).filter(Boolean);
    return words.slice(-50).join(' ') || undefined;
  };

  const startChunk = async () => {
    if (!listeningRef.current) return;
    try {
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      chunkTimerRef.current = setTimeout(processChunk, CHUNK_MS);
    } catch {
      listeningRef.current = false;
      setListening(false);
    }
  };

  const processChunk = async () => {
    const recording = recordingRef.current;
    if (!recording) return;
    recordingRef.current = null;
    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }

    let uri: string | null = null;
    try {
      await recording.stopAndUnloadAsync();
      uri = recording.getURI();
    } catch {
      // ignore stop errors
    }

    // Resume recording IMMEDIATELY so no speech is lost while the
    // previous clip uploads and transcribes in the background.
    if (listeningRef.current) startChunk();

    if (!uri) return;
    const clipUri = uri;
    activeTranscriptions.current += 1;
    setTranscribing(true);
    // Chain transcriptions so chunks append in order and the server
    // handles one request at a time. Context is read at run time so it
    // includes everything appended from earlier chunks.
    transcribeChainRef.current = transcribeChainRef.current.then(async () => {
      try {
        const text = await transcribeAPI.transcribe(clipUri, getContext(), i18n.language);
        if (text) {
          gotTextRef.current = true;
          appendText(text);
        }
      } catch (e: any) {
        // Keep going — one bad chunk shouldn't end the session — but remember
        // why, so stopRecording can report it if nothing ever came through.
        lastErrorRef.current = describeError(e);
      } finally {
        activeTranscriptions.current -= 1;
        if (activeTranscriptions.current === 0) setTranscribing(false);
      }
    });
  };

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert(tr('components.voiceInput.permissionTitle'), tr('components.voiceInput.permissionMsg'));
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      gotTextRef.current = false;
      lastErrorRef.current = null;
      listeningRef.current = true;
      setListening(true);
      await startChunk();
    } catch {
      Alert.alert(tr('common.error'), tr('components.voiceInput.recordFailed'));
    }
  };

  const stopRecording = async () => {
    listeningRef.current = false;
    setListening(false);
    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    await processChunk();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

    // Wait for the last chunks to finish before judging the session. Reported
    // once, on stop, rather than per chunk — a two-minute dictation against a
    // misconfigured server would otherwise fire fifty alerts.
    try {
      await transcribeChainRef.current;
    } catch {
      // the chain never rejects; each chunk handles its own failure
    }
    if (!gotTextRef.current && lastErrorRef.current) {
      Alert.alert(
        tr('components.voiceInput.transcribeFailedTitle'),
        `${tr('components.voiceInput.transcribeFailed')}\n\n${lastErrorRef.current}`,
      );
      lastErrorRef.current = null;
    }
  };

  const toggleVoice = () => (listening ? stopRecording() : startRecording());

  const micColor = listening ? t.accent : transcribing ? t.brown : t.muted2;
  const micIcon: any = listening ? 'mic' : transcribing ? 'hourglass-outline' : 'mic-outline';

  // Tapping anywhere in the box (padding, or the empty area of a multiline
  // field) focuses the input — not just the exact text glyphs.
  const focusInput = () => {
    if (editable !== false) inputRef.current?.focus();
  };

  return (
    <Pressable
      onPress={focusInput}
      style={[
        style,
        {
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
        },
      ]}
    >
      <TextInput
        ref={inputRef}
        {...rest}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        editable={editable}
        style={{
          flex: 1,
          // Web only: in a narrow desktop column the field refuses to shrink
          // below its placeholder and pushes the mic button outside the box.
          // Native never puts these fields in a narrow column, and the phone
          // layout is not mine to change.
          ...(Platform.OS === 'web' ? { minWidth: 0 } : null),
          alignSelf: 'stretch',
          backgroundColor: 'transparent',
          borderWidth: 0,
          padding: 0,
          margin: 0,
          color: textColor,
          fontSize,
          fontWeight,
          ...(multiline ? { textAlignVertical: 'top' as const } : null),
        }}
      />
      {showMic && (
        <TouchableOpacity
          onPress={toggleVoice}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
          style={{ paddingLeft: 8, paddingTop: multiline ? 2 : 0 }}
        >
          <Ionicons name={micIcon} size={17} color={micColor} />
        </TouchableOpacity>
      )}
    </Pressable>
  );
}
