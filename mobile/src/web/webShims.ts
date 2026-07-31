/**
 * Browser behaviour the React Native web layer doesn't provide.
 *
 * Imported once, for its side effects, before the app renders. Everything here
 * is a no-op on iOS and Android.
 */
import { Alert, Platform } from 'react-native';

/**
 * react-native-web ships `class Alert { static alert() {} }` — a function that
 * does nothing at all. Every error message, every delete confirmation, every
 * "are you sure" in this app goes through Alert.alert, so on web all 291 of
 * them were silent: a failed login looked like a dead button, and a destructive
 * confirm looked like nothing happened.
 *
 * Patching Alert itself rather than introducing a wrapper means every existing
 * call site is fixed without touching it, and native is untouched.
 */
function installAlert() {
  type Btn = { text?: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' };

  (Alert as any).alert = (
    title?: string,
    message?: string,
    buttons?: Btn[],
    _options?: unknown,
  ) => {
    const body = [title, message].filter(Boolean).join('\n\n');
    const list = buttons ?? [];

    // No choice to make — just tell them.
    if (list.length <= 1) {
      window.alert(body);
      list[0]?.onPress?.();
      return;
    }

    // A choice. The cancel button is whichever is marked as such (RN convention
    // puts it first); the action is the last one that isn't cancel, which is
    // where RN puts the confirm on both platforms.
    const cancel = list.find(b => b.style === 'cancel');
    const action = [...list].reverse().find(b => b.style !== 'cancel') ?? list[list.length - 1];

    if (window.confirm(body)) action?.onPress?.();
    else cancel?.onPress?.();
  };
}

/**
 * The browser's default focus ring is drawn tight around the <input> itself,
 * which sits inside a padded container — so it reads as a small blue rectangle
 * floating inside the field rather than as the field being focused.
 *
 * Removing it outright would leave keyboard users with no focus indication, so
 * this suppresses it for pointer focus only and keeps a deliberate ring for
 * :focus-visible, which browsers set when focus came from the keyboard.
 */
function installGlobalCss() {
  const css = `
    /* Fill the viewport so the app's own background covers the page. */
    html, body, #root { height: 100%; margin: 0; }
    body { overscroll-behavior: none; }

    /* Text fields: no ring at all. Chrome treats a mouse click on an input as
       :focus-visible (because it accepts typing next), so suppressing only
       :focus leaves the ring on regardless. A text field already shows focus
       unambiguously — it has the caret — which is the case for removing it
       here and nowhere else. It also looked wrong: the ring hugs the bare
       <input>, which sits inside a padded container, so it read as a small
       blue rectangle floating inside the field. */
    input:focus, input:focus-visible,
    textarea:focus, textarea:focus-visible,
    select:focus, select:focus-visible,
    [contenteditable]:focus, [contenteditable]:focus-visible {
      outline: none;
      box-shadow: none;
    }

    /* Buttons and links keep a keyboard focus ring: they have no caret, so
       without one a keyboard user cannot tell what they're about to activate. */
    button:focus-visible, a:focus-visible,
    [role="button"]:focus-visible, [tabindex]:focus-visible {
      outline: 2px solid rgba(35, 110, 150, 0.65);
      outline-offset: 2px;
      border-radius: 8px;
    }

    /* Match the type rendering the native apps get. */
    * { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }

    /* The app scrolls its own panes; the page itself never should. */
    body { overflow: hidden; }
  `;
  const tag = document.createElement('style');
  tag.setAttribute('data-bloomprint', 'web-shims');
  tag.appendChild(document.createTextNode(css));
  document.head.appendChild(tag);
}

if (Platform.OS === 'web') {
  installAlert();
  if (typeof document !== 'undefined') installGlobalCss();
}

export {};
