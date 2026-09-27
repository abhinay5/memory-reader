import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

/** Minimal model interface the pipeline depends on; swap for a serverless proxy later. */
export interface StructuredLLM {
  readonly model: string;
  complete<T>(request: StructuredRequest<T>): Promise<T>;
}

export interface StructuredRequest<T> {
  /** Short name used in error messages ("analysis", "cards"...). */
  name: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** How hard the model should think. Lower is faster; review/reformulation need less than comprehension. */
  effort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}

export type AIErrorKind = "auth" | "rate_limit" | "network" | "model" | "refusal" | "bad_output" | "aborted" | "overloaded" | "other";

export class AIError extends Error {
  constructor(
    public readonly kind: AIErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AIError";
  }
}

class OutputError extends Error {}

function mapApiError(err: unknown): AIError {
  if (err instanceof AIError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new AIError("aborted", "Cancelled.");
  if (err instanceof Anthropic.AuthenticationError) {
    return new AIError("auth", "Anthropic rejected the API key. Check it in Settings.");
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AIError("auth", "This Anthropic API key isn't allowed to use the selected model.");
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AIError("model", "The selected Claude model isn't available to this API key. Choose another model in Settings.");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AIError("rate_limit", "Anthropic rate limit reached. Wait a minute and retry.");
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AIError("network", "Couldn't reach Anthropic. Check your internet connection — your highlights and cards are still saved.");
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new AIError("overloaded", "Anthropic is temporarily overloaded or unavailable. Retry in a moment.");
  }
  if (err instanceof Anthropic.BadRequestError) {
    const msg = err.message || "Bad request";
    if (/credit balance/i.test(msg)) return new AIError("auth", "Your Anthropic account has no remaining credit.");
    return new AIError("other", `Anthropic rejected the request: ${msg}`);
  }
  if (err instanceof Anthropic.APIError) return new AIError("other", err.message);
  return new AIError("other", err instanceof Error ? err.message : String(err));
}

export class AnthropicLLM implements StructuredLLM {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    public readonly model: string,
  ) {
    // The key belongs to the user and is only ever sent to api.anthropic.com.
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  }

  async complete<T>({ name, system, user, schema, maxTokens = 32000, effort = "medium", signal }: StructuredRequest<T>): Promise<T> {
    let lastProblem = "";
    // One automatic structured retry if the output can't be parsed/validated.
    for (let attempt = 0; attempt < 2; attempt++) {
      const content =
        attempt === 0
          ? user
          : `${user}\n\n<retry_note>Your previous response could not be used (${lastProblem}). Respond again, following the output schema exactly.</retry_note>`;
      try {
        const stream = this.client.messages.stream(
          {
            model: this.model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: "user", content }],
            // Haiku 4.5 doesn't accept the effort setting.
            output_config: { format: zodOutputFormat(schema), ...(this.model.startsWith("claude-haiku") ? {} : { effort }) },
          },
          { signal },
        );
        const message = await stream.finalMessage();
        if (message.stop_reason === "refusal") {
          throw new AIError("refusal", "Claude declined to process this material.");
        }
        if (message.stop_reason === "max_tokens") throw new OutputError("the response was cut off");
        const parsed = schema.safeParse(message.parsed_output);
        if (!parsed.success) throw new OutputError(parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
        return parsed.data;
      } catch (err) {
        if (err instanceof AIError || err instanceof Anthropic.APIError) throw mapApiError(err);
        if (signal?.aborted) throw new AIError("aborted", "Cancelled.");
        // Anything else (unparseable JSON, schema mismatch, truncated output) is an output problem.
        if (err instanceof Error) {
          lastProblem = err.message;
          continue;
        }
        throw mapApiError(err);
      }
    }
    throw new AIError("bad_output", `Claude returned an unusable ${name} response twice (${lastProblem}). Please retry.`);
  }
}

/** Cheap call used by Settings → Test connection. */
export async function testAnthropicKey(apiKey: string, model: string): Promise<void> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
  try {
    await client.messages.create({ model, max_tokens: 16, messages: [{ role: "user", content: "Reply with OK." }] });
  } catch (err) {
    throw mapApiError(err);
  }
}
