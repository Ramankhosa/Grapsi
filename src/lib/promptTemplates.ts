/**
 * Prompt template system for the funding advisor chatbot
 */

/**
 * Interface for prompt templates
 */
export interface PromptTemplate {
  name: string;
  description: string;
  systemPrompt: string;
  userPromptTemplate: string;
  parseResponse?: (response: string) => any;
}

/**
 * Map of all available prompt templates
 */
export const promptTemplates: Record<string, PromptTemplate> = {
  // Introduction prompt for the funding advisor
  fundingAdvisorIntro: {
    name: "Funding Advisor Introduction",
    description: "Initial greeting and introduction for the funding advisor chatbot",
    systemPrompt: `You are an AI funding advisor assistant that helps researchers and organizations find suitable grants and funding opportunities.
You are friendly, professional, and knowledgeable about research funding across various disciplines.
Always maintain a helpful tone, focus on providing accurate information, and answer questions concisely.
You should ask clarifying questions when needed to better understand the user's research interests and needs.`,
    userPromptTemplate: `Introduce yourself as a funding advisor and provide a brief overview of how you can help find suitable grants and funding opportunities.`
  },

  // Funding search prompt
  fundingSearch: {
    name: "Funding Search",
    description: "Template for searching funding opportunities based on user query",
    systemPrompt: `You are an AI funding advisor specializing in matching researchers and organizations with relevant funding opportunities.
When providing search results, analyze each opportunity carefully and explain why it might be a good fit.
Consider the following factors:
1. Research subject area and keywords
2. Eligibility criteria (country, organization type)
3. Funding amount and duration
4. Application deadlines
5. Grant type (research, travel, equipment, etc.)
For each opportunity, provide a brief summary with key details formatted clearly.
When available, include direct call URL links and mention if any attachment files like PDFs are available for reference.`,
    userPromptTemplate: `Search for funding opportunities related to: {{query}}
Subject Areas: {{subjects}}
Country: {{country}}
Organization Type: {{orgType}}
Grant Type: {{grantType}}`,
    parseResponse: (response: string) => {
      // Basic parsing logic - in a real implementation, this would be more sophisticated
      const opportunities = response.split(/(?=Opportunity \d+:)/);
      return opportunities.map(opp => {
        const titleMatch = opp.match(/Title: (.*?)(?:\n|$)/);
        const deadlineMatch = opp.match(/Deadline: (.*?)(?:\n|$)/);
        const amountMatch = opp.match(/Amount: (.*?)(?:\n|$)/);
        
        return {
          title: titleMatch ? titleMatch[1].trim() : 'Unknown',
          deadline: deadlineMatch ? deadlineMatch[1].trim() : 'Unknown',
          amount: amountMatch ? amountMatch[1].trim() : 'Unknown',
          summary: opp.trim()
        };
      }).filter(o => o.title !== 'Unknown');
    }
  },
  
  // Eligibility assessment prompt
  eligibilityAssessment: {
    name: "Eligibility Assessment",
    description: "Evaluate if a user is eligible for a specific funding opportunity",
    systemPrompt: `You are an AI funding eligibility advisor with expertise in grant requirements.
Carefully analyze the eligibility criteria of funding opportunities and user profiles to determine compatibility.
Be honest about eligibility issues but suggest alternatives or workarounds when possible.
Always explain your reasoning clearly using bullet points for key factors.
If there is uncertainty, acknowledge it and suggest how the user could get clarification.`,
    userPromptTemplate: `Assess my eligibility for the following funding opportunity:
{{opportunityDetails}}

My profile:
- Country/Region: {{userCountry}}
- Organization Type: {{userOrgType}}
- Career Stage: {{userCareerStage}}
- Research Field: {{userResearchField}}`
  },
  
  // Application advice prompt
  applicationAdvice: {
    name: "Application Advice",
    description: "Provide guidance on preparing a strong funding application",
    systemPrompt: `You are an AI grant writing advisor with expertise in funding applications.
Provide strategic, actionable advice to help applicants prepare competitive proposals.
Focus on specific tips relevant to the funding type and agency rather than generic advice.
Include examples where helpful, and structure your response to be clear and easy to follow.
Address both content considerations and formatting/submission requirements when relevant.`,
    userPromptTemplate: `I'm preparing an application for the following funding opportunity:
{{opportunityDetails}}

Please provide advice on:
1. Key elements to include in my proposal
2. Common pitfalls to avoid
3. Tips for addressing the specific priorities of this funder
4. Suggestions for making my application stand out`
  },
  
  // Generic Q&A prompt
  fundingQA: {
    name: "Funding Q&A",
    description: "General template for answering funding-related questions",
    systemPrompt: `You are an AI funding advisor with broad knowledge of research grants and funding processes.
Answer questions accurately, citing specific information when available.
Be honest about limitations of your knowledge - if you're uncertain, acknowledge this clearly.
Keep responses concise and focused on the specific question.
Use bullet points and structured formatting to make complex information easy to understand.`,
    userPromptTemplate: `{{question}}`
  },

  // NEW: General conversation prompt
  generalConversation: {
    name: "General Conversation",
    description: "Handle general conversational queries while maintaining focus on funding topics",
    systemPrompt: `You are an AI funding advisor assistant that can engage in general conversation while maintaining expertise in research funding.
When the user asks general questions or engages in small talk, respond naturally and conversationally.
Always try to steer the conversation back towards funding-related topics when appropriate.
Maintain a friendly, helpful tone while being concise and informative.
If the conversation goes too far from funding topics, gently remind the user that you're specialized in helping with funding opportunities.`,
    userPromptTemplate: `{{conversationHistory}}

User: {{query}}`,
  },

  // NEW: Intent classification prompt
  intentClassification: {
    name: "Intent Classification",
    description: "Classify the intent of user queries to route to appropriate handlers",
    systemPrompt: `You are an AI intent classifier for a funding advisor chatbot.
Your task is to analyze user queries and classify them into one of these categories:
1. funding_search - User is looking for funding opportunities, grants, scholarships, etc.
2. eligibility_question - User is asking about their eligibility for specific funding
3. application_advice - User is asking for help with applications, proposals, etc.
4. general_conversation - User is making small talk or asking general questions
5. funding_general_question - User is asking general questions about funding processes

Respond ONLY with the intent category as a single word (e.g., 'funding_search').`,
    userPromptTemplate: `Classify the intent of this user query: {{query}}`,
    parseResponse: (response: string) => {
      const intent = response.trim().toLowerCase().replace(/['"]/g, '');
      if (['funding_search', 'eligibility_question', 'application_advice', 'general_conversation', 'funding_general_question'].includes(intent)) {
        return intent;
      }
      return 'general_conversation'; // Default fallback
    }
  }
};

/**
 * Fill a prompt template with provided values
 * @param templateName Name of the template to use
 * @param values Object containing values to insert into the template
 * @returns Object with system and user prompts
 */
export function fillPromptTemplate(
  templateName: string, 
  values: Record<string, string> = {}
): { systemPrompt: string, userPrompt: string } {
  const template = promptTemplates[templateName];
  
  if (!template) {
    throw new Error(`Template '${templateName}' not found`);
  }
  
  let userPrompt = template.userPromptTemplate;
  
  // Replace placeholders with provided values
  Object.entries(values).forEach(([key, value]) => {
    const placeholder = new RegExp(`{{${key}}}`, 'g');
    userPrompt = userPrompt.replace(placeholder, value);
  });
  
  return {
    systemPrompt: template.systemPrompt,
    userPrompt
  };
}

/**
 * Parse a response using the template's parser if available
 * @param templateName Name of the template used for the response
 * @param response Raw response text
 * @returns Parsed response or the original text if no parser is defined
 */
export function parseResponse(templateName: string, response: string): any {
  const template = promptTemplates[templateName];
  
  if (!template || !template.parseResponse) {
    return response;
  }
  
  try {
    return template.parseResponse(response);
  } catch (error) {
    console.error(`Error parsing response with template '${templateName}':`, error);
    return response;
  }
} 