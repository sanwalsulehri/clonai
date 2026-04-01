import { NextResponse } from "next/server";
import { createClone } from "@/lib/cloneStore";

export async function POST(request) {
  try {
    const body = await request.json();
    const name = body?.name?.trim();
    const personality = body?.personality?.trim();
    const style = body?.style?.trim();
    const tone = body?.tone?.trim();
    const goals = "Stay in character and answer point-to-point.";
    const doNotUse = "";
    const responseLength = "balanced";

    if (!name || !personality || !style || !tone) {
      return NextResponse.json(
        {
          error: "name, personality, style, and tone are required.",
        },
        { status: 400 },
      );
    }

    const clone = createClone({
      name,
      personality,
      style,
      tone,
      responseLength,
      goals,
      doNotUse,
    });
    return NextResponse.json(clone, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create clone." },
      { status: 500 },
    );
  }
}
