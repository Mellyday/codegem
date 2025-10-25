import { clerkMiddleware } from "@clerk/nextjs/server";

export default clerkMiddleware(async (auth, req) => {
  const ownerEmail = process.env.OWNER_EMAIL;

  // Always allow the unauthorized page to render to avoid redirect loops
  const pathname = req.nextUrl?.pathname || new URL(req.url).pathname;
  if (pathname.startsWith("/unauthorized")) return;

  if (ownerEmail) {
    const { userId, sessionClaims } = await auth();
    // If not signed in, allow access (UI shows sign-in controls)
    if (!userId) return;

    const email =
      (sessionClaims as any)?.email ||
      ((sessionClaims as any)?.email_addresses?.[0] as string) ||
      "";
    if (email.toLowerCase() !== ownerEmail.toLowerCase()) {
      const url = new URL("/unauthorized", req.url);
      return Response.redirect(url);
    }
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
