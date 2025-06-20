const { generateAiPrompt } = require('../utils/promptUtils');
const { generateImageDescription } = require('../utils/textProcessing');

/**
 * Test script to validate photo realism improvements
 */
async function testPhotoRealism() {
  console.log('🧪 Testing Photo Realism Improvements...\n');

  // Test cases for different photo types
  const testCases = [
    {
      name: 'Portrait Photo',
      description: 'A woman standing on a foggy street at night, soft lighting from street lamps',
      expectedType: 'photograph',
      expectedSubtype: 'portrait'
    },
    {
      name: 'Architecture Photo', 
      description: 'Modern glass building reflecting city lights at sunset',
      expectedType: 'photograph',
      expectedSubtype: 'architecture'
    },
    {
      name: 'Nature Photo',
      description: 'Mountain landscape with snow-capped peaks and golden hour lighting',
      expectedType: 'photograph', 
      expectedSubtype: 'landscape'
    },
    {
      name: 'Street Photo',
      description: 'Busy urban street scene with people walking and traffic',
      expectedType: 'photograph',
      expectedSubtype: 'street'
    }
  ];

  for (const testCase of testCases) {
    console.log(`📸 Testing: ${testCase.name}`);
    console.log(`Original: "${testCase.description}"`);
    
    try {
      // Test prompt generation
      const aiPrompt = await generateAiPrompt(testCase.description);
      console.log(`Generated AI Prompt: "${aiPrompt}"`);
      
      // Check for photo-specific keywords
      const photoKeywords = ['film photograph', 'digital photograph', 'camera', 'natural lighting', 'grain', 'lens'];
      const hasPhotoKeywords = photoKeywords.some(keyword => 
        aiPrompt.toLowerCase().includes(keyword.toLowerCase())
      );
      
      // Check for AI tells
      const aiTells = ['3d render', 'digital art', 'illustration', 'hyper-realistic', 'professional photo'];
      const hasAiTells = aiTells.some(tell => 
        aiPrompt.toLowerCase().includes(tell.toLowerCase())
      );
      
      console.log(`✅ Photo keywords present: ${hasPhotoKeywords}`);
      console.log(`❌ AI tells avoided: ${!hasAiTells}`);
      console.log(`📏 Prompt length: ${aiPrompt.length} characters`);
      
    } catch (error) {
      console.error(`❌ Error testing ${testCase.name}:`, error.message);
    }
    
    console.log('---\n');
  }

  console.log('🎯 Photo Realism Test Complete!');
  console.log('\nKey Improvements Implemented:');
  console.log('• Film/digital photograph specification');
  console.log('• Natural lighting and grain mentions');
  console.log('• Lens distortion and realistic shadows');
  console.log('• Avoidance of AI tells (3D render, digital art)');
  console.log('• Photo-specific post-processing with noise/grain');
  console.log('• Enhanced image type classification');
}

// Run the test
if (require.main === module) {
  testPhotoRealism().catch(console.error);
}

module.exports = { testPhotoRealism }; 