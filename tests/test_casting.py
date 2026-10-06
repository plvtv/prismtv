import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from casting import CastSessions, CastError, media_payload

class CastingTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.sessions = CastSessions(lambda: self.now)
        self.keys = self.sessions.handle('create')
        self.owner, self.receiver = self.keys['key'], self.keys['receiverKey']
        self.device = self.sessions.handle('join', self.receiver, {'name': 'Tablet'})['deviceId']
    def command(self, command, **fields):
        return self.sessions.handle('command', self.owner, dict(deviceId=self.device, command=command, **fields))
    def state(self):
        return self.sessions.handle('state', self.receiver, {'deviceId': self.device})
    def test_load_pause_stop(self):
        self.command('load', media={'kind':'file','url':'https://example.com/video.mp4','position':42})
        self.assertEqual(self.state()['media']['position'],42)
        self.command('pause')
        self.assertEqual(self.state()['revision'],2)
        self.assertEqual(self.state()['mediaRevision'],1)
        self.command('stop')
        self.assertIsNone(self.state()['media'])
    def test_roles_are_separate(self):
        self.assertNotEqual(self.owner,self.receiver)
        for action,key,data in [('join',self.owner,{}),('command',self.receiver,{'deviceId':self.device,'command':'stop'}),('report',self.owner,{'deviceId':self.device})]:
            with self.assertRaises(CastError) as caught: self.sessions.handle(action,key,data)
            self.assertEqual(caught.exception.status,403)
    def test_offline_and_expired(self):
        self.now=21
        self.assertEqual(self.sessions.handle('state',self.owner)['devices'],[])
        with self.assertRaises(CastError) as caught: self.command('play')
        self.assertEqual(caught.exception.status,409)
        self.now=4000
        with self.assertRaises(CastError): self.state()
    def test_report_and_leave(self):
        self.sessions.handle('report',self.receiver,{'deviceId':self.device,'phase':'needs-play','paused':True})
        self.assertEqual(self.sessions.handle('state',self.owner)['devices'][0]['phase'],'needs-play')
        self.sessions.handle('leave',self.receiver,{'deviceId':self.device})
        self.assertEqual(self.sessions.handle('state',self.owner)['devices'],[])
    def test_invalid_sources(self):
        for url in ['javascript:alert(1)','file:///tmp/a.mp4','https://user:password@example.com/a','https://evil.test/embed/a']:
            with self.assertRaises(CastError): media_payload({'kind':'embed','url':url})
        self.assertEqual(media_payload({'kind':'embed','url':'https://www.youtube-nocookie.com/embed/abc','position':float('nan')})['position'],0)
    def test_device_limit(self):
        for _ in range(7): self.sessions.handle('join',self.receiver,{})
        with self.assertRaises(CastError) as caught: self.sessions.handle('join',self.receiver,{})
        self.assertEqual(caught.exception.status,429)

if __name__ == '__main__': unittest.main()
