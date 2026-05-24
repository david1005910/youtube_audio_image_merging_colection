# 무료/저비용 영상 생성 방법 가이드

## 🎬 현재 사용 가능한 영상 생성 방법

### 1. **FFmpeg 기반 솔루션** (완전 무료, 로컬)
이미지를 영상으로 변환하는 가장 간단하고 무료인 방법

```bash
# 단일 이미지를 5초 영상으로 변환
ffmpeg -loop 1 -i image.jpg -c:v libx264 -t 5 -pix_fmt yuv420p output.mp4

# 여러 이미지를 슬라이드쇼로 (각 3초)
ffmpeg -framerate 1/3 -pattern_type glob -i '*.jpg' -c:v libx264 -pix_fmt yuv420p slideshow.mp4

# 이미지에 자막 추가
ffmpeg -loop 1 -i image.jpg -vf "drawtext=text='Hello World':fontsize=40:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2" -c:v libx264 -t 5 output.mp4
```

**장점:**
- 완전 무료
- 로컬 처리 (API 제한 없음)
- 빠른 속도
- 자막, 효과, 전환 등 다양한 기능

**단점:**
- 프로그래밍 필요
- AI 생성 영상 아님

---

### 2. **Grok API** (X.AI) - 부분 무료
이미 `server.py`에 구현되어 있음

**엔드포인트:**
- `/api/proxy/grok-video` - 텍스트/이미지 → 영상
- `/api/proxy/grok-video/<id>` - 생성 상태 확인
- `/api/proxy/grok-video-concat` - 여러 영상 합치기

**사용법:**
```javascript
// 텍스트 → 영상
fetch('/api/proxy/grok-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        prompt: 'dancing cat',
        duration: 10,
        aspect_ratio: '16:9',
        resolution: '720p'
    })
})

// 이미지 → 영상 (모션 추가)
fetch('/api/proxy/grok-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        image_url: 'https://example.com/image.jpg',
        prompt: 'make it move naturally',
        duration: 5
    })
})
```

**필요사항:** `XAI_API_KEY` (.env 파일에 추가)

---

### 3. **Replicate API** (저비용, 고품질)
다양한 오픈소스 모델 제공

**주요 모델:**
- **Stable Video Diffusion** - 이미지 → 영상
- **AnimateDiff** - 텍스트 → 애니메이션
- **CogVideo** - 텍스트 → 영상

**가격:** 
- $0.0002/초 (매우 저렴)
- 신규 가입시 무료 크레딧 제공

**구현 예시:**
```javascript
// Stable Video Diffusion
const response = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
        'Authorization': `Token ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
    },
    body: JSON.stringify({
        version: "3f0457e4619daac51203dedb472816fd4af51f3149fa7a9e0b5ffcf1b8172438",
        input: {
            input_image: "https://example.com/image.jpg",
            video_length: "25_frames_with_svd_xt",
            sizing_strategy: "maintain_aspect_ratio",
            frames_per_second: 6
        }
    })
});
```

---

### 4. **Canvas API 활용** (무료, 브라우저 기반)
JavaScript Canvas로 간단한 애니메이션 생성 후 영상 변환

```javascript
// Canvas 애니메이션을 WebM으로 녹화
const canvas = document.getElementById('canvas');
const stream = canvas.captureStream(30); // 30 fps
const recorder = new MediaRecorder(stream, {
    mimeType: 'video/webm',
    videoBitsPerSecond: 2500000
});

recorder.ondataavailable = (e) => {
    const blob = new Blob([e.data], { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    // 다운로드 또는 표시
};

recorder.start();
// 애니메이션 실행
setTimeout(() => recorder.stop(), 5000); // 5초 후 정지
```

---

### 5. **Hugging Face 무료 모델들**

**Text-to-Video:**
- ModelScope Text2Video
- ZeroScope

**Image-to-Video:**
- Stable Video Diffusion
- I2VGen-XL

**사용법:**
```python
# Gradio API 활용
import requests

response = requests.post(
    "https://api-inference.huggingface.co/models/modelscope/text-to-video-synthesis",
    headers={"Authorization": f"Bearer {HF_TOKEN}"},
    json={"inputs": "A cat playing piano"}
)
```

---

### 6. **RunwayML** (제한적 무료)
- Gen-2: 이미지/텍스트 → 영상
- 무료 티어: 월 125 크레딧 (약 25초 영상)
- API 제공

---

### 7. **Pika Labs** (제한적 무료)
- Discord 봇으로 제공
- 일일 무료 생성 제한
- 웹 버전 베타 테스트 중

---

## 🚀 추천 구현 순서

### 1단계: FFmpeg 기반 구현 (즉시 가능)
```javascript
// server.py에 추가
async function createVideoFromImage(imagePath, text, duration) {
    const command = `ffmpeg -loop 1 -i ${imagePath} \
        -vf "drawtext=text='${text}':fontsize=30:fontcolor=white:box=1:boxcolor=black@0.5:x=(w-text_w)/2:y=h-50" \
        -c:v libx264 -t ${duration} -pix_fmt yuv420p output.mp4`;
    
    // 실행 및 반환
}
```

### 2단계: Grok API 활성화 (XAI_API_KEY 필요)
- 이미 구현됨, API 키만 필요

### 3단계: Replicate 통합 (저비용)
- 가입 후 API 토큰 발급
- server.py에 프록시 추가

### 4단계: Canvas 애니메이션 (창의적 접근)
- 텍스트 애니메이션
- 파티클 효과
- 전환 효과

---

## 💡 최적 조합 추천

**무료 우선:**
1. FFmpeg로 이미지 슬라이드쇼 생성
2. Pollinations로 이미지 생성
3. Canvas로 텍스트 애니메이션 추가

**품질 우선:**
1. Replicate API (Stable Video Diffusion)
2. Grok API (X.AI)
3. RunwayML (Gen-2)

**하이브리드:**
1. Pollinations로 이미지 생성
2. FFmpeg로 기본 영상 변환
3. 필요시 Replicate로 고급 효과

---

## 📝 구현 예제

### FFmpeg + Pollinations 조합
```javascript
// 1. Pollinations로 이미지 생성
const imageUrl = await generateWithPollinations(prompt);

// 2. 이미지 다운로드
const imagePath = await downloadImage(imageUrl);

// 3. FFmpeg로 영상 변환
const videoPath = await convertToVideo(imagePath, {
    duration: 5,
    text: prompt,
    transition: 'fade'
});

// 4. 반환
return videoPath;
```

이 방법은 완전 무료이며 즉시 구현 가능합니다!