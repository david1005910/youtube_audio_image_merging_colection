// ====== 통합 이미지 생성 및 영상 변환 시스템 ======
// index.html의 이미지 생성 기능과 영상 변환 워크플로우 통합

(function() {
  'use strict';

  // 전역 변수
  window.integratedImageVideo = {
    currentImageUrl: null,
    currentImageMode: 'pollinations', // 'pollinations' or 'gemini'
    generatedImages: []
  };

  // Pollinations 이미지 생성 함수
  window.generateWithPollinations = async function(prompt, options = {}) {
    const {
      width = 1920,
      height = 1080,
      nologo = true,
      useProxy = true
    } = options;

    try {
      if (useProxy && typeof fetch !== 'undefined') {
        // 프록시 서버를 통한 생성 (CORS 우회)
        const response = await fetch('/api/proxy/pollinations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: prompt,
            width: width,
            height: height,
            nologo: nologo
          })
        });
        
        if (response.ok) {
          const blob = await response.blob();
          const imageUrl = URL.createObjectURL(blob);
          window.integratedImageVideo.currentImageUrl = imageUrl;
          window.integratedImageVideo.generatedImages.push({
            url: imageUrl,
            prompt: prompt,
            timestamp: Date.now(),
            source: 'pollinations'
          });
          return imageUrl;
        }
      }
      
      // 프록시 실패 시 직접 URL 사용
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=${nologo}&seed=${Date.now()}`;
      window.integratedImageVideo.currentImageUrl = imageUrl;
      window.integratedImageVideo.generatedImages.push({
        url: imageUrl,
        prompt: prompt,
        timestamp: Date.now(),
        source: 'pollinations'
      });
      return imageUrl;
      
    } catch (error) {
      console.error('Pollinations 이미지 생성 오류:', error);
      throw error;
    }
  };

  // Gemini Imagen 이미지 생성 함수
  window.generateWithGemini = async function(prompt, apiKey) {
    if (!apiKey) {
      throw new Error('Gemini API 키가 필요합니다');
    }

    try {
      const response = await fetch('/api/proxy/gemini-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          geminiApiKey: apiKey,
          prompt: prompt,
          model: 'imagen-4.0-fast-generate-001'
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.predictions && data.predictions[0]) {
          const base64 = data.predictions[0].bytesBase64Encoded;
          const imageUrl = `data:image/png;base64,${base64}`;
          window.integratedImageVideo.currentImageUrl = imageUrl;
          window.integratedImageVideo.generatedImages.push({
            url: imageUrl,
            prompt: prompt,
            timestamp: Date.now(),
            source: 'gemini'
          });
          return imageUrl;
        }
      }
      throw new Error('Gemini 이미지 생성 실패');
      
    } catch (error) {
      console.error('Gemini 이미지 생성 오류:', error);
      throw error;
    }
  };

  // 이미지를 영상으로 변환하는 함수
  window.convertImageToVideo = async function(imageUrl, options = {}) {
    const {
      duration = 5,
      effect = 'none',
      text = '',
      resolution = '1080p'
    } = options;

    try {
      // FFmpeg API 호출 시도
      const response = await fetch('/api/ffmpeg/image-to-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: imageUrl,
          text: text,
          duration: duration,
          effect: effect
        })
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const videoUrl = URL.createObjectURL(blob);
        return {
          success: true,
          videoUrl: videoUrl,
          blob: blob
        };
      }
    } catch (error) {
      console.log('FFmpeg 변환 실패, Canvas 방법 시도:', error);
    }

    // FFmpeg 실패 시 Canvas로 영상 생성
    return await createCanvasVideo(imageUrl, duration, text);
  };

  // Canvas로 영상 생성 (폴백 방법)
  async function createCanvasVideo(imageUrl, duration, text) {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    
    // 이미지 로드
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    return new Promise((resolve, reject) => {
      img.onload = () => {
        const stream = canvas.captureStream(30); // 30 fps
        const recorder = new MediaRecorder(stream, {
          mimeType: 'video/webm;codecs=vp9',
          videoBitsPerSecond: 5000000
        });
        
        const chunks = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);
        
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          const videoUrl = URL.createObjectURL(blob);
          resolve({
            success: true,
            videoUrl: videoUrl,
            blob: blob
          });
        };
        
        recorder.start();
        
        // 애니메이션 렌더링
        let frame = 0;
        const fps = 30;
        const totalFrames = duration * fps;
        
        const render = () => {
          // 이미지 그리기
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          
          // 텍스트 오버레이
          if (text) {
            ctx.font = 'bold 60px Arial';
            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 3;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            
            const textY = canvas.height - 100;
            ctx.strokeText(text, canvas.width / 2, textY);
            ctx.fillText(text, canvas.width / 2, textY);
          }
          
          frame++;
          if (frame < totalFrames) {
            requestAnimationFrame(render);
          } else {
            recorder.stop();
          }
        };
        
        render();
      };
      
      img.onerror = () => {
        reject(new Error('이미지 로드 실패'));
      };
      
      img.src = imageUrl;
    });
  }

  // 통합 워크플로우 실행 함수
  window.runImageToVideoWorkflow = async function(prompt, options = {}) {
    const {
      imageMode = 'pollinations',
      geminiApiKey = '',
      videoDuration = 5,
      videoEffect = 'none',
      videoText = '',
      onProgress = () => {}
    } = options;

    try {
      // Step 1: 이미지 생성
      onProgress({ step: 1, message: '이미지 생성 중...', progress: 20 });
      
      let imageUrl;
      if (imageMode === 'pollinations') {
        imageUrl = await generateWithPollinations(prompt);
      } else if (imageMode === 'gemini') {
        imageUrl = await generateWithGemini(prompt, geminiApiKey);
      } else {
        throw new Error('지원하지 않는 이미지 생성 모드');
      }
      
      onProgress({ step: 2, message: '이미지 생성 완료!', progress: 50, imageUrl: imageUrl });
      
      // Step 2: 영상 변환
      onProgress({ step: 3, message: '영상으로 변환 중...', progress: 70 });
      
      const videoResult = await convertImageToVideo(imageUrl, {
        duration: videoDuration,
        effect: videoEffect,
        text: videoText
      });
      
      if (videoResult.success) {
        onProgress({ 
          step: 4, 
          message: '영상 생성 완료!', 
          progress: 100, 
          videoUrl: videoResult.videoUrl,
          videoBlob: videoResult.blob
        });
        
        return {
          success: true,
          imageUrl: imageUrl,
          videoUrl: videoResult.videoUrl,
          videoBlob: videoResult.blob
        };
      } else {
        throw new Error('영상 변환 실패');
      }
      
    } catch (error) {
      onProgress({ step: -1, message: `오류: ${error.message}`, progress: 0 });
      throw error;
    }
  };

  // 생성된 이미지를 영상으로 변환하는 버튼 추가
  window.addVideoConversionButton = function() {
    // 이미지가 생성된 후에 영상 변환 버튼 추가
    const existingBtn = document.getElementById('convertToVideoBtn');
    if (existingBtn) return; // 이미 있으면 스킵
    
    // 기존 UI에 영상 변환 버튼만 추가
    const targetContainer = document.querySelector('.grok-action-buttons') || 
                           document.querySelector('#grokModalBody');
    
    if (targetContainer) {
      const btn = document.createElement('button');
      btn.id = 'convertToVideoBtn';
      btn.className = 'px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 font-semibold mt-3';
      btn.innerHTML = '🎬 생성된 이미지 → 영상 변환';
      btn.onclick = openVideoConversionModal;
      targetContainer.appendChild(btn);
    }
  };

  // 영상 변환 모달 열기
  window.openVideoConversionModal = function() {
    // 현재 생성된 이미지 찾기
    const currentImages = [];
    
    // 모든 생성된 이미지 수집
    document.querySelectorAll('[id^="grok-img-el-"]').forEach(img => {
      if (img.src && (img.src.startsWith('data:image') || img.src.startsWith('http'))) {
        currentImages.push(img.src);
      }
    });
    
    // Pollinations 이미지도 확인
    if (window.integratedImageVideo.currentImageUrl) {
      currentImages.push(window.integratedImageVideo.currentImageUrl);
    }
    
    if (currentImages.length === 0) {
      alert('먼저 이미지를 생성해주세요!');
      return;
    }
    
    // 영상 변환 모달 생성
    const modal = document.createElement('div');
    modal.id = 'videoConversionModal';
    modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/80';
    modal.innerHTML = `
      <div class="space-y-4">
        <!-- 이미지 생성 방법 선택 -->
        <div class="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
          <div class="text-sm font-semibold text-blue-300 mb-3">🎨 이미지 생성 방법</div>
          <div class="grid grid-cols-2 gap-2">
            <button onclick="window.integratedImageVideo.currentImageMode='pollinations'; this.classList.add('ring-2','ring-blue-500'); this.nextElementSibling.classList.remove('ring-2','ring-blue-500');"
                    class="p-3 bg-slate-800 hover:bg-slate-700 rounded-lg text-center ring-2 ring-blue-500">
              <div class="font-semibold text-white">Pollinations</div>
              <div class="text-xs text-slate-400">무료 · 제한 없음</div>
            </button>
            <button onclick="window.integratedImageVideo.currentImageMode='gemini'; this.classList.add('ring-2','ring-blue-500'); this.previousElementSibling.classList.remove('ring-2','ring-blue-500'); document.getElementById('geminiKeyInput').classList.remove('hidden');"
                    class="p-3 bg-slate-800 hover:bg-slate-700 rounded-lg text-center">
              <div class="font-semibold text-white">Gemini Imagen</div>
              <div class="text-xs text-slate-400">고품질 · API 키 필요</div>
            </button>
          </div>
        </div>

        <!-- Gemini API 키 입력 (선택시만) -->
        <div id="geminiKeyInput" class="hidden bg-slate-900/60 border border-slate-700 rounded-xl p-4">
          <label class="text-xs font-semibold text-slate-300">Gemini API 키</label>
          <input type="password" id="geminiApiKeyInput" 
                 class="w-full mt-2 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white"
                 placeholder="AIzaSy...">
        </div>

        <!-- 프롬프트 입력 -->
        <div class="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
          <label class="text-xs font-semibold text-slate-300">프롬프트</label>
          <textarea id="imagePromptInput" 
                    class="w-full mt-2 px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white h-24"
                    placeholder="생성할 이미지를 설명하세요...">beautiful sunset over mountains with golden clouds, cinematic lighting</textarea>
        </div>

        <!-- 영상 변환 옵션 -->
        <div class="bg-slate-900/60 border border-slate-700 rounded-xl p-4">
          <div class="text-xs font-semibold text-slate-300 mb-3">🎥 영상 변환 옵션</div>
          <div class="grid grid-cols-3 gap-2">
            <div>
              <label class="text-xs text-slate-400">재생 시간</label>
              <select id="videoDurationSelect" class="w-full mt-1 px-2 py-1 bg-slate-800 border border-slate-600 rounded text-white text-sm">
                <option value="3">3초</option>
                <option value="5" selected>5초</option>
                <option value="10">10초</option>
              </select>
            </div>
            <div>
              <label class="text-xs text-slate-400">효과</label>
              <select id="videoEffectSelect" class="w-full mt-1 px-2 py-1 bg-slate-800 border border-slate-600 rounded text-white text-sm">
                <option value="none">없음</option>
                <option value="zoom">줌인</option>
                <option value="pan">패닝</option>
                <option value="fade">페이드</option>
              </select>
            </div>
            <div>
              <label class="text-xs text-slate-400">텍스트</label>
              <input type="text" id="videoTextInput" 
                     class="w-full mt-1 px-2 py-1 bg-slate-800 border border-slate-600 rounded text-white text-sm"
                     placeholder="오버레이 텍스트">
            </div>
          </div>
        </div>

        <!-- 실행 버튼들 -->
        <div class="flex gap-3">
          <button onclick="executeIntegratedWorkflow()" 
                  class="flex-1 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold rounded-lg hover:from-blue-600 hover:to-purple-700">
            🚀 이미지 생성 → 영상 변환
          </button>
          <button onclick="generateImageOnly()" 
                  class="px-6 py-3 bg-slate-700 text-white font-semibold rounded-lg hover:bg-slate-600">
            🖼️ 이미지만
          </button>
        </div>

        <!-- 진행 상태 -->
        <div id="workflowProgress" class="hidden">
          <div class="bg-slate-800 rounded-lg p-4">
            <div class="flex items-center gap-3">
              <div class="spinner w-6 h-6"></div>
              <span id="progressMessage" class="text-white"></span>
            </div>
            <div class="mt-3 bg-slate-900 rounded-full h-2">
              <div id="progressBar" class="bg-blue-500 h-2 rounded-full transition-all" style="width: 0%"></div>
            </div>
          </div>
        </div>

        <!-- 결과 표시 -->
        <div id="workflowResult" class="hidden space-y-4">
          <div id="imageResult" class="hidden">
            <div class="text-xs font-semibold text-slate-300 mb-2">생성된 이미지</div>
            <img id="generatedImageDisplay" class="w-full rounded-lg">
          </div>
          <div id="videoResult" class="hidden">
            <div class="text-xs font-semibold text-slate-300 mb-2">생성된 영상</div>
            <video id="generatedVideoDisplay" controls class="w-full rounded-lg"></video>
            <button onclick="downloadGeneratedVideo()" 
                    class="mt-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600">
              💾 영상 다운로드
            </button>
          </div>
        </div>
      </div>
    `;
  };

  // 통합 워크플로우 실행
  window.executeIntegratedWorkflow = async function() {
    const prompt = document.getElementById('imagePromptInput').value;
    const mode = window.integratedImageVideo.currentImageMode;
    const geminiKey = document.getElementById('geminiApiKeyInput')?.value;
    const duration = parseInt(document.getElementById('videoDurationSelect').value);
    const effect = document.getElementById('videoEffectSelect').value;
    const text = document.getElementById('videoTextInput').value;
    
    if (!prompt) {
      alert('프롬프트를 입력하세요!');
      return;
    }
    
    if (mode === 'gemini' && !geminiKey) {
      alert('Gemini API 키를 입력하세요!');
      return;
    }
    
    // UI 업데이트
    document.getElementById('workflowProgress').classList.remove('hidden');
    document.getElementById('workflowResult').classList.add('hidden');
    
    try {
      const result = await runImageToVideoWorkflow(prompt, {
        imageMode: mode,
        geminiApiKey: geminiKey,
        videoDuration: duration,
        videoEffect: effect,
        videoText: text,
        onProgress: (data) => {
          document.getElementById('progressMessage').textContent = data.message;
          document.getElementById('progressBar').style.width = `${data.progress}%`;
          
          if (data.imageUrl) {
            document.getElementById('workflowResult').classList.remove('hidden');
            document.getElementById('imageResult').classList.remove('hidden');
            document.getElementById('generatedImageDisplay').src = data.imageUrl;
          }
          
          if (data.videoUrl) {
            document.getElementById('videoResult').classList.remove('hidden');
            document.getElementById('generatedVideoDisplay').src = data.videoUrl;
            window.integratedImageVideo.currentVideoBlob = data.videoBlob;
          }
        }
      });
      
      document.getElementById('workflowProgress').classList.add('hidden');
      
    } catch (error) {
      alert(`오류: ${error.message}`);
      document.getElementById('workflowProgress').classList.add('hidden');
    }
  };

  // 이미지만 생성
  window.generateImageOnly = async function() {
    const prompt = document.getElementById('imagePromptInput').value;
    const mode = window.integratedImageVideo.currentImageMode;
    const geminiKey = document.getElementById('geminiApiKeyInput')?.value;
    
    if (!prompt) {
      alert('프롬프트를 입력하세요!');
      return;
    }
    
    document.getElementById('workflowProgress').classList.remove('hidden');
    document.getElementById('progressMessage').textContent = '이미지 생성 중...';
    
    try {
      let imageUrl;
      if (mode === 'pollinations') {
        imageUrl = await generateWithPollinations(prompt);
      } else {
        imageUrl = await generateWithGemini(prompt, geminiKey);
      }
      
      document.getElementById('workflowResult').classList.remove('hidden');
      document.getElementById('imageResult').classList.remove('hidden');
      document.getElementById('generatedImageDisplay').src = imageUrl;
      document.getElementById('workflowProgress').classList.add('hidden');
      
    } catch (error) {
      alert(`오류: ${error.message}`);
      document.getElementById('workflowProgress').classList.add('hidden');
    }
  };

  // 영상 다운로드
  window.downloadGeneratedVideo = function() {
    const blob = window.integratedImageVideo.currentVideoBlob;
    if (!blob) return;
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `generated-video-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  console.log('✅ 통합 이미지→영상 변환 시스템 로드 완료');
  
})();