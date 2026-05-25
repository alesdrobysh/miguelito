export interface ApiResponse {
  status: number;
  contentType: string;
  body: string;
}

export function json(status: number, data: unknown): ApiResponse {
  return { status, contentType: "application/json; charset=utf-8", body: JSON.stringify(data) };
}
