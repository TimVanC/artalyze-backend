// routes/adminRoutes.js
const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose');
const ImagePair = require('../models/ImagePair');
const { authenticateToken, authorizeAdmin } = require('../middleware/authMiddleware');
const router = express.Router();
const streamifier = require('streamifier');
const adminController = require('../controllers/adminController');
const sharp = require('sharp');
const { Configuration, OpenAIApi } = require('openai');
const { generateAIImage } = require('../utils/aiGeneration');

// Configure file upload storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Dynamically select collection name based on environment
const collectionName = process.env.NODE_ENV === "staging" ? "staging_imagePairs" : "imagePairs";
const ImagePairCollection = mongoose.model(collectionName, ImagePair.schema);

// Ensure authentication and admin access for all routes except login
router.use((req, res, next) => {
  if (req.path === '/login') {
    return next();
  }
  authenticateToken(req, res, () => {
    authorizeAdmin(req, res, next);
  });
});

// Ensure ImagePairCollection is available to all routes
router.use((req, res, next) => {
  req.ImagePairCollection = ImagePairCollection;
  next();
});

// Verify Cloudinary configuration
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('Missing Cloudinary configuration');
  process.exit(1);
}

// Cloudinary setup
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Resize image while preserving aspect ratio
const resizeImage = async (buffer) => {
  const image = sharp(buffer);
  const metadata = await image.metadata();
  
  // Only resize if width is greater than 600px
  if (metadata.width > 600) {
    return await image
      .resize(600, null, { 
        fit: 'inside',
        withoutEnlargement: true 
      })
      .toBuffer();
  }
  
  return buffer;
};

// Upload file to Cloudinary
const uploadToCloudinary = (fileBuffer, folderName) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folderName,
        format: "webp",
        quality: "auto:best",
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );
    streamifier.createReadStream(fileBuffer).pipe(uploadStream);
  });
};

// Admin authentication
router.post('/login', adminController.adminLogin);

// Upload image pair for a date
router.post('/upload-image-pair', upload.fields([{ name: 'humanImage' }, { name: 'aiImage' }]), async (req, res) => {
  try {
    const { scheduledDate, pairIndex } = req.body;
    if (!scheduledDate) {
      return res.status(400).json({ error: 'Scheduled date must be provided.' });
    }

    const date = new Date(scheduledDate);
    date.setUTCHours(5, 0, 0, 0);

    const humanImage = req.files['humanImage']?.[0];
    const aiImage = req.files['aiImage']?.[0];
    if (!humanImage || !aiImage) {
      return res.status(400).json({ error: 'Both images must be provided.' });
    }

    let humanUploadResult, aiUploadResult;
    try {
      humanUploadResult = await uploadToCloudinary(humanImage.buffer, 'artalyze/humanImages');
      aiUploadResult = await uploadToCloudinary(aiImage.buffer, 'artalyze/aiImages');
    } catch (uploadError) {
      console.error('Cloudinary Upload Error:', uploadError);
      return res.status(500).json({ error: 'Image upload failed' });
    }

    if (!humanUploadResult?.secure_url || !aiUploadResult?.secure_url) {
      return res.status(500).json({ error: 'Failed to retrieve image URLs from Cloudinary' });
    }

    // Update the database: Use `findOneAndUpdate()` with `$push`
    const updateResult = await ImagePairCollection.findOneAndUpdate(
      { scheduledDate: date }, // Find the document by date
      {
        $push: { 
          pairs: {
            humanImageURL: humanUploadResult.secure_url,
            aiImageURL: aiUploadResult.secure_url,
          } 
        },
      },
      { upsert: true, new: true }
    );

    res.json({ message: 'Image pair uploaded successfully', data: updateResult });

  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: 'Failed to upload image pair' });
  }
});

// Add SSE endpoint for progress updates
router.get('/progress-updates/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Store the response object in a map using sessionId
  if (!global.progressStreams) {
    global.progressStreams = new Map();
  }
  global.progressStreams.set(sessionId, res);

  req.on('close', () => {
    global.progressStreams.delete(sessionId);
  });
});

// Helper function to send progress updates
const sendProgress = (sessionId, message) => {
  if (global.progressStreams?.has(sessionId)) {
    const res = global.progressStreams.get(sessionId);
    res.write(`data: ${JSON.stringify({ message })}\n\n`);
  }
};

// Upload human image for automated pairing
router.post('/upload-human-image', upload.single('humanImage'), async (req, res) => {
  const sessionId = req.body.sessionId;
  try {
    const humanImage = req.file;
    if (!humanImage) {
      return res.status(400).json({ error: 'Human image must be provided.' });
    }

    sendProgress(sessionId, 'Resizing human image...');
    // Resize image before uploading
    const resizedBuffer = await resizeImage(humanImage.buffer);

    sendProgress(sessionId, 'Uploading human image to Cloudinary...');
    // Upload to Cloudinary's humanImages folder
    const humanUploadResult = await uploadToCloudinary(resizedBuffer, 'artalyze/humanImages');

    if (!humanUploadResult?.secure_url) {
      return res.status(500).json({ error: 'Failed to upload image to Cloudinary' });
    }

    sendProgress(sessionId, 'Generating image description with GPT-4 Vision...');
    // Generate image description using GPT-4 Vision
    const description = await generateImageDescription(humanUploadResult.secure_url);
    
    sendProgress(sessionId, 'Starting AI image generation process...');
    // Generate AI image using SDXL with progress updates
    const aiImageUrl = await generateAIImage(description, (message) => {
      sendProgress(sessionId, message);
    });

    sendProgress(sessionId, 'Finding next available date for the pair...');
    // Find the next available date that needs pairs
    const targetDate = new Date();
    targetDate.setUTCHours(5, 0, 0, 0);

    let foundDate = false;
    while (!foundDate) {
      // Check if this date has less than 5 pairs
      const existingDoc = await ImagePairCollection.findOne({ 
        scheduledDate: targetDate,
        $expr: { $lt: [{ $size: "$pairs" }, 5] }
      });

      if (existingDoc || !(await ImagePairCollection.findOne({ scheduledDate: targetDate }))) {
        foundDate = true;
      } else {
        // Move to next day
        targetDate.setDate(targetDate.getDate() + 1);
      }
    }

    sendProgress(sessionId, 'Saving pair to database...');
    // Create or update MongoDB document for this date
    const imagePairDoc = await ImagePairCollection.findOneAndUpdate(
      { scheduledDate: targetDate },
      {
        $push: {
          pairs: {
            humanImageURL: humanUploadResult.secure_url,
            aiImageURL: aiImageUrl,
            metadata: {
              description,
              generatedAt: new Date()
            }
          }
        }
      },
      { 
        upsert: true, 
        new: true,
        setDefaultsOnInsert: true
      }
    );

    sendProgress(sessionId, 'Process completed successfully!');
    
    // Close the SSE connection
    if (global.progressStreams?.has(sessionId)) {
      const stream = global.progressStreams.get(sessionId);
      stream.end();
      global.progressStreams.delete(sessionId);
    }

    res.json({ 
      message: 'Image pair created successfully',
      scheduledDate: targetDate,
      pair: {
        humanImageURL: humanUploadResult.secure_url,
        aiImageURL: aiImageUrl
      },
      imagePairDoc
    });

  } catch (error) {
    console.error('Upload Error:', error);
    sendProgress(sessionId, `Error: ${error.message}`);
    
    // Close the SSE connection on error
    if (global.progressStreams?.has(sessionId)) {
      const stream = global.progressStreams.get(sessionId);
      stream.end();
      global.progressStreams.delete(sessionId);
    }
    
    res.status(500).json({ error: 'Failed to process image pair' });
  }
});

// Helper function to generate image description
const generateImageDescription = async (imageUrl) => {
  try {
    const openai = new OpenAIApi(new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
    }));

    const response = await openai.createChatCompletion({
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe this artwork in detail, focusing on style, composition, and subject matter. Make it suitable for AI image generation."
            },
            {
              type: "image_url",
              image_url: imageUrl
            }
          ]
        }
      ],
      max_tokens: 300
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Error generating image description:', error);
    throw error;
  }
};

// Get image pairs for a date
router.get('/get-image-pairs-by-date/:date', async (req, res) => {
  try {
    const { date } = req.params;
    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }

    const queryStart = new Date(date);
    queryStart.setUTCHours(0, 0, 0, 0);

    const queryEnd = new Date(queryStart);
    queryEnd.setUTCHours(23, 59, 59, 999);

    // Find the image pair within this date range
    const imagePairs = await ImagePairCollection.findOne({
      scheduledDate: { $gte: queryStart, $lte: queryEnd }
    });

    if (!imagePairs) {
      return res.json({ 
        pairs: [],
        pendingHumanImages: [],
        status: 'pending'
      });
    }

    res.json(imagePairs);
  } catch (error) {
    console.error('Error fetching image pairs:', error);
    res.status(500).json({ error: 'Failed to fetch image pairs' });
  }
});

module.exports = router;
