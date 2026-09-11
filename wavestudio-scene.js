/**
 * wavestudio-scene.js
 * WaveStudio Pro - Multi-Scene Subtitles Studio & Classic Waveform Studio & Library Manager
 */

(function () {
  'use strict';

  class WaveStudioSceneManager {
    constructor() {
      this.scenes = []; // [{ id, file, url, media_path, duration, subtitle, is_video }]
      this.sceneAudio = null; // { file, url, duration }
      this.classicAudio = null;
      this.classicImage = null;
      this.activeTab = 'remotion';
    }

    init() {
      this._bindDOMElements();
      this._bindEvents();
      this.fetchLibraryFiles();
    }

    _bindDOMElements() {
      // Scene Studio
      this.domSceneAudioInput = document.getElementById('wsSceneAudioInput');
      this.domSceneAudioCard = document.getElementById('wsSceneAudioCard');
      this.domSceneAudioName = document.getElementById('wsSceneAudioName');
      this.domNarrationText = document.getElementById('wsNarrationText');
      this.domBtnDistribute = document.getElementById('wsBtnDistributeSubs');
      this.domBtnAutoBalance = document.getElementById('wsBtnAutoBalance');
      this.domMultiSceneInput = document.getElementById('wsMultiSceneInput');
      this.domScenesContainer = document.getElementById('wsScenesContainer');
      this.domBtnAddScene = document.getElementById('wsBtnAddScene');
      this.domBtnRenderScenes = document.getElementById('wsBtnRenderScenes');

      // Style Options
      this.domSubFontSize = document.getElementById('wsSubFontSize');
      this.domSubFontColor = document.getElementById('wsSubFontColor');
      this.domSubBgStyle = document.getElementById('wsSubBgStyle');
      this.domSubPosition = document.getElementById('wsSubPosition');

      // Classic Studio
      this.domClassicAudioInput = document.getElementById('wsClassicAudioInput');
      this.domClassicImageInput = document.getElementById('wsClassicImageInput');
      this.domWaveColor = document.getElementById('wsWaveColor');
      this.domOpacitySlider = document.getElementById('wsOpacitySlider');
      this.domHeightSlider = document.getElementById('wsHeightSlider');
      this.domClassicPosition = document.getElementById('wsClassicPosition');
      this.domBtnRenderClassic = document.getElementById('wsBtnRenderClassic');

      // Library
      this.domLibraryList = document.getElementById('wsLibraryList');
      this.domLibraryEmpty = document.getElementById('wsLibraryEmpty');
    }

    _bindEvents() {
      // Audio for Scene Studio
      if (this.domSceneAudioInput) {
        this.domSceneAudioInput.addEventListener('change', (e) => {
          const file = e.target.files[0];
          if (file) this.setSceneAudio(file);
        });
      }

      // Add Scenes Input
      if (this.domMultiSceneInput) {
        this.domMultiSceneInput.addEventListener('change', (e) => {
          const files = Array.from(e.target.files);
          files.forEach(f => this.addSceneItem({ file: f, name: f.name }));
          e.target.value = '';
        });
      }

      if (this.domBtnAddScene && this.domMultiSceneInput) {
        this.domBtnAddScene.addEventListener('click', () => this.domMultiSceneInput.click());
      }

      // Distribute Subtitles
      if (this.domBtnDistribute && this.domNarrationText) {
        this.domBtnDistribute.addEventListener('click', () => {
          this.distributeNarrationText(this.domNarrationText.value);
        });
      }

      // Auto-balance Duration
      if (this.domBtnAutoBalance) {
        this.domBtnAutoBalance.addEventListener('click', () => {
          this.autoBalanceDuration();
        });
      }

      // Render Scene Video
      if (this.domBtnRenderScenes) {
        this.domBtnRenderScenes.addEventListener('click', () => {
          this.renderSceneVideo();
        });
      }

      // Render Classic Video
      if (this.domBtnRenderClassic) {
        this.domBtnRenderClassic.addEventListener('click', () => {
          this.renderClassicVideo();
        });
      }

      // Color Presets
      document.querySelectorAll('.ws-preset-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
          const col = e.currentTarget.dataset.color;
          if (this.domWaveColor) this.domWaveColor.value = col;
        });
      });
    }

    setSceneAudio(fileOrUrl, duration = null) {
      if (fileOrUrl instanceof File) {
        const url = URL.createObjectURL(fileOrUrl);
        const audio = new Audio();
        audio.src = url;
        audio.onloadedmetadata = () => {
          this.sceneAudio = { file: fileOrUrl, url: url, duration: audio.duration, name: fileOrUrl.name };
          if (this.domSceneAudioCard) this.domSceneAudioCard.classList.remove('hidden');
          if (this.domSceneAudioName) this.domSceneAudioName.textContent = `${fileOrUrl.name} (${Math.round(audio.duration)}초)`;
        };
      } else if (typeof fileOrUrl === 'string') {
        const audio = new Audio();
        audio.src = fileOrUrl;
        audio.onloadedmetadata = () => {
          this.sceneAudio = { url: fileOrUrl, duration: duration || audio.duration, name: 'AI 나레이션 음성' };
          if (this.domSceneAudioCard) this.domSceneAudioCard.classList.remove('hidden');
          if (this.domSceneAudioName) this.domSceneAudioName.textContent = `AI 나레이션 음성 (${Math.round(this.sceneAudio.duration)}초)`;
        };
      }
    }

    loadScenesFromScriptCards(cards, audioUrl = null, audioDuration = null) {
      this.scenes = [];
      if (this.domScenesContainer) this.domScenesContainer.innerHTML = '';

      cards.forEach((card, idx) => {
        const imgUrl = card.imageUrl || card.src || card.dataUrl || null;
        const sub = (card.subtitles || card.subtitle || card.cutDescription || '').trim();
        const dur = parseFloat(card.duration) || 5.0;

        this.addSceneItem({
          url: imgUrl,
          subtitle: sub,
          duration: dur,
          title: card.chapterTitle || `장면 ${idx + 1}`
        });
      });

      if (audioUrl) {
        this.setSceneAudio(audioUrl, audioDuration);
      }
    }

    addSceneItem(opts = {}) {
      const scene = {
        id: `sc_${Date.now()}_${this.scenes.length}`,
        file: opts.file || null,
        url: opts.url || (opts.file ? URL.createObjectURL(opts.file) : null),
        duration: opts.duration || 5.0,
        subtitle: opts.subtitle || '',
        title: opts.title || (opts.file ? opts.file.name : `장면 ${this.scenes.length + 1}`),
        is_video: opts.file ? opts.file.type.startsWith('video') : false
      };

      this.scenes.push(scene);
      this._renderSceneCard(scene, this.scenes.length - 1);
    }

    _renderSceneCard(scene, index) {
      if (!this.domScenesContainer) return;

      const card = document.createElement('div');
      card.id = `ws-scene-card-${scene.id}`;
      card.className = 'scene-card-item';
      card.innerHTML = `
        <div class="scene-thumb-box">
          ${scene.url ? `<img src="${scene.url}" class="scene-thumb-img" alt="Scene Thumbnail">` : `<div class="flex items-center justify-center h-full text-slate-600 text-xs">미디어 없음</div>`}
          <span class="absolute top-2 left-2 bg-black/70 text-cyan-300 text-[10px] font-bold px-1.5 py-0.5 rounded">#${index + 1}</span>
        </div>
        <div class="scene-card-body">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-bold text-slate-200 truncate flex-1">${scene.title}</span>
            <button class="text-red-400 hover:text-red-300 text-xs" title="삭제">✕</button>
          </div>
          <div>
            <label class="text-[10px] font-semibold text-slate-400">지속 시간 (초)</label>
            <input type="number" min="0.5" step="0.5" value="${scene.duration}"
              class="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 mt-1 dur-input">
          </div>
          <div>
            <label class="text-[10px] font-semibold text-yellow-400">나레이션 자막</label>
            <textarea rows="2" class="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 mt-1 resize-none sub-input"
              placeholder="자막 텍스트…">${scene.subtitle}</textarea>
          </div>
        </div>
      `;

      // Event Listeners
      const delBtn = card.querySelector('button');
      delBtn.addEventListener('click', () => {
        this.scenes = this.scenes.filter(s => s.id !== scene.id);
        card.remove();
      });

      const durInput = card.querySelector('.dur-input');
      durInput.addEventListener('change', (e) => {
        scene.duration = Math.max(0.5, parseFloat(e.target.value) || 3.0);
      });

      const subInput = card.querySelector('.sub-input');
      subInput.addEventListener('input', (e) => {
        scene.subtitle = e.target.value;
      });

      this.domScenesContainer.appendChild(card);
    }

    distributeNarrationText(text) {
      if (!text || !text.trim()) {
        alert('대본 텍스트를 먼저 입력해주세요.');
        return;
      }
      const sentences = text
        .split(/(?<=[.?!])\s+|\n+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

      if (!sentences.length) return;

      if (!this.scenes.length) {
        sentences.forEach((st, idx) => {
          this.addSceneItem({ subtitle: st, duration: 5.0 });
        });
      } else {
        this.scenes.forEach((sc, idx) => {
          sc.subtitle = sentences[idx] || '';
          const card = document.getElementById(`ws-scene-card-${sc.id}`);
          if (card) {
            const subInput = card.querySelector('.sub-input');
            if (subInput) subInput.value = sc.subtitle;
          }
        });
      }
    }

    autoBalanceDuration() {
      if (!this.scenes.length) {
        alert('먼저 씬을 추가해주세요.');
        return;
      }
      const totalDur = (this.sceneAudio && this.sceneAudio.duration > 0) ? this.sceneAudio.duration : (this.scenes.length * 5.0);
      const sliceDur = parseFloat((totalDur / this.scenes.length).toFixed(2));

      this.scenes.forEach(sc => {
        sc.duration = sliceDur;
        const card = document.getElementById(`ws-scene-card-${sc.id}`);
        if (card) {
          const durInput = card.querySelector('.dur-input');
          if (durInput) durInput.value = sliceDur;
        }
      });
    }

    async renderSceneVideo() {
      if (!this.scenes.length) {
        alert('최소 1개 이상의 씬이 필요합니다.');
        return;
      }
      if (!this.sceneAudio) {
        alert('나레이션 오디오 파일이 필요합니다. 상단에서 오디오를 업로드하거나 AI 나레이션을 생성하세요.');
        return;
      }

      const fd = new FormData();
      fd.append('tasks', 'scene_subtitles');

      if (this.sceneAudio.file) {
        fd.append('audio', this.sceneAudio.file);
      } else if (this.sceneAudio.url) {
        fd.append('audio_url', this.sceneAudio.url);
      }

      const scenesMeta = [];
      this.scenes.forEach((sc, idx) => {
        const sm = {
          duration: sc.duration,
          subtitle: sc.subtitle,
          is_video: sc.is_video || false
        };
        if (sc.file) {
          const field = `scene_file_${idx}`;
          fd.append(field, sc.file);
          sm.file_field = field;
        } else if (sc.url) {
          sm.url = sc.url;
        }
        scenesMeta.push(sm);
      });

      fd.append('scenes_meta', JSON.stringify(scenesMeta));
      fd.append('font_size', this.domSubFontSize ? this.domSubFontSize.value : 30);
      fd.append('font_color', this.domSubFontColor ? this.domSubFontColor.value : '#ffffff');
      fd.append('bg_style', this.domSubBgStyle ? this.domSubBgStyle.value : 'box');
      fd.append('sub_position', this.domSubPosition ? this.domSubPosition.value : 'bottom');

      this._submitJob(fd, '씬 & 나레이션 자막 1080p 비디오 렌더링');
    }

    async renderClassicVideo() {
      const mode = document.querySelector('input[name="wsClassicMode"]:checked')?.value || 'waveform_overlay';
      const audioFile = this.domClassicAudioInput?.files?.[0];
      const imageFile = this.domClassicImageInput?.files?.[0];

      if (!audioFile) {
        alert('오디오 파일이 필요합니다.');
        return;
      }
      if ((mode === 'waveform_overlay' || mode === 'static') && !imageFile) {
        alert('배경 이미지가 필요합니다.');
        return;
      }

      const fd = new FormData();
      fd.append('tasks', mode);
      fd.append('audio', audioFile);
      if (imageFile) fd.append('image', imageFile);
      if (this.domWaveColor) fd.append('wave_color', this.domWaveColor.value);
      if (this.domOpacitySlider) fd.append('opacity', this.domOpacitySlider.value);
      if (this.domHeightSlider) fd.append('wave_height', this.domHeightSlider.value);
      if (this.domClassicPosition) fd.append('position', this.domClassicPosition.value);

      this._submitJob(fd, `클래식 비디오 (${mode}) 렌더링`);
    }

    async _submitJob(formData, taskLabel) {
      const monitorBox = document.getElementById('wsGlobalMonitor');
      const progressFill = document.getElementById('wsGlobalProgressFill');
      const stageText = document.getElementById('wsGlobalStageText');
      const percentText = document.getElementById('wsGlobalPercentText');
      const resultArea = document.getElementById('wsGlobalResultArea');

      if (monitorBox) monitorBox.classList.remove('hidden');
      if (stageText) stageText.textContent = `${taskLabel} 작업 제출 중...`;
      if (progressFill) progressFill.style.width = '5%';
      if (percentText) percentText.textContent = '5%';
      if (resultArea) resultArea.innerHTML = '';

      try {
        const res = await fetch('/api/run', { method: 'POST', body: formData });
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
              if (stageText) stageText.textContent = '✨ 렌더링 완료!';
              if (resultArea && statusData.results && statusData.results[0]) {
                const url = statusData.results[0].url;
                resultArea.innerHTML = `
                  <div class="mt-3 p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl flex items-center justify-between">
                    <span class="text-xs text-emerald-300 font-bold">🎬 비디오 생성 완료!</span>
                    <div class="flex gap-2">
                      <a href="${url}" target="_blank" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition">미리보기</a>
                      <a href="${url}" download class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition">다운로드</a>
                    </div>
                  </div>
                `;
              }
              this.fetchLibraryFiles();
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

    async fetchLibraryFiles() {
      try {
        const res = await fetch('/api/files');
        if (!res.ok) return;
        const data = await res.json();
        const files = data.files || [];

        if (this.domLibraryEmpty) {
          this.domLibraryEmpty.style.display = files.length ? 'none' : 'block';
        }
        if (this.domLibraryList) {
          this.domLibraryList.innerHTML = files.map(f => `
            <div class="p-3 bg-slate-900/80 border border-slate-700/80 rounded-xl flex items-center justify-between gap-3">
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-lg">${f.type === 'video' ? '🎬' : (f.type === 'audio' ? '🎵' : '📄')}</span>
                <div class="min-w-0">
                  <p class="text-xs font-bold text-slate-200 truncate">${f.name}</p>
                  <p class="text-[10px] text-slate-400">${f.size} • ${f.modified}</p>
                </div>
              </div>
              <div class="flex items-center gap-1.5 flex-shrink-0">
                <a href="${f.url}" target="_blank" class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition">보기</a>
                <a href="${f.url}" download class="px-2.5 py-1 bg-blue-700 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition">다운로드</a>
                <button onclick="window.WaveStudio.deleteLibraryFile('${f.name}')" class="p-1 text-slate-500 hover:text-red-400 transition" title="삭제">🗑</button>
              </div>
            </div>
          `).join('');
        }
      } catch (e) {
        console.error('Library fetch error:', e);
      }
    }

    async deleteLibraryFile(filename) {
      if (!confirm(`'${filename}' 파일을 삭제하시겠습니까?`)) return;
      try {
        const res = await fetch(`/api/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        if (res.ok) this.fetchLibraryFiles();
      } catch (e) {
        alert(`삭제 실패: ${e.message}`);
      }
    }
  }

  window.WaveStudioSceneManager = WaveStudioSceneManager;
  window.WaveStudio = new WaveStudioSceneManager();
})();
