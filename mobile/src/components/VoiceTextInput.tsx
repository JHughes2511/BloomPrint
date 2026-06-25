import React, { useState, useRef } from 'react';
import { View, TextInput, TouchableOpacity, TextInputProps, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { transcribeAPI } from '../api/client';

type Props = TextInputProps & {
  value?: string;
  onChangeText?: (text: string) => void;
};

export default function VoiceTextInput({ value = '', onChangeText, style, secureTextEntry, editable, ...rest }: Props) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);

  const showMic = !secureTextEntry && editable !== false;

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
      Alert.alert('Error', 'Could not transcribe audio. Make sure the server is running.');
    } finally {
      setTranscribing(false);
    }
  };

  const toggleVoice = () => {
    if (listening) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const micColor = transcribing ? '#f59e0b' : listening ? '#7c3aed' : '#6b7280';
  const micIcon = transcribing ? 'hourglass-outline' : listening ? 'mic' : 'mic-outline';

  return (
    <View style={{ position: 'relative' }}>
      <TextInput
        {...rest}
        value={value}
        onChangeText={onChangeText}
        style={[style, showMic ? { paddingRight: 36 } : undefined]}
        secureTextEntry={secureTextEntry}
        editable={editable}
      />
      {showMic && (
        <TouchableOpacity
          onPress={toggleVoice}
          disabled={transcribing}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            position: 'absolute',
            right: 10,
            top: 0,
            bottom: 0,
            justifyContent: 'center',
          }}
        >
          <Ionicons name={micIcon as any} size={17} color={micColor} />
        </TouchableOpacity>
      )}
    </View>
  );
}
