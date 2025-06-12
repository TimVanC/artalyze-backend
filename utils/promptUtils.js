const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Generate a creative AI image prompt from a caption using GPT-4 Turbo
 * @param {string} caption Original image caption
 * @returns {Promise<string>} Generated prompt for AI image
 */
async function generateAiPrompt(caption) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{
        role: "system",
        content: `You are a precise art prompt engineer for Stable Diffusion XL. Your task is to create new prompts that maintain strict consistency with the original artwork's style and category while varying the specific subject.

Key principles:
1. Style consistency: If the original is photorealistic, abstract, watercolor, etc., maintain that exact style
2. Category consistency: Keep the same general category (e.g., architecture → building, animal → animal, landscape → landscape)
3. Subject variation: Change the specific subject while staying within the category
4. Grounded realism: Only include fantasy/surreal elements if present in the original
5. Conciseness: Keep prompts under 100 characters`
      }, {
        role: "user",
        content: `You are given a caption describing a piece of visual art:

"${caption}"

Create a new prompt for a different, creatively distinct piece of art that:
- Uses the same artistic style (e.g., photorealistic, watercolor, abstract, etc.)
- Stays in the same category or subject type (e.g., architecture → building, animal → different animal, abstract → abstract, landscape → landscape)
- Changes the specific subject (e.g., not the exact same house or animal)
- Keeps the tone grounded and believable — no fantasy unless the original is surreal
- Keeps the result concise (under 100 characters)

Return ONLY the prompt text with no explanation or additional text.`
      }],
      temperature: 0.7, // Reduced for more consistent outputs
      max_tokens: 100,
      top_p: 0.9,
      frequency_penalty: 0.5,
      presence_penalty: 0.5
    });

    const prompt = response.choices[0].message.content.trim();
    return prompt;

  } catch (error) {
    console.error('Error generating AI prompt:', error);
    throw error;
  }
}

module.exports = {
  generateAiPrompt
}; 