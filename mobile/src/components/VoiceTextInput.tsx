import React, { useState, useRef, useEffect } from 'react';
import { View, TextInput, TouchableOpacity, Pressable, TextInputProps, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';
import { transcribeAPI } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';

type Props = TextInputProps & {
  value?: string;
  onChangeText?: (text: string) => void;
};

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
  const { t: tr } = useTranslation();
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const listeningRef = useRef(false);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  const activeTranscriptions = useRef(0);
  const transcribeChainRef = useRef<Promise<void>>(Promise.resolve());

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
        const text = await transcribeAPI.transcribe(clipUri, getContext());
        if (text) appendText(text);
      } catch {
        // silently skip bad chunks
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
