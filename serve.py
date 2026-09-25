#!/usr/bin/env python3
"""
PrismTV local server.

Serves the app's files and adds a tiny bridge that hands a stream URL to mpv on
this machine. That matters because a browser is the weakest possible IPTV client:
it refuses cross-origin streams, cannot set a User-Agent or Referer, and cannot
touch a YouTube or Twitch page. mpv (with yt-dlp) has none of those limits.

Endpoints, all bound to localhost only:
  GET /api/health         -> whether mpv and yt-dlp are on PATH
  GET /api/play?url=&title=  -> launch mpv on that URL
  GET /api/stop           -> stop players this server started
  GET /api/hls?url=       -> relay an HLS playlist or segment for the browser
                             (&raw=1 returns a playlist untouched, for channel lists)
  POST /api/scan          -> body {"urls": [...], "force": bool}: check streams in the background
  GET /api/scan           -> progress, plus {"results": {url: status}} with ?results=1

The scan runs here rather than in the browser because the browser cannot read most
stream servers (see the relay above), while this machine sees them exactly as a
player would, region locks included. Results are kept in .stream-health.json for
SCAN_TTL seconds, so a rescan only rechecks stale entries.

The relay exists because many broadcasters never send Access-Control-Allow-Origin,
so the browser refuses their streams even though they are up. Fetched here and
served from localhost, the same stream is same-origin and plays. Playlists are
rewritten so every segment, key and variant also comes through the relay. Only
used for sources the browser was blocked from; everything else stays direct.

Safety: only http/https URLs are accepted, mpv is launched via argv (never a
shell), no option may come from the client, and by default the socket is bound to
127.0.0.1 so nothing off this machine can reach it.

Home-network mode (`./serve.sh --lan`): binds to all interfaces so phones, tablets
and TVs on the same Wi-Fi can open PrismTV. Requests from anything that is not a
private/home-network address are refused, and mpv (/api/play, /api/stop) still
only answers this Mac, so another device cannot start players on it.
"""
import http.server
import ipaddress
import re
import socket
import urllib.error
import urllib.request
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse, parse_qs, urljoin, quote

ROOT = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[1:]
LAN = '--lan' in ARGS
PORT = next((int(a) for a in ARGS if a.isdigit()), 8080)


def is_local(ip):
    try:
        return ipaddress.ip_address(ip.split('%')[0]).is_loopback
    except ValueError:
        return False


def is_home_network(ip):
    """Loopback, private (10/8, 172.16/12, 192.168/16, fc00::/7) or link-local addresses only."""
    try:
        a = ipaddress.ip_address(ip.split('%')[0])
    except ValueError:
        return False
    if getattr(a, 'ipv4_mapped', None):
        a = a.ipv4_mapped
    return a.is_loopback or a.is_private or a.is_link_local


def lan_addresses():
    """This Mac's address on the home network, plus its Bonjour name (works on iPhones and most TVs)."""
    out = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('192.0.2.1', 9))          # no packet is sent; this only picks the outgoing interface
        ip = s.getsockname()[0]
        s.close()
        if not ip.startswith('127.'):
            out.append('http://%s:%d' % (ip, PORT))
    except OSError:
        pass
    try:
        name = subprocess.run(['scutil', '--get', 'LocalHostName'], capture_output=True, text=True, timeout=3).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        name = ''
    if not name:
        name = socket.gethostname().split('.')[0]
    if name:
        out.append('http://%s.local:%d' % (name, PORT))
    return out
PLAYERS = []

RELAY_UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
            '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')
RELAY_TIMEOUT = 15
RELAY_CHUNK = 64 * 1024
PLAYLIST_TYPES = ('mpegurl', 'm3u')
URI_ATTR = re.compile(r'URI="([^"]+)"')


def relay_link(target):
    return '/api/hls?url=' + quote(target, safe='')


def rewrite_playlist(text, base):
    """Point every URI in an HLS playlist back at the relay, resolved against `base`."""
    out = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            out.append(line)
        elif stripped.startswith('#'):
            out.append(URI_ATTR.sub(lambda m: 'URI="' + relay_link(urljoin(base, m.group(1))) + '"', line))
        else:
            out.append(relay_link(urljoin(base, stripped)))
    return '\n'.join(out) + '\n'


SCAN_FILE = os.path.join(ROOT, '.stream-health.json')
SCAN_TTL = 12 * 3600
SCAN_WORKERS = 96
SCAN_TIMEOUT = 8
SCAN = {'lock': threading.Lock(), 'running': False, 'total': 0, 'done': 0,
        'started': 0, 'finished': 0, 'results': {}}


def load_scan():
    try:
        with open(SCAN_FILE) as fh:
            SCAN['results'] = json.load(fh)
    except (OSError, ValueError):
        SCAN['results'] = {}


def save_scan():
    tmp = SCAN_FILE + '.tmp'
    with SCAN['lock']:
        data = json.dumps(SCAN['results'])
    with open(tmp, 'w') as fh:
        fh.write(data)
    os.replace(tmp, SCAN_FILE)


def check_stream(url):
    """'ok' if it serves a playlist or media, 'forbidden' on 401/403, 'dead' otherwise."""
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        return 'dead'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': RELAY_UA, 'Accept': '*/*'})
        with urllib.request.urlopen(req, timeout=SCAN_TIMEOUT) as res:
            head = res.read(2048)
            ctype = (res.headers.get('Content-Type') or '').lower()
            if head.lstrip().startswith(b'#EXTM3U') or 'mpegurl' in ctype:
                return 'ok' if b'#EXT' in head else 'dead'
            if ctype.startswith(('video/', 'audio/')) or head[:1] == b'G' or 'octet-stream' in ctype:
                return 'ok'
            return 'dead'
    except urllib.error.HTTPError as err:
        return 'forbidden' if err.code in (401, 403, 451) else 'dead'
    except Exception:
        return 'dead'


def run_scan(urls):
    def one(url):
        status = check_stream(url)
        with SCAN['lock']:
            SCAN['results'][url] = [status, int(time.time())]
            SCAN['done'] += 1
            done = SCAN['done']
        if done % 500 == 0:
            save_scan()
    try:
        with ThreadPoolExecutor(max_workers=SCAN_WORKERS) as pool:
            list(pool.map(one, urls))
    finally:
        save_scan()
        with SCAN['lock']:
            SCAN['running'] = False
            SCAN['finished'] = int(time.time())


def host_allowed(host):
    """Refuse loopback / unspecified targets so the relay cannot be pointed back at itself."""
    if not host or host.lower() in ('localhost', 'localhost.localdomain'):
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return True   # let the fetch report the DNS failure
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split('%')[0])
        if ip.is_loopback or ip.is_unspecified:
            return False
    return True


def which_mpv():
    return shutil.which('mpv') or shutil.which('mpv.app/Contents/MacOS/mpv')


def which_ytdlp():
    return shutil.which('yt-dlp') or shutil.which('youtube-dl')


def reap():
    PLAYERS[:] = [p for p in PLAYERS if p.poll() is None]
    return len(PLAYERS)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        if '/api/' in self.path and not self.path.startswith(('/api/hls', '/api/scan')):
            sys.stderr.write('%s - %s\n' % (self.log_date_time_string(), fmt % args))

    def send_json(self, code, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def from_this_mac(self):
        return is_local(self.client_address[0])

    def api_info(self):
        self.send_json(200, {'lan': LAN, 'port': PORT, 'urls': lan_addresses() if LAN else [],
                             'thisMac': self.from_this_mac()})

    def api_health(self):
        # mpv plays on this Mac's screen, so other devices are told it is not available.
        mpv = which_mpv() if self.from_this_mac() else None
        self.send_json(200, {
            'bridge': True,
            'mpv': bool(mpv),
            'mpvPath': mpv,
            'ytdlp': bool(which_ytdlp()),
            'playing': reap(),
            'relay': True,
            'scan': True,
            'thisMac': self.from_this_mac(),
        })

    def api_play(self, query):
        url = (query.get('url') or [''])[0]
        title = (query.get('title') or [''])[0]

        if not (url.startswith('http://') or url.startswith('https://')):
            return self.send_json(400, {'error': 'Only http and https URLs are accepted.'})

        mpv = which_mpv()
        if not mpv:
            return self.send_json(503, {
                'error': 'mpv is not on PATH.',
                'hint': 'brew install mpv yt-dlp',
            })

        args = [mpv, '--force-window=immediate', '--keep-open=no']
        if title:
            args.append('--title=' + title.replace('\n', ' ')[:90] + ' - PrismTV')
        args.append('--')          # nothing after this is read as an option
        args.append(url)

        try:
            proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as err:
            return self.send_json(500, {'error': str(err)})

        PLAYERS.append(proc)
        self.send_json(200, {'ok': True, 'pid': proc.pid, 'ytdlp': bool(which_ytdlp())})

    def api_hls(self, query):
        url = (query.get('url') or [''])[0]
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            return self.send_json(400, {'error': 'Only http and https URLs are accepted.'})
        if not host_allowed(parsed.hostname):
            return self.send_json(403, {'error': 'That host is not allowed.'})

        headers = {'User-Agent': RELAY_UA, 'Accept': '*/*'}
        if self.headers.get('Range'):
            headers['Range'] = self.headers['Range']
        try:
            upstream = urllib.request.urlopen(urllib.request.Request(url, headers=headers),
                                              timeout=RELAY_TIMEOUT)
        except urllib.error.HTTPError as err:
            return self.send_json(err.code, {'error': 'Upstream returned HTTP %d' % err.code})
        except Exception as err:  # DNS, TLS, timeout, refused
            return self.send_json(502, {'error': 'Upstream unreachable: %s' % err})

        with upstream:
            ctype = upstream.headers.get('Content-Type', 'application/octet-stream')
            final = upstream.geturl()
            head = upstream.read(RELAY_CHUNK)
            is_playlist = (any(t in ctype.lower() for t in PLAYLIST_TYPES)
                           or urlparse(final).path.lower().endswith(('.m3u8', '.m3u'))
                           or head.lstrip().startswith(b'#EXTM3U'))
            try:
                if is_playlist and (query.get('raw') or ['0'])[0] != '1':
                    body = head + upstream.read(4 * 1024 * 1024)
                    text = body.decode('utf-8', errors='replace')
                    data = rewrite_playlist(text, final).encode('utf-8')
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/vnd.apple.mpegurl')
                    self.send_header('Content-Length', str(len(data)))
                    self.send_header('Cache-Control', 'no-store')
                    self.end_headers()
                    self.wfile.write(data)
                    return
                self.send_response(upstream.status)
                self.send_header('Content-Type', ctype)
                for name in ('Content-Length', 'Content-Range', 'Accept-Ranges'):
                    if upstream.headers.get(name):
                        self.send_header(name, upstream.headers[name])
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                chunk = head
                while chunk:
                    self.wfile.write(chunk)
                    chunk = upstream.read(RELAY_CHUNK)
            except (BrokenPipeError, ConnectionResetError):
                pass  # the player moved on mid-segment; nothing to do

    def scan_state(self, with_results=False):
        with SCAN['lock']:
            out = {k: SCAN[k] for k in ('running', 'total', 'done', 'started', 'finished')}
            out['known'] = len(SCAN['results'])
            if with_results:
                out['results'] = {u: v[0] for u, v in SCAN['results'].items()}
        return out

    def api_scan_get(self, query):
        self.send_json(200, self.scan_state(with_results=(query.get('results') or ['0'])[0] == '1'))

    def api_scan_post(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
            payload = json.loads(self.rfile.read(min(length, 32 * 1024 * 1024)) or b'{}')
        except (ValueError, OSError):
            return self.send_json(400, {'error': 'Expected a JSON body.'})
        urls = [u for u in payload.get('urls', []) if isinstance(u, str) and u.startswith(('http://', 'https://'))]
        force = bool(payload.get('force'))
        now = time.time()
        with SCAN['lock']:
            if SCAN['running']:
                busy = True
            else:
                busy = False
                todo = [u for u in dict.fromkeys(urls)
                        if force or u not in SCAN['results'] or now - SCAN['results'][u][1] > SCAN_TTL]
                SCAN.update(running=bool(todo), total=len(todo), done=0, started=int(now))
        if not busy and todo:
            threading.Thread(target=run_scan, args=(todo,), daemon=True).start()
        self.send_json(200, self.scan_state())

    def refuse_outsiders(self):
        """True (and a 403 sent) when a request comes from outside the home network."""
        if is_home_network(self.client_address[0]):
            return False
        self.send_json(403, {'error': 'PrismTV only answers devices on this home network.'})
        return True

    def do_POST(self):
        if self.refuse_outsiders():
            return
        if urlparse(self.path).path == '/api/scan':
            return self.api_scan_post()
        self.send_json(404, {'error': 'Not found'})

    def api_stop(self):
        stopped = 0
        for proc in PLAYERS:
            if proc.poll() is None:
                proc.terminate()
                stopped += 1
        reap()
        self.send_json(200, {'stopped': stopped})

    def do_GET(self):
        if self.refuse_outsiders():
            return
        parsed = urlparse(self.path)
        if parsed.path == '/api/health':
            return self.api_health()
        if parsed.path == '/api/info':
            return self.api_info()
        if parsed.path in ('/api/play', '/api/stop') and not self.from_this_mac():
            return self.send_json(403, {'error': 'mpv can only be started from the Mac running PrismTV.'})
        if parsed.path == '/api/play':
            return self.api_play(parse_qs(parsed.query))
        if parsed.path == '/api/scan':
            return self.api_scan_get(parse_qs(parsed.query))
        if parsed.path == '/api/hls':
            return self.api_hls(parse_qs(parsed.query))
        if parsed.path == '/api/stop':
            return self.api_stop()
        return super().do_GET()


def main():
    load_scan()
    server = http.server.ThreadingHTTPServer(('0.0.0.0' if LAN else '127.0.0.1', PORT), Handler)
    mpv = which_mpv()
    print('PrismTV  ->  http://localhost:%d   (Ctrl+C to stop)' % PORT)
    if LAN:
        urls = lan_addresses()
        print('  Home network mode: phones, tablets and TVs on this Wi-Fi can open')
        for u in urls:
            print('         %s' % u)
        print('  (Preferences -> Watch on another device shows a QR code for these.)')
        print('  If macOS asks whether python3 may accept incoming connections, choose Allow.')
    else:
        print('  Only this Mac can open it. Run ./serve.sh --lan to allow phones and TVs at home.')
    print('  mpv    : %s' % (mpv or 'not found  (brew install mpv)'))
    print('  yt-dlp : %s' % (which_ytdlp() or 'not found  (brew install yt-dlp) - needed for YouTube'))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nstopping')
        for proc in PLAYERS:
            if proc.poll() is None:
                proc.terminate()


if __name__ == '__main__':
    main()
