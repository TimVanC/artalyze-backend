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

// POST endpoint for uploading or updating an image pair
router.post('/upload-image-pair', upload.fields([{ name: 'humanImage' }, { name: 'aiImage' }]), async (req, res) => {
  try {
    const { scheduledDate, pairIndex } = req.body;
    if (!scheduledDate) {
      return res.status(400).json({ error: 'Scheduled date must be provided.' });
    }
    
    const date = new Date(scheduledDate);
    // Set to 12:00 AM EST (or EDT depending on the season)
    const isDaylightSaving = date.getMonth() >= 2 && date.getMonth() <= 10; // March to November
    if (isDaylightSaving) {
      date.setUTCHours(4, 0, 0, 0); // 4:00 AM UTC for EDT
    } else {
      date.setUTCHours(5, 0, 0, 0); // 5:00 AM UTC for EST
    }
    
    // Upload images to Cloudinary
    const humanImage = req.files['humanImage']?.[0];
    const aiImage = req.files['aiImage']?.[0];
    
    if (!humanImage || !aiImage) {
      return res.status(400).json({ error: 'Both images must be provided.' });
    }
    
    const humanUploadResult = await uploadToCloudinary(humanImage.buffer, 'artalyze/humanImages');
    const aiUploadResult = await uploadToCloudinary(aiImage.buffer, 'artalyze/aiImages');
    
    // Check if an entry for the scheduled date already exists
    let imagePairDocument = await ImagePair.findOne({ scheduledDate: date });
    
    if (imagePairDocument) {
      // Use MongoDB `$set` to update specific pair index, avoiding VersionError
      const updatedDocument = await ImagePair.findOneAndUpdate(
        { scheduledDate: date },
        {
          $set: {
            [`pairs.${pairIndex}.humanImageURL`]: humanUploadResult.secure_url,
            [`pairs.${pairIndex}.aiImageURL`]: aiUploadResult.secure_url,
          },
        },
        { new: true, upsert: true }
      );
    
      res.json({ message: 'Image pair updated successfully', data: updatedDocument });
    }
    
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: 'Failed to upload image pair' });
  }
});

module.exports = router;
