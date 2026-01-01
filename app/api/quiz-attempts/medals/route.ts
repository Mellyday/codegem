import { GET as baseGet } from "../route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return baseGet(request);
}
