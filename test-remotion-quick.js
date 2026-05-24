// Quick test of Remotion server with sample data
const fs = require('fs');
// Using global fetch (Node.js 18+)

async function testRemotionServer() {
    console.log('🔧 Testing Remotion server...');
    
    // Create a simple test image (solid color with text)
    const canvas = require('canvas').createCanvas(1920, 1080);
    const ctx = canvas.getContext('2d');
    
    // Gradient background
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Text
    ctx.fillStyle = 'white';
    ctx.font = 'bold 120px Arial';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 10;
    ctx.fillText('Remotion 테스트', canvas.width / 2, canvas.height / 2);
    
    const imageSrc = canvas.toDataURL('image/png');
    
    console.log('🎨 Test image created');
    console.log('📡 Sending to Remotion server...');
    
    try {
        const response = await fetch('http://localhost:8766/render-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                imageSrc: imageSrc,
                subtitle: 'Remotion 서버 테스트 성공!',
                duration: 3,
                fps: 30,
                width: 1920,
                height: 1080
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        
        console.log('🎬 Rendering completed successfully!');
        
        const buffer = await response.buffer();
        fs.writeFileSync('remotion-test-output.mp4', buffer);
        
        console.log('✅ Test completed!');
        console.log('📁 Output saved as: remotion-test-output.mp4');
        console.log(`💾 File size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
        
        return true;
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        return false;
    }
}

// Run test
if (require.main === module) {
    testRemotionServer()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(err => {
            console.error('💥 Unexpected error:', err.message);
            process.exit(1);
        });
}