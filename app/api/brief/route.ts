import { NextRequest } from "next/server";
import { checkBriefRateLimit, getClientIp } from "@/rag/ratelimit";
import {
  briefRequestSchema,
  briefResponseSchema,
  type BriefResponse,
} from "@/rag/brief-contract";
import {
  BRIEF_GROUNDING_SYSTEM_PREAMBLE,
  buildUnknownBriefResponse,
  claimStatusForBrief,
  classifyBriefQuestion,
  confidenceFromRetrieval,
  evidenceFromRetrieval,
  knowledgeFromReindexState,
  validateGeneratedBriefAnswer,
} from "@/rag/brief-policy";
import { retrieveSalemEvidence } from "@/rag/retrieve";
import { createRedisReindexStateStore } from "@/rag/reindex-freshness";
import {
  BRIEF_READ_SCOPE,
  authenticateBriefRead,
  briefAuthHttpStatus,
  type BriefAuthStatus,
} from "./auth";

// Freshness reads share the existing reindex module, whose dependency graph
// includes Node filesystem modules through the indexer. Keep Brief on Node
// rather than pretending that graph is Edge-compatible or duplicating state.
export const runtime = "nodejs";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://docs.opencoven.ai",
  "https://opencoven.ai",
  "https://salem.opencoven.ai",
];

const ALLOWED_MODELS = [
  "gpt-5-nano",
  "gpt-5-mini",
  "gpt-5",
  "gpt-5.1",
  "gpt-5.2",
];

function allowedOrigins(): string[] {
  const configured = process.env.ALLOWED_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  const allowedOrigin = origin && allowedOrigins().includes(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin",
  };
}

function jsonResponse(
  request: Request,
  data: object,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
      ...headers,
    },
  });
}

function authFailure(
  request: Request,
  status: Exclude<BriefAuthStatus, "authorized">,
) {
  const httpStatus = briefAuthHttpStatus(status);
  const code = `BRIEF_AUTH_${status.replaceAll("-", "_").toUpperCase()}`;
  const headers: Record<string, string> = {};
  if (httpStatus === 401) {
    headers["WWW-Authenticate"] = `Bearer scope="${BRIEF_READ_SCOPE}"`;
  }
  return jsonResponse(
    request,
    {
      error:
        status === "not-configured"
          ? "Quick Answer access is not configured"
          : status === "revoked"
            ? "Quick Answer credential has been revoked"
            : "Valid Quick Answer credential required",
      code,
      status: httpStatus,
    },
    httpStatus,
    headers,
  );
}

export async function OPTIONS(request: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

async function currentKnowledge() {
  const store = createRedisReindexStateStore();
  if (!store) return knowledgeFromReindexState(null);
  try {
    return knowledgeFromReindexState(await store.get());
  } catch (error) {
    console.warn("Brief freshness read failed:", error);
    return knowledgeFromReindexState(null);
  }
}

function generateQueryId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `brief-${timestamp}-${random}`;
}

function successResponse(
  request: Request,
  response: BriefResponse,
  rateLimitHeaders: Record<string, string>,
) {
  const validated = briefResponseSchema.parse(response);
  return jsonResponse(request, validated, 200, {
    ...rateLimitHeaders,
    "X-Query-Id": validated.queryId,
    "X-Claim-Status": validated.classification.claimStatus,
    "X-Confidence": validated.classification.confidence,
    "X-Knowledge-Freshness": validated.knowledge.freshness,
  });
}

export async function POST(request: NextRequest) {
  const queryId = generateQueryId();

  const auth = await authenticateBriefRead(request.headers.get("authorization"));
  if (auth.status !== "authorized" || !auth.fingerprint) {
    return authFailure(request, auth.status as Exclude<BriefAuthStatus, "authorized">);
  }

  const requestHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    requestHeaders[key] = value;
  });
  const clientIp = getClientIp(requestHeaders);
  const rateLimit = await checkBriefRateLimit(`${auth.fingerprint}:${clientIp}`);
  const rateLimitHeaders: Record<string, string> = {};
  if (rateLimit) {
    rateLimitHeaders["X-RateLimit-Limit"] = rateLimit.limit.toString();
    rateLimitHeaders["X-RateLimit-Remaining"] = rateLimit.remaining.toString();
    rateLimitHeaders["X-RateLimit-Reset"] = rateLimit.reset.toString();
    if (!rateLimit.success) {
      rateLimitHeaders["Retry-After"] = Math.ceil(
        (rateLimit.reset - Date.now()) / 1000,
      ).toString();
      return jsonResponse(
        request,
        { error: "Too many Quick Answer requests. Please try again later.", code: "BRIEF_RATE_LIMITED", status: 429 },
        429,
        rateLimitHeaders,
      );
    }
  }

  let briefRequest;
  try {
    briefRequest = briefRequestSchema.parse(await request.json());
  } catch (error) {
    return jsonResponse(
      request,
      { error: error instanceof Error ? error.message : "Invalid request", status: 400 },
      400,
      rateLimitHeaders,
    );
  }

  const knowledge = await currentKnowledge();

  let retrieval;
  try {
    retrieval = await retrieveSalemEvidence({
      query: briefRequest.question,
      userStrategy: "auto",
      canAccessPrivate: false,
    });
  } catch (error) {
    console.error("Brief retrieval failed:", error);
    const unknown = buildUnknownBriefResponse({
      request: briefRequest,
      queryId,
      knowledge,
      reason: "Salem could not retrieve enough current OpenCoven evidence to answer reliably.",
    });
    return successResponse(request, unknown, rateLimitHeaders);
  }

  const claimStatus = claimStatusForBrief({
    question: briefRequest.question,
    retrieval,
  });

  if (claimStatus === "unknown") {
    const kind = classifyBriefQuestion(briefRequest.question);
    const reason = retrieval.isLowConfidence
      ? "The available OpenCoven evidence did not meet the retrieval confidence threshold."
      : kind === "release_sensitive"
        ? "The current Salem corpus does not carry pinned implementation or release evidence strong enough to establish current availability."
        : "The question asks Salem to overstate or bypass the available evidence.";
    return successResponse(
      request,
      buildUnknownBriefResponse({
        request: briefRequest,
        queryId,
        knowledge,
        reason,
      }),
      rateLimitHeaders,
    );
  }

  const evidence = evidenceFromRetrieval(retrieval.results);
  if (evidence.length === 0) {
    return successResponse(
      request,
      buildUnknownBriefResponse({
        request: briefRequest,
        queryId,
        knowledge,
        reason: "No citable OpenCoven evidence remained after retrieval filtering.",
      }),
      rateLimitHeaders,
    );
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return jsonResponse(
      request,
      { error: "Server configuration error", status: 500 },
      500,
      rateLimitHeaders,
    );
  }

  const configuredModel = process.env.DEFAULT_BRIEF_MODEL || process.env.DEFAULT_CHAT_MODEL || "gpt-5-mini";
  const model = ALLOWED_MODELS.includes(configuredModel) ? configuredModel : "gpt-5-mini";

  const evidenceBlock = evidence
    .map(
      (item) =>
        `EVIDENCE ${item.id}\nTITLE: ${item.title}\nSOURCE: ${item.url ?? "non-public source"}\nEXCERPT:\n${item.summary.slice(0, 1200)}`,
    )
    .join("\n\n---\n\n");

  const generationResponse = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: BRIEF_GROUNDING_SYSTEM_PREAMBLE },
          {
            role: "user",
            content: `QUESTION: ${briefRequest.question}\nAUDIENCE: ${briefRequest.audience}\nDEPTH: ${briefRequest.depth}\n\n${evidenceBlock}`,
          },
        ],
      }),
    },
  );

  if (!generationResponse.ok) {
    return jsonResponse(
      request,
      { error: `OpenAI API error: ${generationResponse.status}`, status: 502 },
      502,
      rateLimitHeaders,
    );
  }

  let generated: unknown;
  try {
    const payload = await generationResponse.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("missing generated content");
    generated = JSON.parse(content);
  } catch (error) {
    console.warn("Brief generation parse failed:", error);
    return successResponse(
      request,
      buildUnknownBriefResponse({
        request: briefRequest,
        queryId,
        knowledge,
        reason: "Salem could not validate a grounded speakable answer from the retrieved evidence.",
      }),
      rateLimitHeaders,
    );
  }

  const validEvidenceIds = new Set(evidence.map((item) => item.id));
  const answer = validateGeneratedBriefAnswer(generated, validEvidenceIds);
  if (!answer) {
    return successResponse(
      request,
      buildUnknownBriefResponse({
        request: briefRequest,
        queryId,
        knowledge,
        reason: "The drafted answer exceeded Salem's evidence or safety claim boundary.",
      }),
      rateLimitHeaders,
    );
  }

  const citedEvidence = evidence.filter((item) =>
    answer.evidenceIds.includes(item.id),
  );

  const response: BriefResponse = {
    schemaVersion: "opencoven.salem-brief/v1",
    queryId,
    question: briefRequest.question,
    answer: {
      sayThis: answer.sayThis,
      followUp: answer.followUp,
      caveats: answer.caveats,
    },
    classification: {
      claimStatus,
      confidence: confidenceFromRetrieval(retrieval),
      safeToGeneralize: false,
    },
    evidence: citedEvidence,
    knowledge,
  };

  try {
    return successResponse(request, response, rateLimitHeaders);
  } catch (error) {
    console.warn("Brief response validation failed:", error);
    return successResponse(
      request,
      buildUnknownBriefResponse({
        request: briefRequest,
        queryId,
        knowledge,
        reason: "The generated response did not satisfy the Salem Brief wire contract.",
      }),
      rateLimitHeaders,
    );
  }
}
