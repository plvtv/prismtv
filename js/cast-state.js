export function castFailure(error, phase = 'connect') {
  const code = error?.code || error;
  if (['cancel', 'cancelled'].includes(code) || error?.name === 'NotAllowedError') return null;
  if (code === 'receiver_unavailable') return 'No Chromecast TV was found. Check that the TV is awake and both devices are on the same Wi-Fi, then try again.';
  if (code === 'timeout') return 'The TV did not respond in time. Check its connection, then retry.';
  if (code === 'session_error' || code === 'channel_error') return 'The connection to the TV was lost. Reconnect and try again.';
  if (phase === 'load' || ['load_media_failed', 'invalid_parameter'].includes(code)) return 'The TV could not play this source. Try another source; its format or provider access may not be supported by the TV.';
  return error?.message || 'Could not connect to the TV. Check its Wi-Fi connection and retry.';
}
export function describeMedia(remote) {
  if (!remote?.media?.contentId) return null;
  const info = remote.media;
  return {url:info.contentId, title:info.metadata?.title || 'PrismTV video', live:info.streamType === 'LIVE',
    kind: /mpegurl/i.test(info.contentType || '') ? 'hls' : 'file', contentType:info.contentType || 'video/mp4'};
}
export function castPhase(remote) {
  if (!remote) return 'connected';
  return ({PLAYING:'playing',PAUSED:'paused',BUFFERING:'loading'})[remote.playerState] ||
    (remote.idleReason === 'ERROR' ? 'error' : remote.idleReason === 'FINISHED' ? 'finished' : 'connected');
}
export function timeLabel(seconds) {
  const s=Math.max(0,Math.floor(Number(seconds) || 0));
  const h=Math.floor(s/3600),m=Math.floor(s%3600/60);
  return (h ? h+':'+String(m).padStart(2,'0') : m)+':'+String(s%60).padStart(2,'0');
}
