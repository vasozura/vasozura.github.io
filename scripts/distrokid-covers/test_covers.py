import json
from pathlib import Path
import tempfile
import sys
import types
import threading
import urllib.request
import urllib.error
import unittest
from unittest.mock import patch
import dk_covers as covers


class CoversTest(unittest.TestCase):
    def test_prompt_never_requests_lettering(self):
        with patch.dict(sys.modules, {'yt_alexandria': types.ModuleType('yt_alexandria')}):
            for title in ('მაისი-თვრამეტი', 'A memory'):
                prompt = covers.artwork_prompt({'title': title, 'title_en': 'May the Eighteenth', 'lyrics': 'UNIQUE_LYRIC_COPY'})
                self.assertNotIn('write exactly', prompt)
                self.assertNotIn('Copy every Georgian letter', prompt)
                self.assertIn('no text, no letters', prompt)
                self.assertNotIn(title, prompt)
                self.assertNotIn('May the Eighteenth', prompt)
                self.assertNotIn('UNIQUE_LYRIC_COPY', prompt)

    def test_path_cannot_escape_cover_folder(self):
        for rid in ('../escape', '..', 'C:\\escape', 'a/b', ''):
            with self.assertRaises(ValueError):
                covers.folder(rid)
        with self.assertRaises(ValueError):
            covers.image_path('valid', 4)

    def test_gpu_interference(self):
        self.assertFalse(covers.foreign_gpu_work({10: 200}, {10: 200, 20: 9000}, 20))
        self.assertTrue(covers.foreign_gpu_work({10: 200}, {10: 900, 20: 9000}, 20))
        self.assertTrue(covers.foreign_gpu_work({}, {30: 2000, 20: 9000}, 20))
        self.assertFalse(covers.foreign_gpu_work({}, {20: None, 21: None}, {20, 21}))

    def test_full_minute_idle_is_required(self):
        now = [0]
        def sleep(seconds):
            now[0] += seconds
        with patch.object(covers, 'gpu_sample', return_value=(0, {})), \
             patch.object(covers.time, 'monotonic', side_effect=lambda: now[0]), \
             patch.object(covers.time, 'sleep', side_effect=sleep):
            covers.wait_idle(lambda *args: None)
        self.assertGreaterEqual(now[0], 60)

    def test_compositor_writes_both_title_layouts(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as temp:
            temp = Path(temp)
            raw = temp / 'raw.png'
            Image.new('RGB', (1024, 1024), '#345678').save(raw)
            with patch.object(covers, 'HERE', Path(__file__).resolve().parent):
                for title, english in [('მაისი-თვრამეტი', ''), ('Осень', 'Autumn')]:
                    out = temp / 'cover.jpg'
                    covers.compose(raw, out, {'title': title, 'title_en': english})
                    with Image.open(out) as result:
                        self.assertEqual(result.size, (3000, 3000))
                        self.assertEqual(result.mode, 'RGB')
                        self.assertGreater(len(result.crop((90, 90, 570, 570)).getcolors(300000) or []), 100)

    def test_completed_candidates_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(covers, 'DATA', Path(temp)):
            root = Path(temp)
            (root / 'releases').mkdir()
            (root / 'releases/test.json').write_text(json.dumps({'title': 'test'}))
            for i in range(1, 4):
                p = covers.image_path('test', i)
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(b'preserved')
            covers.generate('test')
            self.assertEqual(covers.status('test')['state'], 'done')
            self.assertEqual(covers.image_path('test', 1).read_bytes(), b'preserved')

    def test_console_handles_georgian_under_cp1252(self):
        import io
        output = io.BytesIO()
        stream = io.TextIOWrapper(output, encoding='cp1252')
        with patch.object(covers.sys, 'stdout', stream), patch.object(covers.sys, 'stderr', stream):
            covers.configure_console()
            print('მაისი-თვრამეტი', file=stream, flush=True)
        self.assertEqual(output.getvalue().decode('utf-8').strip(), 'მაისი-თვრამეტი')

    def test_partial_concept_set_resumes_only_missing_candidate(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(covers, 'DATA', Path(temp)), \
             patch.object(covers, 'MAESTRO', Path(temp) / 'model'):
            root = Path(temp)
            (root / 'releases').mkdir()
            (root / 'releases/test.json').write_text(json.dumps({'title': 'test'}))
            for name in ('flux-2-klein-9b_quanto_bf16_int8.safetensors', 'flux2_vae.safetensors',
                         'qwen3_8b/qwen3_8b_quanto_bf16_int8.safetensors'):
                f = covers.MAESTRO / 'ckpts' / name
                f.parent.mkdir(parents=True, exist_ok=True)
                f.touch()
            (covers.MAESTRO / 'wgp_config.json').write_text('{"checkpoints_paths": ["ckpts"]}')
            for i in (1, 6, 8):
                f = covers.image_path('test', i)
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(b'preserved')
            with patch.object(covers, 'wait_idle', side_effect=RuntimeError('busy GPU')):
                with self.assertRaisesRegex(RuntimeError, 'busy GPU'):
                    covers.generate('test', {6: 'six', 7: 'seven', 8: 'eight'})
            out = covers.folder('test')
            self.assertTrue((out / 'settings_7.json').is_file())
            self.assertFalse((out / 'settings_6.json').exists())
            for i in (1, 6, 8):
                self.assertEqual(covers.image_path('test', i).read_bytes(), b'preserved')
            prompt = json.loads((out / 'settings_7.json').read_text())['prompt']
            self.assertTrue(prompt.startswith('Pure picture: no text'))
            self.assertIn('seven', prompt)

    def test_http_candidate_selection_preserves_release_metadata(self):
        from PIL import Image
        from http.server import ThreadingHTTPServer
        with patch.dict(sys.modules, {'yt_alexandria': types.ModuleType('yt_alexandria')}):
            import dk_ui as ui
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            releases = root / 'releases'
            releases.mkdir()
            release = releases / 'test.json'
            release.write_text(json.dumps({'id': 'test', 'title': 'Test', 'owner_note': 'keep me'}))
            with patch.object(ui, 'DATA', root), patch.object(ui, 'REL', releases), patch.object(covers, 'DATA', root), \
                 patch.object(ui, 'check_audio', return_value={'ok': False}), \
                 patch.object(ui, 'check_cover', return_value={'ok': True}):
                image = covers.image_path('test', 1)
                image.parent.mkdir(parents=True)
                Image.new('RGB', (3000, 3000)).save(image)
                server = ThreadingHTTPServer(('127.0.0.1', 0), ui.H)
                threading.Thread(target=server.serve_forever, daemon=True).start()
                base = f'http://127.0.0.1:{server.server_port}'
                try:
                    with urllib.request.urlopen(base + '/cover-candidate?id=test&n=1') as response:
                        self.assertEqual(response.headers['Content-Type'], 'image/jpeg')
                    req = urllib.request.Request(base + '/api/covers/choose', data=b'{"id":"test","n":1}',
                                                 headers={'Content-Type': 'application/json'})
                    with urllib.request.urlopen(req) as response:
                        result = json.load(response)
                    self.assertEqual(result['owner_note'], 'keep me')
                    self.assertEqual(result['cover'], str(image))
                    with urllib.request.urlopen(base + '/api/covers/status?id=test') as response:
                        self.assertEqual(json.load(response)['candidates'], [1])
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(base + '/cover-candidate?id=..&n=1')
                    self.assertEqual(error.exception.code, 404)
                finally:
                    server.shutdown()
                    server.server_close()


if __name__ == '__main__':
    unittest.main()
