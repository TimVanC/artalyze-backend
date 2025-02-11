// routes/adminRoutes.js
const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const ImagePair = require('../models/ImagePair');
const { authenticateToken, authorizeAdmin } = require('../middleware/authMiddleware');
const router = express.Router();
const streamifier = require('streamifier');
const adminController = require('../controllers/adminController');

// Multer setup for file handling (store in memory)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Cloudinary setup (ensure environment variables are configured)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Helper function to upload to Cloudinary using a buffer stream
const uploadToCloudinary = (fileBuffer, folderName) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: folderName },
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

// Admin authentication route
router.post('/login', adminController.adminLogin);

router.post('/upload-image-pair', upload.fields([{ name: 'humanImage' }, { name: 'aiImage' }]), async (req, res) => {
  try {
    const { scheduledDate, pairIndex } = req.body;
    if (!scheduledDate) {
      return res.status(400).json({ error: 'Scheduled date must be provided.' });
    }

    const date = new Date(scheduledDate);
    date.setUTCHours(5, 0, 0, 0); // Standardize to UTC+5 (EST)

    // Ensure images exist
    const humanImage = req.files['humanImage']?.[0];
    const aiImage = req.files['aiImage']?.[0];
    if (!humanImage || !aiImage) {
      return res.status(400).json({ error: 'Both images must be provided.' });
    }

    // Upload images to Cloudinary
    let humanUploadResult, aiUploadResult;
    try {
      humanUploadResult = await uploadToCloudinary(humanImage.buffer, 'artalyze/humanImages');
      aiUploadResult = await uploadToCloudinary(aiImage.buffer, 'artalyze/aiImages');
    } catch (uploadError) {
      console.error('Cloudinary Upload Error:', uploadError);
      return res.status(500).json({ error: 'Image upload failed' });
    }

    // Ensure upload was successful
    if (!humanUploadResult?.secure_url || !aiUploadResult?.secure_url) {
      return res.status(500).json({ error: 'Failed to retrieve image URLs from Cloudinary' });
    }

    // Check if a document for the scheduled date exists
    let imagePairDocument = await ImagePair.findOne({ scheduledDate: date });
    if (imagePairDocument) {
      // Update existing image pair
      imagePairDocument.pairs[pairIndex] = {
        humanImageURL: humanUploadResult.secure_url,
        aiImageURL: aiUploadResult.secure_url,
      };
    } else {
      // Create new document
      imagePairDocument = new ImagePair({
        scheduledDate: date,
        pairs: [{
          humanImageURL: humanUploadResult.secure_url,
          aiImageURL: aiUploadResult.secure_url,
        }],
        status: 'pending'
      });
    }

    await imagePairDocument.save();
    res.json({ message: 'Image pair uploaded successfully', data: imagePairDocument });

  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: 'Failed to upload image pair' });
  }
});


// Add this route to `adminRoutes.js`
exports.getImagePairsByDate = async (req, res) => {
  try {
    const { date } = req.params;
    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }

    // Convert the date to match MongoDB storage
    const queryDate = new Date(date);
    queryDate.setUTCHours(5, 0, 0, 0); // Ensure correct timezone

    const imagePairs = await ImagePair.findOne({ scheduledDate: queryDate });
    if (!imagePairs) {
      return res.status(404).json({ error: 'No image pairs found for this date' });
    }

    res.status(200).json(imagePairs);
  } catch (error) {
    console.error('Error fetching image pairs:', error);
    res.status(500).json({ message: 'Failed to fetch image pairs' });
  }
};



module.exports = router;
