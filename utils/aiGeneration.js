const OpenAI = require('openai');
const cloudinary = require('cloudinary').v2;
const sharp = require('sharp');
const axios = require('axios');

// Initialize OpenAI with API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Maximum retries for AI generation
const MAX_RETRIES = 3;
// Delay between retries (in milliseconds)
const RETRY_DELAY = 5000;

const validateImage = async (imageUrl) => {
  try {
    // Download image for validation
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    // Use sharp to analyze image
    const metadata = await sharp(buffer).metadata();

    // Basic validation criteria
    const isValidSize = metadata.width >= 512 && metadata.height >= 512;
    const isValidFormat = ['jpeg', 'png', 'webp'].includes(metadata.format);
    
    // Check if image is not completely black or white
    const stats = await sharp(buffer).stats();
    const channels = stats.channels;
    const isMonochrome = channels.every(channel => {
      const mean = channel.mean;
      return mean < 5 || mean > 250;
    });

    return {
      isValid: isValidSize && isValidFormat && !isMonochrome,
      issues: {
        size: !isValidSize ? 'Image is too small' : null,
        format: !isValidFormat ? 'Invalid image format' : null,
        quality: isMonochrome ? 'Image appears to be monochrome' : null
      }
    };
  } catch (error) {
    console.error('Error validating image:', error);
    // Return true to skip validation if there's an error
    return {
      isValid: true,
      issues: {
        error: 'Failed to validate image, proceeding anyway'
      }
    };
  }
};

const generateAIImage = async (description, progressCallback = null) => {
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (progressCallback) {
        progressCallback(`Attempt ${attempt}: Generating AI image with DALL-E 3...`);
      }

      // Generate image with DALL-E 3
      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: description,
        n: 1,
        response_format: "url",
        quality: "hd",
        style: "vivid"
      });

      const imageUrl = response.data[0].url;

      if (progressCallback) {
        progressCallback('AI image generated, validating...');
      }

      // Validate the generated image
      const validation = await validateImage(imageUrl);
      if (!validation.isValid) {
        console.warn('Image validation issues:', validation.issues);
        // Continue anyway since DALL-E 3 images should be reliable
      }

      if (progressCallback) {
        progressCallback('Image validated, uploading to Cloudinary...');
      }

      // Upload validated image to Cloudinary
      const uploadResponse = await cloudinary.uploader.upload(imageUrl, {
        folder: 'artalyze/aiImages',
        format: 'webp',
        quality: 'auto:best',
      });

      if (progressCallback) {
        progressCallback('Process completed successfully');
      }

      return uploadResponse.secure_url;

    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt} failed:`, error);

      // Handle rate limiting and quota errors
      if (error.status === 429 || (error.error?.type === 'quota_exceeded')) {
        console.error('Rate limit or quota exceeded:', error);
        if (progressCallback) {
          progressCallback('API quota exceeded. Skipping generation.');
        }
        // Return null to indicate generation was skipped
        return null;
      }

      if (progressCallback) {
        progressCallback(`Attempt ${attempt} failed, ${attempt < MAX_RETRIES ? 'retrying...' : 'giving up.'}`);
      }

      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
      continue;
    }
  }

  // If we reach here, all attempts failed
  console.error(`Failed to generate AI image after ${MAX_RETRIES} attempts:`, lastError);
  return null;
};

module.exports = {
  generateAIImage,
  validateImage
}; 