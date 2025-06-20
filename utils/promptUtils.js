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
        content: `You are an expert prompt engineer for creating images that must convincingly pass as human-made in a side-by-side guessing game. Your prompts should generate images that look authentically human-created, not AI-generated.

CRITICAL RULES FOR PHOTOGRAPHS:
- Use "film photograph" or "digital photograph" as the medium (not just "photo")
- Include realistic photographic elements: "natural lighting", "slight grain", "lens distortion", "minor blur", "realistic shadows"
- Specify camera characteristics: "taken with a camera", "realistic perspective", "authentic colors"
- AVOID: "hyper-realistic", "professional photo", "perfect lighting" (these create uncanny AI tells)
- AVOID: "3D render", "digital art", "illustration" (these are AI tells)

CRITICAL RULES FOR PAINTINGS:
- Specify actual painting medium: "oil painting on canvas", "watercolor on paper", "acrylic painting"
- Include paint characteristics: "visible brushstrokes", "paint texture", "canvas grain", "paint drips"
- AVOID: "photo of a painting", "render of painting" (these are AI tells)

CRITICAL RULES FOR DIGITAL ART:
- Specify digital medium: "digital illustration", "digital art", "digital composition"
- AVOID: Photographic realism unless specifically requested

GENERAL RULES:
1. Specify artistic medium clearly (film photograph, oil painting, digital art, etc.)
2. Include texture, lighting, and material details specific to the medium
3. Add natural imperfections: slight asymmetry, framing issues, medium-specific flaws
4. Favor grounded realism over perfect compositions
5. Target 15-25 words, max 100 characters
6. Use technical language that DALL-E 3 understands
7. NEVER generate phrases that suggest AI creation or 3D rendering`
      }, {
        role: "user",
        content: `You are given a caption describing a piece of visual art:

"${caption}"

Create a new prompt for a different, creatively distinct piece of art that:
- Uses the EXACT same artistic medium (photograph stays photograph, painting stays painting)
- Stays in the same category or subject type (architecture → building, animal → different animal)
- Changes the specific subject (not the exact same house or animal)
- Keeps the tone grounded and believable — no fantasy unless the original is surreal
- Keeps the result concise (under 100 characters)
- Includes medium-specific details and natural imperfections
- AVOIDS any phrases that would create AI tells or uncanny perfection

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