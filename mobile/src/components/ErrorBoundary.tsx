import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';

/**
 * Catches a render crash anywhere below it and shows a recoverable screen.
 *
 * Without this, one thrown error unmounts the whole tree and the app goes
 * white with no way back except force-quitting — the coach loses whatever
 * they were doing and has no idea why. "Try again" remounts the subtree, which
 * clears the vast majority of these (a bad field on one record, a transient
 * shape from the API) without restarting the app.
 *
 * Deliberately not translated: this renders precisely when the app is in an
 * unknown state, and reading i18n through a broken tree is one more thing that
 * can throw. English here is the safe choice.
 */
type Props = { children: React.ReactNode; onReset?: () => void };
type State = { error: Error | null };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the component stack in the dev console — the message alone rarely
    // says which screen threw.
    console.error('Unhandled render error:', error, info?.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.sub}>
          The screen you were on hit an error. Your data is safe — nothing was lost.
        </Text>
        <ScrollView style={styles.detailBox} contentContainerStyle={{ padding: 12 }}>
          <Text style={styles.detail}>{String(error?.message || error)}</Text>
        </ScrollView>
        <TouchableOpacity style={styles.btn} onPress={this.reset} accessibilityRole="button">
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0C2331', alignItems: 'center', justifyContent: 'center', padding: 28 },
  title: { color: '#F5EFE3', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  sub: { color: '#9FB3C0', fontSize: 14, textAlign: 'center', marginTop: 10, lineHeight: 20 },
  detailBox: {
    maxHeight: 160, alignSelf: 'stretch', marginTop: 20,
    backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10,
  },
  detail: { color: '#9FB3C0', fontSize: 12, fontFamily: 'Courier' },
  btn: {
    marginTop: 24, backgroundColor: '#E8A33D', borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 40,
  },
  btnText: { color: '#0C2331', fontSize: 15, fontWeight: '800' },
});
