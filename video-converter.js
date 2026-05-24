// ====== 생성된 이미지를 영상으로 변환하는 기능 ======
// 기존 UI를 건드리지 않고 영상 변환 기능만 추가

(function() {
  'use strict';

  let observer = null;
  let currentGeneratedImages = [];

  // 이미지 감지 및 영상 변환 버튼 추가
  function watchForGeneratedImages() {
    // MutationObserver로 이미지 생성 감지
    observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // 새로 추가된 이미지 요소 감지
            const images = node.querySelectorAll ? 
              node.querySelectorAll('img[id^="grok-img-el-"], img[src*="pollinations"], img[src^="data:image"]') :
              [];
            
            if (node.tagName === 'IMG' && (
              node.id?.startsWith('grok-img-el-') || 
              node.src?.includes('pollinations') ||
              node.src?.startsWith('data:image')
            )) {
              addVideoButtonNearImage(node);
            }
            
            images.forEach(img => addVideoButtonNearImage(img));
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // 이미지 근처에 영상 변환 버튼 추가
  function addVideoButtonNearImage(imgElement) {
    if (!imgElement.src || imgElement.src === '') return;
    
    // 이미 버튼이 있으면 스킵
    const existingBtn = imgElement.parentElement?.querySelector('.video-convert-btn');
    if (existingBtn) return;

    // 이미지가 완전히 로드된 후 버튼 추가
    const addButton = () => {
      const btnContainer = document.createElement('div');
      btnContainer.className = 'mt-2 text-center';
      
      const videoBtn = document.createElement('button');
      videoBtn.className = 'video-convert-btn px-3 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded-md font-semibold transition-colors';
      videoBtn.innerHTML = '🎬 영상 변환';
      videoBtn.onclick = () => openVideoConverter(imgElement.src);
      
      btnContainer.appendChild(videoBtn);
      
      // 이미지 부모 요소에 버튼 추가
      const parent = imgElement.parentElement;
      if (parent && !parent.querySelector('.video-convert-btn')) {
        parent.appendChild(btnContainer);
      }
    };

    if (imgElement.complete) {
      addButton();
    } else {
      imgElement.onload = addButton;
    }
  }

  // 영상 변환기 모달 열기
  window.openVideoConverter = function(imageUrl) {
    if (!imageUrl) {
      alert('이미지 URL이 없습니다.');
      return;
    }

    // 기존 모달이 있으면 제거
    const existingModal = document.getElementById('videoConverterModal');
    if (existingModal) {
      existingModal.remove();
    }

    // 새 모달 생성
    const modal = document.createElement('div');
    modal.id = 'videoConverterModal';
    modal.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm';
    
    modal.innerHTML = `
      <div class="bg-slate-800 rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <!-- 헤더 -->
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-xl font-bold text-white">🎬 이미지 → 영상 변환</h2>
          <button onclick="closeVideoConverter()" 
                  class="text-gray-400 hover:text-white text-2xl">×</button>
        </div>

        <!-- 이미지 미리보기 -->
        <div class="mb-6">
          <div class="text-sm font-semibold text-slate-300 mb-2">선택된 이미지</div>
          <img src="${imageUrl}" class="w-full max-h-64 object-contain rounded-lg bg-slate-900">
        </div>

        <!-- 영상 설정 -->
        <div class="space-y-4 mb-6">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-slate-300 mb-2">재생 시간</label>
              <select id="videoDurationSelect" class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white">
                <option value="3">3초</option>
                <option value="5" selected>5초</option>
                <option value="10">10초</option>
                <option value="15">15초</option>
                <option value="30">30초</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-300 mb-2">비디오 효과</label>
              <select id="videoEffectSelect" class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white">
                <option value="none">없음</option>
                <option value="zoom">줌인</option>
                <option value="pan">좌→우 패닝</option>
                <option value="fade">페이드 효과</option>
                <option value="ken-burns">켄 번스 효과</option>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-300 mb-2">텍스트 오버레이 (선택사항)</label>
            <input type="text" id="videoTextInput" 
                   class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                   placeholder="영상에 표시할 텍스트를 입력하세요">
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-300 mb-2">해상도</label>
            <select id="videoResolutionSelect" class="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white">
              <option value="720p">HD 720p (1280×720)</option>
              <option value="1080p" selected>Full HD 1080p (1920×1080)</option>
              <option value="4K">4K UHD (3840×2160)</option>
            </select>
          </div>
        </div>

        <!-- 변환 방법 선택 -->
        <div class="mb-6">
          <div class="text-sm font-semibold text-slate-300 mb-3">변환 방법</div>
          <div class="grid grid-cols-2 gap-3">
            <button onclick="selectConversionMethod('ffmpeg')" 
                    id="ffmpegMethodBtn"
                    class="p-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-white font-semibold ring-2 ring-blue-400">
              <div class="font-bold">FFmpeg (서버)</div>
              <div class="text-xs opacity-80">고품질, 빠른 속도</div>
            </button>
            <button onclick="selectConversionMethod('canvas')" 
                    id="canvasMethodBtn"
                    class="p-3 bg-slate-600 hover:bg-slate-700 rounded-lg text-white font-semibold">
              <div class="font-bold">Canvas (브라우저)</div>
              <div class="text-xs opacity-80">호환성 우선</div>
            </button>
          </div>
        </div>

        <!-- 진행 상태 -->
        <div id="conversionProgress" class="hidden mb-6">
          <div class="bg-slate-700 rounded-lg p-4">
            <div class="flex items-center gap-3 mb-3">
              <div class="animate-spin w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full"></div>
              <span id="progressMessage" class="text-white">영상 변환 중...</span>
            </div>
            <div class="bg-slate-600 rounded-full h-2">
              <div id="progressBar" class="bg-blue-500 h-2 rounded-full transition-all duration-300" 
                   style="width: 0%"></div>
            </div>
          </div>
        </div>

        <!-- 결과 영역 -->
        <div id="conversionResult" class="hidden mb-6">
          <div class="text-sm font-semibold text-slate-300 mb-2">변환된 영상</div>
          <video id="resultVideo" controls class="w-full rounded-lg bg-black"></video>
          <div class="mt-3 flex gap-2">
            <button onclick="downloadConvertedVideo()" 
                    class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold">
              💾 다운로드
            </button>
            <button onclick="shareConvertedVideo()" 
                    class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold">
              📤 공유
            </button>
          </div>
        </div>

        <!-- 액션 버튼 -->
        <div class="flex gap-3">
          <button onclick="startVideoConversion('${imageUrl}')" 
                  id="startConversionBtn"
                  class="flex-1 py-3 bg-gradient-to-r from-green-500 to-blue-500 text-white font-bold rounded-lg hover:from-green-600 hover:to-blue-600">
            🚀 영상 변환 시작
          </button>
          <button onclick="closeVideoConverter()" 
                  class="px-6 py-3 bg-slate-600 hover:bg-slate-700 text-white font-semibold rounded-lg">
            취소
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 클릭 시 모달 닫기 (배경 클릭)
    modal.onclick = (e) => {
      if (e.target === modal) closeVideoConverter();
    };
  };

  // 변환 방법 선택
  window.selectConversionMethod = function(method) {
    const ffmpegBtn = document.getElementById('ffmpegMethodBtn');
    const canvasBtn = document.getElementById('canvasMethodBtn');
    
    if (method === 'ffmpeg') {
      ffmpegBtn.classList.add('ring-2', 'ring-blue-400');
      canvasBtn.classList.remove('ring-2', 'ring-blue-400');
      window.selectedConversionMethod = 'ffmpeg';
    } else {
      canvasBtn.classList.add('ring-2', 'ring-blue-400');
      ffmpegBtn.classList.remove('ring-2', 'ring-blue-400');
      window.selectedConversionMethod = 'canvas';
    }
  };

  // 영상 변환 시작
  window.startVideoConversion = async function(imageUrl) {
    const duration = parseInt(document.getElementById('videoDurationSelect').value);
    const effect = document.getElementById('videoEffectSelect').value;
    const text = document.getElementById('videoTextInput').value;
    const resolution = document.getElementById('videoResolutionSelect').value;
    const method = window.selectedConversionMethod || 'ffmpeg';

    // UI 업데이트
    document.getElementById('conversionProgress').classList.remove('hidden');
    document.getElementById('conversionResult').classList.add('hidden');
    document.getElementById('startConversionBtn').disabled = true;

    try {
      updateProgress('변환 준비 중...', 10);

      if (method === 'ffmpeg') {
        await convertWithFFmpeg(imageUrl, duration, effect, text, resolution);
      } else {
        await convertWithCanvas(imageUrl, duration, effect, text, resolution);
      }

    } catch (error) {
      alert(`변환 오류: ${error.message}`);
      document.getElementById('conversionProgress').classList.add('hidden');
    } finally {
      document.getElementById('startConversionBtn').disabled = false;
    }
  };

  // FFmpeg로 변환
  async function convertWithFFmpeg(imageUrl, duration, effect, text, resolution) {
    updateProgress('FFmpeg 서버로 전송 중...', 30);

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
      updateProgress('영상 생성 완료!', 100);
      const blob = await response.blob();
      const videoUrl = URL.createObjectURL(blob);
      showResult(videoUrl, blob);
    } else {
      throw new Error('FFmpeg 변환 실패');
    }
  }

  // Canvas로 변환
  async function convertWithCanvas(imageUrl, duration, effect, text, resolution) {
    updateProgress('Canvas 초기화 중...', 20);

    // 해상도 설정
    const resolutions = {
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 },
      '4K': { width: 3840, height: 2160 }
    };
    const { width, height } = resolutions[resolution];

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    updateProgress('이미지 로딩 중...', 40);

    // 이미지 로드
    const img = new Image();
    img.crossOrigin = 'anonymous';
    
    return new Promise((resolve, reject) => {
      img.onload = async () => {
        updateProgress('영상 녹화 시작...', 60);

        const stream = canvas.captureStream(30);
        const recorder = new MediaRecorder(stream, {
          mimeType: 'video/webm;codecs=vp9',
          videoBitsPerSecond: 8000000
        });

        const chunks = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);
        
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          const videoUrl = URL.createObjectURL(blob);
          updateProgress('영상 생성 완료!', 100);
          showResult(videoUrl, blob);
          resolve();
        };

        recorder.start();

        // 애니메이션 렌더링
        let frame = 0;
        const fps = 30;
        const totalFrames = duration * fps;

        const render = () => {
          // 배경 그리기
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, width, height);

          // 이미지 그리기 (효과 적용)
          let scale = 1;
          let offsetX = 0;
          let offsetY = 0;

          if (effect === 'zoom') {
            scale = 1 + (frame / totalFrames) * 0.1; // 10% 줌인
          } else if (effect === 'pan') {
            offsetX = -(frame / totalFrames) * (img.width * scale - width);
          } else if (effect === 'ken-burns') {
            scale = 1 + (frame / totalFrames) * 0.2;
            offsetX = -(frame / totalFrames) * 50;
            offsetY = -(frame / totalFrames) * 50;
          }

          ctx.save();
          ctx.translate(width/2, height/2);
          ctx.scale(scale, scale);
          ctx.drawImage(img, -img.width/2 + offsetX, -img.height/2 + offsetY);
          ctx.restore();

          // 텍스트 오버레이
          if (text) {
            ctx.font = `bold ${Math.floor(height * 0.05)}px Arial`;
            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 3;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            
            const textY = height - 50;
            ctx.strokeText(text, width / 2, textY);
            ctx.fillText(text, width / 2, textY);
          }

          // 페이드 효과
          if (effect === 'fade') {
            if (frame < fps) { // 첫 1초 페이드 인
              ctx.fillStyle = `rgba(0,0,0,${1 - frame/fps})`;
              ctx.fillRect(0, 0, width, height);
            } else if (frame > totalFrames - fps) { // 마지막 1초 페이드 아웃
              const fadeOpacity = (frame - (totalFrames - fps)) / fps;
              ctx.fillStyle = `rgba(0,0,0,${fadeOpacity})`;
              ctx.fillRect(0, 0, width, height);
            }
          }

          frame++;
          const progress = 60 + (frame / totalFrames) * 35;
          updateProgress(`녹화 진행 중... ${Math.round((frame/totalFrames)*100)}%`, progress);

          if (frame < totalFrames) {
            requestAnimationFrame(render);
          } else {
            recorder.stop();
          }
        };

        render();
      };

      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.src = imageUrl;
    });
  }

  // 진행 상태 업데이트
  function updateProgress(message, percentage) {
    document.getElementById('progressMessage').textContent = message;
    document.getElementById('progressBar').style.width = `${percentage}%`;
  }

  // 결과 표시
  function showResult(videoUrl, blob) {
    document.getElementById('conversionProgress').classList.add('hidden');
    document.getElementById('conversionResult').classList.remove('hidden');
    document.getElementById('resultVideo').src = videoUrl;
    
    // 전역 변수에 저장
    window.convertedVideoBlob = blob;
    window.convertedVideoUrl = videoUrl;
  }

  // 다운로드
  window.downloadConvertedVideo = function() {
    if (!window.convertedVideoBlob) return;
    
    const url = URL.createObjectURL(window.convertedVideoBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `converted-video-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 공유 (향후 확장)
  window.shareConvertedVideo = function() {
    if (navigator.share && window.convertedVideoBlob) {
      const file = new File([window.convertedVideoBlob], 'video.webm', { type: 'video/webm' });
      navigator.share({
        files: [file],
        title: '생성된 영상',
        text: 'AI로 생성한 영상을 확인해보세요!'
      });
    } else {
      // 폴백: 클립보드에 URL 복사
      if (window.convertedVideoUrl) {
        navigator.clipboard.writeText(window.convertedVideoUrl);
        alert('영상 URL이 클립보드에 복사되었습니다.');
      }
    }
  };

  // 모달 닫기
  window.closeVideoConverter = function() {
    const modal = document.getElementById('videoConverterModal');
    if (modal) modal.remove();
  };

  // 초기화
  window.selectedConversionMethod = 'ffmpeg';

  // 페이지 로드 후 감시 시작
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchForGeneratedImages);
  } else {
    watchForGeneratedImages();
  }

  console.log('✅ 영상 변환기 로드 완료');

})();