export class AppError extends Error {
  constructor(message, status = 400, code = "INVALID_REQUEST") {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function errorResponse(error) {
  const known = error instanceof AppError;
  if (!known)
    console.error("Request failed:", error?.code || error?.name || "Error");
  return Response.json(
    {
      error: known ? error.message : "ประมวลผลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
      code: known ? error.code : "INTERNAL_ERROR",
    },
    {
      status: known ? error.status : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
