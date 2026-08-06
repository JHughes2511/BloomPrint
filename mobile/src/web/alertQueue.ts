/**
 * The queue behind the browser's replacement for Alert.alert.
 *
 * Plain module, no JSX and no React import: webShims runs for its side effects
 * before the app renders, and it has to be able to hand an alert over at that
 * point without pulling a component tree in with it. AppAlert subscribes from
 * inside the tree and does the drawing.
 */
export type AlertButton = {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

export type AlertRequest = {
  id: number;
  title?: string;
  message?: string;
  buttons: AlertButton[];
};

type Listener = (current: AlertRequest | null) => void;

let queue: AlertRequest[] = [];
let listener: Listener | null = null;
let nextId = 1;

const publish = () => listener?.(queue[0] ?? null);

/** Called by AppAlert when it mounts. One host; the last to subscribe wins. */
export function subscribeToAlerts(fn: Listener | null) {
  listener = fn;
  publish();
}

export function pushAlert(title?: string, message?: string, buttons?: AlertButton[]) {
  // An alert with no buttons still needs a way out. RN does the same thing:
  // a bare Alert.alert('Saved') gets an OK.
  const list = buttons?.length ? buttons : [{ text: 'OK' }];
  queue = [...queue, { id: nextId++, title, message, buttons: list }];
  publish();
}

/** Drop the alert on screen and show whatever is behind it. */
export function resolveAlert(id: number) {
  queue = queue.filter(a => a.id !== id);
  publish();
}
