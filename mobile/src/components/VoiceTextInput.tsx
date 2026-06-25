import React, { useState, useRef } from 'react';
import { View, TextInput, TouchableOpacity, TextInputProps, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { transcribeAPI } from '../api/client';

type Props = TextInputProps & {
  value?: string;
  onChangeText?: (text: string) => void;
};

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

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission required', 'Microphone access is needed for voice input.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setListening(true);
    } catch {
      Alert.alert('Error', 'Could not start recording.');
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;
    setListening(false);
    setTranscribing(true);
    try {
      await recordingRef.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      if (!uri) return;
      const text = await transcribeAPI.transcribe(uri);
      if (text && onChangeText) {
        const current = value ?? '';
        const sep = current.length > 0 && !current.endsWith(' ') ? ' ' : '';
        onChangeText(current + sep + text);
      }
    } catch {
      Alert.alert('Error', 'Could not transcribe. Make sure the server is running.');
    } finally {
      setTranscribing(false);
    }
  };

  const toggleVoice = () => (listening ? stopRecording() : startRecording());

  const micColor = transcribing ? '#f59e0b' : listening ? '#7c3aed' : '#6b7280';
  const micIcon: any = transcribing ? 'hourglass-outline' : listening ? 'mic' : 'mic-outline';

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
          disabled={transcribing}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
          style={{ paddingLeft: 8, paddingTop: multiline ? 2 : 0 }}
        >
          <Ionicons name={micIcon} size={17} color={micColor} />
        </TouchableOpacity>
      )}
    </View>
  );
}
