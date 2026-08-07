import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Platform, useWindowDimensions } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import Sheet from './Sheet';
import { Ionicons } from '@expo/vector-icons';
import { topPad } from '../responsive/screenPadding';
import { fonts } from '../theme/typography';

/**
 * Full-screen film playback.
 *
 * SIZED IN PIXELS, FROM THE FIRST FRAME. On web expo-av renders a real
 * <video>, and a <video> with no size of its own falls back to its intrinsic
 * one — 360×180 in the corner of a black screen — until layout resolves. That
 * is the "it loads tiny in the top-left, then jumps" everyone sees on a large
 * file: not slow loading, just an element with no height yet. Computing the box
 * from the window means it is the right size on the very first render, before
 * the file has sent a single byte.
 *
 * ROOM FOR THE CONTROLS. The browser draws play/pause and the scrubber INSIDE
 * the element, along its bottom edge. An element sized to the whole window puts
 * that edge at the bottom of the screen, where a laptop's own chrome sits over
 * it — so the film played but could not be paused or scrubbed. The box stops
 * short of the bottom, and CONTAIN letterboxes within it rather than cropping.
 */
export default function FilmPlayer({
  source,
  title,
  onClose,
}: {
  source: { uri: string; headers?: Record<string, string> } | null;
  title?: string;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [ready, setReady] = useState(false);

  const HEADER = 64;              // the title row above
  const BOTTOM = 28;              // clearance under the control bar
  const SIDE = 24;
  const box = {
    width: Math.max(240, width - SIDE * 2),
    height: Math.max(180, height - HEADER - BOTTOM - topPad(0)),
  };

  return (
    <Sheet visible={!!source} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000EE' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                       paddingHorizontal: 16, height: HEADER, paddingTop: topPad(0) }}>
          <Text style={{ color: '#fff', fontSize: 15, fontFamily: fonts[700], flex: 1 }} numberOfLines={1}>
            {title}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
        </View>

        {!!source && (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: SIDE }}>
            {/* The spinner sits INSIDE the final box, so the picture appears in
                place instead of the player growing into position around it. */}
            {!ready && (
              <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: box.height,
                             alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color="#fff" size="large" />
              </View>
            )}
            <Video
              source={source as any}
              style={Platform.OS === 'web'
                ? { width: box.width, height: box.height, backgroundColor: '#000' }
                : { width: '100%', height: box.height, backgroundColor: '#000' }}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              shouldPlay
              onReadyForDisplay={() => setReady(true)}
              onLoad={() => setReady(true)}
            />
          </View>
        )}
      </View>
    </Sheet>
  );
}
