// The LG remote's keys, and the desktop keys that stand in for them in a browser.
export type Key =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'ok'
  | 'back'
  | 'play'
  | 'pause'
  | 'playPause'
  | 'next'
  | 'restart'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'micUp'
  | 'micDown';

const BY_CODE: Record<number, Key> = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  13: 'ok',
  461: 'back', // webOS Back (disableBackHistoryAPI sends it to the app)
  27: 'back',
  415: 'play',
  19: 'pause',
  179: 'playPause',
  417: 'next', // fast-forward
  412: 'restart', // rewind
  403: 'red',
  404: 'green',
  405: 'yellow',
  406: 'blue',
  33: 'micUp', // CH+
  34: 'micDown', // CH-
};

const BY_NAME: Record<string, Key> = {
  ArrowLeft: 'left',
  ArrowUp: 'up',
  ArrowRight: 'right',
  ArrowDown: 'down',
  Enter: 'ok',
  Escape: 'back',
  MediaPlayPause: 'playPause',
  MediaPlay: 'play',
  MediaPause: 'pause',
  MediaTrackNext: 'next',
  MediaFastForward: 'next',
  MediaRewind: 'restart',
  MediaTrackPrevious: 'restart',
  PageUp: 'micUp',
  PageDown: 'micDown',
};

export function keyOf(event: { keyCode?: number; key?: string }): Key | null {
  if (event.keyCode !== undefined && BY_CODE[event.keyCode]) return BY_CODE[event.keyCode];
  if (event.key && BY_NAME[event.key]) return BY_NAME[event.key];
  return null;
}
