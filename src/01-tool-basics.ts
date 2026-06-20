import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function get_weather(city: string): string {
  return `${city}: 38°C, sunny`;
}

const tools = [{
  functionDeclarations: [{
    name: "get_weather",
    description: "Get the current weather for a city",
    parameters: {
      type: Type.OBJECT,
      properties: {
        city: { type: Type.STRING, description: "The city name" }
      },
      required: ["city"]
    }
  }]
}];

// Step 1: send the user message + tool definitions
const contents: any[] = [
  { role: "user", parts: [{ text: "What's the weather in Delhi?" }] }
];

const response1 = await ai.models.generateContent({
  model: "gemini-3.5-flash",
  contents,
  config: { tools }
});

console.log("First response:", JSON.stringify(response1.candidates?.[0]?.content, null, 2));

// Step 2: check if gemini wants to call a tool
const functionCall = response1.functionCalls?.[0];

if (functionCall) {
  console.log(`\nGemini wants to call: ${functionCall.name}`);
  console.log(`With args:`, functionCall.args);

  // Step 3: YOUR code executes the tool
  const toolResult = get_weather(functionCall.args.city as string);
  console.log(`Tool returned: ${toolResult}`);

  // Step 4: send the full conversation back — including what gemini said AND the tool result
  contents.push({ role: "model", parts: response1.candidates![0].content.parts });
  contents.push({
    role: "user",
    parts: [{
      functionResponse: {
        name: functionCall.name,
        response: { result: toolResult }
      }
    }]
  });

  // Step 5: get the final answer
  const response2 = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents,
    config: { tools }
  });

  console.log("\nFinal answer:", response2.text);
} else {
  console.log("No tool call, direct answer:", response1.text);
}