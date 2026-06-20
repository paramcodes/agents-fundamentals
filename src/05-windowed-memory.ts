// install: npm i groq-sdk
import Groq from "groq-sdk";
import * as readline from "readline";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- tools (your "skills") ---

function add(a: number, b: number): number { return a + b; }
function multiply(a: number, b: number): number { return a * b; }
function power(base: number, exp: number): number {
  if (exp > 10) throw new Error("can't compute, too large.");
  return base ** exp;
}

// OpenAI/Groq tool format = plain JSON Schema, no `Type.OBJECT` enum
const tools = [
  {
    type: "function" as const,
    function: {
      name: "add",
      description: "adds two numbers",
      parameters: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" }
        },
        required: ["a", "b"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "multiply",
      description: "multiply two numbers",
      parameters: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" }
        },
        required: ["a", "b"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "power",
      description: "find power of given number",
      parameters: {
        type: "object",
        properties: {
          base: { type: "number" },
          exp: { type: "number" }
        },
        required: ["base", "exp"]
      }
    }
  }
];

function executeTool(name: string, args: Record<string, any>): { 
  success: boolean; 
  result: string 
} {
  try {
    if (name === "add") return { success: true, result: String(add(args.a, args.b)) };
    if (name === "multiply") return { success: true, result: String(multiply(args.a, args.b)) };
    if (name === "power") return { success: true, result: String(power(args.base, args.exp)) };
    return { success: false, result: `Unknown tool: ${name}` };
  } catch (err) {
    return { 
      success: false, 
      result: `Tool '${name}' failed: ${(err as Error).message}` 
    };
  }
}

// OpenAI-style memory: system is a separate field, messages are flat
const SYSTEM_PROMPT = "You are a math assistant. Never guess — only use tools.";

// each entry: { role, content, tool_calls? } | { role: "tool", tool_call_id, content }
const memory: any[] = []; // populated as the convo goes
const turnSizes:number[] = [];


async function runAgent(userMessage: string) {
    const turnStart = memory.length;

  memory.push({ role: "user", content: userMessage });

  let iterations = 0;
  const MAX_ITERATIONS = 5;

  while (true) {

    if (iterations >= MAX_ITERATIONS) {
      console.log("→ ⚠ max iterations reached, forcing stop");
      memory.push({ 
        role: "assistant", 
        content: "I wasn't able to complete this in time. Please rephrase." 
      });
      break;
    }
    iterations++;

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",  // Groq's best tool-using model on free tier
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...memory
      ],
      tools,
      tool_choice: "auto",            // let model decide when to call
      parallel_tool_calls: false       // simpler for learning; flip to true later
    });

    const msg = response.choices[0].message;
    memory.push(msg); // assistant message (may include tool_calls)

    // no tool call -> final answer
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      console.log("Agent:", msg.content);
      break;
    }

    // execute each tool call, then push a "tool" message per call
    for (const call of msg.tool_calls) {
      const name = call.function.name;
      // Groq returns args as a JSON string; OpenAI does too actually
      const args = JSON.parse(call.function.arguments || "{}");
      const { success, result } = executeTool(name, args);
      console.log(success ? `→ ✓ ${name}: ${result}` : `→ ✗ ${name}: ${result}`);

      memory.push({
        role: "tool",
        tool_call_id: call.id,        // must match the assistant's tool_call.id
        content: result               // tool result MUST be a string
      });
    }
    // loop again so the model sees the tool outputs and produces a final answer
  }
  turnSizes.push(memory.length-turnStart);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const MAX_TURNS = 2;

function ask() {
  rl.question("\nYou: ", async (input) => {
    if (input.toLowerCase() === "exit") { rl.close(); return; }
    await runAgent(input);

    // trim old turns (keep first user/assistant pair as "context anchor")
    // system isn't in `memory` here, so just bound the user/assistant/tool messages
    if (turnSizes.length > MAX_TURNS) {
      const oldest = turnSizes.shift();
        memory.splice(0, oldest); // drop the oldest user+assistant+tool group
    }
    ask();
  });
}

ask();