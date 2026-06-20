import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- tools (your "skills" the agent can use) ---

function add(a:number,b:number):number{
    return (a+b);
}

function multiply(a:number,b:number):number{
    return (a*b);
}

function power(base:number,exp:number):number{
    if(exp > 10)throw new Error("can't compute, too large.")
    return (base**exp);
}

const tools = [{
  functionDeclarations: [
    {
      name: "add",
      description: "adds two numbers",
      parameters: {
        type: Type.OBJECT,
        properties: { a: { type: Type.NUMBER },b:{type:Type.NUMBER} },
        required: ['a','b']
      }
    },
    {
      name: "multiply",
      description: "multiply two numbers",
      parameters: {
        type: Type.OBJECT,
        properties: { a: { type: Type.NUMBER },b:{type:Type.NUMBER} },
        required: ["a","b"]
      }
    },
    {
      name: "power",
      description: "find power of given number",
      parameters: {
        type: Type.OBJECT,
        properties: { base: { type: Type.NUMBER },exp:{type:Type.NUMBER} },
        required: ["base","exp"]
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
    if (name === "add") return { success: true, result: String(add(args.a,args.b) )};
    if (name === "multiply") return { success: true, result: String(multiply(args.a,args.b)) };
    if (name === "power") return { success: true, result: String(power(args.base,args.exp)) };
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
      text: `You are a genius math assistant. You help users calculate computations quickly and accurately. 
When a tool fails, always tell the user clearly what you could not retrieve and why. 
Never guess or make up data — only use what the tools return.`
    }]
  },
  {
    role: "model",
    parts: [{ text: "Understood. I'll help with math computation using the available tools and will always be transparent about any failures." }]
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
await runAgent("What is (3 + 4) multiplied by 2, and what is 2 to the power of 15?");