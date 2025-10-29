import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/unauthorized(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/(.*)",
  "/repo(.*)",
  "/project(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.redirect(new URL("/sign-in", req.url));
    }
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)", "/(api|trpc)(.*)"],
};
