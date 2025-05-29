// routes/adminRoutes.js
const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose'); // ✅ Fix: Import mongoose
const ImagePair = require('../models/ImagePair');
const { authenticateToken, authorizeAdmin } = require('../middleware/authMiddleware');
const router = express.Router();
const streamifier = require('streamifier');
const adminController = require('../controllers/adminController');
const sharp = require('sharp');

// Configure file upload storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Dynamically select collection name based on environment
const collectionName = process.env.NODE_ENV === "staging" ? "staging_imagePairs" : "imagePairs";
const ImagePairCollection = mongoose.model(collectionName, ImagePair.schema);

// ✅ Ensure `ImagePairCollection` is available to all routes if needed
router.use((req, res, next) => {
  req.ImagePairCollection = ImagePairCollection;
  next();
});

// Cloudinary setup (ensure environment variables are configured)
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

// Upload human image for automated pairing
router.post('/upload-human-image', upload.single('humanImage'), async (req, res) => {
  try {
    const { scheduledDate } = req.body;
    if (!scheduledDate) {
      return res.status(400).json({ error: 'Scheduled date must be provided.' });
    }

    const humanImage = req.file;
    if (!humanImage) {
      return res.status(400).json({ error: 'Human image must be provided.' });
    }

    // Resize image before uploading
    const resizedBuffer = await resizeImage(humanImage.buffer);

    // Upload to Cloudinary's humanImages folder
    const humanUploadResult = await uploadToCloudinary(resizedBuffer, 'artalyze/humanImages');

    if (!humanUploadResult?.secure_url) {
      return res.status(500).json({ error: 'Failed to upload image to Cloudinary' });
    }

    res.json({ 
      message: 'Human image uploaded successfully',
      imageUrl: humanUploadResult.secure_url 
    });

  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: 'Failed to upload human image' });
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
      return res.status(404).json({ error: 'No image pairs found for this date' });
    }

    res.status(200).json(imagePairs);
  } catch (error) {
    console.error('Error fetching image pairs:', error);
    res.status(500).json({ message: 'Failed to fetch image pairs' });
  }
});

module.exports = router;
