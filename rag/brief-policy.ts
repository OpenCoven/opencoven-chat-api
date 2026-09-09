import type {
  BriefEvidence,
  BriefKnowledge,
  BriefResponse,
  ClaimStatus,
  Confidence,
} from "./brief-contract";

export type BriefQuestionClass =
  | "release_sensitive"
  | "security_privacy"
  | "architecture"
  | "comparison"
  | "general";

const RELEASE_PATTERNS = [
  /\b(shipped|released|available|production[- ]?ready|works? now|supported now|install|current version|today)\b/i,
  /\bdoes .* support\b/i,
  /\bcan users?\b/i,
];
const SECURITY_PATTERNS = [
  /\b(secur(?:e|ity)|private|privacy|authorization|authentication|encrypted|encryption|permission|compliance|certif(?:ied|ication))\b/i,
];
const ARCHITECTURE_PATTERNS = [
  /\b(SPAR|Threads|Psyche|Coven|Cave|Familiar Contract|runtime|orchestration|identity|continuity)\b/i,
];
const COMPARISON_PATTERNS = [
  /\b(vs\.?|versus|compared? to|difference between|different from|just memory)\b/i,
];

export function classifyBriefQuestion(question: string): BriefQuestionClass {
  if (RELEASE_PATTERNS.some((pattern) => pattern.test(question))) return "release_sensitive";
  if (SECURITY_PATTERNS.some((pattern) => pattern.test(question))) return "security_privacy";
  if (COMPARISON_PATTERNS.some((pattern) => pattern.test(question))) return "comparison";
  if (ARCHITECTURE_PATTERNS.some((pattern) => pattern.test(question))) return "architecture";
  return "general";
}

export function confidenceFromScore(bestScore: number, lowConfidence: boolean): Confidence {
  if (lowConfidence) return "low";
  if (bestScore >= 0.65) return "high";
  return "medium";
}

export function maximumClaimStatus(
  questionClass: BriefQuestionClass,
  evidence: BriefEvidence[],
): ClaimStatus {
  if (evidence.length === 0) return "unknown";

  const hasVerified = evidence.some((item) => item.sourceAuthority === "verification_evidence" && Boolean(item.revision || item.sourceHash));
  const hasImplementation = evidence.some((item) => item.sourceAuthority === "implementation" && Boolean(item.revision || item.sourceHash));
  const hasNormative = evidence.some((item) => item.sourceAuthority === "normative");
  const hasApprovedDesign = evidence.some((item) => item.sourceAuthority === "approved_design");

  if (questionClass === "release_sensitive") {
    if (hasVerified) return "verified";
    if (hasImplementation) return "implemented";
    return "unknown";
  }

  if (hasVerified) return "verified";
  if (hasImplementation) return "implemented";
  if (hasNormative || evidence.some((item) => item.sourceAuthority === "canonical_docs")) return "specified";
  if (hasApprovedDesign) return "approved_design";
  return "unknown";
}

const UNSAFE_OUTPUT_PATTERNS = [
  /\bsupports? every (?:LLM|model|provider)\b/i,
  /\bworks? with every (?:LLM|model|provider)\b/i,
  /\bguarantees? privacy\b/i,
  /\bguaranteed private\b/i,
  /\bdefinitely secure\b/i,
  /\bfully secure\b/i,
  /\bsecurity certified\b/i,
  /\bis (?:alive|conscious|sentient)\b/i,
  /\blegally owns?\b/i,
];

export function hasUnsafeUnsupportedLanguage(text: string): boolean {
  return UNSAFE_OUTPUT_PATTERNS.some((pattern) => pattern.test(text));
}

export function unknownBriefResponse({
  queryId,
  question,
  knowledge,
  caveat,
}: {
  queryId: string;
  question: string;
  knowledge: BriefKnowledge;
  caveat?: string;
}): BriefResponse {
  return {
    schemaVersion: "opencoven.salem-brief/v1",
    queryId,
    question,
    answer: {
      sayThis: "I wouldn't claim that yet.",
      followUp: "I couldn't find current OpenCoven evidence strong enough to support a more specific claim.",
      caveats: caveat ? [caveat] : [],
    },
    classification: {
      claimStatus: "unknown",
      confidence: "low",
      safeToGeneralize: false,
    },
    evidence: [],
    knowledge,
  };
}
