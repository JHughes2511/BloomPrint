/**
 * Browser behaviour the React Native web layer doesn't provide.
 *
 * Imported once, for its side effects, before the app renders. Everything here
 * is a no-op on iOS and Android.
 */
import { Alert, Platform } from 'react-native';
import { pushAlert } from './alertQueue';

/**
 * react-native-web ships `class Alert { static alert() {} }` — a function that
 * does nothing at all. Every error message, every delete confirmation, every
 * "are you sure" in this app goes through Alert.alert, so on web all 299 of
 * them were silent: a failed login looked like a dead button, and a destructive
 * confirm looked like nothing happened.
 *
 * This used to hand them to window.alert and window.confirm. That worked, at
 * two costs a browser will not let you avoid: it labels its dialogs with the
 * site's own name — "bloomprint.org says" above "Remove Brady Smith from the
 * roster?" — and window.confirm offers exactly two answers, so a three-button
 * alert lost one without saying so. Alerts are queued for AppAlert to draw
 * instead; see src/components/AppAlert.tsx.
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
  ) => pushAlert(title, message, buttons);
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

    /* iOS Safari zooms the whole page when a field smaller than 16px takes
       focus, and stays zoomed after the keyboard closes — so tapping a search
       box left the app scaled up and scrolled sideways.

       16px is the entire fix. maximum-scale and user-scalable are the usual
       suggestions and do nothing: iOS has ignored both since iOS 10 precisely
       so that pages cannot disable pinch zoom, and disabling it is not
       something we would want anyway.

       Phone widths only. Wider windows keep the sizes the design uses, and no
       desktop browser zooms on focus.

       !important is required, not defensive: react-native-web writes font-size
       as an inline style on every field, and an inline style beats a stylesheet
       rule. Without it this silently does nothing — the fields stay at 15px and
       keep zooming. */
    @media (max-width: 767px) {
      input, textarea, select { font-size: 16px !important; }
    }

    /* The app scrolls its own panes; the page itself never should. */
    body { overflow: hidden; }

    /* A background on the document, not only inside the app.
       Every screen paints its own gradient, but the page beneath it is white by
       default — so overscrolling in a phone browser shows a white band above or
       below, and the keyboard accessory bar sits against it. ThemeProvider
       replaces this with the live theme's colour; this value only has to hold
       for the moment before React runs, so it matches the dark canvas the app
       opens in. */
    html, body { background-color: #0C2331; }
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
