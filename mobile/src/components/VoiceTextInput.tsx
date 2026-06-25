import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

type Props = TextInputProps & {
  value?: string;
  onChangeText?: (text: string) => void;
};

export default function VoiceTextInput({ value = '', onChangeText, style, secureTextEntry, editable, ...rest }: Props) {
  const [listening, setListening] = useState(false);

  const showMic = !secureTextEntry && editable !== false;

  useSpeechRecognitionEvent('result', (event) => {
    if (!listening) return;
    const transcript = event.results[0]?.transcript ?? '';
    if (transcript && onChangeText) {
      const current = value ?? '';
      const sep = current.length > 0 && !current.endsWith(' ') ? ' ' : '';
      onChangeText(current + sep + transcript);
    }
  });

  useSpeechRecognitionEvent('end', () => {
    if (listening) setListening(false);
  });

  useSpeechRecognitionEvent('error', () => {
    if (listening) setListening(false);
  });

  const toggleVoice = async () => {
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      setListening(false);
      return;
    }
    const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) return;
    setListening(true);
    ExpoSpeechRecognitionModule.start({ lang: 'en-US' });
  };

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
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{
            position: 'absolute',
            right: 10,
            top: 0,
            bottom: 0,
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name={listening ? 'mic' : 'mic-outline'}
            size={17}
            color={listening ? '#7c3aed' : '#6b7280'}
          />
        </TouchableOpacity>
      )}
    </View>
  );
}
