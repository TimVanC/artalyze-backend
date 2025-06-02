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
          role: "system",
          content: `You are an expert art prompt engineer. Your goal is to create prompts that maintain artistic fidelity while introducing creative variations.

Key rules:
1. NEVER use "turtle" as a subject - it's overused
2. Choose subjects that match the scale, tone, and context of the original
3. Maintain the exact same artistic medium and style
4. Keep color and setting changes subtle and artistically relevant
5. Vary sentence structure - avoid starting with "This artwork features..."
6. Preserve aspect ratio and composition type`
        },
        {
          role: "user",
          content: `Original artwork description: '${caption}'

Create a remixed version that:
1. Maintains the exact medium (e.g., if it's a pencil sketch, keep it a pencil sketch)
2. Preserves the artistic style and technique
3. Changes the subject to something contextually appropriate:
   - If it's an animal → use a different species of similar size/type
   - If it's a person → change pose/activity but keep human
   - If it's an object → use a similar object in function/scale
4. Makes minimal, artistically relevant changes to colors/setting
5. Uses varied, natural language (avoid repetitive phrasing)

Keep the prompt concise and vivid, under 100 words.`
        }
      ],
      max_tokens: 150,
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
          role: "system",
          content: "You are an expert art analyst. Analyze artworks in detail, focusing on medium, style, composition, and artistic elements. Be precise and thorough in your descriptions."
        },
        {
          role: "user",
          content: [
            { 
              type: "text", 
              text: `Analyze this artwork and provide a detailed description covering:
1. Medium and technique (e.g., oil painting, watercolor, digital art, photograph, sketch)
2. Artistic style (e.g., realistic, abstract, impressionist, cartoon)
3. Subject matter and composition
4. Color palette and lighting
5. Texture and brushwork (if applicable)
6. Mood and atmosphere

Keep the description clear and concise, under 100 words.` 
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
      max_tokens: 200,
      temperature: 0.7
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