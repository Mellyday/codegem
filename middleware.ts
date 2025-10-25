import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware(async (_auth, req) => {
  // Always allow the unauthorized page to render to avoid redirect loops
  const pathname = req.nextUrl?.pathname || new URL(req.url).pathname;
  if (pathname.startsWith("/unauthorized")) return;
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
