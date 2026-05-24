// Canvas를 사용한 테스트 이미지 생성 및 Remotion 테스트
const { createCanvas } = require('canvas');
const fs = require('fs');
const fetch = require('node-fetch');

async function generateTestImage() {
    const canvas = createCanvas(1920, 1080);
    const ctx = canvas.getContext('2d');
    
    // 그라데이션 배경
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // 텍스트
    ctx.fillStyle = 'white';
    ctx.font = 'bold 120px Arial';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 10;
    ctx.fillText('테스트 이미지', canvas.width / 2, canvas.height / 2);
    
    ctx.font = '60px Arial';
    ctx.fillText('Remotion 렌더링 테스트', canvas.width / 2, canvas.height / 2 + 120);
    
    return canvas.toDataURL('image/png');
}

async function testRemotionRender() {
    console.log('🎨 테스트 이미지 생성 중...');
    const imageSrc = await generateTestImage();
    
    console.log('🎬 Remotion 서버로 렌더링 요청...');
    
    const response = await fetch('http://localhost:8766/render-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            imageSrc: imageSrc,
            subtitle: '안녕하세요! Remotion 테스트입니다.',
            duration: 5,
            fps: 30,
            width: 1920,
            height: 1080
        })
    });
    
    if (response.ok) {
        console.log('✅ 렌더링 성공!');
        const buffer = await response.buffer();
        fs.writeFileSync('test-output.mp4', buffer);
        console.log('📁 test-output.mp4 파일로 저장됨');
        return true;
    } else {
        const error = await response.text();
        console.error('❌ 렌더링 실패:', response.status, error);
        return false;
    }
}

// 실행
if (require.main === module) {
    testRemotionRender()
        .then(success => {
            if (success) {
                console.log('🎉 테스트 완료!');
            }
            process.exit(success ? 0 : 1);
        })
        .catch(err => {
            console.error('💥 오류:', err.message);
            process.exit(1);
        });
}