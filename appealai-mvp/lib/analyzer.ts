import type { AnalysisResult } from "./types";

const hasAny = (text: string, terms: string[]) => terms.some((term) => text.includes(term));

export function analyzeEvidence(raw: string): AnalysisResult {
  const text = raw.toLowerCase();

  if (hasAny(text, ["chargeback", "disputed charge", "unauthorized charge", "billing", "payment", "refund"])) {
    return {
      category: "Billing / Disputed Charge",
      confidence: "High",
      summary: "The notice appears connected to a payment dispute, chargeback, or billing review.",
      found: ["Billing-related language detected", "Moderation/support text supplied"],
      missing: ["Purchase receipt", "Transaction ID", "Bank/payment confirmation"],
    };
  }

  if (hasAny(text, ["harassment", "bullying", "threat", "abusive", "hate", "chat"])) {
    return {
      category: "Chat / Harassment",
      confidence: "High",
      summary: "The notice appears related to chat, harassment, abusive language, or user interactions.",
      found: ["Chat/moderation language detected", "Moderation/support text supplied"],
      missing: ["Relevant conversation context", "Date/time of incident", "Prior moderation notice if available"],
    };
  }

  if (hasAny(text, ["exploit", "cheat", "executor", "script", "modified client"])) {
    return {
      category: "Cheating / Exploiting",
      confidence: "High",
      summary: "The notice appears related to cheating, exploiting, or unauthorized software.",
      found: ["Exploit-related language detected", "Moderation/support text supplied"],
      missing: ["Exact moderation notice", "Account activity context", "Any compromise/security evidence"],
    };
  }

  if (hasAny(text, ["hacked", "compromised", "stolen", "unknown login", "security"])) {
    return {
      category: "Compromised Account",
      confidence: "High",
      summary: "The information suggests the account may have been compromised or used by someone else.",
      found: ["Security/compromise language detected", "User-provided text"],
      missing: ["Security alert emails", "Approximate compromise date", "Ownership/payment proof"],
    };
  }

  if (hasAny(text, ["sexual", "inappropriate content", "asset", "image", "avatar", "ugc"])) {
    return {
      category: "Content / Asset Moderation",
      confidence: "Medium",
      summary: "The notice may concern uploaded content, an asset, avatar item, or another moderated creation.",
      found: ["Content-related language detected", "User-provided text"],
      missing: ["Asset/content ID", "Screenshot of the content", "Exact moderation wording"],
    };
  }

  return {
    category: "Needs Review",
    confidence: text.trim().length > 80 ? "Medium" : "Low",
    summary: "There is not enough structured information to confidently classify this case yet.",
    found: text.trim() ? ["User-provided text received"] : [],
    missing: ["Moderation notice", "Reason shown by Roblox", "Any previous support response"],
  };
}

export const questionsByCategory: Record<string, string[]> = {
  "Billing / Disputed Charge": [
    "Who made the purchase(s) on the account?",
    "Was any charge disputed, reversed, or reported as unauthorized?",
    "Do you have a Roblox receipt or transaction ID?",
    "What outcome are you asking Roblox to review?",
  ],
  "Chat / Harassment": [
    "What did the moderation notice say exactly?",
    "Was the message quoted by Roblox complete or missing context?",
    "Was this the first moderation action for this type of issue?",
    "What specific review are you requesting?",
  ],
  "Cheating / Exploiting": [
    "What exact exploit/cheating reason was shown?",
    "Was the account shared or possibly compromised?",
    "Were any third-party tools installed or running?",
    "What evidence can support your explanation?",
  ],
  "Compromised Account": [
    "When did you first notice unusual activity?",
    "Did you receive any login/security emails?",
    "Have you changed the password and enabled security protections?",
    "What ownership proof can you provide?",
  ],
  "Content / Asset Moderation": [
    "Which asset, image, avatar item, or content was involved?",
    "What did Roblox say violated the rules?",
    "Do you have the original content or screenshot?",
    "What part of the decision do you want reviewed?",
  ],
  "Needs Review": [
    "What exact reason did Roblox show?",
    "When was the action taken?",
    "Have you already contacted support?",
    "What result are you requesting?",
  ],
};

export function buildAppeal(category: string, answers: Record<string, string>, sourceText: string) {
  const details = Object.values(answers).filter(Boolean);
  const detailList = details.length ? details.map((value) => `- ${value}`).join("\n") : "- No additional answers provided yet.";

  return `Subject: Request for Manual Review of Roblox Moderation Decision\n\nHello Roblox Support,\n\nI am requesting a manual review of the moderation action on this account. The case appears to relate to: ${category}.\n\nRelevant information I can provide:\n${detailList}\n\nI want to make sure the review is based on accurate information. I am not asking for special treatment or attempting to bypass Roblox rules. If additional documentation, transaction details, or account verification is needed, please tell me exactly what would help you review the case.\n\n${sourceText.trim() ? "The moderation/support wording I received has been preserved in this case for reference." : "I can provide the original moderation notice if needed."}\n\nThank you for reviewing the case.\n`;
}
