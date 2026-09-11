#!/usr/bin/env python3
"""
로컬 서버 — .env 파일로 API 키를 관리하고,
WaveStudio Pro 미디어 엔진(Remotion 멀티트랙 타임라인, 씬별 자막 비디오,
웨이브폼 오버레이, Edge-TTS 한국어 음성 합성, YouTube AI Audio Overview)을 제공합니다.
실행: python3 server.py
접속: http://localhost:8765
"""
import json
import os
import ssl
import subprocess
import tempfile
import shutil
import urllib.request
import urllib.parse
import urllib.error
import base64
import random
import sys
import time
import uuid
import threading
import asyncio
import re
from datetime import datetime
from email import policy
from email.parser import BytesParser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# macOS Python SSL 인증서 문제 우회 (로컬 개발 서버용)
_ssl_ctx = ssl.create_default_context()
try:
    import certifi
    _ssl_ctx = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode = ssl.CERT_NONE

BASE_DIR = Path(__file__).parent.resolve()
UPLOAD_DIR = BASE_DIR / 'uploads'
OUTPUT_DIR = BASE_DIR / 'outputs'
STATIC_DIR = BASE_DIR / 'static'
TEMPLATES_DIR = BASE_DIR / 'templates'
ENV_FILE   = BASE_DIR / '.env'
SKILLS_DIR = BASE_DIR / 'claude-youtube-main/skills/claude-youtube'
YT_SKILLS_DIR = BASE_DIR / 'youtube-skills-main/skills'

UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# audio_image_merging-main 모듈 경로 등록
AUDIO_MERGE_DIR = BASE_DIR / 'audio_image_merging-main'
if str(AUDIO_MERGE_DIR) not in sys.path:
    sys.path.insert(0, str(AUDIO_MERGE_DIR))

# WaveStudio 엔진 임포트
try:
    from static_video import create_static_video
    from waveform_video import create_waveform_video
    from waveform_overlay_video import create_waveform_overlay_video
    from scene_video import create_scene_video
    from remotion_engine import render_timeline
    from youtube_audio_overview import (
        process_youtube_urls,
        generate_korean_explainer_script_gemini,
        synthesize_explainer_audio_and_timeline,
        extract_video_id,
        fetch_youtube_metadata,
        format_duration_str,
        fetch_youtube_transcript_and_duration,
        generate_srt_content,
        generate_txt_content
    )
except Exception as e:
    print(f"⚠️ WaveStudio 엔진 임포트 경고: {e}")

try:
    import edge_tts
except ImportError:
    edge_tts = None

TASKS = ("waveform", "waveform_overlay", "static", "scene_subtitles", "remotion_render")

JOBS = {}
JOBS_LOCK = threading.Lock()
RUN_LOCK = threading.Lock()

YT_JOBS = {}
YT_LOCK = threading.Lock()

MIME_MAP = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".txt": "text/plain; charset=utf-8",
    ".srt": "text/plain; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
}

def load_env():
    keys = {
        'YOUTUBE_API_KEY': '',
        'GEMINI_API_KEY': '',
        'GEMINI_MODEL': 'gemini-2.5-flash-lite',
        'TRANSCRIPT_API_KEY': '',
        'XAI_API_KEY': '',
        'IMGBB_API_KEY': '',
    }
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                keys[k.strip()] = v.strip()
    return keys

def save_env(data):
    content = (
        f"YOUTUBE_API_KEY={data.get('YOUTUBE_API_KEY', '')}\n"
        f"GEMINI_API_KEY={data.get('GEMINI_API_KEY', '')}\n"
        f"GEMINI_MODEL={data.get('GEMINI_MODEL', 'gemini-2.5-flash-lite')}\n"
        f"TRANSCRIPT_API_KEY={data.get('TRANSCRIPT_API_KEY', '')}\n"
        f"XAI_API_KEY={data.get('XAI_API_KEY', '')}\n"
        f"IMGBB_API_KEY={data.get('IMGBB_API_KEY', '')}\n"
    )
    ENV_FILE.write_text(content, encoding='utf-8')

# ── claude-youtube-main 스킬 (YouTube Creator AI) ──
def get_skill_content(skill_name):
    parts = []
    main_md = SKILLS_DIR / 'SKILL.md'
    if main_md.exists():
        parts.append(main_md.read_text(encoding='utf-8'))
    sub_md = SKILLS_DIR / 'sub-skills' / f'{skill_name}.md'
    if sub_md.exists():
        parts.append(sub_md.read_text(encoding='utf-8'))
    return '\n\n---\n\n'.join(parts)

def list_skills():
    sub_dir = SKILLS_DIR / 'sub-skills'
    if not sub_dir.exists():
        return []
    return sorted(p.stem for p in sub_dir.glob('*.md'))

# ── youtube-skills-main 스킬 (TranscriptAPI) ──
def get_yt_skill_content(skill_name):
    skill_md = YT_SKILLS_DIR / skill_name / 'SKILL.md'
    if skill_md.exists():
        return skill_md.read_text(encoding='utf-8')
    return ''

def list_yt_skills():
    if not YT_SKILLS_DIR.exists():
        return []
    return sorted(
        p.name for p in YT_SKILLS_DIR.iterdir()
        if p.is_dir() and (p / 'SKILL.md').exists()
    )

def _ms_to_srt(ms):
    h = ms // 3600000; m = (ms % 3600000) // 60000
    s = (ms % 60000) // 1000; r = ms % 1000
    return f'{h:02d}:{m:02d}:{s:02d},{r:03d}'

def _send_json(handler, status, obj):
    body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Cache-Control', 'no-store')
    handler.end_headers()
    handler.wfile.write(body)

def _normalize_color(color):
    color = (color or "").strip()
    if not color:
        return "0x00d2ff"
    if color.startswith("#"):
        return "0x" + color[1:].lower()
    if color.lower().startswith("0x"):
        return "0x" + color[2:].lower()
    if re.fullmatch(r"[0-9a-fA-F]{6}", color):
        return "0x" + color.lower()
    return color

def _out_path(prefix, job_id):
    path = os.path.join(str(OUTPUT_DIR), f"{prefix}_{job_id}.mp4")
    if os.path.exists(path):
        try:
            os.remove(path)
        except Exception:
            pass
    return path

def _append_log(job, text):
    if not text:
        return
    with JOBS_LOCK:
        job["log"] = (job.get("log", "") + "\n" + str(text)).strip()
        if len(job["log"]) > 25000:
            job["log"] = job["log"][-20000:]

def _format_size(size_bytes):
    if size_bytes < 1024:
        return f"{size_bytes} B"
    if size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    return f"{size_bytes / (1024 * 1024):.1f} MB"

def _save_data_or_url_to_file(src, dest_path):
    """Base64 data URL, HTTP URL 또는 파일 경로를 디스크 파일로 저장합니다."""
    if not src:
        return None
    if isinstance(src, bytes):
        with open(dest_path, "wb") as f:
            f.write(src)
        return dest_path
    if isinstance(src, str):
        if src.startswith("data:"):
            # data:image/png;base64,....
            try:
                b64_data = src.split(",", 1)[1]
                raw_bytes = base64.b64decode(b64_data)
                with open(dest_path, "wb") as f:
                    f.write(raw_bytes)
                return dest_path
            except Exception as e:
                print(f"Error decoding base64 data: {e}")
                return None
        elif src.startswith("http://") or src.startswith("https://"):
            try:
                req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=30, context=_ssl_ctx) as resp:
                    with open(dest_path, "wb") as f:
                        f.write(resp.read())
                return dest_path
            except Exception as e:
                print(f"Error downloading url {src}: {e}")
                return None
        elif os.path.isfile(src):
            try:
                shutil.copyfile(src, dest_path)
                return dest_path
            except Exception:
                return src
    return None

def _run_job(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        return

    job["status"] = "running"
    cancel_event = job["cancel_event"]

    with RUN_LOCK:
        if cancel_event.is_set():
            job["status"] = "cancelled"
            return

        try:
            form = job["form"]
            raw_tasks = form.get("tasks") or form.get("task") or ""
            if isinstance(raw_tasks, list):
                tasks = [t.strip() for t in raw_tasks if isinstance(t, str) and t.strip() in TASKS]
            else:
                tasks = [t.strip() for t in str(raw_tasks).split(",") if t.strip() in TASKS]
            if not tasks:
                raise ValueError("선택된 작업이 없습니다.")

            # 1. Remotion 타임라인 렌더링 작업
            if "remotion_render" in tasks:
                raw_tl = form.get("timeline_data") or form.get("timeline") or form.get("remotion_timeline")
                if not raw_tl:
                    raise ValueError("타임라인 데이터가 비어 있습니다.")
                timeline = json.loads(raw_tl) if isinstance(raw_tl, str) else raw_tl

                # 비주얼 트랙 파일들 디스크에 저장
                for idx, v in enumerate(timeline.get("visual_track", [])):
                    if v.get("media_path") and os.path.isfile(v.get("media_path")):
                        continue
                    if v.get("file_path") and os.path.isfile(v.get("file_path")):
                        v["media_path"] = v["file_path"]
                        continue
                    field_name = v.get("file_field") or f"visual_file_{idx}"
                    file_obj = form.get(field_name)
                    if isinstance(file_obj, dict) and file_obj.get("data"):
                        ext = os.path.splitext(file_obj.get("filename") or "")[1].lower() or ".jpg"
                        saved_path = os.path.join(str(UPLOAD_DIR), f"{job_id}_v_{idx}{ext}")
                        with open(saved_path, "wb") as f:
                            f.write(file_obj["data"])
                        v["media_path"] = saved_path
                    elif v.get("url"):
                        ext = ".png" if "png" in str(v.get("url")) else ".jpg"
                        saved_path = os.path.join(str(UPLOAD_DIR), f"{job_id}_v_{idx}{ext}")
                        res_p = _save_data_or_url_to_file(v.get("url"), saved_path)
                        if res_p:
                            v["media_path"] = res_p

                # 오디오 트랙 파일들 디스크에 저장
                for idx, a in enumerate(timeline.get("audio_track", [])):
                    if a.get("media_path") and os.path.isfile(a.get("media_path")):
                        continue
                    if a.get("file_path") and os.path.isfile(a.get("file_path")):
                        a["media_path"] = a["file_path"]
                        continue
                    field_name = a.get("file_field") or f"audio_file_{idx}"
                    file_obj = form.get(field_name)
                    if isinstance(file_obj, dict) and file_obj.get("data"):
                        ext = os.path.splitext(file_obj.get("filename") or "")[1].lower() or ".mp3"
                        saved_path = os.path.join(str(UPLOAD_DIR), f"{job_id}_a_{idx}{ext}")
                        with open(saved_path, "wb") as f:
                            f.write(file_obj["data"])
                        a["media_path"] = saved_path
                    elif a.get("url"):
                        ext = ".mp3" if "mp3" in str(a.get("url")) else ".wav"
                        saved_path = os.path.join(str(UPLOAD_DIR), f"{job_id}_a_{idx}{ext}")
                        res_p = _save_data_or_url_to_file(a.get("url"), saved_path)
                        if res_p:
                            a["media_path"] = res_p

                out = _out_path("remotion", job_id)
                job["current_task"] = "Remotion 멀티트랙 비디오 렌더링 중"
                _append_log(job, "▶ [Remotion Studio] 비주얼/오디오/자막 트랙 컴파일 및 1080p 렌더링 시작...")

                def remotion_cb(pct, line):
                    if line:
                        _append_log(job, line)
                    if pct is not None:
                        job["progress"] = min(99, max(job["progress"], int(pct)))

                render_timeline(
                    timeline=timeline,
                    output_path=out,
                    progress_callback=remotion_cb,
                    cancel_event=cancel_event,
                    return_log=False
                )

                if cancel_event.is_set():
                    job["status"] = "cancelled"
                    return

                job["results"].append({
                    "task": "Remotion 멀티트랙 비디오 (Images·Audio·Subtitles)",
                    "url": f"/download/{os.path.basename(out)}"
                })
                job["status"] = "done"
                job["progress"] = 100
                _append_log(job, "✨ === Remotion 비디오 렌더링 완료 ===")
                return

            # 2. 오디오 기반의 기존 작업들 (scene_subtitles, waveform, waveform_overlay, static)
            audio = form.get("audio")
            audio_path = None
            if isinstance(audio, dict) and audio.get("data"):
                ext = os.path.splitext(audio.get("filename") or "")[1].lower() or ".mp3"
                audio_path = os.path.join(str(UPLOAD_DIR), f"{job_id}{ext}")
                with open(audio_path, "wb") as f:
                    f.write(audio["data"])
            elif form.get("audio_url"):
                audio_path = os.path.join(str(UPLOAD_DIR), f"{job_id}.mp3")
                _save_data_or_url_to_file(form.get("audio_url"), audio_path)
            elif form.get("audio_path") and os.path.isfile(form.get("audio_path")):
                audio_path = form.get("audio_path")

            # 단일 이미지 파싱
            image_path = None
            image = form.get("image")
            if isinstance(image, dict) and image.get("data"):
                iext = os.path.splitext(image.get("filename") or "")[1].lower() or ".jpg"
                image_path = os.path.join(str(UPLOAD_DIR), f"{job_id}_bg{iext}")
                with open(image_path, "wb") as f:
                    f.write(image["data"])
            elif form.get("image_url"):
                image_path = os.path.join(str(UPLOAD_DIR), f"{job_id}_bg.jpg")
                _save_data_or_url_to_file(form.get("image_url"), image_path)
            elif form.get("image_path") and os.path.isfile(form.get("image_path")):
                image_path = form.get("image_path")

            wave_color = _normalize_color(form.get("wave_color"))
            try:
                opacity = float(form.get("opacity") or 0.7)
            except (TypeError, ValueError):
                opacity = 0.7
            try:
                wave_height = int(form.get("wave_height") or 320)
            except (TypeError, ValueError):
                wave_height = 320

            position = str(form.get("position") or "bottom").lower()
            if position not in ("top", "center", "bottom"):
                position = "bottom"

            failures = []
            total_tasks = len(tasks)

            for idx, task in enumerate(tasks):
                if cancel_event.is_set():
                    job["status"] = "cancelled"
                    _append_log(job, "✕ 사용자에 의해 작업이 취소되었습니다.")
                    return

                task_base_pct = int((idx / total_tasks) * 100)
                task_slice_pct = int(100 / total_tasks)

                def make_progress_cb(task_name):
                    def cb(pct, line):
                        if line:
                            _append_log(job, line)
                        if pct is not None:
                            calc = task_base_pct + int((pct / 100.0) * task_slice_pct)
                            job["progress"] = min(99, max(job["progress"], calc))
                    return cb

                try:
                    if task == "scene_subtitles":
                        if not audio_path or not os.path.isfile(audio_path):
                            raise ValueError("나레이션 오디오 파일이 필요합니다.")
                        raw_meta = form.get("scenes_meta") or "[]"
                        scenes_meta = json.loads(raw_meta) if isinstance(raw_meta, str) else raw_meta
                        if not scenes_meta:
                            raise ValueError("씬(Scene) 메타데이터가 비어 있습니다.")

                        scenes = []
                        for s_idx, sm in enumerate(scenes_meta):
                            field_name = sm.get("file_field") or f"scene_file_{s_idx}"
                            file_obj = form.get(field_name)
                            m_path = None
                            if isinstance(file_obj, dict) and file_obj.get("data"):
                                m_ext = os.path.splitext(file_obj.get("filename") or "")[1].lower() or ".jpg"
                                m_path = os.path.join(str(UPLOAD_DIR), f"{job_id}_scene_{s_idx}{m_ext}")
                                with open(m_path, "wb") as mf:
                                    mf.write(file_obj["data"])
                            elif sm.get("media_path") and os.path.isfile(sm.get("media_path")):
                                m_path = sm.get("media_path")
                            elif sm.get("url"):
                                m_ext = ".png" if "png" in str(sm.get("url")) else ".jpg"
                                m_path = os.path.join(str(UPLOAD_DIR), f"{job_id}_scene_{s_idx}{m_ext}")
                                _save_data_or_url_to_file(sm.get("url"), m_path)
                            elif image_path:
                                m_path = image_path
                            else:
                                raise ValueError(f"씬 {s_idx+1}의 미디어 파일이 제공되지 않았습니다.")

                            is_video = bool(sm.get("is_video", False)) or str(m_path).lower().endswith((".mp4", ".mov", ".webm"))
                            scenes.append({
                                "media_path": m_path,
                                "duration": float(sm.get("duration", 3.0)),
                                "subtitle": str(sm.get("subtitle", "")).strip(),
                                "is_video": is_video
                            })

                        font_size = int(form.get("font_size") or 30)
                        font_color = str(form.get("font_color") or "#ffffff")
                        bg_style = str(form.get("bg_style") or "box")
                        sub_pos = str(form.get("sub_position") or "bottom")

                        out = _out_path("scene", job_id)
                        job["current_task"] = "씬 & 나레이션 자막 비디오 렌더링 중"
                        _append_log(job, f"▶ [씬 스튜디오] 총 {len(scenes)}개 씬 결합 및 나레이션 자막 렌더링 시작...")
                        create_scene_video(
                            audio_path=audio_path,
                            scenes=scenes,
                            output_path=out,
                            font_size=font_size,
                            font_color=font_color,
                            bg_style=bg_style,
                            position=sub_pos,
                            progress_callback=make_progress_cb("scene_subtitles"),
                            cancel_event=cancel_event,
                            return_log=False
                        )
                        job["results"].append({
                            "task": "씬 & 나레이션 자막 비디오 (Multi-Scene Subtitles)",
                            "url": f"/download/{os.path.basename(out)}"
                        })

                    elif task == "waveform":
                        if not audio_path:
                            raise ValueError("오디오 파일이 필요합니다.")
                        out = _out_path("waveform", job_id)
                        job["current_task"] = "파형 비디오 렌더링 중"
                        _append_log(job, "▶ [1/3] 파형 영상 (waveform) 렌더링 시작...")
                        create_waveform_video(
                            audio_path, out,
                            wave_color=wave_color,
                            progress_callback=make_progress_cb("waveform"),
                            cancel_event=cancel_event,
                            return_log=False
                        )
                        job["results"].append({
                            "task": "파형 비디오 (Waveform)",
                            "url": f"/download/{os.path.basename(out)}"
                        })

                    elif task == "waveform_overlay":
                        if not audio_path or not image_path:
                            raise ValueError("오디오와 배경 이미지가 모두 필요합니다.")
                        out = _out_path("overlay", job_id)
                        job["current_task"] = "웨이브 오버레이 렌더링 중"
                        _append_log(job, "▶ [2/3] 웨이브 오버레이 (waveform_overlay) 합성 시작...")
                        create_waveform_overlay_video(
                            audio_path, image_path, out,
                            wave_color=wave_color, opacity=opacity,
                            wave_height=wave_height, position=position,
                            progress_callback=make_progress_cb("waveform_overlay"),
                            cancel_event=cancel_event,
                            return_log=False
                        )
                        job["results"].append({
                            "task": "웨이브 오버레이 비디오 (Waveform Overlay)",
                            "url": f"/download/{os.path.basename(out)}"
                        })

                    elif task == "static":
                        if not audio_path or not image_path:
                            raise ValueError("오디오와 배경 이미지가 모두 필요합니다.")
                        out = _out_path("static", job_id)
                        job["current_task"] = "정지 이미지 비디오 렌더링 중"
                        _append_log(job, "▶ [3/3] 정지 이미지 영상 (static) 인코딩 시작...")
                        create_static_video(
                            audio_path, image_path, out,
                            progress_callback=make_progress_cb("static"),
                            cancel_event=cancel_event,
                            return_log=False
                        )
                        job["results"].append({
                            "task": "정지 이미지 비디오 (Static Video)",
                            "url": f"/download/{os.path.basename(out)}"
                        })
                except Exception as e:
                    if cancel_event.is_set():
                        job["status"] = "cancelled"
                        return
                    failures.append(f"✕ {task} 실패: {e}")
                    _append_log(job, failures[-1])

            if cancel_event.is_set():
                job["status"] = "cancelled"
            elif failures and not job["results"]:
                job["status"] = "error"
                job["error"] = " | ".join(failures)
            elif failures:
                job["status"] = "partial"
                job["error"] = "일부 작업 실패: " + " | ".join(failures)
                job["progress"] = 100
            else:
                job["status"] = "done"
                job["progress"] = 100
                _append_log(job, "✨ === 모든 비디오 렌더링 완료 ===")
        except Exception as e:
            if cancel_event.is_set():
                job["status"] = "cancelled"
            else:
                job["status"] = "error"
                job["error"] = str(e)
                _append_log(job, f"오류 발생: {e}")
        finally:
            job["finished"] = time.time()

def _run_youtube_job(job_id, urls, api_key, language, tone, voice=None, target_duration=180):
    with YT_LOCK:
        job = YT_JOBS.get(job_id)
    if not job:
        return
    job["status"] = "running"

    def progress_cb(pct, msg):
        with YT_LOCK:
            job["progress"] = pct
            job["stage"] = msg

    try:
        progress_cb(5, "YouTube 영상 목록 분석 및 소스 수집 준비 중...")
        job_dir = os.path.join(str(UPLOAD_DIR), f"yt_{job_id}")
        os.makedirs(job_dir, exist_ok=True)

        progress_cb(15, "YouTube 자막 및 메타데이터 수집 중...")
        sources = process_youtube_urls(urls, job_dir)
        if not sources:
            raise ValueError("입력된 YouTube URL에서 유효한 영상을 찾을 수 없습니다.")

        if str(target_duration).lower() in ("original", "auto", "0"):
            orig_dur = sources[0].get("duration") or 0
            actual_target = max(30, min(1800, orig_dur)) if orig_dur > 0 else 180
            dur_label = f"원본 영상 길이({actual_target}초)"
        else:
            try:
                actual_target = max(30, min(1800, int(target_duration or 180)))
            except (TypeError, ValueError):
                actual_target = 180
            dur_label = f"{actual_target}초"

        progress_cb(35, f"{len(sources)}개 영상 분석 완료. Gemini AI {dur_label} 맞춤형 1인칭 한국어 번역 대본 작성 중...")
        script = generate_korean_explainer_script_gemini(
            sources=sources,
            api_key=api_key,
            language=language,
            tone=tone,
            target_duration=actual_target
        )
        if not script:
            raise ValueError("한국어 해설 대본 생성에 실패했습니다.")

        progress_cb(50, f"한국어 전문 번역 나레이션 음성 합성 (Edge-TTS, 목표: {dur_label}) 진행 중...")
        out_mp3_path = os.path.join(str(OUTPUT_DIR), f"yt_explainer_{job_id}.mp3")

        result = synthesize_explainer_audio_and_timeline(
            script_sections=script,
            sources=sources,
            output_mp3_path=out_mp3_path,
            voice=voice or "ko-KR-InJoonNeural",
            language=language,
            target_duration=actual_target,
            progress_callback=progress_cb
        )

        out_txt_path = os.path.join(str(OUTPUT_DIR), f"yt_narration_{job_id}.txt")
        out_srt_path = os.path.join(str(OUTPUT_DIR), f"yt_subtitles_{job_id}.srt")
        video_title = sources[0].get("title", "YouTube 영상") if sources else "YouTube 영상"

        try:
            txt_content = generate_txt_content(script, video_title)
            with open(out_txt_path, "w", encoding="utf-8") as f:
                f.write(txt_content)
        except Exception:
            pass

        try:
            srt_content = generate_srt_content(result.get("subtitles") or [])
            with open(out_srt_path, "w", encoding="utf-8") as f:
                f.write(srt_content)
        except Exception:
            pass

        with YT_LOCK:
            job["status"] = "done"
            job["progress"] = 100
            job["stage"] = "✨ 한국어 전문 해설 오디오 및 Remotion 타임라인 생성 완료!"
            job["audio_url"] = f"/download/{os.path.basename(out_mp3_path)}"
            job["txt_url"] = f"/download/{os.path.basename(out_txt_path)}"
            job["srt_url"] = f"/download/{os.path.basename(out_srt_path)}"
            job["script"] = script
            job["sources"] = sources
            job["subtitles"] = result.get("subtitles", [])
            job["remotion_timeline"] = result.get("remotion_timeline", {})
            job["actual_duration"] = result.get("actual_duration", actual_target)
            job["target_duration"] = actual_target
    except Exception as e:
        with YT_LOCK:
            job["status"] = "error"
            job["error"] = str(e)
            job["stage"] = f"오류 발생: {e}"

def _parse_multipart(body, content_type):
    m = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', content_type or "")
    if not m:
        raise ValueError("멀티파트 경계값(boundary)을 찾을 수 없습니다.")
    boundary = (m.group(1) or m.group(2)).strip()
    msg_headers = (
        "MIME-Version: 1.0\r\n"
        f"Content-Type: multipart/form-data; boundary={boundary}\r\n"
        "\r\n"
    ).encode("utf-8")
    msg = BytesParser(policy=policy.default).parsebytes(msg_headers + body)
    form = {}
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if name is None:
            continue
        filename = part.get_filename()
        payload = part.get_payload(decode=True)
        if filename:
            form[name] = {"filename": filename, "data": payload}
        else:
            form[name] = payload.decode("utf-8", "replace") if payload else ""
    return form

async def _synthesize_edge_tts_async(text, voice, out_path, rate="+0%", pitch="+0Hz"):
    if not edge_tts:
        raise RuntimeError("edge-tts 모듈이 설치되어 있지 않습니다.")
    comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    await comm.save(out_path)

def _get_audio_duration_ffprobe(audio_path):
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            audio_path
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        return float(res.stdout.strip())
    except Exception:
        return 0.0

class Handler(SimpleHTTPRequestHandler):
    server_version = "WaveStudioPro/3.5"

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def _send_file_streaming(self, full, mime):
        try:
            size = os.path.getsize(full)
        except OSError:
            _send_json(self, 404, {"error": "파일을 찾을 수 없습니다."})
            return

        start, end = 0, size - 1
        rng = self.headers.get("Range")
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
            if m:
                if m.group(1):
                    start = int(m.group(1))
                if m.group(2):
                    end = int(m.group(2))
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return

        length = end - start + 1
        self.send_response(206 if rng else 200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        if rng:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.end_headers()

        with open(full, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    break
                remaining -= len(chunk)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path == '/api/config':
            _send_json(self, 200, load_env())
            return

        elif path == '/api/skills':
            _send_json(self, 200, {'skills': list_skills()})
            return

        elif path.startswith('/api/skill/'):
            skill_name = path[len('/api/skill/'):]
            if not skill_name.replace('-', '').replace('_', '').isalnum():
                self.send_response(400); self.end_headers(); return
            content = get_skill_content(skill_name)
            if not content:
                self.send_response(404); self.end_headers(); return
            _send_json(self, 200, {'content': content})
            return

        elif path == '/api/yt-skills':
            _send_json(self, 200, {'skills': list_yt_skills()})
            return

        elif path.startswith('/api/yt-skill/'):
            skill_name = path[len('/api/yt-skill/'):]
            if not skill_name.replace('-', '').replace('_', '').isalnum():
                self.send_response(400); self.end_headers(); return
            content = get_yt_skill_content(skill_name)
            if not content:
                self.send_response(404); self.end_headers(); return
            _send_json(self, 200, {'content': content})
            return

        elif path.startswith('/api/proxy/youtube'):
            qs_part = self.path[len('/api/proxy/youtube'):]
            api_key = load_env().get('YOUTUBE_API_KEY', '')
            if not api_key:
                _send_json(self, 400, {'error': 'YOUTUBE_API_KEY not set'}); return
            yt_url = f'https://www.googleapis.com/youtube/v3{qs_part}'
            sep = '&' if '?' in yt_url else '?'
            yt_url = f'{yt_url}{sep}key={urllib.parse.quote(api_key, safe="")}'
            req = urllib.request.Request(yt_url, headers={'User-Agent': 'YouTubeContentTool/1.0'})
            try:
                with urllib.request.urlopen(req, timeout=20, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})
            return

        elif path.startswith('/api/proxy/grok-video/'):
            request_id = path[len('/api/proxy/grok-video/'):]
            if not all(c in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in request_id):
                self.send_response(400); self.end_headers(); return
            api_key = load_env().get('XAI_API_KEY', '')
            if not api_key:
                _send_json(self, 400, {'error': 'XAI_API_KEY not set'}); return
            req = urllib.request.Request(
                f'https://api.x.ai/v1/videos/{request_id}',
                headers={'Authorization': f'Bearer {api_key}', 'User-Agent': 'YouTubeContentTool/1.0'}
            )
            try:
                with urllib.request.urlopen(req, timeout=15, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})
            return

        # ── WaveStudio API: 작업 상태 조회 ──
        elif path == '/api/status':
            job_id = qs.get("id", [""])[0]
            with JOBS_LOCK:
                if job_id:
                    job = JOBS.get(job_id)
                elif JOBS:
                    # id가 지정되지 않은 경우 가장 최근 작업 반환
                    job = list(JOBS.values())[-1]
                else:
                    job = None
            if not job:
                _send_json(self, 200, {
                    "id": None,
                    "status": "idle",
                    "progress": 0,
                    "current_task": "대기 중",
                    "results": [],
                    "log": "",
                    "error": None
                })
                return
            _send_json(self, 200, {
                "id": job["id"],
                "status": job["status"],
                "progress": job.get("progress", 0),
                "current_task": job.get("current_task", ""),
                "results": job.get("results", []),
                "log": job.get("log", ""),
                "error": job.get("error")
            })
            return

        # ── WaveStudio API: YouTube AI 오버뷰 상태 조회 ──
        elif path == '/api/youtube/status':
            job_id = qs.get("id", [""])[0]
            with YT_LOCK:
                job = YT_JOBS.get(job_id)
            if not job:
                _send_json(self, 404, {"error": "YouTube 작업을 찾을 수 없습니다."})
                return
            _send_json(self, 200, {
                "id": job["id"],
                "status": job["status"],
                "progress": job.get("progress", 0),
                "stage": job.get("stage", ""),
                "audio_url": job.get("audio_url"),
                "txt_url": job.get("txt_url"),
                "srt_url": job.get("srt_url"),
                "script": job.get("script", []),
                "sources": job.get("sources", []),
                "subtitles": job.get("subtitles", []),
                "remotion_timeline": job.get("remotion_timeline", {}),
                "actual_duration": job.get("actual_duration", 0),
                "target_duration": job.get("target_duration", 0),
                "error": job.get("error")
            })
            return

        # ── WaveStudio API: 결과물 파일 목록 조회 ──
        elif path == '/api/files':
            files = []
            if OUTPUT_DIR.exists():
                for f in OUTPUT_DIR.iterdir():
                    if f.name.startswith("."):
                        continue
                    ext = f.suffix.lower()
                    if ext in (".mp4", ".mp3", ".wav", ".srt", ".txt"):
                        st = f.stat()
                        files.append({
                            "name": f.name,
                            "size": _format_size(st.st_size),
                            "bytes": st.st_size,
                            "modified": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M"),
                            "timestamp": st.st_mtime,
                            "url": f"/download/{f.name}",
                            "type": "video" if ext == ".mp4" else ("audio" if ext in (".mp3", ".wav") else "text")
                        })
            files.sort(key=lambda x: x["timestamp"], reverse=True)
            _send_json(self, 200, {"files": files})
            return

        # ── 파일 다운로드 및 스트리밍 (/download/*) ──
        elif path.startswith('/download/'):
            filename = urllib.parse.unquote(path[len('/download/'):])
            if ".." in filename or "/" in filename or "\\" in filename:
                _send_json(self, 400, {"error": "잘못된 파일명입니다."})
                return
            full_path = OUTPUT_DIR / filename
            if not full_path.is_file():
                _send_json(self, 404, {"error": "파일을 찾을 수 없습니다."})
                return
            ext = full_path.suffix.lower()
            mime = MIME_MAP.get(ext, "application/octet-stream")
            self._send_file_streaming(str(full_path), mime)
            return

        else:
            super().do_GET()

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path.startswith('/api/files/'):
            filename = urllib.parse.unquote(path[len('/api/files/'):])
            if ".." in filename or "/" in filename or "\\" in filename:
                _send_json(self, 400, {"error": "잘못된 파일명입니다."})
                return
            full_path = OUTPUT_DIR / filename
            if full_path.is_file():
                try:
                    full_path.unlink()
                    _send_json(self, 200, {"ok": True, "message": f"{filename} 삭제 완료"})
                    return
                except Exception as e:
                    _send_json(self, 500, {"error": f"삭제 실패: {e}"})
                    return
            else:
                _send_json(self, 404, {"error": "파일을 찾을 수 없습니다."})
                return

        _send_json(self, 404, {"error": "엔드포인트를 찾을 수 없습니다."})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        length = int(self.headers.get('Content-Length', 0))
        body_raw = self.rfile.read(length) if length > 0 else b''

        if path == '/api/config':
            data = json.loads(body_raw)
            save_env(data)
            _send_json(self, 200, {'ok': True})

        elif path == '/api/proxy/transcriptapi':
            data = json.loads(body_raw)
            endpoint = data.get('endpoint', '')
            params   = data.get('params', {})
            allowed = [
                '/api/v2/youtube/transcript',
                '/api/v2/youtube/search',
                '/api/v2/youtube/channel/',
                '/api/v2/youtube/playlist/',
            ]
            if not any(endpoint.startswith(p) for p in allowed):
                _send_json(self, 400, {'error': 'invalid endpoint'}); return
            api_key = load_env().get('TRANSCRIPT_API_KEY', '')
            if not api_key:
                _send_json(self, 400, {'error': 'TRANSCRIPT_API_KEY not set'}); return
            qs  = urllib.parse.urlencode({k: v for k, v in params.items() if v not in ('', None)})
            url = f'https://transcriptapi.com{endpoint}?{qs}'
            req = urllib.request.Request(url, headers={
                'Authorization': f'Bearer {api_key}',
                'User-Agent': 'YouTubeContentTool/1.0',
            })
            try:
                with urllib.request.urlopen(req, timeout=20, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})

        elif path == '/api/proxy/gemini-image':
            data = json.loads(body_raw) if body_raw else {}
            api_key = data.get('geminiApiKey', '').strip() or load_env().get('GEMINI_API_KEY', '')
            raw_prompt = data.get('prompt', '')

            def _clean_and_translate_prompt(text, key):
                if not text:
                    return 'cinematic 4k youtube thumbnail background, photorealistic 8k', 'cinematic background'
                # 1. Preserve bracketed content by replacing brackets with space (NEVER strip content!)
                t = text.replace('[', ' ').replace(']', ' ')
                t = re.sub(r'[\r\n\t]+', ' ', t)
                t = re.sub(r'[\"\`\*\#]', ' ', t)
                t = re.sub(r'\s+', ' ', t).strip()

                eng_prompt = t
                search_kw = t

                # 2. If prompt contains Korean, translate & enrich to English via Gemini Text API
                if re.search(r'[가-힣]', t) and key:
                    trans_models = ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-flash-latest']
                    for tm in trans_models:
                        try:
                            url = f'https://generativelanguage.googleapis.com/v1beta/models/{tm}:generateContent?key={key}'
                            req_body = json.dumps({
                                'contents': [{'parts': [{'text': f'From this image description, output JSON with two fields:\n1. \"prompt\": Vivid, descriptive English AI image prompt (max 38 words) without any text or subtitles.\n2. \"keywords\": 2-3 English search words for the main subject.\n\nDescription: {t}\n\nJSON output ONLY:'}]}],
                                'generationConfig': {'responseMimeType': 'application/json', 'temperature': 0.2}
                            }).encode('utf-8')
                            req = urllib.request.Request(url, data=req_body, headers={'Content-Type': 'application/json', 'User-Agent': 'YouTubeContentTool/1.0'})
                            with urllib.request.urlopen(req, timeout=5, context=_ssl_ctx) as resp:
                                gdata = json.loads(resp.read().decode())
                                tr_text = gdata.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '').strip()
                                p_obj = json.loads(tr_text)
                                p_res = p_obj.get('prompt', '').strip()
                                kw_res = p_obj.get('keywords', '')
                                if isinstance(kw_res, list): kw_res = ' '.join(kw_res)
                                if p_res:
                                    return p_res, (str(kw_res) or p_res)
                        except Exception:
                            continue
                return eng_prompt or 'cinematic 4k youtube thumbnail background', search_kw

            clean_prompt, search_keywords = _clean_and_translate_prompt(raw_prompt, api_key)

            # Ensure pure artwork without embedded subtitles
            clean_prompt = clean_prompt.strip().rstrip(',')
            if 'no text' not in clean_prompt.lower():
                clean_prompt += ', pure artwork, no text, no subtitles, no watermark'

            # 1. Pollinations AI (High-aesthetic multi-model pipeline: flux -> turbo -> default)
            encoded_prompt = urllib.parse.quote(clean_prompt, safe='')
            seed = random.randint(1, 9999999)
            poll_urls = [
                f'https://image.pollinations.ai/prompt/{encoded_prompt}?width=1280&height=720&nologo=true&seed={seed}&model=flux',
                f'https://image.pollinations.ai/prompt/{encoded_prompt}?width=1280&height=720&nologo=true&seed={seed}&model=turbo',
                f'https://image.pollinations.ai/prompt/{encoded_prompt}?width=1280&height=720&nologo=true&seed={seed}',
            ]

            img_bytes = None
            for p_url in poll_urls:
                try:
                    req_p = urllib.request.Request(
                        p_url,
                        headers={
                            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
                        }
                    )
                    with urllib.request.urlopen(req_p, timeout=8, context=_ssl_ctx) as resp_p:
                        b = resp_p.read()
                        if len(b) > 2000 and (b[:3] == b'\xff\xd8\xff' or b[:8] == b'\x89PNG\r\n\x1a\n' or b'WEBP' in b[:16]):
                            img_bytes = b
                            break
                except Exception:
                    pass

            # 2. High-Res Real Subject Photography Fallback (Openverse CC Search)
            if not img_bytes:
                try:
                    from PIL import Image, ImageOps
                    import io
                    kw = search_keywords or clean_prompt[:50]
                    ov_url = f'https://api.openverse.org/v1/images/?q={urllib.parse.quote(kw)}&page_size=5&license_type=commercial,modification'
                    req_ov = urllib.request.Request(ov_url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req_ov, timeout=6, context=_ssl_ctx) as resp_ov:
                        ov_data = json.loads(resp_ov.read().decode())
                        for r in ov_data.get('results', []):
                            img_u = r.get('url')
                            if img_u and not img_u.endswith('.svg'):
                                try:
                                    req_img = urllib.request.Request(img_u, headers={'User-Agent': 'Mozilla/5.0'})
                                    with urllib.request.urlopen(req_img, timeout=6, context=_ssl_ctx) as img_resp:
                                        raw_data = img_resp.read()
                                        if len(raw_data) > 5000:
                                            im = Image.open(io.BytesIO(raw_data)).convert('RGB')
                                            cropped = ImageOps.fit(im, (1280, 720), method=Image.Resampling.LANCZOS)
                                            buf = io.BytesIO()
                                            cropped.save(buf, format='JPEG', quality=90)
                                            img_bytes = buf.getvalue()
                                            break
                                except Exception:
                                    continue
                except Exception:
                    pass

            if not img_bytes:
                _send_json(self, 500, {'error': '이미지 생성 서버 응답이 지연되고 있습니다. 다시 시도해주세요.'})
                return

            b64 = base64.b64encode(img_bytes).decode('utf-8')
            _send_json(self, 200, {
                'predictions': [{
                    'bytesBase64Encoded': b64,
                    'mimeType': 'image/jpeg'
                }]
            })

        elif path == '/api/proxy/gemini':
            data    = json.loads(body_raw)
            api_key = load_env().get('GEMINI_API_KEY', '')
            model   = load_env().get('GEMINI_MODEL', 'gemini-2.5-flash-lite')
            if not api_key:
                _send_json(self, 400, {'error': 'GEMINI_API_KEY not set'}); return

            candidate_models = [model, 'gemini-3.7-flash', 'gemini-3.1-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest']
            seen = set()
            models_to_try = [m for m in candidate_models if m and not (m in seen or seen.add(m))]

            req_body = json.dumps(data).encode('utf-8')
            last_err_body = b'{}'
            last_err_code = 500
            success = False

            for m in models_to_try:
                url = f'https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={api_key}'
                req = urllib.request.Request(url, data=req_body,
                               headers={'Content-Type': 'application/json',
                                        'User-Agent': 'YouTubeContentTool/1.0'})
                try:
                    with urllib.request.urlopen(req, timeout=120, context=_ssl_ctx) as resp:
                        resp_body = resp.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', len(resp_body))
                    self.end_headers()
                    self.wfile.write(resp_body)
                    success = True
                    break
                except urllib.error.HTTPError as e:
                    last_err_code = e.code
                    last_err_body = e.read() or b'{}'
                    if e.code in (429, 503, 404, 500, 502, 504):
                        continue
                    else:
                        break
                except Exception as e:
                    _send_json(self, 500, {'error': str(e)})
                    success = True
                    break

            if not success:
                self.send_response(last_err_code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(last_err_body))
                self.end_headers()
                self.wfile.write(last_err_body)

        elif path == '/api/proxy/grok-video':
            data    = json.loads(body_raw)
            api_key = load_env().get('XAI_API_KEY', '')
            if not api_key:
                _send_json(self, 400, {'error': 'XAI_API_KEY not set'}); return

            payload = {
                'model': 'grok-imagine-video',
                'prompt': data.get('prompt', ''),
                'duration': data.get('duration', 10),
                'aspect_ratio': data.get('aspect_ratio', '16:9'),
                'resolution': data.get('resolution', '720p'),
            }
            if data.get('image_url'):
                payload['image'] = {'url': data['image_url']}

            req_body = json.dumps(payload).encode('utf-8')
            req = urllib.request.Request(
                'https://api.x.ai/v1/videos/generations',
                data=req_body,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {api_key}',
                    'User-Agent': 'YouTubeContentTool/1.0',
                }
            )
            try:
                with urllib.request.urlopen(req, timeout=30, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})

        elif path == '/api/proxy/imgbb-upload':
            data    = json.loads(body_raw)
            api_key = load_env().get('IMGBB_API_KEY', '')
            if not api_key:
                _send_json(self, 400, {'error': 'IMGBB_API_KEY not set'}); return
            b64 = data.get('image', '')
            form = urllib.parse.urlencode({'key': api_key, 'image': b64}).encode('utf-8')
            req  = urllib.request.Request(
                'https://api.imgbb.com/1/upload',
                data=form,
                headers={'User-Agent': 'YouTubeContentTool/1.0'}
            )
            try:
                with urllib.request.urlopen(req, timeout=30, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})

        elif path == '/api/proxy/gemini-tts':
            data    = json.loads(body_raw)
            api_key = load_env().get('GEMINI_API_KEY', '')
            if not api_key:
                _send_json(self, 400, {'error': 'GEMINI_API_KEY not set'}); return
            text  = data.get('text', '')
            voice = data.get('voice', 'Kore')
            model = 'gemini-2.5-flash-preview-tts'
            url   = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}'
            req_body = json.dumps({
                'contents': [{'parts': [{'text': text}], 'role': 'user'}],
                'generationConfig': {
                    'responseModalities': ['AUDIO'],
                    'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice}}}
                }
            }).encode('utf-8')
            req = urllib.request.Request(url, data=req_body,
                      headers={'Content-Type': 'application/json', 'User-Agent': 'YouTubeContentTool/1.0'})
            try:
                with urllib.request.urlopen(req, timeout=120, context=_ssl_ctx) as resp:
                    resp_body = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(resp_body))
                self.end_headers()
                self.wfile.write(resp_body)
            except urllib.error.HTTPError as e:
                err_body = e.read() or b'{}'
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', len(err_body))
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})

        # ── WaveStudio API: Edge-TTS 고품질 한국어 음성 합성 ──
        elif path == '/api/tts/edge-tts':
            try:
                data = json.loads(body_raw)
                text = (data.get('text') or '').strip()
                voice = data.get('voice') or 'ko-KR-InJoonNeural'
                rate = data.get('rate') or '+0%'
                pitch = data.get('pitch') or '+0Hz'

                if not text:
                    _send_json(self, 400, {'error': '텍스트가 비어 있습니다.'})
                    return

                tts_id = uuid.uuid4().hex[:12]
                out_path = os.path.join(str(OUTPUT_DIR), f"tts_{tts_id}.mp3")

                asyncio.run(_synthesize_edge_tts_async(text, voice, out_path, rate=rate, pitch=pitch))
                dur = _get_audio_duration_ffprobe(out_path)

                _send_json(self, 200, {
                    'ok': True,
                    'audio_url': f"/download/{os.path.basename(out_path)}",
                    'audio_path': out_path,
                    'filename': os.path.basename(out_path),
                    'duration': dur,
                    'text': text,
                    'voice': voice
                })
            except Exception as e:
                _send_json(self, 500, {'error': f'Edge-TTS 음성 합성 실패: {str(e)}'})

        # ── WaveStudio API: 작업 제출 (/api/run) ──
        elif path == '/api/run':
            ct = self.headers.get("Content-Type", "")
            try:
                if "multipart/form-data" in ct:
                    form = _parse_multipart(body_raw, ct)
                else:
                    form = json.loads(body_raw) if body_raw else {}

                job_id = uuid.uuid4().hex[:12]
                job = {
                    "id": job_id,
                    "status": "pending",
                    "progress": 0,
                    "current_task": "대기 중",
                    "results": [],
                    "log": "",
                    "error": None,
                    "cancel_event": threading.Event(),
                    "form": form,
                    "created": time.time(),
                    "finished": None
                }
                with JOBS_LOCK:
                    JOBS[job_id] = job

                thread = threading.Thread(target=_run_job, args=(job_id,), daemon=True)
                thread.start()

                _send_json(self, 200, {"id": job_id, "status": "pending"})
            except Exception as e:
                _send_json(self, 400, {"error": f"작업 요청 실패: {e}"})

        # ── WaveStudio API: 작업 취소 (/api/cancel) ──
        elif path == '/api/cancel':
            qs = urllib.parse.parse_qs(parsed.query)
            job_id = qs.get("id", [""])[0]
            with JOBS_LOCK:
                job = JOBS.get(job_id)
            if not job:
                _send_json(self, 404, {"error": "작업을 찾을 수 없습니다."})
                return
            job["cancel_event"].set()
            _send_json(self, 200, {"ok": True, "message": "취소 요청을 전달했습니다."})

        # ── WaveStudio API: YouTube AI 한국어 해설 생성 (/api/youtube/generate) ──
        elif path == '/api/youtube/generate':
            try:
                data = json.loads(body_raw)
                urls = data.get("urls") or []
                api_key = data.get("api_key") or load_env().get("GEMINI_API_KEY", "")
                language = data.get("language", "ko")
                tone = data.get("tone", "conversational")
                voice = data.get("voice", "ko-KR-InJoonNeural")
                target_duration = data.get("target_duration", 180)

                if not urls:
                    _send_json(self, 400, {"error": "YouTube URL이 필요합니다."})
                    return
                if not api_key:
                    _send_json(self, 400, {"error": "Gemini API 키가 필요합니다."})
                    return

                job_id = uuid.uuid4().hex[:12]
                job = {
                    "id": job_id,
                    "status": "pending",
                    "progress": 0,
                    "stage": "대기 중...",
                    "error": None,
                    "audio_url": None,
                    "script": [],
                    "sources": [],
                    "subtitles": [],
                    "remotion_timeline": {},
                    "actual_duration": 0,
                    "target_duration": target_duration,
                    "created": time.time()
                }
                with YT_LOCK:
                    YT_JOBS[job_id] = job

                thread = threading.Thread(
                    target=_run_youtube_job,
                    args=(job_id, urls, api_key, language, tone, voice, target_duration),
                    daemon=True
                )
                thread.start()

                _send_json(self, 200, {"id": job_id, "status": "pending"})
            except Exception as e:
                _send_json(self, 400, {"error": f"YouTube 해설 요청 실패: {e}"})

        # ── 영상 + 음성 + 소프트 자막 병합 ──
        elif path == '/api/proxy/video-audio-merge':
            data       = json.loads(body_raw)
            video_urls = data.get('video_urls', [])
            audio_b64  = data.get('audio_b64', '')
            subtitles  = data.get('subtitles', [])

            if not video_urls: _send_json(self, 400, {'error': 'video_urls 필요'}); return
            if not audio_b64:  _send_json(self, 400, {'error': 'audio_b64 필요'}); return

            ffmpeg_path = shutil.which('ffmpeg') or '/usr/local/bin/ffmpeg'
            if not ffmpeg_path or not Path(ffmpeg_path).exists():
                _send_json(self, 500, {'error': 'ffmpeg 없음'}); return

            tmpdir = tempfile.mkdtemp(prefix='tts_merge_')
            try:
                clip_paths = []
                for i, url in enumerate(video_urls):
                    clip_path = os.path.join(tmpdir, f'clip_{i:03d}.mp4')
                    req = urllib.request.Request(url, headers={'User-Agent': 'YouTubeContentTool/1.0'})
                    with urllib.request.urlopen(req, timeout=60, context=_ssl_ctx) as resp:
                        with open(clip_path, 'wb') as f: f.write(resp.read())
                    clip_paths.append(clip_path)

                video_path = os.path.join(tmpdir, 'video.mp4')
                if len(clip_paths) == 1:
                    shutil.copyfile(clip_paths[0], video_path)
                else:
                    list_path = os.path.join(tmpdir, 'cl.txt')
                    with open(list_path, 'w') as f:
                        for p in clip_paths: f.write(f"file '{p}'\n")
                    subprocess.run([ffmpeg_path, '-y', '-f', 'concat', '-safe', '0',
                                    '-i', list_path, '-c', 'copy', video_path],
                                   capture_output=True, timeout=120)

                audio_path = os.path.join(tmpdir, 'audio.wav')
                with open(audio_path, 'wb') as f:
                    f.write(base64.b64decode(audio_b64))

                srt_path = os.path.join(tmpdir, 'subs.srt')
                with open(srt_path, 'w', encoding='utf-8') as f:
                    for i, sub in enumerate(subtitles):
                        f.write(f"{i+1}\n{_ms_to_srt(sub['start_ms'])} --> {_ms_to_srt(sub['end_ms'])}\n{sub['text']}\n\n")

                out_path = os.path.join(tmpdir, 'output.mp4')
                cmd = [ffmpeg_path, '-y',
                       '-i', video_path, '-i', audio_path, '-i', srt_path,
                       '-c:v', 'copy', '-c:a', 'aac',
                       '-c:s', 'mov_text',
                       '-map', '0:v:0', '-map', '1:a:0', '-map', '2:s:0',
                       '-metadata:s:s:0', 'language=kor',
                       '-shortest', out_path]
                r = subprocess.run(cmd, capture_output=True, timeout=300)
                if r.returncode != 0:
                    cmd2 = [ffmpeg_path, '-y', '-i', video_path, '-i', audio_path,
                            '-c:v', 'copy', '-c:a', 'aac',
                            '-map', '0:v:0', '-map', '1:a:0', '-shortest', out_path]
                    r2 = subprocess.run(cmd2, capture_output=True, timeout=300)
                    if r2.returncode != 0:
                        _send_json(self, 500, {'error': r2.stderr.decode('utf-8','replace')[-400:]}); return

                with open(out_path, 'rb') as f: mp4_data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Content-Length', len(mp4_data))
                self.send_header('Content-Disposition', 'attachment; filename="narration_merged.mp4"')
                self.end_headers()
                self.wfile.write(mp4_data)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})
            finally:
                shutil.rmtree(tmpdir, ignore_errors=True)

        elif path == '/api/proxy/grok-video-concat':
            data = json.loads(body_raw)
            video_urls = data.get('video_urls', [])
            if not video_urls or len(video_urls) < 1:
                _send_json(self, 400, {'error': 'video_urls 필요'}); return

            ffmpeg_path = shutil.which('ffmpeg') or '/usr/local/bin/ffmpeg' or '/opt/homebrew/bin/ffmpeg'
            if not ffmpeg_path or not Path(ffmpeg_path).exists():
                _send_json(self, 500, {'error': 'ffmpeg를 찾을 수 없습니다. brew install ffmpeg 실행 필요'}); return

            tmpdir = tempfile.mkdtemp(prefix='grok_concat_')
            try:
                clip_paths = []
                for i, url in enumerate(video_urls):
                    clip_path = os.path.join(tmpdir, f'clip_{i:03d}.mp4')
                    req = urllib.request.Request(url, headers={'User-Agent': 'YouTubeContentTool/1.0'})
                    with urllib.request.urlopen(req, timeout=60, context=_ssl_ctx) as resp:
                        with open(clip_path, 'wb') as f:
                            f.write(resp.read())
                    clip_paths.append(clip_path)

                list_path = os.path.join(tmpdir, 'concat_list.txt')
                with open(list_path, 'w') as f:
                    for p in clip_paths:
                        f.write(f"file '{p}'\n")

                out_path = os.path.join(tmpdir, 'output.mp4')
                result = subprocess.run(
                    [ffmpeg_path, '-y', '-f', 'concat', '-safe', '0',
                     '-i', list_path, '-c', 'copy', out_path],
                    capture_output=True, timeout=300
                )
                if result.returncode != 0:
                    err = result.stderr.decode('utf-8', errors='replace')[-500:]
                    _send_json(self, 500, {'error': f'ffmpeg 오류: {err}'}); return

                with open(out_path, 'rb') as f:
                    mp4_data = f.read()

                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Content-Length', len(mp4_data))
                self.send_header('Content-Disposition', 'attachment; filename="grok_concat.mp4"')
                self.end_headers()
                self.wfile.write(mp4_data)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})
            finally:
                shutil.rmtree(tmpdir, ignore_errors=True)

        elif path == '/api/ffmpeg/image-to-video':
            data = json.loads(body_raw)
            image_url = data.get('imageUrl', '')
            text = data.get('text', '')
            duration = data.get('duration', 5)
            effect = data.get('effect', 'none')

            if not image_url:
                _send_json(self, 400, {'error': 'imageUrl required'}); return

            ffmpeg_path = shutil.which('ffmpeg') or '/usr/local/bin/ffmpeg'
            if not ffmpeg_path or not Path(ffmpeg_path).exists():
                _send_json(self, 500, {'error': 'ffmpeg not installed'}); return

            tmpdir = tempfile.mkdtemp(prefix='ffmpeg_video_')
            try:
                img_path = os.path.join(tmpdir, 'input.jpg')
                _save_data_or_url_to_file(image_url, img_path)
                out_path = os.path.join(tmpdir, 'output.mp4')

                if effect == 'zoom':
                    filter_complex = f"scale=8000:-1,zoompan=z='zoom+0.001':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={duration*25}:s=1920x1080"
                elif effect == 'pan':
                    filter_complex = f"scale=4000:-1,crop=1920:1080:'(iw-1920)*t/{duration}':0"
                else:
                    filter_complex = "scale=1920:1080"

                if text:
                    text_escaped = text.replace("'", "\\'").replace(":", "\\:")
                    filter_complex += f",drawtext=text='{text_escaped}':fontsize=50:fontcolor=white:box=1:boxcolor=black@0.5:x=(w-text_w)/2:y=h-100"

                cmd = [
                    ffmpeg_path, '-y',
                    '-loop', '1',
                    '-i', img_path,
                    '-vf', filter_complex,
                    '-c:v', 'libx264',
                    '-t', str(duration),
                    '-pix_fmt', 'yuv420p',
                    '-preset', 'fast',
                    out_path
                ]
                result = subprocess.run(cmd, capture_output=True, timeout=30)
                if result.returncode != 0:
                    _send_json(self, 500, {'error': 'FFmpeg failed', 'stderr': result.stderr.decode()[-500:]}); return

                with open(out_path, 'rb') as f:
                    video_data = f.read()

                self.send_response(200)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Content-Length', len(video_data))
                self.send_header('Content-Disposition', 'attachment; filename="generated.mp4"')
                self.end_headers()
                self.wfile.write(video_data)
            except Exception as e:
                _send_json(self, 500, {'error': str(e)})
            finally:
                shutil.rmtree(tmpdir, ignore_errors=True)

        elif path == '/api/proxy/pollinations':
            data = json.loads(body_raw) if body_raw else {}
            raw_prompt = data.get('prompt', 'beautiful landscape')
            width = int(data.get('width', 1024))
            height = int(data.get('height', 1024))
            nologo = data.get('nologo', 'true')
            api_key = load_env().get('GEMINI_API_KEY', '')

            def _quick_clean_prompt(text, key):
                if not text:
                    return 'beautiful cinematic landscape', 'cinematic landscape'
                t = text.replace('[', ' ').replace(']', ' ')
                t = re.sub(r'[\r\n\t]+', ' ', t)
                t = re.sub(r'[\"\`\*\#]', ' ', t)
                t = re.sub(r'\s+', ' ', t).strip()
                search_kw = t
                if re.search(r'[가-힣]', t) and key:
                    try:
                        url = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={key}'
                        req_body = json.dumps({
                            'contents': [{'parts': [{'text': f'From this image description, output JSON with two fields:\n1. \"prompt\": Vivid, descriptive English AI image prompt (max 35 words) without any text or subtitles.\n2. \"keywords\": 2-3 English search words for the main subject.\n\nDescription: {t}\n\nJSON output ONLY:'}]}],
                            'generationConfig': {'responseMimeType': 'application/json', 'temperature': 0.2}
                        }).encode('utf-8')
                        req = urllib.request.Request(url, data=req_body, headers={'Content-Type': 'application/json', 'User-Agent': 'YouTubeContentTool/1.0'})
                        with urllib.request.urlopen(req, timeout=4, context=_ssl_ctx) as resp:
                            gdata = json.loads(resp.read().decode())
                            tr_text = gdata.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '').strip()
                            p_obj = json.loads(tr_text)
                            p_res = p_obj.get('prompt', '').strip()
                            kw_res = p_obj.get('keywords', '')
                            if isinstance(kw_res, list): kw_res = ' '.join(kw_res)
                            if p_res:
                                return p_res, (str(kw_res) or p_res)
                    except Exception:
                        pass
                return t or 'beautiful cinematic landscape', search_kw

            clean_prompt, search_keywords = _quick_clean_prompt(raw_prompt, api_key)
            clean_prompt = clean_prompt.strip().rstrip(',')
            if 'no text' not in clean_prompt.lower():
                clean_prompt += ', pure artwork, no text, no subtitles, no watermark'

            encoded_prompt = urllib.parse.quote(clean_prompt, safe='')
            seed = random.randint(1, 9999999)
            poll_urls = [
                f'https://image.pollinations.ai/prompt/{encoded_prompt}?width={width}&height={height}&nologo={nologo}&seed={seed}&model=flux',
                f'https://image.pollinations.ai/prompt/{encoded_prompt}?width={width}&height={height}&nologo={nologo}&seed={seed}&model=turbo',
                f'https://image.pollinations.ai/prompt/{encoded_prompt}?width={width}&height={height}&nologo={nologo}&seed={seed}',
            ]

            img_data = None
            for p_url in poll_urls:
                try:
                    req_p = urllib.request.Request(
                        p_url,
                        headers={
                            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8'
                        }
                    )
                    with urllib.request.urlopen(req_p, timeout=8, context=_ssl_ctx) as resp_p:
                        b = resp_p.read()
                        if len(b) > 2000 and (b[:3] == b'\xff\xd8\xff' or b[:8] == b'\x89PNG\r\n\x1a\n' or b'WEBP' in b[:16]):
                            img_data = b
                            break
                except Exception:
                    pass

            # Openverse CC high-resolution photography search fallback
            if not img_data:
                try:
                    from PIL import Image, ImageOps
                    import io
                    kw = search_keywords or clean_prompt[:50]
                    ov_url = f'https://api.openverse.org/v1/images/?q={urllib.parse.quote(kw)}&page_size=5&license_type=commercial,modification'
                    req_ov = urllib.request.Request(ov_url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req_ov, timeout=6, context=_ssl_ctx) as resp_ov:
                        ov_data = json.loads(resp_ov.read().decode())
                        for r in ov_data.get('results', []):
                            img_u = r.get('url')
                            if img_u and not img_u.endswith('.svg'):
                                try:
                                    req_img = urllib.request.Request(img_u, headers={'User-Agent': 'Mozilla/5.0'})
                                    with urllib.request.urlopen(req_img, timeout=6, context=_ssl_ctx) as img_resp:
                                        raw_bytes = img_resp.read()
                                        if len(raw_bytes) > 5000:
                                            im = Image.open(io.BytesIO(raw_bytes)).convert('RGB')
                                            cropped = ImageOps.fit(im, (width, height), method=Image.Resampling.LANCZOS)
                                            buf = io.BytesIO()
                                            cropped.save(buf, format='JPEG', quality=90)
                                            img_data = buf.getvalue()
                                            break
                                except Exception:
                                    continue
                except Exception:
                    pass

            if not img_data:
                _send_json(self, 500, {'error': 'Image generation server is busy. Please try again.'})
                return

            self.send_response(200)
            self.send_header('Content-Type', 'image/jpeg')
            self.send_header('Content-Length', len(img_data))
            self.end_headers()
            self.wfile.write(img_data)

        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, fmt, *args):
        pass

if __name__ == '__main__':
    port = 8765
    os.chdir(Path(__file__).parent)
    server = ThreadingHTTPServer(('localhost', port), Handler)
    print(f'✅ WaveStudio 통합 로컬 서버 실행 중 → http://localhost:{port}')
    print('   종료: Ctrl+C')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n서버 종료')
