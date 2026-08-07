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

  // Everything the film has to share the window with. The title row and the
  // close button sit ABOVE it (they used to overlap it), and the browser draws
  // play/pause and the scrubber along the film's own bottom edge — so that edge
  // has to stop short of the window, or the controls are simply off-screen.
  const TOP = topPad(0);          // status bar / browser chrome
  const HEADER = 56;              // the title row and close button
  const BOTTOM = 32;              // clearance below the control bar
  const SIDE = 24;
  const box = {
    width: Math.max(240, width - SIDE * 2),
    height: Math.max(180, height - TOP - HEADER - BOTTOM),
  };

  return (
    <Sheet visible={!!source} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000EE' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                       paddingHorizontal: 16, height: HEADER, marginTop: TOP }}>
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
            {/* videoStyle, not just style.
                expo-av puts `style` on a wrapper View and gives the actual
                <video> `position:absolute; inset:0` — then overrides
                `position: undefined` on the same element. Static positioning
                ignores those offsets, so the element falls back to its
                intrinsic 300x150 in the wrapper's top-left corner and stays
                there until the browser has metadata. That is the film loading
                in the corner before it jumps; sizing the wrapper cannot fix it,
                because the wrapper was never the element with the problem.
                videoStyle lands on the <video> itself, ahead of that override,
                so it has real dimensions from the first paint. */}
            <Video
              source={source as any}
              style={{ width: box.width, height: box.height, backgroundColor: '#000' }}
              videoStyle={{ width: box.width, height: box.height }}
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
