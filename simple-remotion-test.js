// Simple test of Remotion server
async function testRemotionServer() {
    console.log('🔧 Testing Remotion server...');
    
    // Create a simple base64 test image (1x1 pixel red PNG)
    const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const imageSrc = `data:image/png;base64,${testImageBase64}`;
    
    console.log('📡 Sending test image to Remotion server...');
    
    try {
        // Test health endpoint first
        const healthResponse = await fetch('http://localhost:8766/health');
        const healthData = await healthResponse.json();
        
        if (!healthData.ok) {
            throw new Error('Health check failed');
        }
        
        console.log('✅ Health check passed');
        
        // Test render endpoint
        const response = await fetch('http://localhost:8766/render-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                imageSrc: imageSrc,
                subtitle: 'Remotion 서버 테스트',
                duration: 2,
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
        
        const buffer = Buffer.from(await response.arrayBuffer());
        const fs = require('fs');
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
testRemotionServer()
    .then(success => {
        process.exit(success ? 0 : 1);
    })
    .catch(err => {
        console.error('💥 Unexpected error:', err.message);
        process.exit(1);
    });