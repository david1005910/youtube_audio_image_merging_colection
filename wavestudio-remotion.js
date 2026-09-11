/**
 * wavestudio-remotion.js
 * Remotion-like Multi-Track Timeline Video Editor (Images, Audio, Subtitles)
 * Full interactive 1080p canvas preview, real-time playback, drag/resize handles, inspector, and 1080p FFmpeg rendering.
 */

(function () {
  'use strict';

  class RemotionEditor {
    constructor() {
      this.timeline = {
        duration: 15.0,
        visual_track: [],   // [{ id, file, url, media_path, is_video, start, duration, imgBitmap, el }]
        audio_track: [],    // [{ id, file, url, media_path, start, duration, volume, audioEl }]
        subtitle_track: [], // [{ id, start, end, text, font_size, font_color, bg_style, position }]
        subtitle_style: {
          font_size: 32,
          font_color: '#ffffff',
          bg_style: 'box',
          position: 'bottom'
        }
      };

      this.currentTime = 0.0;
      this.isPlaying = false;
      this.pxPerSec = 35; // 35 pixels per second
      this.selectedClip = null; // { track: 'visual'|'audio'|'subtitle', item, index }
      this.activeAudioElements = [];

      this.lastFrameTime = 0;
      this.animFrameId = null;

      this.dom = {};
      this.isInitialized = false;
    }

    init() {
      if (this.isInitialized) return;
      this._bindDOMElements();
      this._bindEvents();
      this.renderTimeline();
      this.renderCanvas();
      this.isInitialized = true;
    }

    _bindDOMElements() {
      this.dom.canvas = document.getElementById('remotionCanvas');
      this.dom.ctx = this.dom.canvas ? this.dom.canvas.getContext('2d') : null;

      // Transport controls
      this.dom.btnPlay = document.getElementById('remBtnPlay');
      this.dom.btnStop = document.getElementById('remBtnStop');
      this.dom.timecode = document.getElementById('remTimecode');
      this.dom.zoomSlider = document.getElementById('remZoomSlider');

      // Timeline DOM
      this.dom.timelineRuler = document.getElementById('remTimelineRuler');
      this.dom.playhead = document.getElementById('remPlayhead');
      this.dom.tracksArea = document.getElementById('remTracksArea');
      this.dom.trackVisual = document.getElementById('remTrackVisual');
      this.dom.trackAudio = document.getElementById('remTrackAudio');
      this.dom.trackSubtitle = document.getElementById('remTrackSubtitle');

      // Quick Tools
      this.dom.btnAddImage = document.getElementById('remBtnAddImage');
      this.dom.inputAddImage = document.getElementById('remInputAddImage');
      this.dom.btnAddAudio = document.getElementById('remBtnAddAudio');
      this.dom.inputAddAudio = document.getElementById('remInputAddAudio');
      this.dom.btnAddSubtitle = document.getElementById('remBtnAddSubtitle');
      this.dom.btnExportSrt = document.getElementById('remBtnExportSrt');
      this.dom.btnExportTxt = document.getElementById('remBtnExportTxt');
      this.dom.btnSplit = document.getElementById('remBtnSplit');
      this.dom.btnDeleteClip = document.getElementById('remBtnDeleteClip');
      this.dom.btnExport = document.getElementById('remBtnExport');

      // Inspector
      this.dom.inspectorEmpty = document.getElementById('remInspectorEmpty');
      this.dom.inspectorContent = document.getElementById('remInspectorContent');
      this.dom.inspClipType = document.getElementById('remInspClipType');
      this.dom.inspStart = document.getElementById('remInspStart');
      this.dom.inspDuration = document.getElementById('remInspDuration');
      this.dom.inspSubSection = document.getElementById('remInspSubSection');
      this.dom.inspSubText = document.getElementById('remInspSubText');
      this.dom.inspSubSize = document.getElementById('remInspSubSize');
      this.dom.inspSubColor = document.getElementById('remInspSubColor');
      this.dom.inspSubBg = document.getElementById('remInspSubBg');
      this.dom.inspSubPos = document.getElementById('remInspSubPos');
      this.dom.inspAudioSection = document.getElementById('remInspAudioSection');
      this.dom.inspAudioVol = document.getElementById('remInspAudioVol');
      this.dom.inspAudioVolVal = document.getElementById('remInspAudioVolVal');
    }

    _bindEvents() {
      // Play / Pause
      if (this.dom.btnPlay) {
        this.dom.btnPlay.addEventListener('click', () => this.togglePlay());
      }
      if (this.dom.btnStop) {
        this.dom.btnStop.addEventListener('click', () => {
          this.pause();
          this.seekTo(0);
        });
      }

      // Spacebar to toggle play
      window.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
          const wsModal = document.getElementById('waveStudioModal');
          if (wsModal && !wsModal.classList.contains('hidden')) {
            const remTab = document.getElementById('wsTabRemotion');
            if (remTab && remTab.classList.contains('active')) {
              e.preventDefault();
              this.togglePlay();
            }
          }
        }
      });

      // Zoom
      if (this.dom.zoomSlider) {
        this.dom.zoomSlider.addEventListener('input', (e) => {
          this.pxPerSec = parseInt(e.target.value, 10);
          this.renderTimeline();
          this._updatePlayheadPosition();
        });
      }

      // Timeline Ruler / Playhead Scrubbing
      if (this.dom.timelineRuler) {
        const scrub = (e) => {
          const rect = this.dom.timelineRuler.getBoundingClientRect();
          const scrollLeft = this.dom.tracksArea.scrollLeft;
          const x = e.clientX - rect.left + scrollLeft;
          const time = Math.max(0, Math.min(this.timeline.duration, x / this.pxPerSec));
          this.seekTo(time);
        };

        this.dom.timelineRuler.addEventListener('mousedown', (e) => {
          scrub(e);
          const onMove = (ev) => scrub(ev);
          const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });
      }

      // Add Media Handlers
      if (this.dom.btnAddImage && this.dom.inputAddImage) {
        this.dom.btnAddImage.addEventListener('click', () => this.dom.inputAddImage.click());
        this.dom.inputAddImage.addEventListener('change', (e) => {
          const files = Array.from(e.target.files);
          files.forEach(f => this.addVisualClip(f));
          e.target.value = '';
        });
      }

      if (this.dom.btnAddAudio && this.dom.inputAddAudio) {
        this.dom.btnAddAudio.addEventListener('click', () => this.dom.inputAddAudio.click());
        this.dom.inputAddAudio.addEventListener('change', (e) => {
          const files = Array.from(e.target.files);
          files.forEach(f => this.addAudioClip(f));
          e.target.value = '';
        });
      }

      if (this.dom.btnAddSubtitle) {
        this.dom.btnAddSubtitle.addEventListener('click', () => {
          this.addSubtitleClip({
            start: this.currentTime,
            end: Math.min(this.timeline.duration, this.currentTime + 3.0),
            text: '새 자막 텍스트를 입력하세요'
          });
        });
      }

      // Export SRT & TXT
      if (this.dom.btnExportSrt) {
        this.dom.btnExportSrt.addEventListener('click', () => this.exportSrtFile());
      }
      if (this.dom.btnExportTxt) {
        this.dom.btnExportTxt.addEventListener('click', () => this.exportTxtFile());
      }

      // Split & Delete
      if (this.dom.btnSplit) {
        this.dom.btnSplit.addEventListener('click', () => this.splitSelectedClip());
      }
      if (this.dom.btnDeleteClip) {
        this.dom.btnDeleteClip.addEventListener('click', () => this.deleteSelectedClip());
      }

      // Export Video
      if (this.dom.btnExport) {
        this.dom.btnExport.addEventListener('click', () => this.exportRemotionVideo());
      }

      // Inspector Change Listeners
      if (this.dom.inspStart) {
        this.dom.inspStart.addEventListener('change', (e) => {
          if (!this.selectedClip) return;
          const val = Math.max(0, parseFloat(e.target.value) || 0);
          this.selectedClip.item.start = val;
          if (this.selectedClip.track === 'subtitle') {
            const dur = this.selectedClip.item.end - this.selectedClip.item.start;
            this.selectedClip.item.end = val + Math.max(0.5, dur);
          }
          this._recalculateDuration();
          this.renderTimeline();
          this.renderCanvas();
        });
      }

      if (this.dom.inspDuration) {
        this.dom.inspDuration.addEventListener('change', (e) => {
          if (!this.selectedClip) return;
          const dur = Math.max(0.5, parseFloat(e.target.value) || 1.0);
          if (this.selectedClip.track === 'subtitle') {
            this.selectedClip.item.end = this.selectedClip.item.start + dur;
          } else {
            this.selectedClip.item.duration = dur;
          }
          this._recalculateDuration();
          this.renderTimeline();
          this.renderCanvas();
        });
      }

      if (this.dom.inspSubText) {
        this.dom.inspSubText.addEventListener('input', (e) => {
          if (!this.selectedClip || this.selectedClip.track !== 'subtitle') return;
          this.selectedClip.item.text = e.target.value;
          this.renderTimeline();
          this.renderCanvas();
        });
      }

      if (this.dom.inspSubSize) {
        this.dom.inspSubSize.addEventListener('input', (e) => {
          if (!this.selectedClip || this.selectedClip.track !== 'subtitle') return;
          this.selectedClip.item.font_size = parseInt(e.target.value, 10);
          this.renderCanvas();
        });
      }

      if (this.dom.inspSubColor) {
        this.dom.inspSubColor.addEventListener('input', (e) => {
          if (!this.selectedClip || this.selectedClip.track !== 'subtitle') return;
          this.selectedClip.item.font_color = e.target.value;
          this.renderCanvas();
        });
      }

      if (this.dom.inspSubBg) {
        this.dom.inspSubBg.addEventListener('change', (e) => {
          if (!this.selectedClip || this.selectedClip.track !== 'subtitle') return;
          this.selectedClip.item.bg_style = e.target.value;
          this.renderCanvas();
        });
      }

      if (this.dom.inspSubPos) {
        this.dom.inspSubPos.addEventListener('change', (e) => {
          if (!this.selectedClip || this.selectedClip.track !== 'subtitle') return;
          this.selectedClip.item.position = e.target.value;
          this.renderCanvas();
        });
      }

      if (this.dom.inspAudioVol) {
        this.dom.inspAudioVol.addEventListener('input', (e) => {
          if (!this.selectedClip || this.selectedClip.track !== 'audio') return;
          const vol = parseFloat(e.target.value);
          this.selectedClip.item.volume = vol;
          if (this.dom.inspAudioVolVal) this.dom.inspAudioVolVal.textContent = `${Math.round(vol * 100)}%`;
          if (this.selectedClip.item.audioEl) this.selectedClip.item.audioEl.volume = Math.min(1.0, vol);
        });
      }
    }

    // ── Load Script / Image Cards into Timeline ──
    loadFromScriptCards(cards, audioUrl = null, audioDuration = null) {
      this.init();
      this.timeline.visual_track = [];
      this.timeline.subtitle_track = [];
      this.timeline.audio_track = [];

      let currentTime = 0.0;
      const defaultDurationPerCard = 5.0;

      cards.forEach((card, idx) => {
        const dur = parseFloat(card.duration) || defaultDurationPerCard;
        const imgUrl = card.imageUrl || card.src || card.dataUrl || null;

        // Visual Clip
        const vClip = {
          id: `v_${Date.now()}_${idx}`,
          url: imgUrl,
          title: card.chapterTitle || `장면 ${idx + 1}`,
          start: currentTime,
          duration: dur,
          is_video: false
        };

        if (imgUrl) {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            vClip.imgBitmap = img;
            this.renderCanvas();
          };
          img.src = imgUrl;
        }
        this.timeline.visual_track.push(vClip);

        // Subtitle Clip
        const subText = (card.subtitles || card.subtitle || card.cutDescription || '').trim();
        if (subText) {
          this.timeline.subtitle_track.push({
            id: `sub_${Date.now()}_${idx}`,
            start: currentTime,
            end: currentTime + dur,
            text: subText,
            font_size: 32,
            font_color: '#ffffff',
            bg_style: 'box',
            position: 'bottom'
          });
        }

        currentTime += dur;
      });

      // Audio Track
      if (audioUrl) {
        const aClip = {
          id: `a_${Date.now()}`,
          url: audioUrl,
          title: 'AI 나레이션 음성',
          start: 0.0,
          duration: audioDuration || currentTime,
          volume: 1.0
        };
        const audio = new Audio();
        audio.src = audioUrl;
        aClip.audioEl = audio;
        this.timeline.audio_track.push(aClip);
      }

      this._recalculateDuration();
      this.seekTo(0);
      this.renderTimeline();
      this.renderCanvas();
    }

    // ── Timeline Calculation & Tracks Rendering ──
    _recalculateDuration() {
      let maxTime = 10.0;
      this.timeline.visual_track.forEach(v => {
        maxTime = Math.max(maxTime, v.start + (v.duration || 0));
      });
      this.timeline.audio_track.forEach(a => {
        maxTime = Math.max(maxTime, a.start + (a.duration || 0));
      });
      this.timeline.subtitle_track.forEach(s => {
        maxTime = Math.max(maxTime, s.end || (s.start + 3.0));
      });
      this.timeline.duration = Math.max(10.0, Math.ceil(maxTime));
    }

    renderTimeline() {
      this._recalculateDuration();
      const totalWidth = Math.max(800, this.timeline.duration * this.pxPerSec + 200);

      // Render Ruler
      if (this.dom.timelineRuler) {
        this.dom.timelineRuler.style.width = `${totalWidth}px`;
        this.dom.timelineRuler.innerHTML = '';
        const step = this.pxPerSec >= 50 ? 1 : (this.pxPerSec >= 25 ? 2 : 5);
        for (let sec = 0; sec <= this.timeline.duration + 5; sec += step) {
          const tick = document.createElement('div');
          tick.className = 'ruler-tick';
          tick.style.left = `${sec * this.pxPerSec}px`;
          tick.textContent = this._formatTimecode(sec);
          this.dom.timelineRuler.appendChild(tick);
        }
      }

      // Render Visual Track
      if (this.dom.trackVisual) {
        this.dom.trackVisual.style.width = `${totalWidth}px`;
        this.dom.trackVisual.innerHTML = '';
        this.timeline.visual_track.forEach((v, idx) => {
          const el = this._createClipElement('visual', v, idx);
          this.dom.trackVisual.appendChild(el);
        });
      }

      // Render Audio Track
      if (this.dom.trackAudio) {
        this.dom.trackAudio.style.width = `${totalWidth}px`;
        this.dom.trackAudio.innerHTML = '';
        this.timeline.audio_track.forEach((a, idx) => {
          const el = this._createClipElement('audio', a, idx);
          this.dom.trackAudio.appendChild(el);
        });
      }

      // Render Subtitle Track
      if (this.dom.trackSubtitle) {
        this.dom.trackSubtitle.style.width = `${totalWidth}px`;
        this.dom.trackSubtitle.innerHTML = '';
        this.timeline.subtitle_track.forEach((s, idx) => {
          const el = this._createClipElement('subtitle', s, idx);
          this.dom.trackSubtitle.appendChild(el);
        });
      }

      this._updatePlayheadPosition();
    }

    _createClipElement(trackType, item, index) {
      const clip = document.createElement('div');
      clip.className = `track-clip-item clip-${trackType}`;
      if (this.selectedClip && this.selectedClip.track === trackType && this.selectedClip.item === item) {
        clip.classList.add('selected');
      }

      const left = item.start * this.pxPerSec;
      const dur = trackType === 'subtitle' ? (item.end - item.start) : item.duration;
      const width = Math.max(16, dur * this.pxPerSec);

      clip.style.left = `${left}px`;
      clip.style.width = `${width}px`;

      // Handles
      const hLeft = document.createElement('div');
      hLeft.className = 'clip-handle-left';
      const hRight = document.createElement('div');
      hRight.className = 'clip-handle-right';

      const label = document.createElement('span');
      label.className = 'clip-label-text';
      if (trackType === 'visual') label.textContent = item.title || `이미지 ${index + 1}`;
      else if (trackType === 'audio') label.textContent = item.title || `오디오 ${index + 1}`;
      else label.textContent = item.text || '자막';

      clip.appendChild(hLeft);
      clip.appendChild(label);
      clip.appendChild(hRight);

      // Select Clip
      clip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectClip(trackType, item, index);
      });

      // Drag Move Clip
      clip.addEventListener('mousedown', (e) => {
        if (e.target === hLeft || e.target === hRight) return;
        this.selectClip(trackType, item, index);
        const startX = e.clientX;
        const initialStart = item.start;

        const onMove = (ev) => {
          const deltaX = ev.clientX - startX;
          const deltaTime = deltaX / this.pxPerSec;
          const newStart = Math.max(0, initialStart + deltaTime);
          item.start = newStart;
          if (trackType === 'subtitle') item.end = newStart + dur;
          clip.style.left = `${newStart * this.pxPerSec}px`;
          this.updateInspector();
          this.renderCanvas();
        };

        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          this._recalculateDuration();
          this.renderTimeline();
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });

      // Drag Left Handle (Change Start & Duration)
      hLeft.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const startX = e.clientX;
        const origStart = item.start;
        const origDur = dur;

        const onMove = (ev) => {
          const deltaT = (ev.clientX - startX) / this.pxPerSec;
          const newStart = Math.max(0, Math.min(origStart + origDur - 0.5, origStart + deltaT));
          const newDur = (origStart + origDur) - newStart;
          item.start = newStart;
          if (trackType === 'subtitle') {
            // Keep item.end fixed
          } else {
            item.duration = newDur;
          }
          clip.style.left = `${newStart * this.pxPerSec}px`;
          clip.style.width = `${newDur * this.pxPerSec}px`;
          this.updateInspector();
          this.renderCanvas();
        };

        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          this._recalculateDuration();
          this.renderTimeline();
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });

      // Drag Right Handle (Change Duration)
      hRight.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const startX = e.clientX;
        const origDur = dur;

        const onMove = (ev) => {
          const deltaT = (ev.clientX - startX) / this.pxPerSec;
          const newDur = Math.max(0.5, origDur + deltaT);
          if (trackType === 'subtitle') {
            item.end = item.start + newDur;
          } else {
            item.duration = newDur;
          }
          clip.style.width = `${newDur * this.pxPerSec}px`;
          this.updateInspector();
          this.renderCanvas();
        };

        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          this._recalculateDuration();
          this.renderTimeline();
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });

      return clip;
    }

    selectClip(trackType, item, index) {
      this.selectedClip = { track: trackType, item, index };
      document.querySelectorAll('.track-clip-item').forEach(el => el.classList.remove('selected'));
      this.updateInspector();
    }

    updateInspector() {
      if (!this.selectedClip) {
        if (this.dom.inspectorEmpty) this.dom.inspectorEmpty.classList.remove('hidden');
        if (this.dom.inspectorContent) this.dom.inspectorContent.classList.add('hidden');
        return;
      }

      if (this.dom.inspectorEmpty) this.dom.inspectorEmpty.classList.add('hidden');
      if (this.dom.inspectorContent) this.dom.inspectorContent.classList.remove('hidden');

      const { track, item } = this.selectedClip;
      if (this.dom.inspClipType) {
        const types = { visual: '🎬 이미지/비디오 클립', audio: '🎙️ 오디오 클립', subtitle: '💬 자막 클립' };
        this.dom.inspClipType.textContent = types[track] || '클립';
      }

      if (this.dom.inspStart) this.dom.inspStart.value = item.start.toFixed(2);
      const dur = track === 'subtitle' ? (item.end - item.start) : item.duration;
      if (this.dom.inspDuration) this.dom.inspDuration.value = (dur || 0).toFixed(2);

      // Subtitle Section
      if (this.dom.inspSubSection) {
        if (track === 'subtitle') {
          this.dom.inspSubSection.classList.remove('hidden');
          if (this.dom.inspSubText) this.dom.inspSubText.value = item.text || '';
          if (this.dom.inspSubSize) this.dom.inspSubSize.value = item.font_size || 32;
          if (this.dom.inspSubColor) this.dom.inspSubColor.value = item.font_color || '#ffffff';
          if (this.dom.inspSubBg) this.dom.inspSubBg.value = item.bg_style || 'box';
          if (this.dom.inspSubPos) this.dom.inspSubPos.value = item.position || 'bottom';
        } else {
          this.dom.inspSubSection.classList.add('hidden');
        }
      }

      // Audio Section
      if (this.dom.inspAudioSection) {
        if (track === 'audio') {
          this.dom.inspAudioSection.classList.remove('hidden');
          const vol = item.volume ?? 1.0;
          if (this.dom.inspAudioVol) this.dom.inspAudioVol.value = vol;
          if (this.dom.inspAudioVolVal) this.dom.inspAudioVolVal.textContent = `${Math.round(vol * 100)}%`;
        } else {
          this.dom.inspAudioSection.classList.add('hidden');
        }
      }
    }

    addVisualClip(file) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        this.timeline.visual_track.push({
          id: `v_${Date.now()}`,
          file: file,
          url: url,
          imgBitmap: img,
          title: file.name,
          start: this.currentTime,
          duration: 5.0,
          is_video: file.type.startsWith('video')
        });
        this._recalculateDuration();
        this.renderTimeline();
        this.renderCanvas();
      };
      img.src = url;
    }

    addAudioClip(file) {
      const url = URL.createObjectURL(file);
      const audio = new Audio();
      audio.src = url;
      audio.onloadedmetadata = () => {
        this.timeline.audio_track.push({
          id: `a_${Date.now()}`,
          file: file,
          url: url,
          audioEl: audio,
          title: file.name,
          start: this.currentTime,
          duration: audio.duration || 10.0,
          volume: 1.0
        });
        this._recalculateDuration();
        this.renderTimeline();
        this.renderCanvas();
      };
    }

    addSubtitleClip(opts = {}) {
      const sub = {
        id: `s_${Date.now()}`,
        start: opts.start ?? this.currentTime,
        end: opts.end ?? (this.currentTime + 3.0),
        text: opts.text || '새 자막 내용',
        font_size: opts.font_size || 32,
        font_color: opts.font_color || '#ffffff',
        bg_style: opts.bg_style || 'box',
        position: opts.position || 'bottom'
      };
      this.timeline.subtitle_track.push(sub);
      this._recalculateDuration();
      this.renderTimeline();
      this.renderCanvas();
      this.selectClip('subtitle', sub, this.timeline.subtitle_track.length - 1);
    }

    splitSelectedClip() {
      if (!this.selectedClip) return;
      const { track, item, index } = this.selectedClip;
      const t = this.currentTime;
      const dur = track === 'subtitle' ? (item.end - item.start) : item.duration;
      const end = track === 'subtitle' ? item.end : (item.start + dur);

      if (t <= item.start || t >= end) {
        alert('재생헤드가 선택한 클립의 시작과 끝 사이에 위치해야 분할할 수 있습니다.');
        return;
      }

      if (track === 'visual' || track === 'audio') {
        const dur1 = t - item.start;
        const dur2 = end - t;
        item.duration = dur1;
        const newItem = { ...item, id: `${item.id}_part2`, start: t, duration: dur2 };
        if (track === 'visual') this.timeline.visual_track.splice(index + 1, 0, newItem);
        else this.timeline.audio_track.splice(index + 1, 0, newItem);
      } else if (track === 'subtitle') {
        const endOrig = item.end;
        item.end = t;
        const newItem = { ...item, id: `${item.id}_part2`, start: t, end: endOrig };
        this.timeline.subtitle_track.splice(index + 1, 0, newItem);
      }

      this.renderTimeline();
      this.renderCanvas();
    }

    deleteSelectedClip() {
      if (!this.selectedClip) return;
      const { track, index } = this.selectedClip;
      if (track === 'visual') this.timeline.visual_track.splice(index, 1);
      else if (track === 'audio') this.timeline.audio_track.splice(index, 1);
      else if (track === 'subtitle') this.timeline.subtitle_track.splice(index, 1);

      this.selectedClip = null;
      this.updateInspector();
      this._recalculateDuration();
      this.renderTimeline();
      this.renderCanvas();
    }

    // ── Playback & Canvas Rendering ──
    togglePlay() {
      if (this.isPlaying) this.pause();
      else this.play();
    }

    play() {
      if (this.currentTime >= this.timeline.duration) this.currentTime = 0;
      this.isPlaying = true;
      if (this.dom.btnPlay) this.dom.btnPlay.innerHTML = '⏸';
      this.lastFrameTime = performance.now();
      this._syncAudioPlayback();
      this._playLoop();
    }

    pause() {
      this.isPlaying = false;
      if (this.dom.btnPlay) this.dom.btnPlay.innerHTML = '▶';
      if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
      this._stopAllAudio();
    }

    seekTo(time) {
      this.currentTime = Math.max(0, Math.min(this.timeline.duration, time));
      this._updatePlayheadPosition();
      this._syncAudioPlayback();
      this.renderCanvas();
    }

    _playLoop() {
      if (!this.isPlaying) return;
      const now = performance.now();
      const delta = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;

      this.currentTime += delta;
      if (this.currentTime >= this.timeline.duration) {
        this.currentTime = this.timeline.duration;
        this.pause();
        this._updatePlayheadPosition();
        this.renderCanvas();
        return;
      }

      this._updatePlayheadPosition();
      this.renderCanvas();
      this.animFrameId = requestAnimationFrame(() => this._playLoop());
    }

    _updatePlayheadPosition() {
      const left = this.currentTime * this.pxPerSec;
      if (this.dom.playhead) {
        this.dom.playhead.style.transform = `translateX(${left}px)`;
      }
      if (this.dom.timecode) {
        this.dom.timecode.textContent = `${this._formatTimecode(this.currentTime)} / ${this._formatTimecode(this.timeline.duration)}`;
      }
    }

    _syncAudioPlayback() {
      this.timeline.audio_track.forEach(a => {
        if (!a.audioEl) return;
        const aStart = a.start;
        const aEnd = a.start + (a.duration || 9999);
        if (this.currentTime >= aStart && this.currentTime < aEnd) {
          const offset = this.currentTime - aStart;
          if (Math.abs(a.audioEl.currentTime - offset) > 0.3) {
            a.audioEl.currentTime = offset;
          }
          if (this.isPlaying && a.audioEl.paused) {
            a.audioEl.play().catch(() => {});
          }
        } else {
          if (!a.audioEl.paused) a.audioEl.pause();
        }
      });
    }

    _stopAllAudio() {
      this.timeline.audio_track.forEach(a => {
        if (a.audioEl && !a.audioEl.paused) a.audioEl.pause();
      });
    }

    renderCanvas() {
      const ctx = this.dom.ctx;
      if (!ctx || !this.dom.canvas) return;

      const cw = this.dom.canvas.width;
      const ch = this.dom.canvas.height;

      // Clear Screen
      ctx.fillStyle = '#0a0d16';
      ctx.fillRect(0, 0, cw, ch);

      // 1. Draw Active Visual Clip
      const activeVisual = this.timeline.visual_track.find(v => {
        return this.currentTime >= v.start && this.currentTime < (v.start + (v.duration || 0));
      });

      if (activeVisual && activeVisual.imgBitmap) {
        const img = activeVisual.imgBitmap;
        const scale = Math.min(cw / img.width, ch / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (cw - dw) / 2;
        const dy = (ch - dh) / 2;
        ctx.drawImage(img, dx, dy, dw, dh);
      } else {
        // Fallback Dark Background Grid
        ctx.fillStyle = '#0f1422';
        ctx.fillRect(0, 0, cw, ch);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.font = '28px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('1080p Full HD Canvas', cw / 2, ch / 2);
      }

      // 2. Draw Active Subtitles
      const activeSubs = this.timeline.subtitle_track.filter(s => {
        return this.currentTime >= s.start && this.currentTime <= (s.end || (s.start + 3.0));
      });

      activeSubs.forEach(s => {
        const text = (s.text || '').trim();
        if (!text) return;

        const fontSize = (s.font_size || 32) * 1.5; // Scale up for 1080p
        ctx.font = `bold ${fontSize}px Inter, "Noto Sans KR", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const lines = text.split('\n');
        const lineHeight = fontSize * 1.35;
        const totalHeight = lines.length * lineHeight;

        let centerY = ch - 120; // Bottom position
        if (s.position === 'top') centerY = 120;
        else if (s.position === 'center') centerY = ch / 2;

        const startY = centerY - (totalHeight / 2) + (lineHeight / 2);

        lines.forEach((line, lineIdx) => {
          const ly = startY + lineIdx * lineHeight;
          const textMetrics = ctx.measureText(line);
          const tw = textMetrics.width;

          if (s.bg_style === 'box') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
            const padX = 24;
            const padY = 12;
            ctx.fillRect((cw - tw) / 2 - padX, ly - (lineHeight / 2) - 4, tw + padX * 2, lineHeight + padY);
          } else {
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 6;
            ctx.strokeText(line, cw / 2, ly);
          }

          ctx.fillStyle = s.font_color || '#ffffff';
          ctx.fillText(line, cw / 2, ly);
        });
      });
    }

    _formatTimecode(seconds) {
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 10);
      return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
    }

    // ── Export Functions ──
    exportSrtFile() {
      const subs = [...this.timeline.subtitle_track].sort((a, b) => a.start - b.start);
      if (!subs.length) {
        alert('내보낼 자막이 없습니다.');
        return;
      }

      let srt = '';
      subs.forEach((s, idx) => {
        const fmt = (t) => {
          const h = Math.floor(t / 3600);
          const m = Math.floor((t % 3600) / 60);
          const sec = Math.floor(t % 60);
          const ms = Math.floor((t % 1) * 1000);
          return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
        };
        srt += `${idx + 1}\n${fmt(s.start)} --> ${fmt(s.end)}\n${s.text}\n\n`;
      });

      const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `subtitles_${Date.now()}.srt`;
      a.click();
    }

    exportTxtFile() {
      const subs = [...this.timeline.subtitle_track].sort((a, b) => a.start - b.start);
      if (!subs.length) {
        alert('내보낼 대본이 없습니다.');
        return;
      }
      const txt = subs.map(s => s.text).join('\n\n');
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `script_${Date.now()}.txt`;
      a.click();
    }

    async exportRemotionVideo() {
      const fd = new FormData();
      fd.append('tasks', 'remotion_render');

      const tlExport = {
        duration: this.timeline.duration,
        visual_track: [],
        audio_track: [],
        subtitle_track: this.timeline.subtitle_track,
        subtitle_style: this.timeline.subtitle_style
      };

      // Visual Track Files
      this.timeline.visual_track.forEach((v, idx) => {
        const vItem = {
          start: v.start,
          duration: v.duration,
          is_video: v.is_video || false
        };
        if (v.file) {
          const field = `visual_file_${idx}`;
          fd.append(field, v.file);
          vItem.file_field = field;
        } else if (v.url) {
          vItem.url = v.url;
        }
        tlExport.visual_track.push(vItem);
      });

      // Audio Track Files
      this.timeline.audio_track.forEach((a, idx) => {
        const aItem = {
          start: a.start,
          duration: a.duration,
          volume: a.volume ?? 1.0
        };
        if (a.file) {
          const field = `audio_file_${idx}`;
          fd.append(field, a.file);
          aItem.file_field = field;
        } else if (a.url) {
          aItem.url = a.url;
        }
        tlExport.audio_track.push(aItem);
      });

      fd.append('timeline_data', JSON.stringify(tlExport));

      const monitorBox = document.getElementById('wsGlobalMonitor');
      const progressFill = document.getElementById('wsGlobalProgressFill');
      const stageText = document.getElementById('wsGlobalStageText');
      const percentText = document.getElementById('wsGlobalPercentText');
      const resultArea = document.getElementById('wsGlobalResultArea');

      if (monitorBox) monitorBox.classList.remove('hidden');
      if (stageText) stageText.textContent = 'Remotion 1080p 비디오 렌더링 작업 요청 중...';
      if (progressFill) progressFill.style.width = '5%';
      if (percentText) percentText.textContent = '5%';
      if (resultArea) resultArea.innerHTML = '';

      try {
        const res = await fetch('/api/run', { method: 'POST', body: fd });
        if (!res.ok) throw new Error('작업 제출 실패');
        const data = await res.json();
        const jid = data.id;

        const pollTimer = setInterval(async () => {
          try {
            const sRes = await fetch(`/api/status?id=${jid}`);
            if (!sRes.ok) return;
            const statusData = await sRes.json();

            if (progressFill) progressFill.style.width = `${statusData.progress}%`;
            if (percentText) percentText.textContent = `${statusData.progress}%`;
            if (stageText) stageText.textContent = statusData.current_task || '렌더링 진행 중...';

            if (statusData.status === 'done') {
              clearInterval(pollTimer);
              if (stageText) stageText.textContent = '✨ 1080p 비디오 렌더링 완료!';
              if (resultArea && statusData.results && statusData.results[0]) {
                const url = statusData.results[0].url;
                resultArea.innerHTML = `
                  <div class="mt-3 p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl flex items-center justify-between">
                    <span class="text-xs text-emerald-300 font-bold">🎬 Remotion 비디오 완성!</span>
                    <div class="flex gap-2">
                      <a href="${url}" target="_blank" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition">미리보기</a>
                      <a href="${url}" download class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition">다운로드</a>
                    </div>
                  </div>
                `;
              }
              if (window.WaveStudio && window.WaveStudio.fetchLibraryFiles) {
                window.WaveStudio.fetchLibraryFiles();
              }
            } else if (statusData.status === 'error' || statusData.status === 'cancelled') {
              clearInterval(pollTimer);
              if (stageText) stageText.textContent = `❌ 렌더링 실패: ${statusData.error || '취소됨'}`;
            }
          } catch (e) {
            console.error(e);
          }
        }, 1000);
      } catch (err) {
        if (stageText) stageText.textContent = `❌ 오류: ${err.message}`;
      }
    }
  }

  window.RemotionEditor = RemotionEditor;
  window.remotionEditorInstance = new RemotionEditor();
})();
