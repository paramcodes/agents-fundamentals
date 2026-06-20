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

// persistent memory across turns
const memory: any[] = [
  {
    role: "user",
    parts: [{ text: "You are a math assistant. Never guess — only use tools." }]
  },
  {
    role: "model", 
    parts: [{ text: "Understood." }]
  }
];

async function runAgent(userMessage: string) {
  // append new message to existing memory
  memory.push({ role: "user", parts: [{ text: userMessage }] });

  while (true) {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: memory,  // ← send full history every time
      config: { tools }
    });

    const parts = response.candidates![0].content.parts;
    memory.push({ role: "model", parts });

    const functionCalls = parts.filter((p: any) => p.functionCall);

    if (functionCalls.length === 0) {
      console.log("Agent:", response.text);
      break;
    }

    const toolResults: any[] = [];
    for (const part of functionCalls) {
      const { name, args, id } = part.functionCall;
      const { success, result } = executeTool(name, args);
      console.log(success ? `→ ✓ ${name}: ${result}` : `→ ✗ ${name}: ${result}`);
      toolResults.push({ functionResponse: { name, response: { result }, id } });
    }

    memory.push({ role: "user", parts: toolResults });
  }
}

// now wire it to a CLI loop
import * as readline from "readline";

const rl = readline.createInterface({ 
  input: process.stdin, 
  output: process.stdout 
});

function ask() {
  rl.question("\nYou: ", async (input) => {
    if (input.toLowerCase() === "exit") { rl.close(); }
    await runAgent(input);
    ask(); // loop back
  });
}

ask();