import importlib.util
import ast
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import zipfile

HERE = Path(__file__).resolve().parent
STAGED = Path(os.environ.get('MUSIC_TO_VIDEO_TEST_TARGET', str(HERE / 'staged' if (HERE / 'staged').is_dir() else Path(r'D:\Prog\MusicToVideo\Program'))))
sys.path.insert(0, str(STAGED))
sys.path.insert(1, r'D:\Prog\MusicToVideo\Program')
sys.path.insert(2, r'D:\Prog\MusicToVideo\Program\generator')
import engine_selection as engines

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

def execute(*args):
    return subprocess.check_output(list(map(str, args)), stderr=subprocess.STDOUT, text=True)

class EngineTests(unittest.TestCase):
    def test_finished_video_routes_include_pcm_mov(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            root = Path(directory)
            video = root / 'pcm_export.mov'
            execute('ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=160x96:r=24:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-c:a', 'pcm_s16le', video)
            tree = ast.parse((STAGED / 'main.py').read_text(encoding='utf-8'))
            nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in ('videos_list', 'video_file', 'video_thumb')]
            for node in nodes:
                node.decorator_list = []
            namespace = dict(Path=Path, config=types.SimpleNamespace(FINAL_DIR=str(root), LIB_ROOT=str(root)), _media_duration=lambda f: 1.0,
                             FileResponse=lambda path, **kwargs: types.SimpleNamespace(path=path, **kwargs), HTTPException=RuntimeError)
            exec(compile(ast.Module(body=nodes, type_ignores=[]), 'isolated_video_routes.py', 'exec'), namespace)
            self.assertEqual(namespace['videos_list']()['videos'][0]['name'], video.name)
            response = namespace['video_file'](video.name)
            self.assertEqual(response.media_type, 'video/quicktime')
            self.assertEqual(response.filename, video.name)
            thumb = namespace['video_thumb'](video.name)
            self.assertTrue(Path(thumb.path).is_file())
            self.assertEqual(thumb.media_type, 'image/jpeg')

    def test_gpu_gate_and_competing_process_interrupt(self):
        with patch.object(engines, 'gpu_sample', return_value=(30, 0, set())):
            with self.assertRaises(RuntimeError):
                engines.wait_idle()
        with patch.object(engines, 'gpu_sample', return_value=(0, 100, {999})), patch.object(engines.time, 'monotonic', side_effect=[0, 60]):
            with self.assertRaises(RuntimeError):
                engines.wait_idle()
        with patch.object(engines, 'gpu_sample', return_value=(0, 0, set())), patch.object(engines.time, 'monotonic', side_effect=[0, 60]):
            engines.wait_idle()
        import psutil
        proc = types.SimpleNamespace(pid=10, poll=lambda: None)
        reasons = []
        with patch.object(engines, 'gpu_sample', return_value=(80, 4000, {11, 999})), patch.object(engines.time, 'sleep'), patch.object(psutil, 'Process', return_value=types.SimpleNamespace(children=lambda **kwargs: [types.SimpleNamespace(pid=11)])):
            engines.watch_gpu(proc, reasons.append)
        self.assertEqual(reasons, ['Stopped: another process began using the GPU.'])

    def test_montage_and_regeneration_keep_the_job_engine(self):
        import config
        import re
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            root = Path(directory)
            image = root / 'reference.png'
            execute('ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=832x480', '-frames:v', '1', image)
            config.WAN_MODEL_PROFILES[engines.LTX_MODEL] = dict(fps=24, grid=8, base='ltx2_22B', end_frame=True, ltx=True)
            queue_module = module('engine_montage_queue', STAGED / 'generator/wan_queue.py')
            queue_module._TEMPLATE_PATH = Path(r'D:\Prog\MusicToVideo\Program\generator\wan_queue_template.json')
            tree = ast.parse((STAGED / 'main.py').read_text(encoding='utf-8'))
            node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_montage_build_impl')
            node.decorator_list = []
            jobs = {'chosen': dict(generation_engine='ltx23', scene_mode='poetry')}
            namespace = dict(Path=Path, json=json, re=re, config=config, _eng=engines, jobs=jobs,
                             _parse_idx=lambda value: [], _parse_picks=lambda value: {},
                             _wan_profile=lambda model: config.WAN_MODEL_PROFILES[model],
                             _montage_rows=lambda *args: ({0:image}, {0:'A leaf falls.'}, None),
                             _marks_file=lambda path: Path(path) / 'marks.json',
                             build_wan_queue=queue_module.build_wan_queue)
            exec(compile(ast.Module(body=[node], type_ignores=[]), 'isolated_montage.py', 'exec'), namespace)
            for restored in (False, True):
                if restored:
                    jobs.clear()
                result = namespace['_montage_build_impl'](str(root), '', engines.WAN_MODEL, 5, 0, 1, '', 'chosen', None, None, '', None, None, 'queue.zip')
                settings = json.loads(Path(result['queue']).read_text(encoding='utf-8'))
                self.assertEqual(settings[0]['model_type'], engines.LTX_MODEL)
            self.assertEqual(json.loads((root / 'build_settings.json').read_text(encoding='utf-8'))['generation_engine'], 'ltx23')

    def test_split_on_beats_preserves_timeline_and_last_keyframe(self):
        rows = engines.split_shots([dict(start=0, end=23, end_image_file='end.png')], [9.5, 19, 22])
        self.assertEqual([(r['start'], r['end']) for r in rows], [(0, 9.5), (9.5, 19), (19, 23)])
        self.assertEqual([r['clip_index'] for r in rows], [0, 1, 2])
        self.assertNotIn('end_image_file', rows[0])
        self.assertEqual(rows[-1]['end_image_file'], 'end.png')
        with self.assertRaises(ValueError):
            engines.split_shots([dict(start=0, end=20)])

    def test_unknown_engine_and_missing_keyframe_never_fall_back(self):
        for engine in ('minimax_h3', '', 'unknown'):
            with self.assertRaises(ValueError):
                engines.validate(engine)
        with self.assertRaises(ValueError):
            engines.prepare([dict(start=0, end=5)], 'ltx23')

    def test_real_queue_routes_and_ltx_keyframe_dimensions(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            root = Path(directory)
            image = root / 'reference.png'
            execute('ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=832x480', '-frames:v', '1', image)
            items = [dict(clip_index=0, start=0, end=5, start_image_file=str(image), wan_prompt='A leaf falls. Negative: morphing', i2v_model='ltx2_25')]
            queue_module = module('engine_test_queue', STAGED / 'generator/wan_queue.py')
            # Queue templates stay in the installed app, untouched.
            queue_module._TEMPLATE_PATH = Path(r'D:\Prog\MusicToVideo\Program\generator\wan_queue_template.json')
            wan = queue_module.build_wan_queue(items, 'test', root / 'wan.zip', engine='wan22')
            with zipfile.ZipFile(wan) as archive:
                task = json.loads(archive.read('queue.json'))[0]['params']
                self.assertEqual(task['model_type'], engines.WAN_MODEL)
                self.assertEqual(task['resolution'], '832x480')
            ltx = queue_module.build_wan_queue(items, 'test', root / 'ltx.zip', engine='ltx23')
            task = json.loads(ltx.read_text(encoding='utf-8'))[0]
            self.assertEqual((task['model_type'], task['num_inference_steps'], task['force_fps']), (engines.LTX_MODEL, 8, '24'))
            self.assertEqual(task['resolution'], '1280x704')
            self.assertNotIn('Negative:', task['prompt'])
            dimensions = json.loads(execute('ffprobe', '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', task['image_start']))['streams'][0]
            self.assertEqual(dimensions, dict(width=1280, height=704))
            cli = module('engine_test_cli', STAGED / 'generator/wan_cli.py')
            cfg = types.SimpleNamespace(MAESTRO_MODEL_PREFIXES=(engines.LTX_MODEL,))
            self.assertEqual(cli.engine_for_queue(cfg, ltx), 'maestro')
            self.assertEqual(cli.engine_for_queue(cfg, wan), '')

    def test_mux_keeps_original_audio_packets_for_mp3_and_wav(self):
        assembler_module = module('engine_test_assembler', STAGED / 'assembler/video_assembler.py')
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            root = Path(directory)
            video = root / 'silent.mp4'
            execute('ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=160x96:r=24:d=3', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', '-c:v', 'libx264', '-c:a', 'aac', video)
            assembler = assembler_module.VideoAssembler(output_dir=str(root))
            for extension in ('mp3', 'wav'):
                audio = root / ('song.'+extension)
                execute('ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', audio)
                result = assembler._mux_audio(video, audio, root / ('mux_'+extension+'.mp4'), '')
                hashes = [execute('ffmpeg', '-v', 'error', '-i', p, '-map', '0:a:0', '-c:a', 'copy', '-f', 'hash', '-hash', 'sha256', '-') for p in (audio, result)]
                self.assertEqual(hashes[0], hashes[1])
                self.assertEqual(result.suffix, '.mov' if extension == 'wav' else '.mp4')

if __name__ == '__main__':
    unittest.main(verbosity=2)
