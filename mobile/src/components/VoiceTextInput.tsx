import React, { useState, useRef, useEffect } from 'react';
import { View, TextInput, TouchableOpacity, TextInputProps, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { transcribeAPI } from '../api/client';

type Props = TextInputProps & {
  value?: string;
  onChangeText?: (text: string) => void;
};

const CHUNK_MS = 4000; // send a chunk to Whisper every 4 seconds

export default function VoiceTextInput({
  value = '',
  onChangeText,
  style,
  secureTextEntry,
  editable,
  multiline,
  ...rest
}: Props) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const listeningRef = useRef(false);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const valueRef = useRef(value);
  const transcribingCountRef = useRef(0);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Don't show mic for passwords, read-only fields, or email fields
  const keyboardType = (rest as any).keyboardType;
  const showMic =
    !secureTextEntry &&
    editable !== false &&
    keyboardType !== 'email-address';

  const flatStyle = StyleSheet.flatten(style) as any || {};
  const textColor = flatStyle.color ?? '#f9fafb';
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

  const startChunk = async () => {
    if (!listeningRef.current) return;
    try {
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;

      chunkTimerRef.current = setTimeout(() => {
        processChunk();
      }, CHUNK_MS);
    } catch {
      // recording failed, stop listening
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

    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      if (uri) {
        transcribingCountRef.current += 1;
        setTranscribing(true);
        try {
          const text = await transcribeAPI.transcribe(uri);
          if (text) appendText(text);
        } catch {
          // silently ignore chunk errors
        } finally {
          transcribingCountRef.current -= 1;
          if (transcribingCountRef.current === 0) setTranscribing(false);
        }
      }
    } catch {
      // ignore stop errors
    }

    // Start the next chunk if still listening
    if (listeningRef.current) {
      startChunk();
    }
  };

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission required', 'Microphone access is needed for voice input.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      listeningRef.current = true;
      setListening(true);
      await startChunk();
    } catch {
      Alert.alert('Error', 'Could not start recording.');
    }
  };

  const stopRecording = async () => {
    listeningRef.current = false;
    setListening(false);
    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    // Transcribe whatever is in the current chunk
    await processChunk();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
  };

  const toggleVoice = () => (listening ? stopRecording() : startRecording());

  const micColor = listening ? '#7c3aed' : transcribing ? '#f59e0b' : '#6b7280';
  const micIcon: any = listening ? 'mic' : transcribing ? 'hourglass-outline' : 'mic-outline';

  return (
    <View
      style={[
        style,
        {
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
        },
      ]}
    >
      <TextInput
        {...rest}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        editable={editable}
        style={{
          flex: 1,
          backgroundColor: 'transparent',
          borderWidth: 0,
          padding: 0,
          margin: 0,
          color: textColor,
          fontSize,
          fontWeight,
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
    </View>
  );
}
