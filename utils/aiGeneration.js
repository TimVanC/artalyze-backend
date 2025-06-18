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
  
  // Calculate the aspect ratios of DALL-E's available sizes
  const squareRatio = 1024 / 1024; // 1:1
  const portraitRatio = 1024 / 1792; // ~0.57 (9:16)
  const landscapeRatio = 1792 / 1024; // ~1.75 (16:9)
  
  // Calculate the difference between the input aspect ratio and each DALL-E option
  const squareDiff = Math.abs(aspectRatio - squareRatio);
  const portraitDiff = Math.abs(aspectRatio - portraitRatio);
  const landscapeDiff = Math.abs(aspectRatio - landscapeRatio);
  
  // Choose the closest match
  const minDiff = Math.min(squareDiff, portraitDiff, landscapeDiff);
  
  if (minDiff === squareDiff) {
    return '1024x1024'; // Square (~1:1)
  } else if (minDiff === portraitDiff) {
    return '1024x1792'; // Portrait (~9:16)
  } else {
    return '1792x1024'; // Landscape (~16:9)
  }
};

/**
 * Generates an AI image using DALL·E 3
 * @param {string} prompt - The prompt for image generation
 * @param {Function} [progressCallback] - Optional callback for progress updates
 * @param {Object} [dimensions] - Optional dimensions for the output image
 * @returns {Promise<string>} - The generated image URL
 */
const generateAIImage = async (prompt, progressCallback = null, dimensions = null) => {
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (progressCallback) {
        progressCallback(`Attempt ${attempt}: Generating AI image with DALL·E 3...`);
      }

      // Calculate optimal size based on dimensions
      const size = calculateDallESize(dimensions);
      
      // Log the aspect ratio matching for debugging
      if (dimensions) {
        console.log(`Aspect ratio matching: ${dimensions.width}x${dimensions.height} (${dimensions.aspectRatio.toFixed(2)}) → ${size}`);
      }

      // Generate image with DALL·E 3
      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: prompt,
        n: 1,
        size: size,
        quality: "standard",
        style: "natural"
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
        progressCallback('Image validated, downloading and processing...');
      }

      // Download the image
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageResponse.data);

      // Process with sharp to resize and convert to webp
      const processedBuffer = await sharp(imageBuffer)
        .resize(600, null, { // Resize to 600px width, maintain aspect ratio
          withoutEnlargement: true,
          fit: 'inside'
        })
        .webp({ quality: 90 })
        .toBuffer();

      if (progressCallback) {
        progressCallback('Image processed, uploading to Cloudinary...');
      }

      // Upload to Cloudinary
      const uploadResult = await uploadToCloudinary(processedBuffer);

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
          { width: 600, crop: "scale" }
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