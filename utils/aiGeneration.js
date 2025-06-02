const axios = require('axios');
const cloudinary = require('cloudinary').v2;
const sharp = require('sharp');

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
    return {
      isValid: false,
      issues: {
        error: 'Failed to validate image'
      }
    };
  }
};

const generateAIImage = async (description, progressCallback = null) => {
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (progressCallback) {
        progressCallback(`Attempt ${attempt}: Generating AI image...`);
      }

      // Call Replicate API to generate image with SDXL
      const response = await axios.post(
        'https://api.replicate.com/v1/predictions',
        {
          version: process.env.SDXL_VERSION,
          input: {
            prompt: description,
            negative_prompt: "low quality, blurry, distorted, watermark, signature, text",
            num_inference_steps: 50,
            guidance_scale: 7.5,
            width: 1024,
            height: 1024,
          },
        },
        {
          headers: {
            'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (progressCallback) {
        progressCallback('Image generation started, waiting for completion...');
      }

      // Poll for completion
      let imageUrl;
      const predictionId = response.data.id;
      const startTime = Date.now();
      const TIMEOUT = 5 * 60 * 1000; // 5 minutes timeout

      while (!imageUrl && (Date.now() - startTime) < TIMEOUT) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const status = await axios.get(
          `https://api.replicate.com/v1/predictions/${predictionId}`,
          {
            headers: {
              'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
            },
          }
        );

        if (status.data.status === 'succeeded') {
          imageUrl = status.data.output[0];
          if (progressCallback) {
            progressCallback('AI image generated, validating...');
          }

          // Validate the generated image
          const validation = await validateImage(imageUrl);
          if (!validation.isValid) {
            throw new Error(`Image validation failed: ${JSON.stringify(validation.issues)}`);
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
        } else if (status.data.status === 'failed') {
          throw new Error('Image generation failed');
        }

        if (progressCallback) {
          progressCallback(`Still processing... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
        }
      }

      if (!imageUrl) {
        throw new Error('Generation timed out');
      }

    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt} failed:`, error);

      if (progressCallback) {
        progressCallback(`Attempt ${attempt} failed, ${attempt < MAX_RETRIES ? 'retrying...' : 'giving up.'}`);
      }

      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
      continue;
    }
  }

  throw new Error(`Failed to generate AI image after ${MAX_RETRIES} attempts. Last error: ${lastError.message}`);
};

module.exports = {
  generateAIImage,
  validateImage
}; 