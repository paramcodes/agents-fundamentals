import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- tools (your "skills" the agent can use) ---

function get_weather(city: string): string {
  return `${city}: 38°C, sunny`;
}

function get_population(city: string): string {
  return `${city} has a population of approximately 32 million.`;
}

function get_traffic(city: string): string {
  throw new Error(`Traffic API is down for ${city}`);
}

const tools = [{
  functionDeclarations: [
    {
      name: "get_weather",
      description: "Get current weather for a city",
      parameters: {
        type: Type.OBJECT,
        properties: { city: { type: Type.STRING } },
        required: ["city"]
      }
    },
    {
      name: "get_population",
      description: "Get the population of a city",
      parameters: {
        type: Type.OBJECT,
        properties: { city: { type: Type.STRING } },
        required: ["city"]
      }
    },
    {
      name: "get_traffic",
      description: "Get the traffic of a city",
      parameters: {
        type: Type.OBJECT,
        properties: { city: { type: Type.STRING } },
        required: ["city"]
      }
    }
  ]
}];

// --- tool executor (maps name → actual function) ---

// function executeTool(name: string, args: Record<string, any>): string {
//   if (name === "get_weather") return get_weather(args.city);
//   if (name === "get_population") return get_population(args.city);
//   if (name == "get_traffic") return get_traffic(args.city);
//   return `Unknown tool: ${name}`;
// }

// --- tool executor with error handling ---

function executeTool(name: string, args: Record<string, any>): { 
  success: boolean; 
  result: string 
} {
  try {
    if (name === "get_weather") return { success: true, result: get_weather(args.city) };
    if (name === "get_population") return { success: true, result: get_population(args.city) };
    if (name === "get_traffic") return { success: true, result: get_traffic(args.city) };
    return { success: false, result: `Unknown tool: ${name}` };
  } catch (err) {
    return { 
      success: false, 
      result: `Tool '${name}' failed: ${(err as Error).message}` 
    };
  }
}

// --- the agent loop ---

async function runAgent(userMessage: string) {
  console.log(`\nUser: ${userMessage}\n`);

  const contents: any[] = [
    {
    role: "user",
    parts: [{
      text: `You are a city information assistant. You help users get weather, population, and traffic data for Indian cities. 
When a tool fails, always tell the user clearly what you could not retrieve and why. 
Never guess or make up data — only use what the tools return.`
    }]
  },
  {
    role: "model",
    parts: [{ text: "Understood. I'll help with city information using the available tools and will always be transparent about any failures." }]
  },
    { role: "user", parts: [{ text: userMessage }] }
  ];

  while (true) {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents,
      config: { tools }
    });

    const candidate = response.candidates![0];
    const parts = candidate.content.parts;

    // push model's response into conversation history
    contents.push({ role: "model", parts });

    // check if there are any function calls in this response
    const functionCalls = parts.filter((p: any) => p.functionCall);

    if (functionCalls.length === 0) {
      // no tool calls = gemini is done, return final answer
      console.log("Agent:", response.text);
      break;
    }

    // execute every tool gemini asked for
    const toolResults: any[] = [];

    for (const part of functionCalls) {
      const { name, args, id } = part.functionCall;
      console.log(`→ calling ${name}(${JSON.stringify(args)})`);
      // const result = executeTool(name, args);
      // console.log(`← ${result}`);
      const { success, result } = executeTool(name, args);
  
      // log differently based on success/failure
      if (success) {
        console.log(`← ✓ ${result}`);
      } else {
        console.log(`← ✗ ${result}`);
      }

      toolResults.push({
        functionResponse: { name, response: { result }, id }
      });
    }

    // send all tool results back in one shot
    contents.push({ role: "user", parts: toolResults });

    // loop continues — gemini will either call more tools or give final answer
  }
}

// test it with a question that needs both tools
// await runAgent("What's the weather in Delhi and how many people live there?");
await runAgent("Compare the traffic in Delhi and Mumbai");