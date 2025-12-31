export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getDb } from "../../../../src/lib/mongodb";
import { ObjectId } from "mongodb";
import { auth } from "@clerk/nextjs/server";

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { userId: clerkUserId } = await auth();

        if (!clerkUserId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const db = await getDb();
        const quizzes = db.collection("quizzes");

        const _id = (() => {
            try {
                return new ObjectId(id);
            } catch {
                return id as any;
            }
        })();

        // Build update object conditionally
        const updateDoc: any = {};

        if (Array.isArray(body.sectionMarkers)) {
            // Validate and sort section markers
            const markers = body.sectionMarkers
                .filter((m: any) => typeof m === "number" && m >= 0)
                .sort((a: number, b: number) => a - b);
            updateDoc.sectionMarkers = markers;
        }

        if (Array.isArray(body.sectionNames)) {
            updateDoc.sectionNames = body.sectionNames;
        }

        // If both are provided, validate they match in length
        if (updateDoc.sectionMarkers && updateDoc.sectionNames) {
            if (updateDoc.sectionMarkers.length !== updateDoc.sectionNames.length) {
                return NextResponse.json(
                    { error: "Section markers and names must have the same length" },
                    { status: 400 }
                );
            }
        }

        if (Object.keys(updateDoc).length === 0) {
            return NextResponse.json(
                { error: "No valid updates provided" },
                { status: 400 }
            );
        }

        const result = await quizzes.updateOne(
            { _id, userId: clerkUserId } as any,
            { $set: updateDoc }
        );

        if (result.matchedCount === 0) {
            return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("PATCH /api/quizzes/[id] error:", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
