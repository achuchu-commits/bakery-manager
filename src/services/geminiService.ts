import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const extractRecipeFromImage = async (base64Data: string, mimeType: string) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 未設定，請確認 GitHub Secret 已正確設定');
  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [{
      parts: [
        { inlineData: { data: base64Data, mimeType } },
        { text: `請仔細辨識這張烘焙食譜照片（可能是手寫筆記或印刷版），盡力提取所有可見資訊，以 JSON 格式回傳。

規則：
- title：食譜名稱，若不清楚請用「未命名食譜」
- ingredients 的 amount 必須是純數字（例如 100 而非 "100g"），單位另外放在 unit
- unit 常見值：g、ml、個、顆、片、匙、杯、適量
- bakingStages 請填溫度（如「上火180 下火160」）和時間（如「25分鐘」）
- steps 請依序列出每個製作步驟
- 看不清楚的欄位請填空字串，不要亂猜
- notes 可填入食譜備注、份量說明等` }
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
