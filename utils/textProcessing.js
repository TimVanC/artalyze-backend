const OpenAI = require('openai');

// Initialize OpenAI with API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Remixes a caption into a unique prompt using GPT-4o
 * @param {string} caption - The original caption
 * @returns {Promise<string>} - The remixed prompt
 */
const remixCaption = async (caption) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `This is a caption of a painting: '${caption}'

Please rewrite this prompt with the following creative changes:
1. Change the subject to something entirely different (e.g., rabbit → turtle, frog, cat, etc.).
2. Change the setting or background (e.g., forest → kitchen, moon, ballroom, desert).
3. Swap out any specific colors with new ones (e.g., red → teal).
4. Keep the overall art style and tone.
5. Keep the prompt concise and vivid, under 30 words.`
        }
      ],
      max_tokens: 100,
      temperature: 0.8
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error remixing caption:', error);
    // Return original caption if remix fails
    return caption;
  }
};

/**
 * Generates a description of an image using GPT-4o
 * @param {string} imageUrl - URL of the image to describe
 * @returns {Promise<string>} - The generated description
 */
const generateImageDescription = async (imageUrl) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { 
              type: "text", 
              text: "Describe this artwork in detail, focusing on its artistic style, composition, and subject matter. Be specific but concise." 
            },
            {
              type: "image_url",
              image_url: {
                url: imageUrl
              }
            }
          ],
        },
      ],
      max_tokens: 150,
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Error generating description:', error);
    throw new Error(`Failed to generate description: ${error.message}`);
  }
};

module.exports = {
  remixCaption,
  generateImageDescription
}; 