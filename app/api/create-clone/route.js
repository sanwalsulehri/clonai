import { NextResponse } from "next/server";
import { createClone } from "@/lib/cloneStore";

export async function POST(request) {
  try {
    const body = await request.json();
    const name = body?.name?.trim();
    const personality = body?.personality?.trim();
    const style = body?.style?.trim();

    if (!name || !personality || !style) {
      return NextResponse.json(
        { error: "name, personality, and style are required." },
        { status: 400 },
      );
    }

    const clone = createClone({ name, personality, style });
    return NextResponse.json(clone, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create clone." },
      { status: 500 },
    );
  }
}
