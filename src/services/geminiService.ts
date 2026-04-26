import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const extractRecipeFromImage = async (base64Data: string, mimeType: string) => {
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{
      parts: [
        { inlineData: { data: base64Data, mimeType } },
        { text: "請從這張食譜照片中提取資訊，並以 JSON 格式返回。包含食譜標題 (title)、描述 (description)、主要分類 (mainCategory)、次要分類 (subCategory)、食材列表 (ingredients: {name, amount, unit})、步驟列表 (steps: {content})、烘焙階段 (bakingStages: {temp, time}) 以及筆記 (notes)。食材數量 (amount) 必須是數字。" }
      ]
    }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          mainCategory: { type: Type.STRING },
          subCategory: { type: Type.STRING },
          ingredients: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, amount: { type: Type.NUMBER }, unit: { type: Type.STRING } }, required: ["name", "amount", "unit"] } },
          steps: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { content: { type: Type.STRING } }, required: ["content"] } },
          bakingStages: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { temp: { type: Type.STRING }, time: { type: Type.STRING } }, required: ["temp", "time"] } },
          notes: { type: Type.STRING }
        },
        required: ["title", "ingredients", "steps"]
      }
    }
  });
  return JSON.parse(response.text || "{}");
};
