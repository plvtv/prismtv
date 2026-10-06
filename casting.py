"""Ephemeral, paired browser receivers for PrismTV's home-network server."""
import math
import secrets
import threading
import time
from urllib.parse import urlparse


class CastError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def number(value, default=0):
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return max(0, min(float(value), 1_000_000_000))
    return default


def media_payload(value):
    if not isinstance(value, dict) or value.get('kind') not in ('hls', 'file', 'embed'):
        raise CastError(400, 'Choose a playable video first.')
    url = value.get('url', '')
    if not isinstance(url, str) or len(url) > 8192:
        raise CastError(400, 'Invalid media URL.')
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise CastError(400, 'Only http and https media URLs are accepted.')
    if value['kind'] == 'embed' and not (
        parsed.hostname in ('www.youtube.com', 'www.youtube-nocookie.com') and parsed.path.startswith('/embed/')
        or parsed.hostname == 'player.twitch.tv'
    ):
        raise CastError(400, 'This embedded player cannot be sent to another device.')
    return {
        'kind': value['kind'], 'url': url,
        'title': str(value.get('title', 'PrismTV'))[:200],
        'live': bool(value.get('live')), 'position': number(value.get('position')),
        'contentType': value.get('contentType') if value.get('contentType') in
        ('video/mp4', 'video/webm', 'video/ogg', 'application/x-mpegURL') else 'video/mp4',
    }


class CastSessions:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.sessions = {}
        self.lock = threading.Lock()

    def handle(self, action, key='', data=None):
        data = data or {}
        with self.lock:
            now = self.clock()
            self.sessions = {k: s for k, s in self.sessions.items() if now - s['seen'] < 3600}
            if action == 'create':
                if len(self.sessions) >= 64:
                    raise CastError(429, 'Too many active pairing links. Try again later.')
                owner, receiver = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
                self.sessions[owner] = {'receiverKey': receiver, 'seen': now, 'devices': {}}
                return {'key': owner, 'receiverKey': receiver}
            owner = key in self.sessions
            session = self.sessions.get(key) if owner else next(
                (s for s in self.sessions.values() if secrets.compare_digest(s['receiverKey'], key)), None)
            if not session:
                raise CastError(404, 'This pairing link expired. Create a new link in the Cast panel.')
            session['seen'] = now
            session['devices'] = {i: d for i, d in session['devices'].items() if now - d['seen'] < 300}
            if action == 'join':
                if owner:
                    raise CastError(403, 'Use the receiving-device link to connect.')
                active = [d for d in session['devices'].values() if now - d['seen'] < 20]
                if len(active) >= 8:
                    raise CastError(429, 'Eight devices are already connected to this pairing link.')
                device_id = secrets.token_urlsafe(12)
                session['devices'][device_id] = {
                    'name': str(data.get('name', 'Receiving device')).strip()[:60] or 'Receiving device',
                    'seen': now, 'revision': 0, 'mediaRevision': 0, 'media': None, 'command': None,
                    'status': {'phase': 'ready', 'position': 0, 'paused': True},
                }
                return {'deviceId': device_id}
            if action == 'state' and owner:
                return {'devices': [dict(id=i, name=d['name'], media=d['media'], **d['status'])
                                    for i, d in session['devices'].items() if now - d['seen'] < 20]}
            device = session['devices'].get(data.get('deviceId', ''))
            if not device:
                raise CastError(404, 'The receiving device is no longer connected.')
            if action == 'state' and not owner:
                device['seen'] = now
                return {k: device[k] for k in ('revision', 'mediaRevision', 'media', 'command')}
            if action == 'report' and not owner:
                phase = data.get('phase', 'ready')
                if phase not in ('ready', 'loading', 'playing', 'paused', 'needs-play', 'embedded', 'error'):
                    raise CastError(400, 'Invalid receiver status.')
                device['seen'] = now
                device['status'] = {'phase': phase, 'paused': bool(data.get('paused', True)),
                                    'position': number(data.get('position')),
                                    'message': str(data.get('message', ''))[:200]}
                return {'ok': True}
            if action == 'leave' and not owner:
                del session['devices'][data['deviceId']]
                return {'ok': True}
            if action == 'command' and owner:
                if now - device['seen'] >= 20:
                    raise CastError(409, 'The device went offline. Open its receiving page again.')
                command = data.get('command')
                if command not in ('load', 'play', 'pause', 'stop'):
                    raise CastError(400, 'Unknown playback command.')
                if command == 'load':
                    device['media'] = media_payload(data.get('media'))
                    device['mediaRevision'] += 1
                    device['status'] = {'phase': 'loading', 'position': device['media']['position'], 'paused': False}
                elif command == 'stop':
                    device['media'] = None
                    device['mediaRevision'] += 1
                    device['status'] = {'phase': 'ready', 'position': 0, 'paused': True}
                device['revision'] += 1
                device['command'] = command
                return {'ok': True}
            raise CastError(403, 'This pairing key cannot perform that action.')
