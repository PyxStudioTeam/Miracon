export class WorkerError extends Error {
  constructor(message, { retryable = true, cause } = {}) {
    super(message, { cause });
    this.name = new.target.name;
    this.retryable = retryable;
  }
}

export class InvalidJobError extends WorkerError {
  constructor(message, options = {}) {
    super(message, { ...options, retryable: false });
  }
}

export class LeaseLostError extends WorkerError {
  constructor(message = "Job lease was lost") {
    super(message, { retryable: true });
  }
}

export function errorDetails(error) {
  if (!(error instanceof Error)) {
    return { error: String(error).slice(0, 2000) };
  }

  return {
    error: error.message.slice(0, 2000),
    error_name: error.name,
    ...(typeof error.code === "string" ? { error_code: error.code } : {}),
    ...(typeof error.status === "number" ? { status: error.status } : {}),
  };
}

export function isRetryable(error) {
  if (typeof error?.retryable === "boolean") return error.retryable;
  if (typeof error?.status === "number") {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return true;
}
