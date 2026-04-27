const API_KEY = process.env.GEMINI_API_KEY;
const SITE_URL = 'https://achuchu-commits.github.io/bakery-manager/';

export const extractRecipeFromImage = async (base64Data: string, mimeType: string) => {
  if (!API_KEY) throw new Error('API 金鑰未設定，請確認 GitHub Secret 已正確設定');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': SITE_URL,
    },
    body: JSON.stringify({
      model: 'qwen/qwen2.5-vl-72b-instruct:free',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Data}` }
            },
            {
              type: 'text',
              text: `請仔細辨識這張烘焙食譜照片（可能是手寫筆記或印刷版），盡力提取所有可見資訊，只回傳 JSON 格式，不要加任何說明文字。

規則：
- title：食譜名稱，若不清楚請用「未命名食譜」
- ingredients 的 amount 必須是純數字（例如 100 而非 "100g"），單位另外放在 unit
- unit 常見值：g、ml、個、顆、片、匙、杯、適量
- bakingStages 請填溫度（如「上火180 下火160」）和時間（如「25分鐘」）
- steps 請依序列出每個製作步驟
- 看不清楚的欄位請填空字串，不要亂猜
- notes 可填入食譜備注、份量說明等

回傳格式：
{
  "title": "",
  "description": "",
  "mainCategory": "",
  "subCategory": "",
  "ingredients": [{"name": "", "amount": 0, "unit": ""}],
  "steps": [{"content": ""}],
  "bakingStages": [{"temp": "", "time": ""}],
  "notes": ""
}`
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(JSON.stringify(err));
  }

  const data = await response.json();
  const text: string = data.choices?.[0]?.message?.content || '{}';

  // 去除 markdown code block（有時模型會包 ```json ... ```）
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
};
