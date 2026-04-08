import type { Response } from "express";

export type ApiErrorCode =
  | "bad_request"
  | "not_found"
  | "conflict"
  | "validation_error"
  | "internal_error";

export function sendApiError(
  response: Response,
  status: number,
  message: string,
  code: ApiErrorCode,
  details?: unknown
) {
  response.status(status).json({
    error: message,
    code,
    ...(details === undefined ? {} : { details })
  });
}
