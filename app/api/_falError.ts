const ERROR_MESSAGES: Record<string, string> = {
  no_media_generated:
    'Unable to generate — the prompt may contain unsafe content or be incompatible with this model. Try rephrasing.',
  content_moderation: 'Blocked by content moderation. Please revise your prompt.',
  invalid_input: 'Invalid input — please check your prompt and try again.',
  rate_limit_exceeded: 'Too many requests — please wait a moment and try again.',
};

interface FalErrorDetail {
  type?: string;
  msg?: string;
}

interface FalError {
  status?: unknown;
  body?: unknown;
  message?: string;
}

export function friendlyFalError(
  err: FalError,
  fallback = 'Generation failed — please try again.'
): string {
  const body = err.body as { detail?: FalErrorDetail[] | string; error?: string } | undefined;
  if (body) {
    if (Array.isArray(body.detail) && body.detail.length > 0) {
      const first = body.detail[0];
      return (first?.type ? ERROR_MESSAGES[first.type] : undefined) ?? first?.msg ?? fallback;
    }
    if (typeof body.detail === 'string') {
      if (body.detail.includes('Exhausted balance')) {
        return 'Out of FAL credits — top up at fal.ai/dashboard/billing.';
      }
      if (body.detail.includes('locked')) {
        return 'FAL account is locked — check your account status at fal.ai/dashboard.';
      }
      return body.detail;
    }
    if (typeof body.error === 'string') return body.error;
  }
  return err.message ?? fallback;
}
