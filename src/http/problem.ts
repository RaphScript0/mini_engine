export interface FieldError {
  path: string;
  message: string;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  requestId?: string;
  errors?: FieldError[];
}

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export function problem(params: Omit<Problem, "type" | "title"> & { code: string; detail?: string; instance?: string; errors?: FieldError[]; requestId?: string }): Problem {
  const type = `https://errors.mini-engine.local/${params.code.toLowerCase().replace(/_/g, "-")}`;
  const title = codeToTitle(params.code);
  return {
    type,
    title,
    status: params.status,
    detail: params.detail,
    instance: params.instance,
    code: params.code,
    requestId: params.requestId,
    errors: params.errors,
  };
}

function codeToTitle(code: string): string {
  switch (code) {
    case "INVALID_ARGUMENT":
      return "Invalid argument";
    case "UNSUPPORTED_MEDIA_TYPE":
      return "Unsupported media type";
    case "UNPROCESSABLE_ENTITY":
      return "Unprocessable entity";
    case "RATE_LIMITED":
      return "Rate limited";
    case "NOT_FOUND":
      return "Not found";
    default:
      return "Internal error";
  }
}
