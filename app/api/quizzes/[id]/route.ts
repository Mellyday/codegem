export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { getDb, toJson, fromJson } from "../../../../src/lib/sqlite";
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

        const db = getDb();

        // Build update SET clauses dynamically
        const updates: string[] = [];
        const values: any[] = [];

        if (Array.isArray(body.sectionMarkers)) {
            // Validate and sort section markers
            const markers = body.sectionMarkers
                .filter((m: any) => typeof m === "number" && m >= 0)
                .sort((a: number, b: number) => a - b);
            updates.push("section_markers = ?");
            values.push(toJson(markers));
        }

        if (Array.isArray(body.sectionNames)) {
            updates.push("section_names = ?");
            values.push(toJson(body.sectionNames));
        }

        // If both are provided, validate they match in length
        if (body.sectionMarkers && body.sectionNames) {
            const markers = body.sectionMarkers
                .filter((m: any) => typeof m === "number" && m >= 0)
                .sort((a: number, b: number) => a - b);
            const expectedNames = markers.length + 1;
            if (body.sectionNames.length !== expectedNames) {
                return NextResponse.json(
                    { error: `Expected ${expectedNames} section names for ${markers.length} markers, got ${body.sectionNames.length}` },
                    { status: 400 }
                );
            }
        }

        // Handle setting isCanonical
        if (typeof body.isCanonical === "boolean") {
            updates.push("is_canonical = ?");
            values.push(body.isCanonical ? 1 : 0);

            // If setting as canonical, we need to unset on other quizzes for the same file
            if (body.isCanonical === true) {
                // First, get this quiz's fileId to find sibling quizzes
                const thisQuiz = db.prepare(`
                    SELECT file_id FROM quizzes WHERE id = ? AND user_id = ?
                `).get(id, clerkUserId) as { file_id: string } | undefined;

                if (thisQuiz && thisQuiz.file_id) {
                    // Unset isCanonical on all other quizzes for this file
                    db.prepare(`
                        UPDATE quizzes SET is_canonical = 0
                        WHERE user_id = ? AND file_id = ? AND id != ?
                    `).run(clerkUserId, thisQuiz.file_id, id);
                }
            }
        }

        if (updates.length === 0) {
            return NextResponse.json(
                { error: "No valid updates provided" },
                { status: 400 }
            );
        }

        values.push(id, clerkUserId);
        const result = db.prepare(`
            UPDATE quizzes SET ${updates.join(", ")}
            WHERE id = ? AND user_id = ?
        `).run(...values);

        if (result.changes === 0) {
            return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("PATCH /api/quizzes/[id] error:", error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
