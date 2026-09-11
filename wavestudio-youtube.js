/**
 * wavestudio-youtube.js
 * YouTube Multi-Source AI Audio Overview (NotebookLM Style) & Edge-TTS Speech Synthesis
 */

(function () {
  'use strict';

  class YouTubeOverviewManager {
    constructor() {
      this.activeJobId = null;
      this.pollTimer = null;
      this.lastResult = null;
      this.selectedDuration = 180;
    }

    init() {
      this._bindDOMElements();
      this._bindEvents();
    }

    _bindDOMElements() {
      this.domUrlsInput = document.getElementById('wsYtUrlsInput');
      this.domApiKeyInput = document.getElementById('wsYtApiKeyInput');
      this.domVoiceSelect = document.getElementById('wsYtVoiceSelect');
      this.domToneSelect = document.getElementById('wsYtToneSelect');
      this.domBtnGenerate = document.getElementById('wsBtnGenerateYtOverview');
      this.domDurationValBadge = document.getElementById('wsYtDurationValBadge');

      this.domMonitorBox = document.getElementById('wsYtMonitorBox');
      this.domStageText = document.getElementById('wsYtStageText');
      this.domProgressFill = document.getElementById('wsYtProgressFill');
      this.domPercentText = document.getElementById('wsYtPercentText');

      this.domResultSection = document.getElementById('wsYtResultSection');
      this.domAudioPlayer = document.getElementById('wsYtAudioPlayer');
      this.domDialogueList = document.getElementById('wsYtDialogueList');

      this.domBtnSendToRemotion = document.getElementById('wsYtBtnSendToRemotion');
      this.domBtnSendToScene = document.getElementById('wsYtBtnSendToScene');
      this.domBtnDownloadAudio = document.getElementById('wsYtBtnDownloadAudio');
      this.domBtnDownloadTxt = document.getElementById('wsYtBtnDownloadTxt');
      this.domBtnDownloadSrt = document.getElementById('wsYtBtnDownloadSrt');
    }

    _bindEvents() {
      // Auto-load Gemini API key from main config or env
      if (this.domApiKeyInput) {
        if (window.GEMINI_API_KEY) this.domApiKeyInput.value = window.GEMINI_API_KEY;
        this.domApiKeyInput.addEventListener('change', (e) => {
          if (e.target.value) window.GEMINI_API_KEY = e.target.value.trim();
        });
      }

      // Duration Presets
      document.querySelectorAll('.btn-ws-duration-preset').forEach(btn => {
        btn.addEventListener('click', (e) => {
          document.querySelectorAll('.btn-ws-duration-preset').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const d = btn.dataset.duration;
          this.selectedDuration = d === 'original' ? 'original' : parseInt(d, 10);
          if (this.domDurationValBadge) {
            this.domDurationValBadge.textContent = d === 'original' ? '원본 길이 자동 맞춤' : `${d}초`;
          }
        });
      });

      // Generate Overview
      if (this.domBtnGenerate) {
        this.domBtnGenerate.addEventListener('click', () => this.generateOverview());
      }

      // Bridge: Send to Remotion
      if (this.domBtnSendToRemotion) {
        this.domBtnSendToRemotion.addEventListener('click', () => {
          if (!this.lastResult) return;
          this.sendToRemotionStudio();
        });
      }

      // Bridge: Send to Scene Studio
      if (this.domBtnSendToScene) {
        this.domBtnSendToScene.addEventListener('click', () => {
          if (!this.lastResult) return;
          this.sendToSceneStudio();
        });
      }
    }

    async generateOverview() {
      const urlsText = this.domUrlsInput ? this.domUrlsInput.value.trim() : '';
      if (!urlsText) {
        alert('YouTube 영상 URL을 최소 1개 이상 입력해주세요.');
        return;
      }

      const apiKey = (this.domApiKeyInput ? this.domApiKeyInput.value.trim() : '') || window.GEMINI_API_KEY;
      if (!apiKey) {
        alert('Gemini API 키가 필요합니다.');
        return;
      }

      const urls = urlsText.split('\n').map(u => u.trim()).filter(u => u.length > 0);
      const voice = this.domVoiceSelect ? this.domVoiceSelect.value : 'ko-KR-InJoonNeural';
      const tone = this.domToneSelect ? this.domToneSelect.value : 'conversational';

      if (this.domMonitorBox) this.domMonitorBox.classList.remove('hidden');
      if (this.domResultSection) this.domResultSection.classList.add('hidden');
      if (this.domStageText) this.domStageText.textContent = 'YouTube 메타데이터 및 자막 분석 시작...';
      if (this.domProgressFill) this.domProgressFill.style.width = '10%';
      if (this.domPercentText) this.domPercentText.textContent = '10%';

      try {
        const res = await fetch('/api/youtube/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: urls,
            api_key: apiKey,
            language: 'ko',
            tone: tone,
            voice: voice,
            target_duration: this.selectedDuration
          })
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || '요청 실패');
        }

        const data = await res.json();
        const jid = data.id;

        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = setInterval(async () => {
          try {
            const sRes = await fetch(`/api/youtube/status?id=${jid}`);
            if (!sRes.ok) return;
            const statusData = await sRes.json();

            if (this.domProgressFill) this.domProgressFill.style.width = `${statusData.progress}%`;
            if (this.domPercentText) this.domPercentText.textContent = `${statusData.progress}%`;
            if (this.domStageText) this.domStageText.textContent = statusData.stage || '분석 진행 중...';

            if (statusData.status === 'done') {
              clearInterval(this.pollTimer);
              this.lastResult = statusData;
              this.renderResults(statusData);
            } else if (statusData.status === 'error') {
              clearInterval(this.pollTimer);
              if (this.domStageText) this.domStageText.textContent = `❌ 실패: ${statusData.error}`;
            }
          } catch (e) {
            console.error(e);
          }
        }, 1500);

      } catch (err) {
        if (this.domStageText) this.domStageText.textContent = `❌ 오류: ${err.message}`;
      }
    }

    renderResults(data) {
      if (this.domResultSection) this.domResultSection.classList.remove('hidden');
      if (this.domAudioPlayer && data.audio_url) {
        this.domAudioPlayer.src = data.audio_url;
      }

      if (this.domBtnDownloadAudio && data.audio_url) this.domBtnDownloadAudio.href = data.audio_url;
      if (this.domBtnDownloadTxt && data.txt_url) this.domBtnDownloadTxt.href = data.txt_url;
      if (this.domBtnDownloadSrt && data.srt_url) this.domBtnDownloadSrt.href = data.srt_url;

      // Dialogue List
      if (this.domDialogueList && data.script) {
        this.domDialogueList.innerHTML = data.script.map((item, idx) => `
          <div class="p-3 bg-slate-900/70 border border-slate-700/60 rounded-xl flex gap-3 items-start">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${item.section_type === 'hook' ? 'bg-amber-900/60 text-amber-300' : (item.section_type === 'deep_dive' ? 'bg-cyan-900/60 text-cyan-300' : 'bg-purple-900/60 text-purple-300')}">
              ${item.section_label || item.section_type || `섹션 ${idx + 1}`}
            </span>
            <div class="flex-1">
              <p class="text-xs text-slate-200 leading-relaxed">${item.text}</p>
              ${item.timestamp ? `<span class="text-[10px] text-cyan-400 font-mono mt-1 inline-block">⏱ ${item.timestamp}</span>` : ''}
            </div>
          </div>
        `).join('');
      }
    }

    sendToRemotionStudio() {
      if (!this.lastResult) return;
      const timeline = this.lastResult.remotion_timeline || {};
      const audioUrl = this.lastResult.audio_url;
      const actualDur = this.lastResult.actual_duration || 60;

      // Create Cards from script sections
      const cards = (this.lastResult.script || []).map((sec, i) => {
        const thumbUrl = (this.lastResult.sources && this.lastResult.sources[0]) ? this.lastResult.sources[0].thumbnail_url : null;
        return {
          imageUrl: thumbUrl,
          chapterTitle: sec.section_label || `섹션 ${i + 1}`,
          subtitles: sec.text,
          duration: (actualDur / Math.max(1, (this.lastResult.script || []).length))
        };
      });

      if (window.remotionEditorInstance) {
        window.remotionEditorInstance.loadFromScriptCards(cards, audioUrl, actualDur);
      }

      // Switch Tab to Remotion Studio
      if (window.switchWaveStudioTab) {
        window.switchWaveStudioTab('remotion');
      }
    }

    sendToSceneStudio() {
      if (!this.lastResult) return;
      const audioUrl = this.lastResult.audio_url;
      const actualDur = this.lastResult.actual_duration || 60;

      const cards = (this.lastResult.script || []).map((sec, i) => {
        const thumbUrl = (this.lastResult.sources && this.lastResult.sources[0]) ? this.lastResult.sources[0].thumbnail_url : null;
        return {
          imageUrl: thumbUrl,
          chapterTitle: sec.section_label || `섹션 ${i + 1}`,
          subtitles: sec.text,
          duration: (actualDur / Math.max(1, (this.lastResult.script || []).length))
        };
      });

      if (window.WaveStudio) {
        window.WaveStudio.loadScenesFromScriptCards(cards, audioUrl, actualDur);
      }

      if (window.switchWaveStudioTab) {
        window.switchWaveStudioTab('scene');
      }
    }
  }

  // General Edge-TTS synthesis helper for the whole app
  window.generateEdgeTTSVoice = async function (text, options = {}) {
    const {
      voice = 'ko-KR-InJoonNeural',
      rate = '+0%',
      pitch = '+0Hz'
    } = options;

    const res = await fetch('/api/tts/edge-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, rate, pitch })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'TTS 생성 실패');
    }

    return await res.json(); // { ok, audio_url, filename, duration, text, voice }
  };

  window.YouTubeOverviewManager = YouTubeOverviewManager;
  window.ytOverviewInstance = new YouTubeOverviewManager();
})();
