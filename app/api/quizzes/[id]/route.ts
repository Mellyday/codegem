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
        // N markers create N+1 sections: [0, marker1), [marker1, marker2), ..., [lastMarker, end)
        // So we need N+1 section names for N markers
        if (updateDoc.sectionMarkers && updateDoc.sectionNames) {
            const expectedNames = updateDoc.sectionMarkers.length + 1;
            if (updateDoc.sectionNames.length !== expectedNames) {
                return NextResponse.json(
                    { error: `Expected ${expectedNames} section names for ${updateDoc.sectionMarkers.length} markers, got ${updateDoc.sectionNames.length}` },
                    { status: 400 }
                );
            }
        }

        // Handle setting isCanonical
        if (typeof body.isCanonical === "boolean") {
            updateDoc.isCanonical = body.isCanonical;

            // If setting as canonical, we need to unset on other quizzes for the same file
            if (body.isCanonical === true) {
                // First, get this quiz's fileId to find sibling quizzes
                const thisQuiz = await quizzes.findOne(
                    { _id, userId: clerkUserId } as any,
                    { projection: { fileId: 1 } }
                );

                if (thisQuiz && thisQuiz.fileId) {
                    // Unset isCanonical on all other quizzes for this file
                    await quizzes.updateMany(
                        {
                            userId: clerkUserId,
                            fileId: thisQuiz.fileId,
                            _id: { $ne: _id },
                        } as any,
                        { $set: { isCanonical: false } }
                    );
                }
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
