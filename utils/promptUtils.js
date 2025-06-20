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
        content: `This prompt will be used to generate an image that should convincingly pass as human-made in a side-by-side guessing game. It should reflect the subject and artistic style of the original image, including imperfections or natural variations typical of a human-made work.

Your task is to create prompts that:
1. Specify an artistic medium (e.g., "film photograph", "oil painting", "watercolor", "charcoal sketch")
2. Mention texture, lighting, and material details (e.g., "visible brushstrokes," "soft glare," "grainy finish," "washed out tones")
3. Avoid sterile compositions or perfect symmetry - include framing imperfections, slight asymmetry, or natural object placement
4. Favor grounded realism - avoid anything overly surreal or fantastical unless the original is clearly abstract or surreal
5. Target ~15+ words, max 100 characters - specific but compact, avoid repetition or overly generic descriptions`
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
- Includes medium-specific details and natural imperfections

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