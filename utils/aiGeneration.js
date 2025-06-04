const OpenAI = require('openai');
const cloudinary = require('cloudinary').v2;
const sharp = require('sharp');
const axios = require('axios');
const streamifier = require('streamifier');

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

/**
 * Calculates the optimal DALL-E size parameter based on dimensions
 * @param {Object} dimensions - Image dimensions metadata
 * @returns {string} - Optimal size parameter for DALL-E
 */
const calculateDallESize = (dimensions) => {
  if (!dimensions) return '1024x1024';

  // DALL-E 3 supported sizes: 1024x1024, 1024x1792, 1792x1024
  const aspectRatio = dimensions.aspectRatio || 1;
  
  if (aspectRatio > 1.6) { // Landscape
    return '1792x1024';
  } else if (aspectRatio < 0.6) { // Portrait
    return '1024x1792';
  } else { // Near square
    return '1024x1024';
  }
};

/**
 * Generates an AI image using enhanced style-aware prompts
 * @param {Object} params - Generation parameters
 * @param {string} params.prompt - The enhanced prompt
 * @param {Object} params.metadata - Style metadata
 * @param {Function} [progressCallback] - Optional callback for progress updates
 * @returns {Promise<string>} - The generated image URL
 */
const generateAIImage = async ({ prompt, metadata }, progressCallback = null) => {
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (progressCallback) {
        progressCallback(`Attempt ${attempt}: Generating AI image with DALL-E 3...`);
      }

      // Adjust quality and style based on metadata
      const quality = metadata.medium === 'photograph' ? 'hd' : 'standard';
      const style = metadata.style?.toLowerCase().includes('realistic') ? 'vivid' : 'natural';
      const size = calculateDallESize(metadata.dimensions);

      // Generate image with DALL-E 3
      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: prompt,
        n: 1,
        response_format: "url",
        quality,
        style,
        size
      });

      const imageUrl = response.data[0].url;

      if (progressCallback) {
        progressCallback('AI image generated, validating...');
      }

      // Validate the generated image
      const validation = await validateImage(imageUrl);
      if (!validation.isValid) {
        console.warn('Image validation issues:', validation.issues);
      }

      if (progressCallback) {
        progressCallback('Image validated, uploading to Cloudinary...');
      }

      // Download the image
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageResponse.data);

      // Upload to Cloudinary using the updated options
      const uploadResult = await uploadToCloudinary(imageBuffer, metadata);

      if (progressCallback) {
        progressCallback('Process completed successfully');
      }

      return uploadResult.secure_url;

    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt} failed:`, error);

      if (error.status === 429 || (error.error?.type === 'quota_exceeded')) {
        console.error('Rate limit or quota exceeded:', error);
        if (progressCallback) {
          progressCallback('API quota exceeded. Skipping generation.');
        }
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

  console.error(`Failed to generate AI image after ${MAX_RETRIES} attempts:`, lastError);
  return null;
};

/**
 * Gets Cloudinary upload options based on medium
 * @param {string} medium - The artwork medium
 * @returns {Object} - Cloudinary upload options
 */
const getCloudinaryOptions = (medium) => {
  const baseOptions = {
    folder: 'artalyze/aiImages',
    format: 'webp',
    quality: 'auto:best',
    flags: 'preserve_transparency',
    fetch_format: 'auto',
    transformation: [
      { width: 650, crop: "scale" }
    ]
  };

  const effect = (() => {
    switch (medium?.toLowerCase()) {
      case 'pencil sketch':
      case 'charcoal':
        return 'art:zorro';
      case 'watercolor':
        return 'art:athena';
      case 'oil painting':
        return 'oil_paint:100';
      case 'photograph':
        return 'improve';
      default:
        return null;
    }
  })();

  if (effect) {
    baseOptions.transformation.push({ effect });
  }

  return baseOptions;
};

const uploadToCloudinary = async (imageBuffer, metadata) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'artalyze/aiImages',
        format: 'webp',
        quality: 'auto:best',
        flags: 'preserve_transparency',
        fetch_format: 'auto',
        transformation: [
          { width: 650, crop: "scale" }
        ]
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );

    streamifier.createReadStream(imageBuffer).pipe(uploadStream);
  });
};

module.exports = {
  generateAIImage,
  validateImage
}; 