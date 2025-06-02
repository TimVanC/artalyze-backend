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
const OpenAI = require('openai');
const { generateAIImage } = require('../utils/aiGeneration');
const jwt = require('jsonwebtoken');
const { generateImageDescription, remixCaption } = require('../utils/textProcessing');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Initialize OpenAI with new SDK format
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Configure file upload storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Dynamically select collection name based on environment
const collectionName = process.env.NODE_ENV === "staging" ? "staging_imagePairs" : "imagePairs";
console.log('Using MongoDB collection:', collectionName);
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
    console.log('Starting Cloudinary upload to folder:', folderName);
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folderName,
        format: "webp",
        quality: "auto:best",
        resource_type: "image"
      },
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', error);
          reject(error);
        } else {
          console.log('Cloudinary upload successful:', {
            publicId: result.public_id,
            url: result.secure_url,
            format: result.format,
            size: result.bytes
          });
          resolve(result);
        }
      }
    );

    // Handle stream errors
    uploadStream.on('error', (error) => {
      console.error('Cloudinary stream error:', error);
      reject(error);
    });

    uploadStream.end(fileBuffer);
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

// Initialize global progress streams map if not exists
if (!global.progressStreams) {
  global.progressStreams = new Map();
}

// Send progress update to client
const sendProgress = (sessionId, message) => {
  if (global.progressStreams?.has(sessionId)) {
    try {
      const res = global.progressStreams.get(sessionId);
      res.write(`data: ${JSON.stringify({ message })}\n\n`);
    } catch (error) {
      console.error('Error sending progress update:', error);
    }
  }
};

// Progress updates endpoint
router.get('/progress-updates/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const token = req.query.token;

  // Verify token
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') {
      res.status(403).end();
      return;
    }
  } catch (error) {
    res.status(401).end();
    return;
  }
  
  // Set headers for SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Store the response object in the global map
  global.progressStreams.set(sessionId, res);

  // Clean up on client disconnect
  req.on('close', () => {
    if (global.progressStreams?.has(sessionId)) {
      global.progressStreams.delete(sessionId);
    }
  });
});

// Upload human image for automated pairing
router.post('/upload-human-image', upload.single('humanImage'), async (req, res) => {
  const sessionId = req.body.sessionId;
  try {
    console.log('Starting upload process with session:', sessionId);
    console.log('Request headers:', req.headers);
    
    const humanImage = req.file;
    if (!humanImage) {
      console.error('No image file provided in request');
      return res.status(400).json({ error: 'Human image must be provided.' });
    }

    console.log('Image received:', {
      filename: humanImage.originalname,
      size: humanImage.size,
      mimetype: humanImage.mimetype
    });

    sendProgress(sessionId, 'Resizing human image...');

    try {
      // Resize image before uploading
      const resizedBuffer = await resizeImage(humanImage.buffer);
      console.log('Image resized successfully');

      sendProgress(sessionId, 'Uploading human image to Cloudinary...');
      
      try {
        // Upload to Cloudinary's humanImages folder
        console.log('Starting Cloudinary upload...');
        const humanUploadResult = await uploadToCloudinary(resizedBuffer, 'artalyze/humanImages');
        console.log('Cloudinary upload successful:', humanUploadResult?.secure_url);

        if (!humanUploadResult?.secure_url) {
          throw new Error('Failed to get secure URL from Cloudinary');
        }

        sendProgress(sessionId, 'Generating image description with GPT-4o...');
        
        let description = null;
        try {
          // Generate image description using GPT-4o
          console.log('Starting GPT-4o description generation...');
          description = await generateImageDescription(humanUploadResult.secure_url);
          console.log('Generated description:', description);
          
          if (!description) {
            throw new Error('Failed to generate description');
          }

          sendProgress(sessionId, 'Remixing description for AI generation...');

          // Remix the description for AI generation
          const remixedPrompt = await remixCaption(description);
          console.log('Remixed prompt:', remixedPrompt);
          
          sendProgress(sessionId, 'Starting AI image generation with DALL-E 3...');
          
          try {
            // Generate AI image using DALL-E 3 with progress updates
            console.log('Starting DALL-E 3 image generation with prompt:', remixedPrompt);
            const aiImageUrl = await generateAIImage(remixedPrompt, (message) => {
              console.log('DALL-E 3 progress:', message);
              sendProgress(sessionId, message);
            });

            // If generation was skipped due to quota, handle gracefully
            if (!aiImageUrl) {
              console.log('AI image generation skipped');
              sendProgress(sessionId, 'AI image generation skipped due to API limits. Please try again later.');
              return res.status(429).json({ 
                error: 'AI image generation skipped due to API limits',
                humanImageURL: humanUploadResult.secure_url,
                description
              });
            }

            console.log('AI image generated:', aiImageUrl);

            sendProgress(sessionId, 'Finding next available date for the pair...');
            
            try {
              // Find the next available date that needs pairs
              const targetDate = new Date();
              targetDate.setUTCHours(5, 0, 0, 0);

              console.log('Finding next available date starting from:', targetDate);
              let foundDate = false;
              while (!foundDate) {
                // Check if this date has less than 5 pairs
                const existingDoc = await ImagePairCollection.findOne({ 
                  scheduledDate: targetDate,
                  $expr: { $lt: [{ $size: "$pairs" }, 5] }
                });

                if (existingDoc || !(await ImagePairCollection.findOne({ scheduledDate: targetDate }))) {
                  foundDate = true;
                  console.log('Found available date:', targetDate);
                } else {
                  // Move to next day
                  targetDate.setDate(targetDate.getDate() + 1);
                  console.log('Moving to next date:', targetDate);
                }
              }

              sendProgress(sessionId, 'Saving pair to database...');
              
              try {
                console.log('Saving to database with data:', {
                  scheduledDate: targetDate,
                  humanImageURL: humanUploadResult.secure_url,
                  aiImageURL: aiImageUrl,
                  metadata: {
                    originalDescription: description,
                    remixedPrompt,
                    generatedAt: new Date()
                  }
                });

                // Create or update MongoDB document for this date
                const imagePairDoc = await ImagePairCollection.findOneAndUpdate(
                  { scheduledDate: targetDate },
                  {
                    $push: {
                      pairs: {
                        humanImageURL: humanUploadResult.secure_url,
                        aiImageURL: aiImageUrl,
                        metadata: {
                          originalDescription: description,
                          remixedPrompt,
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

                console.log('Successfully saved to database:', imagePairDoc._id);
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
                    aiImageURL: aiImageUrl,
                    metadata: {
                      originalDescription: description,
                      remixedPrompt
                    }
                  },
                  imagePairDoc
                });
              } catch (dbError) {
                console.error('Database error:', dbError);
                throw new Error(`Failed to save to database: ${dbError.message}`);
              }
            } catch (dateError) {
              console.error('Date scheduling error:', dateError);
              throw new Error(`Failed to schedule date: ${dateError.message}`);
            }
          } catch (aiError) {
            console.error('AI generation error:', aiError);
            throw new Error(`Failed to generate AI image: ${aiError.message}`);
          }
        } catch (descriptionError) {
          console.error('Description generation error:', descriptionError);
          throw new Error(`Failed to generate description: ${descriptionError.message}`);
        }
      } catch (uploadError) {
        console.error('Cloudinary upload error:', uploadError);
        throw new Error(`Failed to upload to Cloudinary: ${uploadError.message}`);
      }
    } catch (resizeError) {
      console.error('Image resize error:', resizeError);
      throw new Error(`Failed to resize image: ${resizeError.message}`);
    }
  } catch (error) {
    console.error('Upload Error:', error);
    sendProgress(sessionId, `Error: ${error.message}`);
    
    // Close the SSE connection on error
    if (global.progressStreams?.has(sessionId)) {
      const stream = global.progressStreams.get(sessionId);
      stream.end();
      global.progressStreams.delete(sessionId);
    }
    
    // Send detailed error information
    res.status(500).json({ 
      error: error.message || 'Failed to process image pair',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      details: error.details || undefined
    });
  }
});

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
