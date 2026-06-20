import Groq from "groq-sdk";


const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function webSearch(topic: string): string { return `Search results for "${topic}": [simulated data — pollution sources, statistics, and contributing factors related to this specific angle]`; }

const tools = [
    {
    type: "function" as const,
    function: {
      name: "websearch",
      description: "searches the web for given topic",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string" },
        },
        required: ["topic"]
      }
    }
  }
]

function executeTool(name: string, args: Record<string, any>): { 
  success: boolean; 
  result: string 
} {
  try {
    if (name === "websearch") return { success: true, result: String(webSearch(args.topic)) };
    return { success: false, result: `Unknown tool: ${name}` };
  } catch (err) {
    return { 
      success: false, 
      result: `Tool '${name}' failed: ${(err as Error).message}` 
    };
  }
}


async function runAgent(topic: string) {

    const messages: any[] = [
        { role: "system", content: `You are a research agent. Given a topic, search for information using the websearch tool and summarize findings.\n\nTopic: ${topic}` },
        { role: "user", content: `Research this: ${topic}` }
    ];

    let iterations = 0;
    const MAX_ITERATIONS = 5;

  while (true) {

    if (iterations >= MAX_ITERATIONS) {
      console.log("→ ⚠ max iterations reached, forcing stop");
      break;
    }
    iterations++;

    let response;
    try{
        response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages,
        tools,
        tool_choice: "auto",
        parallel_tool_calls: false
        });
    } catch(err){
        console.log(`→ ⚠ API call failed: ${(err as Error).message}`);
        return `Research on "${topic}" failed due to a tool-calling error.`;
    }
    const msg = response.choices[0]?.message;
    messages.push(msg);

    // no tool call -> final answer
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg?.content ?? "";
    }

    // execute each tool call, then push a "tool" message per call
    for (const call of msg.tool_calls) {
      const name = call.function.name;
      // Groq returns args as a JSON string; OpenAI does too actually
      const args = JSON.parse(call.function.arguments || "{}");
      const { success, result } = executeTool(name, args);
      console.log(success ? `→ ✓ ${name}: ${result}` : `→ ✗ ${name}: ${result}`);

      messages.push({          // ← THIS was missing — push the tool result
        role: "tool",
        tool_call_id: call.id,
        content: result
      });
    }
  }
}

// 1. planner — plain LLM call, returns a list of sub-topics to research
async function planResearch(topic: string): Promise<string[]> {
  // prompt: given this topic, break it into 2-3 focused research angles
  // return JSON array of strings
  const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: `
            You are a Planning agent, given this topic, break it into 2-3 focused research angles

            
            Return raw JSON only no markdown,no backticks,nothing else,:
            {
            "angles": ["<focused research angles>"]
            }
                
            Topic:${topic}
        ` },
      ],
    });
    
    let msg = await response.choices[0]?.message?.content;
    return JSON.parse(msg).angles;
}

// 2. worker — ReAct loop with a search tool (reuse your existing loop pattern)
async function researchAgent(angle: string): Promise<string> {
  // run a mini agent loop with a fake search tool (simulate web results for now)
  // return findings as a string
  const result = await runAgent(angle);
  return result;
}

// 3. aggregator — plain LLM call, no tools
async function writeReport(topic: string, findings: string[]): Promise<string> {
  // prompt: synthesize into one coherent report, handle conflicts/redundancy
  const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: `
            You are writing a final report. You have Following research findings below, 
            possibly overlapping or conflicting. Your job:

            1. Identify any conflicting facts between sources and note the conflict 
            explicitly rather than picking one arbitrarily
            2. Remove redundant points that appear in multiple findings
            3. Organize into a coherent narrative with clear sections
            4. Write in one consistent voice — the user should not be able to tell 
            three different searches happened

            ${findings.map((f,ind)=>`Finding ${ind+1}: ${f}`)}

            Write the final report now.
        ` },
      ],
    });
    
    let msg = await response.choices[0]?.message?.content;
    return msg ?? "";
}

// 4. orchestrator — ties it together
async function runResearchAgent(topic: string) {
  const angles = await planResearch(topic);
  console.log("Planned angles:", angles);

  const findings = await Promise.all(angles.map(a => researchAgent(a)));
  console.log("Worker findings:", findings);

  const report = await writeReport(topic, findings);
  console.log("\nFinal report:\n", report);
}

runResearchAgent("Analyze the causes of rise of pollution in Delhi");